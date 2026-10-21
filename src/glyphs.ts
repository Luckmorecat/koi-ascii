/** Every glyph the ASCII pass can emit, keyed by its GLSL constant (G_<KEY>). */
export const GLYPHS = {
  SPACE: ' ',
  DOT: '.',
  COMMA: ',',
  QUOTE: "'",
  BACKTICK: '`',
  COLON: ':',
  MINUS: '-',
  UNDERSCORE: '_',
  TILDE: '~',
  EQUALS: '=',
  PLUS: '+',
  STAR: '*',
  O: 'o',
  HASH: '#',
  PERCENT: '%',
  AT: '@',
  LPAREN: '(',
  RPAREN: ')',
  SLASH: '/',
  BSLASH: '\\',
  PIPE: '|',
} as const;

const CHARS: readonly string[] = Object.values(GLYPHS);

export const LINE_HEIGHT = 1.2;
export const FONT_WEIGHT = 600;

export function glyphDefines(): string {
  return Object.keys(GLYPHS)
    .map((k, i) => `#define G_${k} ${i}\n`)
    .join('');
}

export interface Atlas {
  texture: WebGLTexture;
  /** Cell size in device pixels. */
  cellW: number;
  cellH: number;
  fontPx: number;
}

/**
 * Rasterises the glyph set into a single-row R8 texture, one cell per glyph,
 * at the exact device-pixel cell size so the ASCII pass can copy texels 1:1.
 */
export function buildAtlas(gl: WebGL2RenderingContext, fontPx: number, family: string): Atlas {
  const font = `${FONT_WEIGHT} ${fontPx}px ${family}`;
  const probe = document.createElement('canvas').getContext('2d');
  if (!probe) throw new Error('2D canvas unavailable for the glyph atlas');
  probe.font = font;
  const cellW = Math.max(1, Math.round(probe.measureText('M').width));
  const cellH = Math.max(1, Math.round(fontPx * LINE_HEIGHT));

  // Centre the ink extent of the whole set vertically in the cell.
  let ascent = 0;
  let descent = 0;
  for (const c of CHARS) {
    const m = probe.measureText(c);
    ascent = Math.max(ascent, m.actualBoundingBoxAscent);
    descent = Math.max(descent, m.actualBoundingBoxDescent);
  }
  const baseline = Math.round((cellH - (ascent + descent)) / 2 + ascent);

  const canvas = document.createElement('canvas');
  canvas.width = cellW * CHARS.length;
  canvas.height = cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for the glyph atlas');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  CHARS.forEach((c, i) => {
    // Centre the ink rather than the advance, and squeeze glyphs whose ink
    // overhangs the advance ('%', '@') so the cell does not clip them.
    const m = ctx.measureText(c);
    const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
    const sx = inkW > cellW - 0.5 ? (cellW - 0.5) / inkW : 1;
    const cx = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * cellW, 0, cellW, cellH);
    ctx.clip();
    ctx.translate(i * cellW + cellW / 2, 0);
    ctx.scale(sx, 1);
    ctx.fillText(c, -cx, baseline);
    ctx.restore();
  });

  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not allocate the glyph atlas texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { texture, cellW, cellH, fontPx };
}
