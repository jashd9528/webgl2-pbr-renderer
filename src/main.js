import { Renderer } from './core/Renderer.js';
import { Camera } from './core/Camera.js';
import { Framebuffer } from './core/Framebuffer.js';
import { Scene } from './scene/Scene.js';
import { GBuffer } from './rendering/GBuffer.js';
import { GeometryPass } from './rendering/GeometryPass.js';
import { LightingPass } from './rendering/LightingPass.js';
import { SSAOPass } from './rendering/SSAOPass.js';
import { SSRPass } from './rendering/SSRPass.js';
import { TonemapPass } from './rendering/TonemapPass.js';
import { loadShaders } from './shaders/index.js';

const canvas = document.getElementById('viewport');
const logElement = document.getElementById('log');

function reportError(error) {
  console.error(error);
  if (!logElement) return;
  logElement.hidden = false;
  logElement.textContent += `${error?.stack ?? error}\n\n`;
}

window.addEventListener('error', (event) => reportError(event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportError(event.reason));

const params = {
  exposure: 1.1,
  sunIntensity: 5,
  ambient: 0.75,
  roughnessScale: 1,
  aoStrength: 1,
  ssrStrength: 0.9,
  scale: 1,
  debug: 0,
  ssaoEnabled: true,
  ssrEnabled: true,
  ssrDebug: 0,
};

async function main() {
  const renderer = new Renderer(canvas);
  const gl = renderer.gl;

  const scene = new Scene(gl);
  const camera = new Camera({ target: [0, 0.95, 0.1], distance: 10.2, yaw: 0.55, pitch: 0.28 });

  const shaders = await loadShaders(gl);

  renderer.resizeToDisplay();
  let renderWidth = Math.max(1, Math.round(canvas.width * params.scale));
  let renderHeight = Math.max(1, Math.round(canvas.height * params.scale));

  const gbuffer = new GBuffer(gl, renderWidth, renderHeight, renderer.hdrFormat);
  const hdrA = new Framebuffer(gl, renderWidth, renderHeight, [renderer.hdrFormat], { depthTexture: false });
  const hdrB = new Framebuffer(gl, renderWidth, renderHeight, [renderer.hdrFormat], { depthTexture: false });

  const drawFullscreen = () => renderer.drawFullscreen();

  const geometryPass = new GeometryPass(gl, shaders.geometry);
  const lightingPass = new LightingPass(gl, shaders.lighting, hdrA, drawFullscreen);
  const ssaoPass = new SSAOPass(gl, shaders.ssao, shaders.aoBlur, drawFullscreen, renderWidth, renderHeight);
  const ssrPass = new SSRPass(gl, shaders.ssr, hdrB, drawFullscreen);
  const tonemapPass = new TonemapPass(gl, shaders.tonemap, drawFullscreen);

  function applyResize() {
    const nextWidth = Math.max(1, Math.round(canvas.width * params.scale));
    const nextHeight = Math.max(1, Math.round(canvas.height * params.scale));
    if (nextWidth === renderWidth && nextHeight === renderHeight) return false;

    renderWidth = nextWidth;
    renderHeight = nextHeight;
    gbuffer.resize(renderWidth, renderHeight);
    hdrA.resize(renderWidth, renderHeight);
    hdrB.resize(renderWidth, renderHeight);
    ssaoPass.resize(renderWidth, renderHeight);
    return true;
  }

  // --- UI wiring -----------------------------------------------------------
  const readouts = new Map(
    Array.from(document.querySelectorAll('.val')).map((el) => [el.dataset.for, el]),
  );

  function bindRange(id, key, format = (v) => v.toFixed(2)) {
    const input = document.getElementById(id);
    if (!input) return;
    const update = () => {
      params[key] = Number.parseFloat(input.value);
      const label = readouts.get(id);
      if (label) label.textContent = format(params[key]);
    };
    input.addEventListener('input', update);
    update();
  }

  bindRange('exposure', 'exposure');
  bindRange('sun', 'sunIntensity');
  bindRange('ambient', 'ambient');
  bindRange('roughness', 'roughnessScale');
  bindRange('ao-strength', 'aoStrength');
  bindRange('ssr-strength', 'ssrStrength');
  bindRange('scale', 'scale');

  const debugSelect = document.getElementById('debug-view');
  debugSelect?.addEventListener('change', () => {
    const value = Number.parseInt(debugSelect.value, 10);
    // Value 6 is not a tonemap view: it visualises where SSR found a hit.
    params.ssrDebug = value === 6 ? 1 : 0;
    params.debug = value === 6 ? 0 : value;
  });

  const ssaoToggle = document.getElementById('ssao-enabled');
  ssaoToggle?.addEventListener('change', () => {
    params.ssaoEnabled = ssaoToggle.checked;
  });

  const ssrToggle = document.getElementById('ssr-enabled');
  ssrToggle?.addEventListener('change', () => {
    params.ssrEnabled = ssrToggle.checked;
  });

  const scaleInput = document.getElementById('scale');
  scaleInput?.addEventListener('change', () => applyResize());

  document.getElementById('screenshot')?.addEventListener('click', () => {
    const dataUrl = renderer.readPixelsBase64();
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `webgl2-pbr-${Date.now()}.png`;
    link.click();
  });

  // --- Orbit controls ------------------------------------------------------
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    camera.orbit(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  });

  canvas.addEventListener('pointerup', (event) => {
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    camera.zoom(event.deltaY);
  }, { passive: false });

  // --- Frame loop ----------------------------------------------------------
  const fpsElement = document.getElementById('fps');
  const frameMsElement = document.getElementById('frame-ms');
  const resElement = document.getElementById('res');

  const start = performance.now();
  let frames = 0;

  function frame(now) {
    const time = (now - start) / 1000;

    renderer.resizeToDisplay();
    applyResize();

    camera.update(canvas.width / canvas.height);
    scene.update(time);

    scene.lights[0].intensity = params.sunIntensity;

    geometryPass.render(scene, camera, gbuffer, {
      roughnessScale: params.roughnessScale,
    });

    ssaoPass.enabled = params.ssaoEnabled;
    const aoTexture = ssaoPass.render(gbuffer, camera, time);

    lightingPass.render(gbuffer, camera, scene, aoTexture, {
      ambient: params.ambient,
      aoStrength: params.aoStrength,
    });

    ssrPass.enabled = params.ssrEnabled && params.ssrStrength > 0.001;
    ssrPass.strength = params.ssrStrength;
    ssrPass.debug = params.ssrDebug;
    const finalTarget = ssrPass.render(hdrA, gbuffer, camera);

    tonemapPass.exposure = params.exposure;
    tonemapPass.debug = params.debug;
    tonemapPass.render(finalTarget, gbuffer, aoTexture, canvas, camera);

    const stats = renderer.tick(now);
    frames += 1;

    if (fpsElement) fpsElement.textContent = stats.fps.toFixed(0);
    if (frameMsElement) frameMsElement.textContent = stats.frameMs.toFixed(2);
    if (resElement) resElement.textContent = `${renderWidth}×${renderHeight}${renderer.hdrSupported ? ' HDR' : ''}`;

    window.__APP.frames = frames;
    window.__APP.stats = stats;

    requestAnimationFrame(frame);
  }

  window.__APP = {
    renderer,
    gl,
    scene,
    camera,
    params,
    shaders,
    passes: { geometryPass, lightingPass, ssaoPass, ssrPass, tonemapPass, gbuffer, hdrA, hdrB },
    frames: 0,
    stats: renderer.stats,
    objects: scene.objects,
  };

  if (!renderer.hdrSupported) {
    console.warn('EXT_color_buffer_float missing: falling back to RGBA8 render targets.');
  }

  requestAnimationFrame(frame);
}

main().catch(reportError);
