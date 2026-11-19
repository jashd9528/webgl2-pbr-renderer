import { Framebuffer } from '../core/Framebuffer.js';

const AO_FORMAT = (gl) => ({
  internalFormat: gl.R8,
  format: gl.RED,
  type: gl.UNSIGNED_BYTE,
  filter: gl.LINEAR,
});

/** Deterministic LCG so screenshots and AO noise patterns are reproducible. */
function makeRandom(seed = 0x2f6e2b1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Hemisphere sample kernel, denser near the origin (classic SSAO weighting). */
function buildKernel(size = 32) {
  const random = makeRandom(0x51ed270b);
  const kernel = new Float32Array(size * 3);

  for (let i = 0; i < size; i += 1) {
    let x = random() * 2 - 1;
    let y = random() * 2 - 1;
    let z = random();
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;

    let scale = i / size;
    scale = 0.1 + 0.9 * scale * scale;

    kernel[i * 3 + 0] = x * scale;
    kernel[i * 3 + 1] = y * scale;
    kernel[i * 3 + 2] = z * scale;
  }
  return kernel;
}

/**
 * SSAO pass with a blur resolve.
 * Produces an R8 occlusion texture (1 = fully lit, 0 = fully occluded) that the lighting
 * pass multiplies into the ambient term.
 */
export class SSAOPass {
  constructor(gl, rawShader, blurShader, drawFullscreen, width, height) {
    this.gl = gl;
    this.rawShader = rawShader;
    this.blurShader = blurShader;
    this.drawFullscreen = drawFullscreen;

    const format = AO_FORMAT(gl);
    this.rawTarget = new Framebuffer(gl, width, height, [format], { depthTexture: false });
    this.blurTarget = new Framebuffer(gl, width, height, [format], { depthTexture: false });

    this.kernel = buildKernel(32);
    this.sampleCount = 32;
    this.radius = 1.2;
    this.bias = 0.02;
    this.enabled = true;
    this._seed = 0;
  }

  resize(width, height) {
    this.rawTarget.resize(width, height);
    this.blurTarget.resize(width, height);
  }

  /** Fills the AO target with 1.0 so lighting sees "no occlusion" when SSAO is off. */
  clearToWhite() {
    const gl = this.gl;
    this.blurTarget.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return this.blurTarget.colors[0];
  }

  render(gbuffer, camera, timeSeconds) {
    const gl = this.gl;

    if (!this.enabled) return this.clearToWhite();

    this._seed = (timeSeconds * 0.37) % 100;

    this.rawTarget.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const shader = this.rawShader.use();
    shader
      .setMat4('uProj', camera.projection)
      .setMat4('uInvProj', camera.invProjection)
      .setMat4('uView', camera.view)
      .setInt('uSampleCount', this.sampleCount)
      .setFloat('uRadius', this.radius)
      .setFloat('uBias', this.bias)
      .setFloat('uRandomSeed', this._seed);
    shader.setVec3Array('uKernel', this.kernel);
    shader
      .bindTexture('uDepth', gbuffer.depthTexture)
      .bindTexture('uNormal', gbuffer.normalTexture);
    this.drawFullscreen();

    this.blurTarget.bind();
    const blur = this.blurShader.use();
    blur
      .setVec2('uTexel', 1 / this.rawTarget.width, 1 / this.rawTarget.height)
      .setInt('uRadius', 2);
    blur.bindTexture('uAO', this.rawTarget.colors[0]);
    this.drawFullscreen();

    return this.blurTarget.colors[0];
  }

  dispose() {
    this.rawTarget.dispose();
    this.blurTarget.dispose();
  }
}
