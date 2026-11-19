import { identity, translation, scaling, multiply, normalMatrix3 } from '../math/mat4.js';

/**
 * Metallic / roughness material. Albedo is authored in linear space, not sRGB.
 * `pattern` drives a procedural detail from the fragment shader:
 *   0 = solid, 1 = world-space grid line, 2 = checker.
 */
export class PBRMaterial {
  constructor({
    albedo = [0.8, 0.8, 0.8],
    metallic = 0,
    roughness = 0.5,
    pattern = 0,
    uvScale = 0.5,
    accent = [0.3, 0.4, 0.5],
  } = {}) {
    this.albedo = albedo;
    this.metallic = metallic;
    this.roughness = roughness;
    this.pattern = pattern;
    this.uvScale = uvScale;
    this.accent = accent;
  }
}

export class SceneObject {
  constructor({ mesh, material, position = [0, 0, 0], scale = [1, 1, 1] }) {
    this.mesh = mesh;
    this.material = material;
    this.position = position;
    this.scale = scale;
    this.model = identity();
    this.normalMatrix = new Float32Array(9);
    this.updateMatrix();
  }

  updateMatrix() {
    const s = scaling(identity(), this.scale[0], this.scale[1], this.scale[2]);
    const t = translation(identity(), this.position[0], this.position[1], this.position[2]);
    multiply(this.model, t, s);
    normalMatrix3(this.normalMatrix, this.model);
  }
}
