// CPU-side mirror of the analytic GGX/Smith/Schlick math that runs in the shaders.
// Used by the UI readout and by tests to assert the GLSL implementation agrees.

export const PI = 3.14159265359;

export function D_GGX(NdotH, roughness) {
  const a = roughness * roughness;
  const a2 = a * a;
  const denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / Math.max(PI * denom * denom, 1e-6);
}

function G_SchlickGGX(NdotX, roughness) {
  const r = roughness + 1.0;
  const k = (r * r) / 8.0;
  return NdotX / Math.max(NdotX * (1.0 - k) + k, 1e-6);
}

export function G_Smith(NdotV, NdotL, roughness) {
  return G_SchlickGGX(NdotV, roughness) * G_SchlickGGX(NdotL, roughness);
}

export function fresnelSchlick(cosTheta, f0) {
  const f = Math.pow(1.0 - Math.min(Math.max(cosTheta, 0), 1), 5);
  return [
    f0[0] + (1 - f0[0]) * f,
    f0[1] + (1 - f0[1]) * f,
    f0[2] + (1 - f0[2]) * f,
  ];
}

export function specularTerm(NdotH, NdotV, NdotL, roughness) {
  const D = D_GGX(NdotH, roughness);
  const G = G_Smith(NdotV, NdotL, roughness);
  return (D * G) / Math.max(4.0 * NdotV * NdotL, 1e-4);
}
