#version 300 es
// Geometry pass vertex stage: writes world-space position / normal plus the
// material parameters that the deferred lighting pass consumes.

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
uniform mat3 uNormalMatrix;

uniform vec3 uAlbedo;
uniform float uMetallic;
uniform float uRoughness;
uniform float uRoughnessScale;
uniform float uUVScale;

out vec3 vWorldPos;
out vec3 vWorldNormal;
out vec3 vAlbedo;
out float vMetallic;
out float vRoughness;
out vec2 vUV;

void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);

  vWorldPos = world.xyz;
  vWorldNormal = normalize(uNormalMatrix * aNormal);
  vAlbedo = uAlbedo;
  vMetallic = uMetallic;
  vRoughness = clamp(uRoughness * uRoughnessScale, 0.035, 1.0);
  vUV = vec2(aPosition.x, aPosition.z) * uUVScale;

  gl_Position = uProj * uView * world;
}
