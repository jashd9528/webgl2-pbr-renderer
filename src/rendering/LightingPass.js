/** Deferred lighting pass: evaluates the GGX BRDF from the G-Buffer into an HDR target. */
export class LightingPass {
  /**
   * @param {WebGL2RenderingContext} gl
   * @param {import('../core/Shader.js').Shader} shader
   * @param {import('../core/Framebuffer.js').Framebuffer} target
   * @param {() => void} drawFullscreen shared fullscreen-triangle draw
   */
  constructor(gl, shader, target, drawFullscreen) {
    this.gl = gl;
    this.shader = shader;
    this.target = target;
    this.drawFullscreen = drawFullscreen;
  }

  render(gbuffer, camera, scene, aoTexture, params) {
    const gl = this.gl;
    const shader = this.shader.use();

    this.target.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const pointLights = scene.lights.filter((light) => light.type === 'point').slice(0, 2);
    const pointPositions = new Float32Array(6);
    const pointColors = new Float32Array(6);

    pointLights.forEach((light, i) => {
      pointPositions[i * 3 + 0] = light.position[0];
      pointPositions[i * 3 + 1] = light.position[1];
      pointPositions[i * 3 + 2] = light.position[2];
      pointColors[i * 3 + 0] = light.color[0] * light.intensity;
      pointColors[i * 3 + 1] = light.color[1] * light.intensity;
      pointColors[i * 3 + 2] = light.color[2] * light.intensity;
    });

    const sun = scene.lights.find((light) => light.type === 'directional') ?? {
      direction: [0, 1, 0],
      color: [1, 1, 1],
      intensity: 1,
    };

    shader
      .setMat4('uProj', camera.projection)
      .setMat4('uInvProj', camera.invProjection)
      .setMat4('uView', camera.view)
      .setMat4('uInvView', camera.invView)
      .setVec3('uCameraPos', camera.position)
      .setVec3('uSunDir', sun.direction)
      .setVec3('uSunColor', [
        sun.color[0] * sun.intensity,
        sun.color[1] * sun.intensity,
        sun.color[2] * sun.intensity,
      ])
      .setVec3Array('uPointPos', pointPositions)
      .setVec3Array('uPointColor', pointColors)
      .setFloat('uAmbient', params.ambient)
      .setFloat('uAOStrength', params.aoStrength);

    shader
      .bindTexture('uAlbedo', gbuffer.albedoTexture)
      .bindTexture('uNormal', gbuffer.normalTexture)
      .bindTexture('uDepth', gbuffer.depthTexture)
      .bindTexture('uAO', aoTexture);

    this.drawFullscreen();
    return this.target;
  }
}
