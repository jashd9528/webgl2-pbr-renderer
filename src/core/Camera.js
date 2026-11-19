import * as mat4 from '../math/mat4.js';

/**
 * Orbit camera: yaw/pitch/distance around a target, persisting view, projection,
 * and both inverses so the deferred passes can reconstruct view-space positions.
 */
export class Camera {
  constructor(options = {}) {
    this.target = options.target ?? [0, 0.6, 0];
    this.distance = options.distance ?? 9.5;
    this.yaw = options.yaw ?? 0.62;
    this.pitch = options.pitch ?? 0.30;
    this.fov = ((options.fov ?? 48) * Math.PI) / 180;
    this.near = options.near ?? 0.1;
    this.far = options.far ?? 120;

    this.position = new Float32Array(3);
    this.view = mat4.create();
    this.projection = mat4.create();
    this.invProjection = mat4.create();
    this.invView = mat4.create();
    this.viewProjection = mat4.create();
    this._dirty = true;
  }

  update(aspect) {
    const cp = Math.cos(this.pitch);
    this.position[0] = this.target[0] + this.distance * cp * Math.sin(this.yaw);
    this.position[1] = this.target[1] + this.distance * Math.sin(this.pitch);
    this.position[2] = this.target[2] + this.distance * cp * Math.cos(this.yaw);

    mat4.lookAt(this.view, this.position, this.target, [0, 1, 0]);
    mat4.perspective(this.projection, this.fov, aspect, this.near, this.far);
    mat4.invert(this.invProjection, this.projection);
    mat4.invert(this.invView, this.view);
    mat4.multiply(this.viewProjection, this.projection, this.view);
    this._dirty = false;
  }

  orbit(deltaX, deltaY) {
    this.yaw -= deltaX * 0.005;
    this.pitch = Math.min(Math.max(this.pitch + deltaY * 0.005, -0.15), 1.35);
    this._dirty = true;
  }

  zoom(delta) {
    this.distance = Math.min(Math.max(this.distance * (1 + delta * 0.0012), 3.5), 30);
    this._dirty = true;
  }
}
