# Changelog

## v28 — 2026-04-21

- Ask (generative): fix "stuck download" UX — download/cached/loaded state is now honest per-model. Progress bar aggregates bytes across files (no more snap-back when a new file starts), status text updates while downloading, and errors persist inline until the user retries or switches models.
- Ask: switching between model presets no longer erases the per-model "cached" flag; the dropdown now shows "✓ cached" next to models whose weights are already in the browser HTTP cache.
- Ask: auto-load the LLM on boot when it was previously enabled and cached (never downloads without consent).
- Ask: "Open Settings" fallback from the command palette now deep-links into the Integrations accordion and focuses the download button.
- Performance: 1-second active-timer tick no longer re-renders the entire task list — it patches only the live row + floating banner, fixing hover/scroll flicker and CPU burn on long lists.
- Performance: hoisted the per-row `listsWithTasks` computation out of `renderTaskItem` (was O(N²) on every render).
- Correctness: `gen.js` now rejects `genLoad` fast when a different model is already in flight instead of silently handing back the in-progress pipeline; `genGenerate` clears its `AbortController` in `finally` so a failed generation can't poison the next `genAbort` call.
- Correctness: IndexedDB "backup recovery" in `loadState` no longer clobbers live edits — it only restores when the in-memory state is still pristine, otherwise surfaces a toast.
- Security (low-likelihood XSS): escape `note.createdAt` and smart-add chip enum fields before injection.
- Mobile: body now uses `min-height: 100dvh` (with `100vh` fallback) so iOS Safari's address bar no longer hides the bottom of the app.

## v27 — 2026-04-21

- On-device generative **Ask** (opt-in, beta): new command-palette mode — prefix with `?` — that routes natural-language requests through a local instruct-tuned LLM (SmolLM2 360M / 135M / Qwen2.5 0.5B) with a strict preview-before-apply policy. Nothing ever leaves the browser.
- Settings → AI: LLM download, load, abort, and timeout controls alongside the existing embedding model.
- Architecture: new `js/gen.js` and `js/ask.js` modules; service worker continues to bypass the LLM CDN so weights live in the browser HTTP cache rather than the SW cache.
- Content-Security-Policy widened to allow `cdn.jsdelivr.net` + Hugging Face hosts for the one-time model fetch.

## v26 — 2026-04-21

- Security: CSP meta tag, XSS hardening (attribute contexts, smart-add tags), inbound P2P accept/reject gate, sync timestamp clamping, calendar fetch URL/timeout/size limits, CSV formula injection mitigation, aligned inline service worker cache policy with main `sw.js`.
- Correctness: midnight rollover archives then resets daily counters safely; local `completedAt` timestamps for “done today”; `resumeTimer` restarts keepalive; monthly recurrence day clamp; RRULE `COUNT=0` returns no occurrences; calendar month navigation uses local `YYYY-MM`.
- Performance / UX: debounced auto-save; chunked duplicate-similarity scans; single-flight `intelLoad` / Schwartz embeddings; filters summary line; command palette footer hints; search clear + semantic pill; swipe tip + today-banner snooze; drag handle when sort is manual; export toasts; floating mini timer wording in README.
- DX: `js/version.js` release anchor, `LICENSE`, docs (`SECURITY`, `CONTRIBUTING`, `ARCHITECTURE`), CI smoke tests for version ↔ service worker sync.
