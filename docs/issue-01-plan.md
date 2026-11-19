# Issue #1 — 局部 cubemap 反射探针（IBL）

目标：让金属球反射出**场景里真实存在的物体**（旁边四个球、地面网格、天空），而不是现在的解析近似。

---

## 0. 范围

**做**

- 每个探针一张 RGBA16F cubemap（捕获原始辐照度）
- 一张预滤波 cubemap（按粗糙度分 mip，GGX 重要性采样）
- 一张 BRDF 积分查找表（split-sum 的第二项）
- SH9 漫反射辐照度（替代现在的 `skyBase(N)`)
- 探针开关 + 调试视图（6 个面 / 单个 mip / LUT）

**不做**

- 多探针混合与 box 投影（单探针足够，留 issue）
- 视差校正（视点固定在球心，相机移动时反射会轻微"游泳"，已知）
- 引入任何第三方库

---

## 1. 为什么是 split-sum

IBL 的镜面项是一个球面积分：

```
L_o(v) = ∫_Ω L_i(l) · f(l, v) · (n·l) dl
```

实时光栅不可能逐像素积分。Karis 2013 的拆分近似把它变成两个可预计算的项：

```
L_o(v) ≈ (∫_Ω L_i(l) · D(h) · (n·h) / (4·(v·h)) ... )    ← 预滤波环境图，只依赖 R 和 roughness
        × (F0 · A + B)                                   ← BRDF LUT，只依赖 NdotV 和 roughness
```

落地就是两个纹理：

| 纹理 | 维度 | 参数化 | 内容 |
|---|---|---|---|
| `uPrefilteredCube` | 256² × 6 × 9 mip | `R` × `roughness` | 按 GGX 权重平均后的入射辐亮度 |
| `uBrdfLUT` | 256×256 RG16F | `x = NdotV`, `y = roughness` | `A`（scale）、`B`（bias） |

采样时：

```glsl
vec3 prefiltered = textureLod(uPrefilteredCube, R, roughness * uMaxMip).rgb;
vec2 ab = texture(uBrdfLUT, vec2(NdotV, roughness)).rg;
vec3 specIBL = prefiltered * (F0 * ab.x + ab.y);
```

这一步做完，`lighting.frag` 里现在那段 `environmentRadiance(R)` 就被真实反射替换掉了。

---

## 2. 管线

```
每帧（或探针 dirty 时）
  ① Capture    : 6 个面，90° FOV，探针位置，前向着色 → rawCube (RGBA16F, 9 mip)
  ② generateMipmap(rawCube)
  ③ Prefilter  : 6 面 × 9 mip，GGX 重要性采样 → prefilteredCube
  ④ SH9        : 从 rawCube 的 32² 降采样读回，CPU 投影 9 个 vec3 系数
启动时一次
  ⑤ BRDF LUT   : 256×256，1024 采样 GGX 积分 → uBrdfLUT
```

### ① 捕获

延迟管线不能直接复用：每个面都要一套 G-Buffer + 光照，6 面代价过高。捕获走**前向着色**，但 BRDF 函数与 `lighting.frag` 是同一份数学（抽到 `shaders/brdf.glsl` 由两处 include，或直接复制并在注释里标注来源，避免 WebGL2 没有 `#include` 的麻烦）。

```js
// src/rendering/ReflectionProbe.js
const FACE_DIRS = [
  { dir: [ 1, 0, 0], up: [0,-1, 0] }, // +X
  { dir: [-1, 0, 0], up: [0,-1, 0] }, // -X
  { dir: [ 0, 1, 0], up: [0, 0, 1] }, // +Y
  { dir: [ 0,-1, 0], up: [0, 0,-1] }, // -Y
  { dir: [ 0, 0, 1], up: [0,-1, 0] }, // +Z
  { dir: [ 0, 0,-1], up: [0,-1, 0] }, // -Z
];
```

投影矩阵 `perspective(π/2, 1.0, 0.1, 200)`，`lookAt(probePos, probePos + dir, up)`。

**自排除**：捕获时必须跳过探针所在的那个球，否则球会把自己烘进环境图（和 SSR 的凸面镜问题同源）。几何 Pass 已经在 G-Buffer 里写 `objectId`，前向捕获里传一个 `uSkipId`，命中就 `discard`。

**背景**：捕获的每个面都要画天空（解析环境），否则反射里会出现黑边。复用 `skyBase()`，但**不要**用 `environmentRadiance()`——那是旧的近似，会把"假地面"烘进探针。

### ② 预滤波

```glsl
// shaders/prefilter.frag
uniform samplerCube uEnvCube;
uniform float uRoughness;     // 当前 mip 对应的粗糙度
uniform int   uSampleCount;   // 1024 → 远端 mip 递减
uniform uint  uBaseSeed;      // 每像素错开，避免条带

vec3 N = normalize(vLocalDir);   // 等于 R，假设 V = N = R
vec3 R = N;
vec3 V = N;
float totalWeight = 0.0;
vec3 prefiltered = vec3(0.0);

for (uint i = 0u; i < MAX_SAMPLES; i++) {
  if (int(i) >= uSampleCount) break;
  vec2 Xi = hammersley(i + uBaseSeed, uint(uSampleCount));
  vec3 H  = importanceSampleGGX(Xi, N, uRoughness);
  vec3 L  = normalize(2.0 * dot(V, H) * H - V);

  float NdotL = max(dot(N, L), 0.0);
  if (NdotL > 0.0) {
    // Karis：mip 级用 lod = 当前 mip，先把高频噪声糊掉，减少 firefly
    prefiltered  += textureLod(uEnvCube, L, uSourceLod).rgb * NdotL;
    totalWeight  += NdotL;
  }
}
fragColor = vec4(prefiltered / max(totalWeight, 1e-4), 1.0);
```

`importanceSampleGGX`（切线空间，`a = roughness²`）：

```glsl
vec3 importanceSampleGGX(vec2 Xi, vec3 N, float roughness) {
  float a = roughness * roughness;
  float phi = 2.0 * PI * Xi.x;
  float cosTheta = sqrt((1.0 - Xi.y) / (1.0 + (a * a - 1.0) * Xi.y));
  float sinTheta = sqrt(max(0.0, 1.0 - cosTheta * cosTheta));

  vec3 H = vec3(cos(phi) * sinTheta, sin(phi) * sinTheta, cosTheta);
  // tangent frame
  vec3 up = abs(N.z) < 0.999 ? vec3(0, 0, 1) : vec3(1, 0, 0);
  vec3 tangent = normalize(cross(up, N));
  vec3 bitangent = cross(N, tangent);
  return normalize(tangent * H.x + bitangent * H.y + N * H.z);
}
```

Hammersley：

```glsl
float radicalInverseVdC(uint bits) {
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return float(bits) * 2.3283064365386963e-10; // / 2^32
}
vec2 hammersley(uint i, uint N) { return vec2(float(i) / float(N), radicalInverseVdC(i)); }
```

采样数按 mip 递减（1024 起步，每级减半，最低 64），否则远端 mip 白算。

### ③ BRDF LUT

```glsl
// shaders/brdf_lut.frag  —— 一次性渲染到 256×256 RG16F，之后只当纹理用
vec2 integrateBRDF(float NdotV, float roughness) {
  vec3 V = vec3(sqrt(1.0 - NdotV * NdotV), 0.0, NdotV);
  float A = 0.0, B = 0.0;

  for (uint i = 0u; i < 1024u; i++) {
    vec2 Xi = hammersley(i, 1024u);
    vec3 H = importanceSampleGGX(Xi, vec3(0, 0, 1), roughness);
    vec3 L = normalize(2.0 * dot(V, H) * H - V);

    float NdotL = max(L.z, 0.0);
    float NdotH = max(H.z, 0.0);
    float VdotH = max(dot(V, H), 0.0);

    if (NdotL > 0.0) {
      float G = geometrySmith(NdotV, NdotL, roughness);   // 复用 lighting.frag 的实现
      float GVis = (G * VdotH) / (NdotH * NdotV);
      float Fc = pow(1.0 - VdotH, 5.0);
      A += (1.0 - Fc) * GVis;
      B += Fc * GVis;
    }
  }
  return vec2(A, B) / 1024.0;
}
```

LUT 里 `G` 必须用**直接光**的 `k = (r+1)²/8`，不能用 IBL 的 `k = r²/2`，否则 A/B 与预滤波对不上。

### ④ SH9 漫反射

从 raw cube 的 32² 面读回（`gl.readPixels`，6 × 1024 像素，一次几毫秒），CPU 投影：

```
L_lm = Σ_pixels L(ω) · Y_lm(ω) · dω
```

9 个系数、3 个 band，卷积用 Alder 常数 `Â_0 = π, Â_1 = 2π/3, Â_2 = π/4`。着色时：

```glsl
vec3 shIrradiance(vec3 n) {
  return max(vec3(0.0),
      uSH[0] * 0.282095
    + uSH[1] * (0.488603 * n.y) + uSH[2] * (0.488603 * n.z) + uSH[3] * (0.488603 * n.x)
    + uSH[4] * (1.092548 * n.x * n.y) + uSH[5] * (1.092548 * n.y * n.z)
    + uSH[6] * (0.315392 * (3.0 * n.z * n.z - 1.0))
    + uSH[7] * (1.092548 * n.x * n.z) + uSH[8] * (0.546274 * (n.x * n.x - n.y * n.y)));
}
```

免去一张 irradiance cubemap，采样成本是一次多项式求值。

---

## 3. 接进现有代码

| 文件 | 改动 |
|---|---|
| `src/rendering/ReflectionProbe.js` | 新增：capture / prefilter / SH9 / resize / dispose |
| `src/shaders/probe.vert` `.frag` | 新增：前向着色捕获（GGX + 解析天空背景） |
| `src/shaders/prefilter.frag` | 新增 |
| `src/shaders/brdf_lut.frag` | 新增 |
| `src/shaders/lighting.frag` | 镜面环境项换成 `prefilteredCube` + LUT；漫反射环境项换成 `shIrradiance(N)`；`environmentRadiance()` 只留给背景 |
| `src/main.js` | 帧首执行 `probe.update(scene, params)`；面板加 `probeEnabled` 与探针调试视图 |
| `src/shaders/tonemap.frag` | 调试视图加 `uDebug == 7`（LUT）、`== 8`（预滤波某级 mip） |
| `docs/rendering-pipeline.md` | 补 IBL 章节 |
| `README.md` | 能力表加一行，截图换新的 |

`lighting.frag` 的最终环境项：

```glsl
vec3 R = reflect(-V, N);
vec3 prefiltered = textureLod(uPrefilteredCube, R, roughness * uMaxMip).rgb;
vec2 ab = texture(uBrdfLUT, vec2(NdotV, roughness)).rg;
vec3 specIBL = prefiltered * (F0 * ab.x + ab.y);

vec3 diffIBL = albedo * (1.0 - metallic) * shIrradiance(N) / PI;

vec3 ambient = (diffIBL + specIBL) * ao;
```

`params.probeEnabled === false` 时必须回退到现在的 `environmentRadiance()`，两条路径都要能跑（也是回归测试的对照组）。

---

## 4. 参数

| 参数 | 值 | 理由 |
|---|---|---|
| 捕获分辨率 | 256² | 镜面球在 1080p 下约占 300px，256 够；再高只是 mip 0 更锐 |
| mip 数 | 9（256→1） | `log2(256)+1`，粗糙度 0..1 线性映射到 mip 0..8 |
| 捕获采样 | 每帧 6 面 | 点光源在动，必须逐帧或隔帧 |
| 预滤波采样 | mip0 1024，逐级减半，下限 64 | 远端 mip 已经糊了，不需要精度 |
| LUT | 256×256 RG16F，1024 采样 | 半浮点够用，A/B 都在 [0,1] |
| SH 读回 | 32² × 6 | 二次投影，分辨率再高也没意义 |
| 预滤波重算 | 探针 dirty 才做 | 预滤波是 6×9 次 draw，比捕获贵 |

---

## 5. 验收标准

1. **可识别性**：镜面球在 roughness 0.075 下能看出旁边四个球的位置关系，且镜像方向正确（不是左右翻转）。
2. **LUT 数值**：roughness = 0 时 `A + B ≈ 1`（1e-2 内），`A` 随 roughness 单调下降，无 NaN。
3. **白炉测试**：把环境换成纯白（L = 1），albedo 0.5 / metallic 0 的球在 roughness 0.1..1 上应稳定输出 ≈ 0.5（误差 < 2%）。这一条能抓出漏掉的 `1/π` 和能量不守恒。
4. **接缝**：256² 下 6 个面的接缝在球面反射里不可见（WebGL2 没有 `TEXTURE_CUBE_MAP_SEAMLESS`，靠预滤波的 `textureLod` 模糊掩盖）。
5. **性能**：1080p 下相对当前实现帧时间增幅 < 15%（用面板上的帧时读数，不做假数据）。
6. **回退**：`params.probeEnabled = false` 时画面与当前版本一致，控制台无报错。
7. **无新依赖**：`package.json` 不变。

---

## 6. 风险

| 风险 | 规避 |
|---|---|
| 立方体接缝 | 预滤波时 `textureLod` 的 lod 给足；实在明显就在捕获时给每个面 1px 重叠（渲染 258² 再采样偏移） |
| Firefly（亮斑） | 预滤波用 `textureLod` 而不是 `texture`；命中权重 `NdotL` 归一化 |
| `NdotL == 0` 除零 | 循环内 `if (NdotL > 0.0)` 守卫 |
| RGBA16F cube 不可渲染 | 复用 `Renderer.hdrFormat` 探测；不支持时降级 RGBA8（反射会有色阶，可接受） |
| 逐帧预滤波掉帧 | dirty 标记 + 隔帧更新；预滤波只在场景/探针移动时重算 |
| 读回 SH 阻塞 GPU | 32² 读回一次几 ms，放在 `probe.update()` 里且只在 dirty 时执行 |

---

## 7. 给 Devin 的任务书（可直接粘贴）

> 仓库：https://github.com/jashd9528/webgl2-pbr-renderer （分支 `main`，本地已 clone）
>
> **任务**：实现 issue #1 —— 把解析环境光替换成局部 cubemap 反射探针（IBL）。完整方案见仓库里的 `docs/issue-01-plan.md`，按它实现，不要自创架构。
>
> **硬约束**
> - 不引入任何第三方依赖，`package.json` 的 dependencies 保持为空。
> - 必须保留 `params.probeEnabled = false` 的解析环境回退路径，两条路径都能跑。
> - 不要改动 `SSAOPass` / `SSRPass` 的现有行为；SSR 仍然负责地面反射，探针只负责环境项。
> - 所有 BRDF 数学与 `src/shaders/lighting.frag` 现有实现保持一致（GGX / Smith-Schlick / Schlick Fresnel），不要悄悄换成别的近似。
>
> **交付**
> 1. `src/rendering/ReflectionProbe.js` + 三个新 shader（probe / prefilter / brdf_lut）。
> 2. `lighting.frag` 的镜面与漫反射环境项替换，保留回退。
> 3. 两个新调试视图：BRDF LUT、预滤波指定 mip。
> 4. `docs/rendering-pipeline.md` 补一节 IBL，写清 split-sum 的两个因子从哪来。
> 5. `docs/verification.md` 追加：LUT 数值检查结果、白炉测试结果、1080p 帧时对比（真实测量，没有数据就写没有）。
>
> **验收**：按 `docs/issue-01-plan.md` 第 5 节的 7 条逐条自检，每条给出证据（截图或读数），不接受"应该可以"。
>
> **提交**：每个阶段一次 commit（capture → prefilter → LUT → SH9 → 文档），message 写清改了什么、为什么。全部完成后开 PR 到 `main`，PR 描述里贴对比截图。
