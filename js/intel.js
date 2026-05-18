/**
 * Ambient intelligence — Xenova/bge-base-en-v1.5 (WebGPU) or Xenova/bge-small-en-v1.5 (WASM)
 * via Transformers.js (feature-extraction). No generative model.
 */
const _C = window.ODTAULAI_CONFIG || {};
const TRANSFORMERS_CDN  = _C.TRANSFORMERS_CDN  || 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1';
const EMBED_MODEL_WEBGPU = _C.EMBED_MODEL_WEBGPU || 'Xenova/bge-base-en-v1.5';
const EMBED_MODEL_WASM   = _C.EMBED_MODEL_WASM   || 'Xenova/bge-small-en-v1.5';
const EMBED_DIM_WEBGPU   = _C.EMBED_DIM_WEBGPU   || 768;
const EMBED_DIM_WASM     = _C.EMBED_DIM_WASM     || 384;
/** Version string for IndexedDB migration — must change when embed model or dim strategy changes */
const EMBED_MODEL_VER    = _C.EMBED_MODEL_VER    || 'bge-base-en-v1.5-migration-v2';

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
 * Pre-flight check: verify the browser can actually create a WebGPU device.
 * Returns true only when adapter + device succeed; false on any failure.
 *
 * Mirrors the probe in gen.js. Without this, attempting `device: 'webgpu'`
 * in pipeline() on hardware where WebGPU is nominally present but the GPU
 * backend can't initialise (broken drivers, denied permissions, headless
 * adapters) can trigger a fatal ONNX Runtime WASM `Aborted()` that kills
 * the page — bypassing the surrounding try/catch and leaving the user
 * with a dead tab instead of the WASM fallback they'd otherwise get.
 */
async function _probeWebGPU(){
  try{
    if(typeof navigator === 'undefined' || !navigator.gpu) return false;
    const adapter = await navigator.gpu.requestAdapter();
    if(!adapter) return false;
    const device = await adapter.requestDevice();
    if(!device) return false;
    device.destroy();
    return true;
  }catch(e){
    console.info('[intel] WebGPU probe failed — will use WASM (CPU)', e);
    return false;
  }
}

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
      // Only attempt WebGPU when a real adapter + device round-trip succeeds.
      // Skipping the probe and letting pipeline() try directly can trigger a
      // fatal WASM Aborted() on broken-driver setups — see _probeWebGPU.
      const gpuOk = await _probeWebGPU();
      let webgpuOk = false;
      if(gpuOk){
        try{
          _extractor = await pipeline('feature-extraction', EMBED_MODEL_WEBGPU, {
            device: 'webgpu',
            dtype: 'fp16',
            progress_callback: cb,
          });
          _intelDevice = 'webgpu';
          _embedDim = EMBED_DIM_WEBGPU;
          _activeEmbedModel = EMBED_MODEL_WEBGPU;
          webgpuOk = true;
        }catch(e){
          console.warn('[intel] WebGPU pipeline failed, falling back to WASM + bge-small', e);
          if(typeof showExportToast === 'function'){
            const reason = (e && e.message && /401|unauthorized/i.test(e.message))
              ? 'Auth error — using smaller model (WASM)'
              : 'WebGPU unavailable — using WASM fallback';
            showExportToast(reason);
          }
        }
      } else {
        console.info('[intel] WebGPU not available — loading with WASM (CPU)');
      }
      if(!webgpuOk){
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

// ── Cleanup on tab close (M1) ─────────────────────────────────────────────────
// Release the embedding pipeline reference so the browser can reclaim GPU/WASM
// memory promptly.  In normal tabs the GC handles this automatically on unload,
// but long-lived PWA windows and service-worker scopes can hold orphaned
// contexts indefinitely without an explicit teardown.
window.addEventListener('beforeunload', () => {
  if (_extractor && typeof _extractor.dispose === 'function') {
    try { _extractor.dispose(); } catch (_) {}
  }
  _extractor = null;
  _intelReady = false;
});
