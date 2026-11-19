/** Screen-space reflection pass: reads the lit HDR buffer, writes the composited result. */
export class SSRPass {
  constructor(gl, shader, outputTarget, drawFullscreen) {
    this.gl = gl;
    this.shader = shader;
    this.outputTarget = outputTarget;
    this.drawFullscreen = drawFullscreen;

    this.enabled = true;
    this.strength = 0.9;
    this.maxDistance = 7.0;
    this.thickness = 0.3;
    this.steps = 52;
    this.debug = 0;
  }

  /** @param {import('../core/Framebuffer.js').Framebuffer} inputTarget lit HDR buffer */
  render(inputTarget, gbuffer, camera) {
    const gl = this.gl;
    const shader = this.shader.use();

    this.outputTarget.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    const context = shader
      .setMat4('uProj', camera.projection)
      .setMat4('uInvProj', camera.invProjection)
      .setMat4('uView', camera.view)
      .setFloat('uStrength', this.enabled ? this.strength : 0)
      .setFloat('uMaxDistance', this.maxDistance)
      .setFloat('uThickness', this.thickness)
      .setInt('uSteps', this.steps)
      .setInt('uDebugSSR', this.enabled ? this.debug : 0);

    context
      .bindTexture('uColor', inputTarget.colors[0])
      .bindTexture('uAlbedo', gbuffer.albedoTexture)
      .bindTexture('uNormal', gbuffer.normalTexture)
      .bindTexture('uDepth', gbuffer.depthTexture)
      .bindTexture('uId', gbuffer.idTexture);

    this.drawFullscreen();
    return this.outputTarget;
  }
}
