#version 300 es
// Screen-space reflections: march a view-space ray, project each sample, detect the
// crossing of the stored depth surface, refine the hit with a short bisection, then
// composite the result with a Fresnel-weighted term.
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uColor;
uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform sampler2D uDepth;
uniform sampler2D uId;

uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uView;

uniform float uStrength;
uniform float uMaxDistance;
uniform float uThickness;
uniform int uSteps;
uniform int uDebugSSR;

vec3 reconstructView(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * clip;
  return view.xyz / view.w;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// View-space position of the depth surface under a screen UV, plus a validity flag.
bool sampleSurface(vec2 uv, out vec3 position) {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  float d = texture(uDepth, uv).r;
  if (d >= 0.99999) return false;
  position = reconstructView(uv, d);
  return true;
}

void main() {
  vec3 baseColor = texture(uColor, vUv).rgb;

  if (uStrength <= 0.001) {
    fragColor = vec4(baseColor, 1.0);
    return;
  }

  float depth = texture(uDepth, vUv).r;
  if (depth >= 0.99999) {
    fragColor = vec4(baseColor, 1.0);
    return;
  }

  vec4 albedoSample = texture(uAlbedo, vUv);
  vec4 normalSample = texture(uNormal, vUv);

  float roughness = clamp(normalSample.a, 0.035, 1.0);
  vec3 viewPos = reconstructView(vUv, depth);
  vec3 n = normalize(mat3(uView) * normalize(normalSample.xyz));
  vec3 V = normalize(-viewPos);
  vec3 R = reflect(-V, n);

  float NdotV = max(dot(n, V), 0.0);

  // A per-pixel jitter would trade the horizon seam for speckle; a fixed offset keeps the
  // refraction-free reflection silhouette stable, and the edge fade hides the truncation.
  float stepLength = uMaxDistance / float(max(uSteps, 1));

  vec3 origin = viewPos + n * 0.06 + R * 0.04;
  float t = 0.18 + stepLength * 0.35;
  float tPrev = 0.0;

  vec2 hitUv = vUv;
  vec3 hitPosition = vec3(0.0);
  bool hit = false;

  for (int i = 0; i < 64; i++) {
    if (i >= uSteps) break;

    vec3 p = origin + R * t;
    vec4 clip = uProj * vec4(p, 1.0);
    if (clip.w <= 0.0) break;

    vec2 sampleUv = clip.xy / clip.w * 0.5 + 0.5;
    if (sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;

    float sceneDepth = texture(uDepth, sampleUv).r;
    if (sceneDepth >= 0.99999) {
      tPrev = t;
      t += stepLength * (1.0 + float(i) * 0.07);
      continue;
    }

    vec3 scenePos = reconstructView(sampleUv, sceneDepth);
    float delta = p.z - scenePos.z;

    // Negative delta: the ray passed behind the depth surface => potential hit.
    if (delta < 0.0) {
      if (-delta < uThickness) {
        // Bisect between the last free sample and this one for a stable landing point.
        float lo = tPrev;
        float hi = t;
        for (int r = 0; r < 6; r++) {
          float mid = (lo + hi) * 0.5;
          vec3 q = origin + R * mid;
          vec4 c = uProj * vec4(q, 1.0);
          if (c.w <= 0.0) break;
          vec2 uv2 = c.xy / c.w * 0.5 + 0.5;
          vec3 s2;
          if (!sampleSurface(uv2, s2)) {
            lo = mid;
            continue;
          }
          if (q.z - s2.z < 0.0) {
            hi = mid;
          } else {
            lo = mid;
          }
        }

        vec3 q = origin + R * hi;
        vec4 c = uProj * vec4(q, 1.0);
        vec2 finalUv = c.xy / c.w * 0.5 + 0.5;
        vec3 finalPos;
        if (sampleSurface(finalUv, finalPos) && distance(finalUv, vUv) > 0.006 && hi > 0.35) {
          // Reject back-facing / tangential hit surfaces and hits on the emitter's own
          // object (a convex mirror cannot see itself; those are tracer self-intersections).
          vec3 hitNormal = normalize(mat3(uView) * normalize(texture(uNormal, finalUv).xyz));
          float selfId = texture(uId, vUv).r;
          float hitId = texture(uId, finalUv).r;

          if (dot(hitNormal, R) < -0.08 && abs(hitId - selfId) > 0.002) {
            hitUv = finalUv;
            hitPosition = finalPos;
            hit = true;
          }
        }
      }
      break;
    }

    tPrev = t;
    t += stepLength * (1.0 + float(i) * 0.07);
    if (t > uMaxDistance) break;
  }

  if (!hit) {
    fragColor = uDebugSSR == 1 ? vec4(vec3(0.05, 0.08, 0.2), 1.0) : vec4(baseColor, 1.0);
    return;
  }

  vec3 hitColor = texture(uColor, hitUv).rgb;

  if (uDebugSSR == 1) {
    fragColor = vec4(mix(vec3(1.0, 0.45, 0.1), vec3(1.0), clamp(length(hitColor), 0.0, 1.0)), 1.0);
    return;
  }
  if (uDebugSSR == 2) {
    fragColor = vec4(hitColor, 1.0);
    return;
  }

  vec2 edge = smoothstep(vec2(0.0), vec2(0.10), min(hitUv, 1.0 - hitUv));
  float edgeFade = edge.x * edge.y;

  vec3 F0 = mix(vec3(0.04), albedoSample.rgb, albedoSample.a);
  vec3 F = F0 + (max(vec3(1.0 - roughness), F0) - F0) * pow(1.0 - NdotV, 5.0);

  // Rough surfaces scatters the reflection; fades it out instead of producing a mirror.
  float roughFade = 1.0 - clamp(roughness / 0.8, 0.0, 1.0);
  // Strongly weight grazing angles: those are the floor pixels where a screen-space
  // reflection is both reliable and visually meaningful. Front-facing metal is already
  // covered by the analytic environment term, and tracing it only adds seam noise.
  float grazing = 0.12 + 0.88 * pow(1.0 - NdotV, 3.0);

  vec3 reflection = hitColor * F * roughFade * grazing * edgeFade * uStrength;

  fragColor = vec4(baseColor + reflection, 1.0);
}
