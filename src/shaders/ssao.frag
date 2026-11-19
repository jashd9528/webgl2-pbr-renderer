#version 300 es
// Hemisphere-kernel SSAO. Samples are generated on the CPU (see SSAOPass.js), oriented
// around a random tangent frame per pixel, then projected to screen space for a depth
// comparison against the G-Buffer depth.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uDepth;
uniform sampler2D uNormal;

uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uView;

uniform vec3 uKernel[32];
uniform int uSampleCount;
uniform float uRadius;
uniform float uBias;
uniform float uRandomSeed;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 reconstructView(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * clip;
  return view.xyz / view.w;
}

void main() {
  float depth = texture(uDepth, vUv).r;
  if (depth >= 0.99999) {
    fragColor = vec4(1.0);
    return;
  }

  vec3 viewPos = reconstructView(vUv, depth);
  vec3 worldNormal = texture(uNormal, vUv).xyz;
  vec3 n = normalize(mat3(uView) * worldNormal);

  float angle = hash(gl_FragCoord.xy + uRandomSeed) * 6.2831853;
  vec3 randomVec = vec3(cos(angle), sin(angle), 0.0);
  vec3 tangent = normalize(randomVec - n * dot(randomVec, n));
  vec3 bitangent = cross(n, tangent);
  mat3 TBN = mat3(tangent, bitangent, n);

  float occlusion = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uSampleCount) break;

    vec3 samplePos = viewPos + TBN * uKernel[i] * uRadius;

    vec4 clip = uProj * vec4(samplePos, 1.0);
    if (clip.w <= 0.0) continue;
    vec2 sampleUv = clip.xy / clip.w * 0.5 + 0.5;
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) continue;

    float sceneDepth = texture(uDepth, sampleUv).r;
    if (sceneDepth >= 0.99999) continue;

    vec3 scenePos = reconstructView(sampleUv, sceneDepth);

    // Reject occluders that are not actually within the sampling sphere; otherwise distant
    // geometry bleeding through the screen-space projection would darken everything.
    if (length(samplePos - scenePos) > uRadius) continue;

    // View-space Z is negative, so "closer to the camera" means a *larger* Z. The sample
    // is occluded when the surface stored at its screen position sits in front of it.
    if (scenePos.z >= samplePos.z + uBias) occlusion += 1.0;
  }

  float ao = 1.0 - occlusion / float(max(uSampleCount, 1));
  fragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
}
