/** A punctual light: either a directional "sun" or a positional point light (1 / r^2). */
export class Light {
  constructor({ type = 'point', position = [0, 0, 0], direction = [0, 1, 0], color = [1, 1, 1], intensity = 1, radius = 1 }) {
    this.type = type;
    this.position = position;
    this.direction = direction;
    this.color = color;
    this.intensity = intensity;
    this.radius = radius;
  }
}
