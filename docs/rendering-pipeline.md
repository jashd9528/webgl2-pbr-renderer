# 渲染管线细节

## 1. G-Buffer 布局

| 附件 | 格式 | R | G | B | A |
|---|---|---|---|---|---|
| color0 | RGBA16F | albedo.r | albedo.g | albedo.b | metallic |
| color1 | RGBA16F | normal.x | normal.y | normal.z | roughness |
| color2 | RGBA8 | objectId | — | — | 1 |
| depth | DEPTH24 | 硬件深度 | | | |

法线存**世界空间**。好处是 SSAO / SSR 只要乘一次 `mat3(uView)` 就能转视空间；坏处是光照方向也要在世界空间算，本项目统一在世界空间完成。

## 2. 几何 Pass

`geometry.vert` 输出世界坐标、世界法线、材质参数；`normalMatrix3` 用模型矩阵左上 3×3 的逆转置，保证非均匀缩放下法线正确。

`geometry.frag` 里有一个程序化图案分支：

```glsl
float gridLine(vec2 uv) {
  vec2 grid = abs(fract(uv - 0.5) - 0.5) / max(fwidth(uv), vec2(1e-5));
  return 1.0 - min(min(grid.x, grid.y), 1.0);
}
```

用 `fwidth` 做屏幕空间导数归一化，网格线在任何距离都保持约 1 像素宽，不会出现近处糊、远处摩尔纹。

## 3. 深度反投影

```glsl
vec3 reconstructView(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProj * clip;
  return view.xyz / view.w;
}
vec3 worldPos = (uInvView * vec4(viewPos, 1.0)).xyz;
```

光照 / SSAO / SSR 三个 Pass 用同一段代码，保证三者对「同一个像素在哪里」的理解一致。

## 4. Cook-Torrance

### 4.1 法线分布（GGX / Trowbridge-Reitz）

```glsl
float distributionGGX(float NdotH, float roughness) {
  float a  = roughness * roughness;
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * denom * denom, 1e-6);
}
```

### 4.2 几何遮蔽（Smith + Schlick-GGX，直接光用 k = (r+1)²/8）

```glsl
float geometrySchlickGGX(float NdotX, float roughness) {
  float r = roughness + 1.0;
  float k = (r * r) / 8.0;
  return NdotX / max(NdotX * (1.0 - k) + k, 1e-6);
}
```

### 4.3 菲涅尔

直接光用 `F0 + (1-F0)(1-cosθ)^5`；环境光用 `F0 + (max(1-roughness, F0) - F0)(1-NdotV)^5`，避免粗糙金属边缘过亮。

### 4.4 组合

```
specular = D·G·F / (4·NdotV·NdotL)
kD       = (1 - F)·(1 - metallic)
diffuse  = kD·albedo/π
Lo      += (diffuse + specular)·radiance·NdotL
```

点光源用平方反比衰减 `1/max(d², 0.04)`，太阳用固定方向。

### 4.5 环境项

```
irradiance   = skyBase(N)·ambient
ambientDiff  = albedo·(1-metallic)·irradiance
F            = fresnelSchlickRoughness(NdotV, F0, roughness)
envSpec      = environmentRadiance(R)·ambient
ambient      = (ambientDiff + envSpec·F·mix(1, 0.45, roughness))·ao
```

## 5. SSAO

1. CPU 端用固定种子的 LCG 生成 32 个半球样本，长度按 `0.1 + 0.9·(i/n)²` 加权，让样本集中在近处。
2. 每像素按 `hash(gl_FragCoord + seed)` 随机旋转切线基，把条带噪声打散。
3. 采样点投影回屏幕，与该像素的深度比较：

```glsl
if (length(samplePos - scenePos) > uRadius) continue;   // 采样球外，不是有效遮挡体
if (scenePos.z >= samplePos.z + uBias) occlusion += 1.0; // 视空间 Z 为负：更大 = 更近
```

4. `ao = 1 - occlusion / sampleCount`，过一遍 5×5 box blur。

> **踩坑记录**：第一版把比较写成 `scenePos.z <= samplePos.z - uBias`（按「Z 越小越远」的直觉），结果平面被判定成 100% 遮蔽，金属球的环境项被乘成 0，整个镜面球变成黑球。视空间 Z 是负数，**更靠近相机 = Z 更大**。

## 6. SSR

### 6.1 光线

```glsl
vec3 V = normalize(-viewPos);      // 表面 → 相机
vec3 R = reflect(-V, n);           // 反射方向
vec3 origin = viewPos + n * 0.06 + R * 0.04;
```

两段偏移：沿法线避免自交，沿射线避免 t=0 处退化。

### 6.2 步进

固定步长 `uMaxDistance / uSteps`，步长随迭代略微增长（远处不需要那么精细）。每个采样点投影到屏幕，取该像素的视空间 Z：

```glsl
float delta = p.z - scenePos.z;
if (delta < 0.0) {          // 射线穿到深度面之后 → 命中窗口
  if (-delta < uThickness) { /* 二分细化 */ }
  break;                     // 穿过去了还没命中：终止，避免漏光
}
```

### 6.3 二分细化

命中窗口内做 6 次二分，把落点收敛到深度面附近，显著减少锯齿状的反射边缘。

### 6.4 有效性剔除

| 判据 | 目的 |
|---|---|
| `hi > 0.35` | 丢掉贴着表面的近距命中（自交与噪声源） |
| `distance(hitUv, vUv) > 0.006` | 丢掉和起点几乎同一个像素的命中 |
| `dot(hitNormal, R) < -0.08` | 丢掉背面 / 相切面命中 |
| `abs(hitId - selfId) > 0.002` | 丢掉同一物体的命中（凸面镜看不到自己） |
| `smoothstep` 边缘淡出 | 屏幕外无法采样的部分自然衰减 |
| 掠射权重 `(1-NdotV)³` | 只保留地面这类真正需要 SSR 的区域 |
| `1 - roughness/0.8` | 粗糙表面淡出镜面反射 |

### 6.5 合成

```
reflection = hitColor · F · roughFade · grazing · edgeFade · strength
outColor   = baseColor + reflection
```

## 7. 色调映射

ACES fitted（Stephen Hill 拟合）：

```
color = ACESInput · color
a = color·(color + 0.0245786) - 0.000090537
b = color·(0.983729·color + 0.4329510) + 0.238081
out = clamp(ACESOutput · (a/b), 0, 1)
```

再 `pow(1/2.2)` 转到 sRGB。

## 8. 调试视图

`tonemap.frag` 用 `uDebug` 分支，代价是可以直接截图证明每一级的数据：

| uDebug | 视图 | 数据来源 |
|---|---|---|
| 0 | 最终画面 | HDR + ACES |
| 1 | Albedo | color0.rgb |
| 2 | Normal | color1.rgb |
| 3 | Depth | 深度线性化后归一化 |
| 4 | Roughness / Metallic | color1.a / color0.a |
| 5 | SSAO | AO 纹理 |
| — | SSR 命中掩膜 | `ssrPass.debug = 1`，橙色=命中 |

> **踩坑记录**：深度视图第一版直接显示 `pow(1-d, 1.6)`，整屏全黑——近平面 0.1、远平面 120 时，非线性深度在可见范围内几乎都贴近 1.0。必须用 `2nf/(f+n-z(f-n))` 线性化再归一化。
