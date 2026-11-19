#version 300 es
// Final pass: ACES filmic tone mapping, sRGB encode, and the G-Buffer debug viewers.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uColor;
uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform sampler2D uDepth;
uniform sampler2D uAO;

uniform float uExposure;
uniform int uDebug;
uniform float uNear;
uniform float uFar;

const mat3 ACES_INPUT = mat3(
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777
);

const mat3 ACES_OUTPUT = mat3(
   1.60475, -0.10208, -0.00327,
  -0.53108,  1.10813, -0.07276,
  -0.07367, -0.00605,  1.07602
);

vec3 acesFitted(vec3 color) {
  color = ACES_INPUT * color;
  vec3 a = color * (color + 0.0245786) - 0.000090537;
  vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
  return clamp(ACES_OUTPUT * (a / b), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
  if (uDebug == 1) {
    fragColor = vec4(linearToSrgb(texture(uAlbedo, vUv).rgb), 1.0);
    return;
  }
  if (uDebug == 2) {
    fragColor = vec4(normalize(texture(uNormal, vUv).xyz) * 0.5 + 0.5, 1.0);
    return;
  }
  if (uDebug == 3) {
    // Hardware depth is hyperbolic; linearize it or the whole view collapses to black.
    float d = texture(uDepth, vUv).r * 2.0 - 1.0;
    float linear = (2.0 * uNear * uFar) / (uFar + uNear - d * (uFar - uNear));
    fragColor = vec4(vec3(pow(clamp(linear / max(uFar * 0.35, 1.0), 0.0, 1.0), 0.8)), 1.0);
    return;
  }
  if (uDebug == 4) {
    vec4 albedo = texture(uAlbedo, vUv);
    vec4 normal = texture(uNormal, vUv);
    fragColor = vec4(normal.a, albedo.a, 0.08, 1.0);
    return;
  }
  if (uDebug == 5) {
    fragColor = vec4(vec3(texture(uAO, vUv).r), 1.0);
    return;
  }

  vec3 hdr = texture(uColor, vUv).rgb * uExposure;
  fragColor = vec4(linearToSrgb(acesFitted(hdr)), 1.0);
}
