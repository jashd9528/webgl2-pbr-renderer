#version 300 es
// Geometry pass fragment stage: MRT write into the G-Buffer.
//  attachment 0 = albedo.rgb + metallic
//  attachment 1 = world normal.rgb + roughness
//  depth         = hardware depth (sampled later for reconstruction)
precision highp float;

in vec3 vWorldPos;
in vec3 vWorldNormal;
in vec3 vAlbedo;
in float vMetallic;
in float vRoughness;
in vec2 vUV;

uniform int uPattern;
uniform vec3 uAccent;
uniform float uObjectId;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
layout(location = 2) out vec4 gId;

// Screen-space-derivative-stable grid: keeps line width constant with distance.
float gridLine(vec2 uv) {
  vec2 grid = abs(fract(uv - 0.5) - 0.5) / max(fwidth(uv), vec2(1e-5));
  float line = min(grid.x, grid.y);
  return 1.0 - min(line, 1.0);
}

void main() {
  vec3 albedo = vAlbedo;

  if (uPattern == 1) {
    albedo = mix(albedo, uAccent, gridLine(vUV) * 0.9);
  } else if (uPattern == 2) {
    float checker = mod(floor(vUV.x) + floor(vUV.y), 2.0);
    albedo = mix(albedo, uAccent, checker * 0.35);
  }

  gAlbedo = vec4(albedo, vMetallic);
  gNormal = vec4(normalize(vWorldNormal), vRoughness);
  gId = vec4(vec3(uObjectId), 1.0);
}
