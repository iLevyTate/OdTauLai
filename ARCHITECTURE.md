# Architecture

```mermaid
flowchart LR
  subgraph shell [Static shell]
    index[index.html]
    css[css/main.css]
    sw[sw.js]
    manifest[manifest.json]
  end
  subgraph core [Core modules]
    version[js/version.js]
    utils[js/utils.js]
    icons[js/icons.js]
    timer[js/timer.js<br/>state]
    storage[js/storage.js]
    tasks[js/tasks.js]
    ui[js/ui.js]
    audio[js/audio.js]
    nlparse[js/nlparse.js]
    app[js/app.js]
    pwa[js/pwa.js]
  end
  subgraph intelligence [On-device AI]
    intel[js/intel.js<br/>embeddings]
    embedstore[js/embed-store.js]
    intelFeat[js/intel-features.js]
    gen[js/gen.js<br/>LLM]
    ask[js/ask.js<br/>Brain + Ask]
    toolschema[js/tool-schema.js]
    ai[js/ai.js<br/>UI glue]
  end
  subgraph integrations [Integrations]
    sync[js/sync.js<br/>P2P]
    cal[js/calfeeds.js]
  end
  index --> version --> utils --> icons --> timer --> storage --> nlparse --> audio --> tasks --> ui
  index --> intel --> embedstore --> intelFeat
  index --> gen --> ask --> toolschema --> ai
  index --> sync
  index --> cal
  index --> pwa
  index --> app
  app --> intel
  app --> gen
  ai --> gen
  ai --> intel
  ui --> ask
  ask --> intel
  ask --> gen
  intelFeat --> tasks
  sync --> storage
  cal --> storage
```

## Load order

Scripts in [`index.html`](index.html) run in declaration order. There are no ES modules; files communicate through shared `function` declarations and a few `window.*` exports.

## State

Core mutable state (tasks, timer, goals, lists, …) lives primarily in [`js/timer.js`](js/timer.js). [`js/storage.js`](js/storage.js) snapshots that state to `localStorage` with an IndexedDB mirror and handles migrations.

**Task classifications:** each task may have a `category` string id (life area). Defaults and user overrides live in `cfg.categories` (see [`js/intel-features.js`](js/intel-features.js): `ensureClassificationConfig`, `DEFAULT_CATEGORY_DEFS`). There is no separate `context` field on tasks — location-style grouping uses lists and tags.

## Release identity

[`js/version.js`](js/version.js) sets `window.ODTAULAI_RELEASE`. The service worker cache name in [`sw.js`](sw.js) must stay aligned (see [`tests/version-sync.test.mjs`](tests/version-sync.test.mjs)).

## On‑device intelligence

Two separate Transformers.js pipelines, loaded independently:

| Pipeline | File | Model | Purpose | When it loads |
|---|---|---|---|---|
| Embedding | [`js/intel.js`](js/intel.js) | WebGPU: `Xenova/gte-base-en-v1.5` (768‑dim, ~110 MB). WASM: `Xenova/bge-small-en-v1.5` (384‑dim) | Semantic search, smart‑add, harmonize, auto‑organize, duplicates, category centroids | First AI feature used |
| Generative (optional, opt‑in) | [`js/gen.js`](js/gen.js) | `HuggingFaceTB/SmolLM2-360M-Instruct` q4 by default (~230 MB); presets include Qwen2.5 0.5B/1.5B | Natural‑language **Ask** (Cmd/Ctrl+K, `?`) — multi‑turn Brain loop in [`js/ask.js`](js/ask.js) turns requests into validated JSON ops | Only after Settings → Integrations → Generative AI is enabled AND the user clicks *Download* |

Both use **WebGPU when available, WASM fallback everywhere else**. Weights are cached by the browser's HTTP cache (the service worker explicitly does **not** precache CDN model URLs, to avoid exhausting the PWA cache quota on mobile).

### Brain / Ask flow (retrieval‑augmented, multi‑turn)

`brainRun` lives in [`js/ask.js`](js/ask.js) (same script order as the browser; `askRun` is an alias). Read‑only ops (`QUERY_TASKS`, `GET_TASK_DETAIL`, `GET_CALENDAR_EVENTS`, `LIST_CATEGORIES`, `LIST_LISTS` — see `readOnly` in [`js/tool-schema.js`](js/tool-schema.js)) execute immediately; the model may run up to four short turns, then returns write ops for preview.

```
user query
   │
   ├──► embedText()  ───►  semanticSearch(query, 10)  ───┐
   │                                                      │
   ├──► top‑20 recently‑modified open tasks  ────────────►│ compact JSON lines (≤200 chars/task, ≤1800 chars total)
   │                                                      │
   ├──► Calendar (next 7 days) from cal feeds  ────────────►│ capped block in user prompt
   ▼                                                      ▼
[ system prompt: TOOL_SCHEMA + few‑shot ]            [ user prompt: lists + calendar + context + request ]
                          │
                          ▼
                 genGenerate() — streaming (per turn; max 4 turns). **Qwen2.5‑1.5B‑Instruct** passes `tools` from `buildOpenAIToolsFromToolSchema()` into `apply_chat_template`; the model replies with `<tool_call>` JSON, parsed by `parseQwen25ToolCallBlocks` (falls back to JSON-array `parseOpsJson` if no tags). Other presets use the all-in-prompt JSON array only.
                          │
            read-only JSON? ──yes──► runReadOp() ──► append tool result; next turn
                          │
                          no (write ops or done)
                          ▼
               parseOpsJson()  (tolerant JSON array)
                          │
                          ▼
               validateOps(writeOps, ctx)
                          │
      valid ops ─────────┴──────────► acceptProposedOps()
                                             │
                                             ▼
                                   _pendingOps  →  _renderPendingOps()
                                             │
                                             ▼
                                   intelApplyPending()  →  executeIntelOp()
                                             │
                                             ▼
                                        undo stack (10 deep)
```

Safety invariants:

- **Hard cap** of 50 ops per response; ops 51+ are recorded as `BATCH_LIMIT` in `rejected[]` and only the first 50 are validated (not an all-or-nothing reject).
- **Every** LLM‑proposed op is filtered through `validateOps()` in [`js/tool-schema.js`](js/tool-schema.js): required fields, enum coercion, id existence checks (against live `tasks[]` / `lists[]`).
- **No auto‑apply, ever** — ops land in the existing preview UI with per‑field checkboxes and the 10‑deep undo stack.
- **Destructive ACK** — any `DELETE_TASK`, or ≥5 `ARCHIVE_TASK` / `CHANGE_LIST` in one batch, triggers an additional confirmation before apply.
- **No outbound calls** beyond the one‑time model weight fetch from the same Hugging Face CDN already used by the embedding model.
