/** Geometry (G-Buffer) pass: renders every scene object with MRT enabled. */
export class GeometryPass {
  constructor(gl, shader) {
    this.gl = gl;
    this.shader = shader;
  }

  render(scene, camera, gbuffer, params) {
    const gl = this.gl;
    const shader = this.shader.use();

    gbuffer.bind();
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    shader
      .setMat4('uView', camera.view)
      .setMat4('uProj', camera.projection)
      .setFloat('uRoughnessScale', params.roughnessScale ?? 1);

    let drawCalls = 0;
    let objectIndex = 0;

    for (const object of scene.objects) {
      const material = object.material;
      objectIndex += 1;

      shader
        .setMat4('uModel', object.model)
        .setMat3('uNormalMatrix', object.normalMatrix)
        .setVec3('uAlbedo', material.albedo)
        .setFloat('uMetallic', material.metallic)
        .setFloat('uRoughness', material.roughness)
        .setFloat('uUVScale', material.uvScale)
        .setInt('uPattern', material.pattern)
        .setVec3('uAccent', material.accent)
        .setFloat('uObjectId', objectIndex / 64);

      gl.bindVertexArray(object.mesh.vao);
      gl.drawElements(gl.TRIANGLES, object.mesh.indexCount, gl.UNSIGNED_INT, 0);
      drawCalls += 1;
    }

    gl.bindVertexArray(null);
    return { drawCalls };
  }
}
