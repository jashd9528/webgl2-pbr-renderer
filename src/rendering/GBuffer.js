import { Framebuffer } from '../core/Framebuffer.js';

/**
 * Deferred G-Buffer:
 *   color0 (RGBA16F) = albedo.rgb + metallic
 *   color1 (RGBA16F) = world normal.rgb + roughness
 *   color2 (RGBA8)   = object id, used by SSR to reject screen-space self-intersections
 *   depth  (DEPTH24) = hardware depth, sampled by lighting / SSAO / SSR
 */
export class GBuffer {
  constructor(gl, width, height, format) {
    this.gl = gl;
    this.format = format;
    this.idFormat = {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      filter: gl.NEAREST,
    };
    this.framebuffer = new Framebuffer(gl, width, height, [format, format, this.idFormat], {
      depthTexture: true,
    });
  }

  get albedoTexture() {
    return this.framebuffer.colors[0];
  }

  get normalTexture() {
    return this.framebuffer.colors[1];
  }

  get idTexture() {
    return this.framebuffer.colors[2];
  }

  get depthTexture() {
    return this.framebuffer.depth;
  }

  get width() {
    return this.framebuffer.width;
  }

  get height() {
    return this.framebuffer.height;
  }

  resize(width, height) {
    return this.framebuffer.resize(width, height);
  }

  bind() {
    this.framebuffer.bind();
    return this;
  }

  dispose() {
    this.framebuffer.dispose();
  }
}
