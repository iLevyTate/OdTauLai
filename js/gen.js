// ========== GENERATIVE LLM (opt-in, local-only) ==========
// Mirrors js/intel.js but loads a small instruct-tuned text-generation
// pipeline for the Ask feature. Strictly opt-in: nothing happens until
// the user flips a Settings toggle AND clicks download. No cloud LLM,
// no analytics, no fetch besides the one-time model weights from the
// same Hugging Face CDN already used by the embedding model.

const GEN_TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1';
const GEN_CFG_KEY = 'stupind_gen_cfg';
const GEN_HIST_KEY = 'stupind_gen_history';

const GEN_MODEL_PRESETS = [
  { id:'Xenova/SmolLM2-360M-Instruct', dtype:'q4',    sizeMb:230, label:'SmolLM2 360M (balanced)', note:'Recommended for most devices' },
  { id:'Xenova/SmolLM2-135M-Instruct', dtype:'q4',    sizeMb:100, label:'SmolLM2 135M (tiny)',     note:'Lowest RAM — older phones' },
  { id:'Xenova/Qwen2.5-0.5B-Instruct', dtype:'q4',    sizeMb:320, label:'Qwen2.5 0.5B (bigger)',   note:'Desktop / WebGPU preferred' },
];

let _genPipe = null;
let _genReady = false;
let _genLoading = false;
let _genDevice = null;
let _genModelId = null;
let _genLoadPromise = null;
let _genAbortCtl = null;

function getGenDevice(){ return _genDevice; }
function getGenModel(){ return _genModelId; }
function isGenReady(){ return _genReady; }
function isGenLoading(){ return _genLoading; }

function _loadGenCfg(){
  let cfg = {};
  try{ cfg = JSON.parse(localStorage.getItem(GEN_CFG_KEY) || '{}') || {}; }
  catch(e){ cfg = {}; }
  if(typeof cfg.enabled !== 'boolean') cfg.enabled = false;
  if(!cfg.modelId) cfg.modelId = GEN_MODEL_PRESETS[0].id;
  if(!cfg.dtype)  cfg.dtype  = GEN_MODEL_PRESETS[0].dtype;
  if(typeof cfg.timeoutSec !== 'number') cfg.timeoutSec = _defaultTimeoutSec();
  if(typeof cfg.downloaded !== 'boolean') cfg.downloaded = false;
  return cfg;
}

function _saveGenCfg(cfg){
  try{ localStorage.setItem(GEN_CFG_KEY, JSON.stringify(cfg)); }catch(e){}
}

function _defaultTimeoutSec(){
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  return isMobile ? 30 : 60;
}

function _mobileRamHint(){
  // Very coarse hint; iOS Safari does not report deviceMemory, fall back to agent.
  if(typeof navigator === 'undefined') return null;
  const dm = navigator.deviceMemory;
  if(typeof dm === 'number' && dm < 4) return 'low';
  if(/iPhone|iPad|iPod/.test(navigator.userAgent || '')) return 'ios-unknown';
  return null;
}

function getGenPresets(){ return GEN_MODEL_PRESETS.slice(); }
function getGenCfg(){ return _loadGenCfg(); }
function saveGenCfg(cfg){ _saveGenCfg(cfg); return cfg; }

function getAskHistory(){
  try{ const arr = JSON.parse(localStorage.getItem(GEN_HIST_KEY) || '[]'); return Array.isArray(arr) ? arr : []; }
  catch(e){ return []; }
}
function pushAskHistory(text){
  const s = String(text || '').trim();
  if(!s) return;
  const arr = getAskHistory().filter(x => x && x.text !== s);
  arr.unshift({ ts: Date.now(), text: s.slice(0, 280) });
  try{ localStorage.setItem(GEN_HIST_KEY, JSON.stringify(arr.slice(0, 5))); }catch(e){}
}

/**
 * Load the text-generation pipeline. Does nothing if already loaded.
 * @param {string} modelId
 * @param {string} dtype
 * @param {(progress: { progress?:number, status?:string, file?:string }) => void} [onProgress]
 */
async function genLoad(modelId, dtype, onProgress){
  if(_genReady && _genModelId === modelId) return;
  if(_genLoadPromise) return _genLoadPromise;

  _genLoading = true;
  _genModelId = modelId;

  const cb = typeof onProgress === 'function' ? onProgress : () => {};

  _genLoadPromise = (async () => {
    let pipeline, env;
    try{
      const mod = await import(GEN_TRANSFORMERS_CDN);
      pipeline = mod.pipeline;
      env = mod.env;
    }catch(e){
      _genLoading = false;
      _genLoadPromise = null;
      throw e;
    }
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    try{
      try{
        _genPipe = await pipeline('text-generation', modelId, {
          device: 'webgpu',
          dtype: dtype || 'q4f16',
          progress_callback: cb,
        });
        _genDevice = 'webgpu';
      }catch(e){
        console.warn('[gen] WebGPU pipeline failed, falling back to WASM', e);
        _genPipe = await pipeline('text-generation', modelId, {
          device: 'wasm',
          dtype: dtype || 'q4',
          progress_callback: cb,
        });
        _genDevice = 'wasm';
      }
      _genReady = true;
    }catch(e){
      _genPipe = null;
      _genReady = false;
      _genDevice = null;
      _genLoading = false;
      _genLoadPromise = null;
      throw e;
    }
    _genLoading = false;
  })();

  return _genLoadPromise;
}

function genAbort(){
  if(_genAbortCtl){
    try{ _genAbortCtl.abort(); }catch(e){}
  }
}

/**
 * Generate text. Streams tokens via onToken if provided.
 * @param {{ messages?:Array, prompt?:string, maxTokens?:number, temperature?:number, onToken?:(t:string)=>void, signal?:AbortSignal }} opts
 * @returns {Promise<string>} Full generated text (without the prompt).
 */
async function genGenerate(opts){
  if(!_genReady || !_genPipe) throw new Error('GEN_NOT_READY');
  const maxTokens   = Math.min(1024, Math.max(16, opts.maxTokens || 512));
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.2;
  const onToken     = typeof opts.onToken === 'function' ? opts.onToken : null;

  // Chain the caller's AbortSignal with our own for genAbort().
  _genAbortCtl = new AbortController();
  const ctl = _genAbortCtl;
  if(opts.signal){
    if(opts.signal.aborted){ ctl.abort(); }
    else opts.signal.addEventListener('abort', () => ctl.abort(), { once: true });
  }

  const tokenizer = _genPipe.tokenizer;
  let inputs;
  if(Array.isArray(opts.messages) && typeof tokenizer.apply_chat_template === 'function'){
    inputs = tokenizer.apply_chat_template(opts.messages, { tokenize: false, add_generation_prompt: true });
  } else if(typeof opts.prompt === 'string'){
    inputs = opts.prompt;
  } else {
    throw new Error('GEN_NO_INPUT');
  }

  let streamer = null;
  try{
    const mod = await import(GEN_TRANSFORMERS_CDN);
    if(mod && mod.TextStreamer && onToken){
      streamer = new mod.TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (t) => { try{ onToken(t); }catch(e){} },
      });
    }
  }catch(e){
    // streaming is optional — fall through with full-string output
  }

  const out = await _genPipe(inputs, {
    max_new_tokens: maxTokens,
    do_sample: temperature > 0,
    temperature: temperature,
    return_full_text: false,
    streamer,
  });

  if(ctl.signal.aborted) throw new Error('GEN_ABORTED');
  _genAbortCtl = null;

  if(Array.isArray(out) && out.length){
    const first = out[0];
    if(first && typeof first.generated_text === 'string') return first.generated_text;
  }
  return '';
}

if(typeof window !== 'undefined'){
  window.GEN_MODEL_PRESETS = GEN_MODEL_PRESETS;
  window.getGenPresets = getGenPresets;
  window.getGenCfg = getGenCfg;
  window.saveGenCfg = saveGenCfg;
  window.genLoad = genLoad;
  window.genGenerate = genGenerate;
  window.genAbort = genAbort;
  window.isGenReady = isGenReady;
  window.isGenLoading = isGenLoading;
  window.getGenDevice = getGenDevice;
  window.getGenModel = getGenModel;
  window.getAskHistory = getAskHistory;
  window.pushAskHistory = pushAskHistory;
  window._mobileRamHint = _mobileRamHint;
}
