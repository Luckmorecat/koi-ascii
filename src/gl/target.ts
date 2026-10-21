export interface TexFormat {
  internal: number;
  format: number;
  type: number;
}

export interface Target {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
}

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  f: TexFormat,
  filter: number = gl.NEAREST,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not allocate a texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, width, height, 0, f.format, f.type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** A framebuffer with one colour attachment per format, or null if incomplete. */
export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  formats: TexFormat[],
): Target | null {
  const fbo = gl.createFramebuffer();
  if (!fbo) return null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  const textures = formats.map((f, i) => {
    const tex = createTexture(gl, width, height, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
    return tex;
  });
  gl.drawBuffers(formats.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const target = { fbo, textures };
  if (!ok) {
    deleteTarget(gl, target);
    return null;
  }
  return target;
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteFramebuffer(t.fbo);
  for (const tex of t.textures) gl.deleteTexture(tex);
}
