/**
 * Ambient intelligence — Xenova/gte-small via Transformers.js (feature-extraction).
 * WebGPU when available, else WASM. No generative model.
 */
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1';
const EMBED_MODEL = 'Xenova/gte-small';
const EMBED_DIM = 384;

let _extractor = null;
let _intelReady = false;
let _intelLoading = false;
let _intelDevice = null;

function getIntelDevice(){ return _intelDevice; }
function isIntelReady(){ return _intelReady; }

/**
 * @param {(progress: { progress?: number, status?: string }) => void} [onProgress]
 */
async function intelLoad(onProgress){
  if(_intelReady || _intelLoading) return;
  _intelLoading = true;
  let pipeline;
  let env;
  try{
    const mod = await import(TRANSFORMERS_CDN);
    pipeline = mod.pipeline;
    env = mod.env;
  }catch(e){
    console.warn('[intel] transformers import failed', e);
    _intelLoading = false;
    throw e;
  }
  env.allowLocalModels = false;
  env.useBrowserCache = true;

  const cb = typeof onProgress === 'function' ? onProgress : () => {};

  try{
    _extractor = await pipeline('feature-extraction', EMBED_MODEL, {
      device: 'webgpu',
      dtype: 'fp16',
      progress_callback: cb,
    });
    _intelDevice = 'webgpu';
  }catch(e){
    console.warn('[intel] WebGPU pipeline failed, falling back to WASM', e);
    _extractor = await pipeline('feature-extraction', EMBED_MODEL, {
      device: 'wasm',
      progress_callback: cb,
    });
    _intelDevice = 'wasm';
  }

  _intelReady = true;
  _intelLoading = false;
}

/**
 * @param {string} text
 * @returns {Promise<Float32Array>} L2-normalized embedding, length EMBED_DIM
 */
async function embedText(text){
  if(!_extractor) throw new Error('Intelligence engine not loaded');
  const t = (text || '').trim();
  if(!t) throw new Error('Empty text');
  const out = await _extractor(t.slice(0, 8000), { pooling: 'mean', normalize: true });
  const raw = out && out.data !== undefined ? out.data : out;
  let data = raw;
  if(raw && typeof raw === 'object' && typeof raw.length === 'number' && !(raw instanceof Float32Array)){
    data = new Float32Array(raw);
  }
  if(!(data instanceof Float32Array)){
    throw new Error('Unexpected embedding output');
  }
  if(data.length !== EMBED_DIM){
    console.warn('[intel] unexpected dim', data.length, 'expected', EMBED_DIM);
  }
  return data;
}

/** Unit-normalized vectors → dot product equals cosine similarity */
function cosine(a, b){
  if(!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for(let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

window.intelLoad = intelLoad;
window.embedText = embedText;
window.cosine = cosine;
window.getIntelDevice = getIntelDevice;
window.isIntelReady = isIntelReady;
window.INTEL_EMBED_DIM = EMBED_DIM;
window.INTEL_EMBED_MODEL = EMBED_MODEL;
