// Shader compile/link wrapper with uniform caching and readable diagnostics.

function withLineNumbers(source) {
  return source
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3, ' ')} | ${line}`)
    .join('\n');
}

export class Shader {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {string} vertexSource
   * @param {string} fragmentSource
   * @param {string} [name] used in diagnostics
   */
  constructor(gl, vertexSource, fragmentSource, name = 'shader') {
    this.gl = gl;
    this.name = name;
    this.uniforms = new Map();

    const vs = this._compile(gl.VERTEX_SHADER, vertexSource, 'vertex');
    const fs = this._compile(gl.FRAGMENT_SHADER, fragmentSource, 'fragment');

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`[${name}] program link failed:\n${log}`);
    }

    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    this.program = program;
    this._unit = 0;
  }

  static async fromURLs(gl, vertexURL, fragmentURL, name) {
    const [vs, fs] = await Promise.all([
      fetch(vertexURL).then((r) => {
        if (!r.ok) throw new Error(`cannot load ${vertexURL}: HTTP ${r.status}`);
        return r.text();
      }),
      fetch(fragmentURL).then((r) => {
        if (!r.ok) throw new Error(`cannot load ${fragmentURL}: HTTP ${r.status}`);
        return r.text();
      }),
    ]);
    return new Shader(gl, vs, fs, name);
  }

  _compile(type, source, stage) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) || 'unknown compile error';
      gl.deleteShader(shader);
      throw new Error(
        `[${this.name}] ${stage} compile failed:\n${log}\n\n${withLineNumbers(source)}`,
      );
    }
    return shader;
  }

  use() {
    this.gl.useProgram(this.program);
    this._unit = 0;
    return this;
  }

  location(name) {
    if (!this.uniforms.has(name)) {
      const loc = this.gl.getUniformLocation(this.program, name);
      this.uniforms.set(name, loc);
    }
    return this.uniforms.get(name);
  }

  setInt(name, v) {
    const loc = this.location(name);
    if (loc) this.gl.uniform1i(loc, v);
    return this;
  }

  setFloat(name, v) {
    const loc = this.location(name);
    if (loc) this.gl.uniform1f(loc, v);
    return this;
  }

  setVec2(name, x, y) {
    const loc = this.location(name);
    if (loc) this.gl.uniform2f(loc, x, y);
    return this;
  }

  setVec3(name, v) {
    const loc = this.location(name);
    if (loc) this.gl.uniform3f(loc, v[0], v[1], v[2]);
    return this;
  }

  setVec4(name, x, y, z, w) {
    const loc = this.location(name);
    if (loc) this.gl.uniform4f(loc, x, y, z, w);
    return this;
  }

  setMat3(name, m) {
    const loc = this.location(name);
    if (loc) this.gl.uniformMatrix3fv(loc, false, m);
    return this;
  }

  setMat4(name, m) {
    const loc = this.location(name);
    if (loc) this.gl.uniformMatrix4fv(loc, false, m);
    return this;
  }

  setVec3Array(name, arr) {
    const loc = this.location(name);
    if (loc) this.gl.uniform3fv(loc, arr);
    return this;
  }

  bindTexture(name, texture, target = this.gl.TEXTURE_2D) {
    const gl = this.gl;
    const unit = this._unit++;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(target, texture);
    this.setInt(name, unit);
    return this;
  }

  dispose() {
    this.gl.deleteProgram(this.program);
    this.uniforms.clear();
  }
}
