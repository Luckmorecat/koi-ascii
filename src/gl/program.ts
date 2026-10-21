function compile(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`${label}: could not create shader`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    const numbered = source
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(4)}  ${l}`)
      .join('\n');
    gl.deleteShader(shader);
    throw new Error(`${label}: shader compile failed\n${log}\n${numbered}`);
  }
  return shader;
}

/** A linked program with cached uniform lookups. */
export class Program {
  readonly handle: WebGLProgram;
  private readonly gl: WebGL2RenderingContext;
  private readonly locs = new Map<string, WebGLUniformLocation | null>();

  constructor(gl: WebGL2RenderingContext, vertex: string, fragment: string, label: string) {
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, vertex, `${label}.vert`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment, `${label}.frag`);
    const program = gl.createProgram();
    if (!program) throw new Error(`${label}: could not create program`);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`${label}: link failed\n${gl.getProgramInfoLog(program) ?? ''}`);
    }
    this.handle = program;
  }

  use(): this {
    this.gl.useProgram(this.handle);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locs.set(name, l);
    }
    return l;
  }

  int(name: string, v: number): this {
    this.gl.uniform1i(this.loc(name), v);
    return this;
  }

  ivec2(name: string, x: number, y: number): this {
    this.gl.uniform2i(this.loc(name), x, y);
    return this;
  }

  ints(name: string, v: Int32Array): this {
    this.gl.uniform1iv(this.loc(name), v);
    return this;
  }

  float(name: string, v: number): this {
    this.gl.uniform1f(this.loc(name), v);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }

  vec3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.loc(name), x, y, z);
    return this;
  }

  vec3s(name: string, v: Float32Array): this {
    this.gl.uniform3fv(this.loc(name), v);
    return this;
  }

  vec4s(name: string, v: Float32Array): this {
    this.gl.uniform4fv(this.loc(name), v);
    return this;
  }

  texture(name: string, unit: number, tex: WebGLTexture): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(name), unit);
    return this;
  }
}
