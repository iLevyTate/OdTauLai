/**
 * Ambient intelligence — Xenova/gte-base-en-v1.5 (WebGPU) or Xenova/bge-small-en-v1.5 (WASM)
 * via Transformers.js (feature-extraction). No generative model.
 */
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1';
const EMBED_MODEL_WEBGPU = 'Xenova/gte-base-en-v1.5';
const EMBED_MODEL_WASM = 'Xenova/bge-small-en-v1.5';
const EMBED_DIM_WEBGPU = 768;
const EMBED_DIM_WASM = 384;
/** Version string for IndexedDB migration — must change when embed model or dim strategy changes */
const EMBED_MODEL_VER = 'gte-base-en-v1.5-migration-v1';

let _extractor = null;
let _intelReady = false;
let _intelLoading = false;
let _intelDevice = null;
let _intelLoadPromise = null;
let _embedDim = EMBED_DIM_WEBGPU;
let _activeEmbedModel = EMBED_MODEL_WEBGPU;

function getIntelDevice(){ return _intelDevice; }
function isIntelReady(){ return _intelReady; }
function getEmbedDim(){ return _embedDim; }
function getActiveEmbedModelId(){ return _activeEmbedModel; }

/**
 * @param {(progress: { progress?: number, status?: string }) => void} [onProgress]
 */
async function intelLoad(onProgress){
  if (_intelReady) return;
  if (_intelLoadPromise) return _intelLoadPromise;

  _intelLoading = true;
  _intelLoadPromise = (async () => {
    let pipeline;
    let env;
    try{
      const mod = await import(TRANSFORMERS_CDN);
      pipeline = mod.pipeline;
      env = mod.env;
    }catch(e){
      console.warn('[intel] transformers import failed', e);
      throw e;
    }
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    const cb = typeof onProgress === 'function' ? onProgress : () => {};

    const loadWasmFallback = async () => {
      _extractor = await pipeline('feature-extraction', EMBED_MODEL_WASM, {
        device: 'wasm',
        progress_callback: cb,
      });
      _intelDevice = 'wasm';
      _embedDim = EMBED_DIM_WASM;
      _activeEmbedModel = EMBED_MODEL_WASM;
    };

    try{
      try{
        _extractor = await pipeline('feature-extraction', EMBED_MODEL_WEBGPU, {
          device: 'webgpu',
          dtype: 'fp16',
          progress_callback: cb,
        });
        _intelDevice = 'webgpu';
        _embedDim = EMBED_DIM_WEBGPU;
        _activeEmbedModel = EMBED_MODEL_WEBGPU;
      }catch(e){
        console.warn('[intel] WebGPU pipeline failed, falling back to WASM + bge-small', e);
        await loadWasmFallback();
      }
      _intelReady = true;
    }catch(e){
      _extractor = null;
      _intelReady = false;
      _intelDevice = null;
      _embedDim = EMBED_DIM_WEBGPU;
      _activeEmbedModel = EMBED_MODEL_WEBGPU;
      throw e;
    }
  })();

  try{
    await _intelLoadPromise;
  }catch(e){
    throw e;
  }finally{
    _intelLoading = false;
    _intelLoadPromise = null;
  }
}

/**
 * @param {string} text
 * @returns {Promise<Float32Array>} L2-normalized embedding, length current embed dim
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
  if(data.length !== _embedDim){
    throw new Error('[intel] unexpected embedding dim ' + data.length + ' expected ' + _embedDim);
  }
  return data;
}

/** Unit-normalized vectors → dot product equals cosine similarity */
function cosine(a, b){
  if(!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for(let i = 0; i < a.length; i++) s += a[i] * b[i];
  if(!Number.isFinite(s)) return 0;
  return s;
}

window.intelLoad = intelLoad;
window.embedText = embedText;
window.cosine = cosine;
window.getIntelDevice = getIntelDevice;
window.isIntelReady = isIntelReady;
window.getEmbedDim = getEmbedDim;
window.getActiveEmbedModelId = getActiveEmbedModelId;
/** @deprecated use getEmbedDim() after load; initial value is WebGPU dim */
Object.defineProperty(window, 'INTEL_EMBED_DIM', { get: () => _embedDim, configurable: true });
Object.defineProperty(window, 'INTEL_EMBED_MODEL', { get: () => _activeEmbedModel, configurable: true });
window.INTEL_EMBED_MODEL_VER = EMBED_MODEL_VER;
