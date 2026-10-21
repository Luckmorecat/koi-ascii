import vertexSrc from './shaders/fullscreen.vert?raw';
import commonSrc from './shaders/common.glsl?raw';
import rippleSrc from './shaders/ripple.frag?raw';
import sceneSrc from './shaders/scene.frag?raw';
import asciiSrc from './shaders/ascii.frag?raw';
import glowSrc from './shaders/glow.frag?raw';
import { Program } from './gl/program';
import { createTarget, createTexture, deleteTarget, type Target, type TexFormat } from './gl/target';
import { buildAtlas, glyphDefines, type Atlas } from './glyphs';
import { FISH_TEXELS, MAX_DROPS, MAX_FISH, layoutDefines } from './koi/layout';
import { varietyDefines } from './koi/varieties';
import { pondUnit, type Pond } from './pond';
import { lightingAt, type Lighting } from './lighting';
import { proto, rgb } from './prototype-palette';

/** World px per ripple simulation texel. */
const RIPPLE_PX = 5;
const RIPPLE_HZ = 60;
const RIPPLE_DAMPING = 0.988;
/** Font size (CSS px) ≈ pond unit / FONT_DIVISOR, so the unit spans ≈ FONT_DIVISOR / LINE_HEIGHT rows. */
const FONT_DIVISOR = 66;
const FONT_MIN = 9;
const FONT_MAX = 22;
/** Smallest font in device px; below this the outline glyphs lose their shape. */
const FONT_MIN_DEVICE = 11;
const BG: [number, number, number] = [0.024, 0.075, 0.102];
/** Halo brightness at glowStrength 1; kept low so glyphs never wash into blobs. */
const GLOW_GAIN = 2.2;
/** Share of the sky's reflection (warm at dawn and dusk) laid over the background. */
const BG_SKY = 0.15;

/**
 * Four passes per frame:
 *  1. ripple — wave equation on a coarse grid (ping-pong)
 *  2. scene  — one fragment per character cell → colour and glyph
 *  3. glow   — one fragment per cell → blurred halo of the bright cells
 *              (skipped on software renderers: no target, no program)
 *  4. ascii  — per screen pixel, copy the cell's glyph from the atlas
 */
export class Renderer {
  raw = false;
  /** Debug switch for the halo; off draws the final view without it. Software renderers have none. */
  glow = true;
  cols = 0;
  rows = 0;
  /** Time of day for the current frame; drives the lighting. */
  phase = 0;
  /** Lighting derived from `phase` for the current frame (the glow pass reads glowStrength). */
  light: Lighting = lightingAt(0);

  private readonly gl: WebGL2RenderingContext;
  private readonly fontFamily: string;
  private readonly vao: WebGLVertexArrayObject;
  private readonly rippleFormat: TexFormat;
  private readonly ripplePacked: boolean;
  private readonly rippleProg: Program;
  private readonly sceneProg: Program;
  private readonly asciiProg: Program;
  private readonly glowProg: Program | null;
  private readonly fishTex: WebGLTexture;
  private readonly dropBuf = new Float32Array(MAX_DROPS * 4);

  private atlas: Atlas | null = null;
  private ripple: [Target, Target] | null = null;
  private scene: Target | null = null;
  private glowTarget: Target | null = null;
  private rippleClock = 0;
  private devW = 1;
  private devH = 1;
  private dpr = 1;
  /** Top-left of the character grid in device px; the grid is centred. */
  private originX = 0;
  private originY = 0;
  private simW = 0;
  private simH = 0;

  /** `software`: a CPU rasteriser; it gets no glow pass (per-cell lighting stays). */
  constructor(gl: WebGL2RenderingContext, fontFamily: string, software: boolean) {
    this.gl = gl;
    this.fontFamily = fontFamily;

    const floatExt = gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
    const half: TexFormat = { internal: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT };
    let packed = true;
    if (floatExt) {
      const probe = createTarget(gl, 4, 4, [half]);
      if (probe) {
        deleteTarget(gl, probe);
        packed = false;
      }
    }
    this.ripplePacked = packed;
    this.rippleFormat = packed ? { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE } : half;

    const defines = layoutDefines() + glyphDefines() + varietyDefines() + (packed ? '#define RIPPLE_PACKED\n' : '');
    const fragment = (src: string) => `#version 300 es\n${defines}${commonSrc}\n${src}`;
    const vertex = `#version 300 es\n${vertexSrc}`;
    this.rippleProg = new Program(gl, vertex, fragment(rippleSrc), 'ripple');
    this.sceneProg = new Program(gl, vertex, fragment(sceneSrc), 'scene');
    this.glowProg = software ? null : new Program(gl, vertex, fragment(glowSrc), 'glow');
    this.asciiProg = new Program(gl, vertex, fragment((software ? '' : '#define GLOW\n') + asciiSrc), 'ascii');

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create a vertex array');
    this.vao = vao;
    this.fishTex = createTexture(gl, FISH_TEXELS, MAX_FISH, {
      internal: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
    });
  }

  get info() {
    return {
      cols: this.cols,
      rows: this.rows,
      cellW: this.atlas?.cellW ?? 0,
      cellH: this.atlas?.cellH ?? 0,
      fontPx: this.atlas?.fontPx ?? 0,
      ripple: `${this.simW}x${this.simH} ${this.ripplePacked ? 'rgba8-packed' : 'rg16f'}`,
    };
  }

  /** Sizes everything for a drawing buffer of devW × devH device pixels. */
  resize(devW: number, devH: number, dpr: number): void {
    const gl = this.gl;
    this.devW = devW;
    this.devH = devH;
    this.dpr = dpr;
    const cssW = devW / dpr;
    const cssH = devH / dpr;

    const fontCss = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(pondUnit(cssW, cssH) / FONT_DIVISOR)));
    const fontPx = Math.max(FONT_MIN_DEVICE, Math.round(fontCss * dpr));
    if (!this.atlas || this.atlas.fontPx !== fontPx) {
      if (this.atlas) gl.deleteTexture(this.atlas.texture);
      this.atlas = buildAtlas(gl, fontPx, this.fontFamily);
    }

    // Whole cells only, centred; the leftover margin is plain background.
    const cols = Math.max(1, Math.floor(devW / this.atlas.cellW));
    const rows = Math.max(1, Math.floor(devH / this.atlas.cellH));
    this.originX = (devW - cols * this.atlas.cellW) >> 1;
    this.originY = (devH - rows * this.atlas.cellH) >> 1;
    if (!this.scene || cols !== this.cols || rows !== this.rows) {
      if (this.scene) deleteTarget(gl, this.scene);
      const rgba8: TexFormat = { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE };
      this.scene = createTarget(gl, cols, rows, [rgba8, rgba8]);
      if (!this.scene) throw new Error('Scene render target is not supported');
      if (this.glowTarget) deleteTarget(gl, this.glowTarget);
      // Linear, so the ASCII pass reads a smooth halo across cell borders.
      this.glowTarget = null;
      if (this.glowProg) {
        // The ascii program samples uGlow whenever it was compiled with GLOW.
        this.glowTarget = createTarget(gl, cols, rows, [rgba8], gl.LINEAR);
        if (!this.glowTarget) throw new Error('Glow render target is not supported');
      }
      this.cols = cols;
      this.rows = rows;
    }

    const simW = Math.ceil(cssW / RIPPLE_PX) + 1;
    const simH = Math.ceil(cssH / RIPPLE_PX) + 1;
    if (!this.ripple || simW !== this.simW || simH !== this.simH) {
      if (this.ripple) this.ripple.forEach((t) => deleteTarget(gl, t));
      const a = createTarget(gl, simW, simH, [this.rippleFormat]);
      const b = createTarget(gl, simW, simH, [this.rippleFormat]);
      if (!a || !b) throw new Error('Ripple render target is not supported');
      this.ripple = [a, b];
      this.simW = simW;
      this.simH = simH;
      // Packed zero height is mid-range, not 0.
      const zero = this.ripplePacked ? 128 / 255 : 0;
      gl.clearColor(zero, 0, zero, 0);
      for (const t of this.ripple) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  /** `phase` is the time of day in [0, 1), 0 = midnight (see sky.ts). */
  render(pond: Pond, dt: number, phase: number): void {
    this.phase = phase;
    const light = (this.light = lightingAt(phase));
    const gl = this.gl;
    const atlas = this.atlas;
    const scene = this.scene;
    if (!atlas || !scene || !this.ripple) return;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // 1. Surface waves at a fixed rate, independent of the display refresh.
    this.rippleClock += dt;
    let steps = Math.floor(this.rippleClock * RIPPLE_HZ);
    this.rippleClock -= steps / RIPPLE_HZ;
    steps = Math.min(steps, 3);
    const rp = this.rippleProg.use();
    rp.ivec2('uSize', this.simW, this.simH).float('uDamping', RIPPLE_DAMPING);
    let ripple = this.ripple;
    for (let s = 0; s < steps; s++) {
      const [src, dst] = ripple;
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, this.simW, this.simH);
      rp.texture('uState', 0, src.textures[0]);
      rp.int('uDropCount', s === 0 ? this.takeDrops(pond) : 0).vec4s('uDrops', this.dropBuf);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ripple = [dst, src];
    }
    this.ripple = ripple;

    // 2. Scene at one fragment per character cell.
    const count = pond.pack();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fishTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, FISH_TEXELS, MAX_FISH, gl.RGBA, gl.FLOAT, pond.data);

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, this.cols, this.rows);
    const unit = pond.unit;
    this.sceneProg
      .use()
      .texture('uFish', 0, this.fishTex)
      .texture('uRipple', 1, ripple[0].textures[0])
      .ivec2('uRippleSize', this.simW, this.simH)
      .float('uRipplePx', RIPPLE_PX)
      .int('uFishCount', count)
      .ints('uOrder', pond.order)
      .vec2('uCell', atlas.cellW / this.dpr, atlas.cellH / this.dpr)
      .vec2('uOriginCss', this.originX / this.dpr, this.originY / this.dpr)
      // Wraps every ~18 h; float32 keeps ~8 ms resolution at the top of the range.
      .float('uTime', pond.time % 65536)
      // Time-of-day lighting, all derived on the CPU from the phase.
      .vec3('uLightDir', ...light.dir)
      .vec3('uLightCol', ...light.color)
      .vec3('uAmbient', ...light.ambient)
      .vec3('uWaterTint', ...light.water)
      .vec3('uSky', ...light.sky)
      .float('uGlint', light.glint)
      .float('uCaustic', light.caustic)
      .float('uFloor', light.floor)
      .vec2('uShadow', unit * light.shadow[0], unit * light.shadow[1])
      .float('uShadowAlpha', light.shadowAlpha)
      // Reduced motion: flicker (ogon twinkle, water glints) runs slower still.
      .float('uCalm', pond.calm ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Halo of the bright cells, at cell resolution. Not needed in the raw view.
    const glowProg = this.raw ? null : this.glowProg;
    if (glowProg && this.glowTarget && !this.glow) {
      // Switched off: an empty halo, since the ascii pass always adds it.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowTarget.fbo);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    } else if (glowProg && this.glowTarget) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.glowTarget.fbo);
      glowProg
        .use()
        .texture('uScene0', 0, scene.textures[0])
        .texture('uScene1', 1, scene.textures[1])
        .ivec2('uGrid', this.cols, this.rows)
        .float('uAspect', atlas.cellW / atlas.cellH)
        .float('uGain', light.glowStrength * GLOW_GAIN);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 4. Glyphs to the screen, on a background graded by the time of day.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.devW, this.devH);
    const bg = BG.map((v, i) => v * light.water[i] + light.sky[i] * BG_SKY) as [number, number, number];
    const ascii = this.asciiProg
      .use()
      .texture('uScene0', 0, scene.textures[0])
      .texture('uScene1', 1, scene.textures[1])
      .texture('uAtlas', 2, atlas.texture)
      .ivec2('uCellPx', atlas.cellW, atlas.cellH)
      .ivec2('uOrigin', this.originX, this.originY)
      .ivec2('uGrid', this.cols, this.rows)
      .int('uCanvasH', this.devH)
      .vec3('uBg', ...bg)
      .vec3('uRawBg', ...BG)
      .int('uRaw', this.raw ? 1 : 0);
    // PROTOTYPE (issue #1): palette model and intensity, see prototype-palette.ts.
    const pr = proto.preset;
    ascii
      .int('uPModel', pr.name === 'pond' ? 0 : { A: 1, B: 2, C: 3 }[proto.variant])
      .vec3('uPBg', ...rgb(pr.bg))
      .vec3('uPRamp0', ...rgb(pr.ramp[0]))
      .vec3('uPRamp1', ...rgb(pr.ramp[1]))
      .vec3('uPRamp2', ...rgb(pr.ramp[2]))
      .vec3('uPWater', ...rgb(pr.water))
      .vec3('uPHi', ...rgb(pr.hi))
      .vec3('uPPale', ...rgb(pr.pale))
      .vec3('uPInk', ...rgb(pr.ink))
      .vec3('uPAccent', ...rgb(pr.accent))
      .vec3('uPTint', ...rgb(pr.tint))
      .float('uPSat', pr.saturation)
      .int('uPInvert', pr.invert ? 1 : 0)
      .float('uPIntensity', proto.intensity);
    if (this.glowTarget) {
      // Bound in the raw view too (stale there, but the raw branch never reads it).
      ascii
        .texture('uGlow', 3, this.glowTarget.textures[0])
        .vec2('uGlowScale', 1 / (this.cols * atlas.cellW), 1 / (this.rows * atlas.cellH));
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Moves up to MAX_DROPS pending impulses into the uniform buffer, in sim texels. */
  private takeDrops(pond: Pond): number {
    const batch = pond.drops.splice(0, MAX_DROPS);
    batch.forEach((d, i) => {
      this.dropBuf[i * 4] = d.x / RIPPLE_PX;
      this.dropBuf[i * 4 + 1] = d.y / RIPPLE_PX;
      this.dropBuf[i * 4 + 2] = Math.max(d.r / RIPPLE_PX, 1.5);
      this.dropBuf[i * 4 + 3] = d.a;
    });
    return batch.length;
  }
}
