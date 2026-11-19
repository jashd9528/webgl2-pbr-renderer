#version 300 es
// Separable 4x4 box blur used to smooth the noisy SSAO result.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAO;
uniform vec2 uTexel;
uniform int uRadius;

void main() {
  float sum = 0.0;
  float weight = 0.0;

  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (abs(x) > uRadius || abs(y) > uRadius) continue;
      vec2 offset = vec2(float(x), float(y)) * uTexel;
      sum += texture(uAO, vUv + offset).r;
      weight += 1.0;
    }
  }

  fragColor = vec4(vec3(sum / max(weight, 1.0)), 1.0);
}
