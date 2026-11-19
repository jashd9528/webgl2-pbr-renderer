/**
 * Context creation, extension negotiation, the fullscreen-triangle VAO used by every
 * deferred pass, and frame timing statistics.
 */
export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });

    if (!gl) throw new Error('WebGL2 is not available in this browser.');

    this.gl = gl;
    this.extensions = {
      colorBufferFloat: gl.getExtension('EXT_color_buffer_float'),
      floatBlend: gl.getExtension('EXT_float_blend'),
    };

    this.hdrFormat = this.extensions.colorBufferFloat
      ? { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT, filter: gl.LINEAR }
      : { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE, filter: gl.LINEAR };

    this.hdrSupported = Boolean(this.extensions.colorBufferFloat);

    this.emptyVAO = gl.createVertexArray();

    this.stats = {
      fps: 0,
      frameMs: 0,
      _frames: 0,
      _last: performance.now(),
      _accum: 0,
    };

    this.cpuTimeMs = 0;
  }

  /** Draws the 3-vertex fullscreen triangle; requires no attribute buffers. */
  drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  resizeToDisplay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      return true;
    }
    return false;
  }

  tick(now) {
    const s = this.stats;
    s._frames += 1;
    s._accum += now - s._last;
    s._last = now;
    if (s._accum > 400) {
      s.fps = (s._frames * 1000) / s._accum;
      s.frameMs = s._accum / s._frames;
      s._frames = 0;
      s._accum = 0;
    }
    return s;
  }

  readPixelsBase64() {
    const gl = this.gl;
    const { width, height } = this.canvas;
    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    const flipped = document.createElement('canvas');
    flipped.width = width;
    flipped.height = height;
    const ctx = flipped.getContext('2d');
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y += 1) {
      const src = (height - 1 - y) * width * 4;
      image.data.set(pixels.subarray(src, src + width * 4), y * width * 4);
    }
    ctx.putImageData(image, 0, 0);
    return flipped.toDataURL('image/png');
  }
}
