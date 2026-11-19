// GPU render target: N color attachments (+ optional depth texture) in a single FBO.

export class Framebuffer {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {number} width
   * @param {number} height
   * @param {Array<{internalFormat:number, format:number, type:number, filter?:number}>} colorSpecs
   * @param {{depthTexture?: boolean}} [options]
   */
  constructor(gl, width, height, colorSpecs, options = {}) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.colorSpecs = colorSpecs;
    this.wantDepthTexture = options.depthTexture !== false;
    this.colors = [];
    this.depth = null;
    this.fbo = gl.createFramebuffer();
    this._allocate();
  }

  _allocate() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);

    this.colors = this.colorSpecs.map((spec, index) => {
      const gl2 = this.gl;
      const tex = gl2.createTexture();
      gl2.bindTexture(gl2.TEXTURE_2D, tex);
      gl2.texImage2D(
        gl2.TEXTURE_2D, 0, spec.internalFormat,
        this.width, this.height, 0,
        spec.format, spec.type, null,
      );
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, spec.filter ?? gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, spec.filter ?? gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
      gl2.framebufferTexture2D(
        gl2.FRAMEBUFFER, gl2.COLOR_ATTACHMENT0 + index, gl2.TEXTURE_2D, tex, 0,
      );
      return tex;
    });

    if (this.colors.length > 0) {
      gl.drawBuffers(this.colors.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    } else {
      gl.drawBuffers([gl.NONE]);
    }

    if (this.wantDepthTexture) {
      this.depth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.depth);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24,
        this.width, this.height, 0,
        gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.depth, 0,
      );
    }

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(
        `Framebuffer incomplete (0x${status.toString(16)}) at ${this.width}x${this.height}`,
      );
    }
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return false;
    this.dispose();
    this.width = width;
    this.height = height;
    this.fbo = this.gl.createFramebuffer();
    this._allocate();
    return true;
  }

  bind() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);
    return this;
  }

  dispose() {
    const gl = this.gl;
    this.colors.forEach((t) => gl.deleteTexture(t));
    this.colors = [];
    if (this.depth) {
      gl.deleteTexture(this.depth);
      this.depth = null;
    }
    if (this.fbo) {
      gl.deleteFramebuffer(this.fbo);
      this.fbo = null;
    }
  }
}
