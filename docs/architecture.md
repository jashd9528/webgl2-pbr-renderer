# 架构说明

## 1. 分层

```
main.js                 装配层：创建上下文、Pass、UI、主循环
 ├── core/              与具体渲染技术无关的基础设施
 │    ├── Renderer      WebGL2 上下文、扩展协商、全屏三角形、帧计时、读帧
 │    ├── Camera        轨道相机，输出 view / proj / 逆矩阵
 │    ├── Shader        编译、链接、Uniform 位置缓存、纹理单元分配
 │    └── Framebuffer   多 Color Attachment + 深度纹理的 FBO 封装
 ├── scene/             数据层：几何、材质实例、灯光
 ├── materials/         材质参数（线性空间 albedo、metallic、roughness、图案）
 ├── math/              矩阵 / 向量 / BRDF 的 CPU 版本
 ├── shaders/           GLSL ES 3.00 源码 + 加载器
 └── rendering/         每个 Pass 一个类，只依赖 core + 显式参数
```

Pass 之间不共享隐式状态：`GeometryPass` 拿 `(scene, camera, gbuffer)`，`LightingPass` 拿 `(gbuffer, camera, scene, aoTexture)`，`SSRPass` 拿 `(inputTarget, gbuffer, camera)`。这样任何一个 Pass 都可以单独替换或跳过，也是能做「逐通道可视化」的前提。

## 2. 资源生命周期

| 资源 | 创建 | 尺寸变化 | 释放 |
|---|---|---|---|
| GBuffer（3 附件 + 深度纹理） | `new GBuffer(...)` | `resize()` 销毁重建 | `dispose()` |
| HDR 目标 A/B | `new Framebuffer(...)` | 同上 | `dispose()` |
| SSAO 原始/模糊目标 | `SSAOPass` 构造 | `ssaoPass.resize()` | `ssaoPass.dispose()` |
| 网格 VAO/VBO | `createSphereMesh` / `createPlaneMesh` | 不随窗口变化 | `mesh.dispose()` |
| Shader Program | `loadShaders()` 一次 | — | `shader.dispose()` |

`Framebuffer.resize()` 在尺寸不变时直接返回，避免每帧重建纹理。

## 3. 关键决策

### 3.1 只存深度，不存位置
G-Buffer 少一个 RGBA16F 附件，代价是光照/SSAO/SSR 每次都要反投影。反投影只有一次矩阵乘 + 除法，带宽收益更大。

### 3.2 G-Buffer 用 RGBA16F 而不是 RGBA8
法线需要高于 8 bit 的精度，否则 GGX 高光会出现台阶。`EXT_color_buffer_float` 不可用时整体降级为 RGBA8（`Renderer.hdrFormat`），HUD 上会显示当前是否在 HDR 路径。

### 3.3 增加 Object-ID 附件
SSR 最大的伪影来源是「凸面镜反射自己」。用 8 bit 的 ID 附件（`objectId = (index+1)/64`）做同物体拒绝，比调厚度参数可靠得多。代价是 1 个 RGBA8 附件与 1 次纹理采样。

### 3.4 解析环境光而不是 HDRI
项目要求零外部资源。环境用解析函数：天空梯度 + 虚拟地面（复刻网格，用 `fwidth` 自适应线宽）+ 两块柔光箱 + 太阳圆盘。
- 漫反射辐照度用 `skyBase(N)`（不含柔光箱，避免高光泄漏到漫反射）
- 镜面反射用 `environmentRadiance(R)`（含柔光箱与地面）

后续接 cubemap 探针时，只需要把 `environmentRadiance` 换成 `textureLod(uEnvMap, R, roughness * maxMip)`，其余 Pass 不用改。

### 3.5 渲染分辨率与显示分辨率解耦
`params.scale` 控制内部 RT 尺寸（HUD 显示 `768×432 HDR`），画布始终是 CSS 尺寸。低端设备可以降内部署分辨率而不改 UI。

## 4. 帧循环顺序

```
1. resizeToDisplay()      画布跟随 CSS 尺寸 × DPR（上限 2）
2. applyResize()          内部 RT 尺寸 × params.scale
3. camera.update(aspect)  重算 view/proj/invProj/invView/viewProjection
4. scene.update(time)     两个点光源做小幅圆周运动
5. GeometryPass           → GBuffer
6. SSAOPass               → AO（关闭时清成 1.0）
7. LightingPass           → HDR A
8. SSRPass                → HDR B
9. TonemapPass            → Canvas（同时处理 6 种调试视图）
```

第 6 步关闭时仍然返回一张全 1 纹理，`LightingPass` 不需要分支，避免 shader 变体。

## 5. 错误处理

- Shader 编译/链接失败时抛出带行号的源码，`main.js` 顶部捕获后写进页面左下角的 `#log` 面板，不会静默黑屏
- Framebuffer 不完整时抛错并带上状态码
- 缺失 `EXT_color_buffer_float` 只降级、不中断
- `window.__APP` 暴露 renderer / passes / params，便于自动化测试与手工调参
