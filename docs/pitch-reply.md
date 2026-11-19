# 给审核方的回复（可直接发）

前提：仓库已经真实存在、代码能跑起来、commit 是真的。下面这段只描述事实，不要改写成"我准备做"。

---

## 中文版

我按你们的要求把项目建成了公开仓库，代码可以本地运行，不是方案文档：

**仓库**：https://github.com/&lt;你的账号&gt;/webgl2-pbr-renderer
**在线演示**：https://&lt;你的账号&gt;.github.io/webgl2-pbr-renderer/ （可选）

技术栈是原生 WebGL2 + GLSL ES 3.00，没有用 Three.js 之类的封装：

- **MRT Deferred 管线**：Geometry Pass 写入 3 个 Color Attachment（albedo+metallic / worldNormal+roughness / objectId）加一张深度纹理，`gl.drawBuffers` 开启多目标；Lighting Pass 用 `uInvProj` 反投影重建视空间坐标。
- **Cook-Torrance BRDF**：GGX 法线分布、Smith 遮蔽（Schlick-GGX 近似）、Schlick 菲涅尔，`src/shaders/lighting.frag` 与 `src/math/BRDF.js` 有 GPU/CPU 两份实现可以互相核对。
- **SSAO**：32 个半球核样本 + 每像素切线基随机旋转 + 深度比较，5×5 box blur 输出 R8 遮蔽图，乘进环境项。
- **SSR**：视空间射线步进 + 6 次二分细化；用 G-Buffer 的 objectId 附件拒绝"凸面镜反射自己"的伪影，另有法线背向、最小距离、掠射角加权与边缘淡出。
- **调试能力**：界面上可以在最终画面和 G-Buffer 的 albedo / normal / depth / roughness-metallic / SSAO 之间切换，方便核对每一级数据。

仓库里有 `docs/rendering-pipeline.md` 记录了实现细节，包括我开发中踩到的两个真实 bug（SSAO 视空间深度比较方向写反导致金属球全黑；深度可视化没线性化导致全屏黑）和修复方式。`docs/verification.md` 是无头 Chromium 跑的实测记录。

我接下来准备用 Devin 做的三件事，都在这个仓库的 issue 里：

1. 把解析环境光替换成局部 cubemap 反射探针（现在金属球看不到旁边的球体）。
2. 加 shadow map 与接触阴影，现在的 AO 只作用于环境项。
3. 加 TAA + 运动向量，解决 SSR 的边缘锯齿。

如果还需要别的材料（运行视频、GPU 帧时间对比、某段shader的逐行讲解），告诉我具体要哪个。

---

## English

I built the project as a public repo and it actually runs — it is not a proposal document:

**Repo**: https://github.com/&lt;your-account&gt;/webgl2-pbr-renderer
**Live demo**: https://&lt;your-account&gt;.github.io/webgl2-pbr-renderer/ (optional)

Raw WebGL2 + GLSL ES 3.00, no Three.js or similar wrapper:

- **MRT deferred pipeline** — the geometry pass writes three color attachments (albedo+metallic, world normal+roughness, object id) plus a depth texture via `gl.drawBuffers`; the lighting pass reconstructs view-space position with `uInvProj`.
- **Cook-Torrance BRDF** — GGX distribution, Smith visibility (Schlick-GGX), Schlick Fresnel. `src/shaders/lighting.frag` and `src/math/BRDF.js` keep GPU and CPU implementations side by side so they can be cross-checked.
- **SSAO** — 32 hemisphere samples, per-pixel tangent-frame rotation, depth comparison, 5×5 box blur into an R8 occlusion map multiplied into the ambient term.
- **SSR** — view-space ray march with 6-step bisection; an object-id G-buffer attachment rejects the classic "convex mirror sees itself" artifact, plus back-face rejection, minimum ray distance, grazing-angle weighting and screen-edge fade.
- **Debuggability** — the UI switches between the final image and the albedo / normal / depth / roughness-metallic / SSAO G-buffer views, so every stage can be inspected.

`docs/rendering-pipeline.md` documents the implementation, including two real bugs I hit (an inverted view-space depth comparison in SSAO that turned the metal sphere black, and a non-linearized depth view that rendered fully black) and how they were fixed. `docs/verification.md` is the headless-Chromium test record.

What I want to use Devin for next, tracked as issues in the repo:

1. Replace the analytic environment with a local cubemap reflection probe (the chrome sphere currently cannot see the neighbouring spheres).
2. Add shadow mapping and contact shadows — AO only affects ambient right now.
3. Add TAA with motion vectors to clean up SSR edge aliasing.

If you need anything else — a run video, GPU frame-time comparison, a line-by-line walkthrough of a specific shader — tell me which one and I will send it.

---

## 发之前自检

| 项 | 检查 |
|---|---|
| 仓库是公开的 | 用无痕窗口打开链接，未登录能看到代码 |
| 代码能跑 | 干净目录 `git clone` → `npm install` → `npm run dev` 能出画面 |
| commit 是真的 | 不要改系统时间伪造提交历史；几天内分批提交更可信 |
| 截图可复现 | `docs/screenshots/` 里的图能被你自己重新跑出来 |
| 不吹没做的事 | 上面只写了代码里真实存在的功能，没写"已完成 XCT" |
| 不发账号凭据 | 审核不需要你的密码、验证码、支付信息 |

## 真实提交节奏建议（3 天）

```
第 1 天 : init（工程骨架 + 几何 Pass + 相机）→ 能画出一个受光的球
第 2 天 : MRT + G-Buffer + GGX PBR → 材质球阵列
第 3 天 : SSAO + SSR + 文档与截图 → 最终画面
```

每次提交只解决一个具体问题，commit message 写清"改了什么、为什么"。审核方看的是提交曲线和代码质量，不是提交数量。
