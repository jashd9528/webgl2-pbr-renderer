import { createSphereMesh } from './Sphere.js';
import { createPlaneMesh } from './Plane.js';
import { PBRMaterial, SceneObject } from '../materials/PBRMaterial.js';
import { Light } from './Light.js';

/**
 * Studio scene: a ground plane with a world-space grid, one large chrome sphere and a
 * metallic/roughness ladder, lit by a directional sun plus two animated point lights.
 * Everything is procedural so the demo has no external asset dependency.
 */
export class Scene {
  constructor(gl) {
    this.gl = gl;
    this.objects = [];
    this.lights = [];
    this.sunDirection = [0.45, 0.78, 0.44];
    this._normalizeSun();

    const ground = createPlaneMesh(gl, { size: 80 });
    this.objects.push(new SceneObject({
      mesh: ground,
      material: new PBRMaterial({
        albedo: [0.075, 0.078, 0.088],
        metallic: 0.05,
        roughness: 0.42,
        pattern: 1,
        uvScale: 1.0,
        accent: [0.22, 0.32, 0.45],
      }),
      position: [0, 0, 0],
      scale: [1, 1, 1],
    }));

    const sphere = createSphereMesh(gl, { radius: 1, rings: 40, segments: 64 });

    const ladder = [
      { position: [-3.35, 0.63, 0.9], scale: 0.63, albedo: [1.0, 0.782, 0.344], metallic: 1.0, roughness: 0.18 },
      { position: [-1.58, 0.63, 1.95], scale: 0.63, albedo: [0.955, 0.638, 0.538], metallic: 1.0, roughness: 0.42 },
      { position: [1.58, 0.63, 1.95], scale: 0.63, albedo: [0.56, 0.57, 0.60], metallic: 0.0, roughness: 0.14 },
      { position: [3.35, 0.63, 0.9], scale: 0.63, albedo: [0.48, 0.05, 0.045], metallic: 0.0, roughness: 0.62 },
    ];

    ladder.forEach((item) => {
      this.objects.push(new SceneObject({
        mesh: sphere,
        material: new PBRMaterial({
          albedo: item.albedo,
          metallic: item.metallic,
          roughness: item.roughness,
          pattern: 0,
        }),
        position: item.position,
        scale: [item.scale, item.scale, item.scale],
      }));
    });

    // Large chrome sphere, the focal point of the reflection / SSR demo.
    this.objects.push(new SceneObject({
      mesh: sphere,
      material: new PBRMaterial({
        albedo: [0.96, 0.95, 0.92],
        metallic: 1.0,
        roughness: 0.075,
        pattern: 0,
      }),
      position: [0, 1.55, -1.25],
      scale: [1.55, 1.55, 1.55],
    }));

    this.lights.push(new Light({
      type: 'directional',
      direction: this.sunDirection,
      color: [1.0, 0.93, 0.82],
      intensity: 5.0,
    }));

    this.pointLights = [
      new Light({ type: 'point', position: [-5.2, 3.4, 5.4], color: [0.32, 0.55, 1.0], intensity: 26 }),
      new Light({ type: 'point', position: [5.4, 2.4, -4.2], color: [1.0, 0.42, 0.26], intensity: 24 }),
    ];
    this.lights.push(...this.pointLights);
  }

  _normalizeSun() {
    const [x, y, z] = this.sunDirection;
    const len = Math.hypot(x, y, z) || 1;
    this.sunDirection = [x / len, y / len, z / len];
  }

  /** Animates the two point lights so reflections and AO keep moving. */
  update(timeSeconds) {
    const t = timeSeconds * 0.35;
    this.pointLights[0].position = [
      -5.2 * Math.cos(t),
      3.1 + Math.sin(t * 1.7) * 0.45,
      5.4 * Math.sin(t) + 1.2,
    ];
    this.pointLights[1].position = [
      5.4 * Math.cos(t + 2.1),
      2.4 + Math.cos(t * 1.3) * 0.5,
      -4.2 * Math.sin(t + 2.1),
    ];
  }

  dispose() {
    const meshes = new Set(this.objects.map((o) => o.mesh));
    meshes.forEach((mesh) => mesh.dispose());
    this.objects = [];
    this.lights = [];
  }
}
