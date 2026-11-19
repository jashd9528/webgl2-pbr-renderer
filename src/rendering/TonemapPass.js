/** Final present pass: tone mapping + debug views, rendering straight to the canvas. */
export class TonemapPass {
  constructor(gl, shader, drawFullscreen) {
    this.gl = gl;
    this.shader = shader;
    this.drawFullscreen = drawFullscreen;
    this.exposure = 1.1;
    this.debug = 0;
  }

  render(hdrTarget, gbuffer, aoTexture, canvas, camera) {
    const gl = this.gl;
    const shader = this.shader.use();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    shader
      .setFloat('uExposure', this.exposure)
      .setFloat('uNear', camera.near)
      .setFloat('uFar', camera.far)
      .setInt('uDebug', this.debug);

    shader
      .bindTexture('uColor', hdrTarget.colors[0])
      .bindTexture('uAlbedo', gbuffer.albedoTexture)
      .bindTexture('uNormal', gbuffer.normalTexture)
      .bindTexture('uDepth', gbuffer.depthTexture)
      .bindTexture('uAO', aoTexture);

    this.drawFullscreen();
  }
}
