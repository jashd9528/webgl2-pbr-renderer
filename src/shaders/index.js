import { Shader } from '../core/Shader.js';

const here = import.meta.url;

function url(file) {
  return new URL(`./${file}`, here).href;
}

async function text(file) {
  const response = await fetch(url(file));
  if (!response.ok) throw new Error(`shader load failed: ${file} (HTTP ${response.status})`);
  return response.text();
}

/** Fetches every GLSL source once and compiles the six pipelines. */
export async function loadShaders(gl) {
  const [geometryVert, geometryFrag, fullscreenVert, lightingFrag, ssaoFrag, blurFrag, ssrFrag, tonemapFrag] =
    await Promise.all([
      text('geometry.vert'),
      text('geometry.frag'),
      text('fullscreen.vert'),
      text('lighting.frag'),
      text('ssao.frag'),
      text('ao_blur.frag'),
      text('ssr.frag'),
      text('tonemap.frag'),
    ]);

  return {
    geometry: new Shader(gl, geometryVert, geometryFrag, 'geometry'),
    lighting: new Shader(gl, fullscreenVert, lightingFrag, 'lighting'),
    ssao: new Shader(gl, fullscreenVert, ssaoFrag, 'ssao'),
    aoBlur: new Shader(gl, fullscreenVert, blurFrag, 'ao-blur'),
    ssr: new Shader(gl, fullscreenVert, ssrFrag, 'ssr'),
    tonemap: new Shader(gl, fullscreenVert, tonemapFrag, 'tonemap'),
  };
}
