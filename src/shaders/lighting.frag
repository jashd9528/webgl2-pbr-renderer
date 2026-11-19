#version 300 es
// Deferred lighting pass: reconstructs view-space position from the depth buffer and
// evaluates a Cook-Torrance GGX BRDF against one directional light and two point lights.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform sampler2D uDepth;
uniform sampler2D uAO;

uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uView;
uniform mat4 uInvView;

uniform vec3 uCameraPos;

uniform vec3 uSunDir;
uniform vec3 uSunColor;

uniform vec3 uPointPos[2];
uniform vec3 uPointColor[2];

uniform float uAmbient;
uniform float uAOStrength;

const float PI = 3.14159265359;

vec3 reconstructView(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * clip;
  return view.xyz / view.w;
}

vec3 skyBase(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 zenith = vec3(0.045, 0.075, 0.145);
  vec3 horizon = vec3(0.30, 0.33, 0.38);
  // The lower hemisphere is a bounce proxy matched to the rendered floor luminance.
  vec3 ground = vec3(0.22, 0.215, 0.205);

  vec3 c = mix(horizon, zenith, pow(up, 0.65));
  c = mix(c, ground, clamp(-d.y * 2.5, 0.0, 1.0));
  return c;
}

/**
 * Analytic environment for specular reflection: sky gradient + a virtual floor plane that
 * reproduces the real grid so metal reflects the scene's structure instead of a flat band.
 * A captured cubemap would be the production answer; this keeps the demo asset-free.
 */
vec3 environmentRadiance(vec3 d) {
  vec3 c = skyBase(d);

  if (d.y < -0.002) {
    vec3 probe = vec3(0.0, 1.45, -0.8);
    float t = (0.0 - probe.y) / d.y;
    vec3 p = probe + d * t;

    vec2 uv = p.xz;
    vec2 cell = abs(fract(uv - 0.5) - 0.5);
    // Analytic anti-aliasing: on a mirror surface neighbouring pixels sample widely
    // different directions, so the line width has to follow the screen-space derivative
    // or the grid aliases into noise inside the reflection.
    vec2 derivative = fwidth(uv) * 1.5;
    float width = 0.012 + t * 0.0018 + max(derivative.x, derivative.y);
    float line = 1.0 - smoothstep(0.0, width, min(cell.x, cell.y));

    vec3 floorLit = vec3(0.075, 0.078, 0.090) * 2.4;
    vec3 lineLit = vec3(0.26, 0.36, 0.50);
    // Distant lines must not smear into a bright haze: fade their weight with distance.
    float lineWeight = line * 0.85 * exp(-t * 0.03);
    vec3 floorColor = mix(floorLit, lineLit, lineWeight);

    float fade = exp(-t * 0.045);
    c = mix(c, floorColor, fade);
  }

  vec3 keyPanel = normalize(vec3(-0.55, 0.72, 0.42));
  vec3 rimPanel = normalize(vec3(0.78, 0.42, -0.52));
  c += vec3(1.0, 0.96, 0.90) * 2.6 * smoothstep(0.88, 0.997, dot(d, keyPanel));
  c += vec3(0.50, 0.68, 1.0) * 1.5 * smoothstep(0.93, 0.999, dot(d, rimPanel));

  float sun = pow(max(dot(d, uSunDir), 0.0), 220.0);
  return c + uSunColor * sun * 2.0;
}

vec3 skyRadiance(vec3 d) {
  // Background uses the same environment the reflections sample, so the sky and the
  // reflected sky stay consistent at the silhouette of every object.
  return environmentRadiance(d);
}

// --- Cook-Torrance terms ---------------------------------------------------

float distributionGGX(float NdotH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denom * denom, 1e-6);
}

float geometrySchlickGGX(float NdotX, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotX / max(NdotX * (1.0 - k) + k, 1e-6);
}

float geometrySmith(float NdotV, float NdotL, float roughness) {
  return geometrySchlickGGX(NdotV, roughness) * geometrySchlickGGX(NdotL, roughness);
}

vec3 fresnelSchlick(float cosTheta, vec3 F0) {
  return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness) {
  return F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - cosTheta, 5.0);
}

vec3 shade(
  vec3 N, vec3 V, vec3 L, vec3 radiance,
  vec3 albedo, float metallic, float roughness, vec3 F0
) {
  float NdotL = max(dot(N, L), 0.0);
  if (NdotL <= 0.0) return vec3(0.0);

  vec3 H = normalize(V + L);
  float NdotV = max(dot(N, V), 1e-3);
  float NdotH = max(dot(N, H), 0.0);
  float HdotV = max(dot(H, V), 0.0);

  float D = distributionGGX(NdotH, roughness);
  float G = geometrySmith(NdotV, NdotL, roughness);
  vec3 F = fresnelSchlick(HdotV, F0);

  vec3 specular = (D * G * F) / max(4.0 * NdotV * NdotL, 1e-4);
  vec3 kD = (1.0 - F) * (1.0 - metallic);
  vec3 diffuse = kD * albedo / PI;

  return (diffuse + specular) * radiance * NdotL;
}

void main() {
  float depth = texture(uDepth, vUv).r;

  // Background: evaluate the analytic environment along the reconstructed view ray.
  if (depth >= 0.99999) {
    vec3 farView = reconstructView(vUv, 1.0);
    vec3 farWorld = (uInvView * vec4(farView, 1.0)).xyz;
    vec3 dir = normalize(farWorld - uCameraPos);
    fragColor = vec4(skyRadiance(dir) * uAmbient, 1.0);
    return;
  }

  vec4 albedoSample = texture(uAlbedo, vUv);
  vec4 normalSample = texture(uNormal, vUv);

  vec3 albedo = albedoSample.rgb;
  float metallic = clamp(albedoSample.a, 0.0, 1.0);
  float roughness = clamp(normalSample.a, 0.035, 1.0);
  vec3 N = normalize(normalSample.xyz);

  vec3 viewPos = reconstructView(vUv, depth);
  vec3 worldPos = (uInvView * vec4(viewPos, 1.0)).xyz;
  vec3 V = normalize(uCameraPos - worldPos);

  vec3 F0 = mix(vec3(0.04), albedo, metallic);

  vec3 Lo = vec3(0.0);

  // Directional light (sun).
  Lo += shade(N, V, uSunDir, uSunColor, albedo, metallic, roughness, F0);

  // Two animated point lights with inverse-square falloff.
  for (int i = 0; i < 2; i++) {
    vec3 toLight = uPointPos[i] - worldPos;
    float dist2 = max(dot(toLight, toLight), 0.04);
    vec3 L = toLight * inversesqrt(dist2);
    vec3 radiance = uPointColor[i] / dist2;
    Lo += shade(N, V, L, radiance, albedo, metallic, roughness, F0);
  }

  // Analytic environment fallback so metals still read as metal before SSR runs.
  float NdotV = max(dot(N, V), 1e-3);
  vec3 R = reflect(-V, N);
  vec3 irradiance = skyBase(N) * uAmbient;
  float ao = mix(1.0, texture(uAO, vUv).r, uAOStrength);

  vec3 ambientDiffuse = albedo * (1.0 - metallic) * irradiance;
  vec3 F = fresnelSchlickRoughness(NdotV, F0, roughness);
  vec3 envSpecular = environmentRadiance(R) * uAmbient;

  vec3 ambient = (ambientDiffuse + envSpecular * F * mix(1.0, 0.45, roughness)) * ao;

  fragColor = vec4(Lo + ambient, 1.0);
}
