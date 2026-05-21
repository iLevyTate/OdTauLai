# OdTauLai — Post-Feature-Wave Audit

**Original scope**: codebase state on branch `audit-findings`, head `40617a1` (cache `odtaulai-v43`, build 2026-04-27), after the wave of UX/UI/coverage PRs (#21–#25).

**Method**: read-only static analysis of `js/`, `sw.js`, `js/pwa.js`, `index.html`, and the `tests/` inventory. No code was modified by this audit. Each finding lists severity, evidence with file:line citations, and a suggested fix that's small enough to land in a focused follow-up branch.

---

## Status as of v48 (2026-05-21)

Most findings have been resolved by subsequent feature waves. Each section below is annotated with a ✅ Fixed / 🟡 Open / 🔵 Obsolete banner. The original analysis text is preserved so readers can see what the issue was, why it mattered, and how it was addressed.

| Finding | Severity | Status | Resolved in |
|---|---|---|---|
| H-1 | High | ✅ Fixed | Allow-list + addEventListener migration |
| H-2 | High | ✅ Fixed | CSP hardened; inline handlers eliminated |
| M-1 | Medium | ✅ Fixed | `check-version-sync.mjs` extended to `pwa.js` |
| M-2 | Medium | 🟡 Open | `pwa.js` inline manifest still duplicated |
| M-3 | Medium | ✅ Fixed | `setHeaderDate()` wrapper added |
| M-4 | Medium | ✅ Fixed | Same migration as H-1 |
| M-5 | Medium | 🟡 Open | `js/app.js` still lacks direct test coverage |
| L-1 | Low | 🟡 Open | `pwa.js` install-state polling still has layered timeouts |
| L-2 | Low | 🔵 Obsolete | The `escAttr`-in-inline antipattern can no longer exist (H-2 removed all inline handlers) |
| L-3 | Low | 🟡 Open | Dynamic icon-only buttons still rely on `title` for screen readers |

---

## Severity legend

- **High** — exploitable security issue or live functional bug.
- **Medium** — drift, footgun, or maintainability hazard that's likely to bite within one or two more feature waves.
- **Low** — hygiene, dead code, style.

---

## High-severity findings

### H-1 — XSS via malicious backup-import (category id injection)

> ✅ **Fixed.** `ensureClassificationConfig` now strips every imported category id through a `[A-Za-z0-9_-]` allow-list (`js/intel-features.js:161`), so an imported config can no longer smuggle quotes or HTML. The original `innerHTML +=` sink at `intel-features.js:510` was also migrated to `createElement` + `addEventListener` (now at `intel-features.js:521,529`), removing the inline-handler interpolation path entirely. Combined fix means the attack is closed at both ends — both Option 1 and Option 3 from the original recommendation landed.

**Vector**: `importData` (`js/storage.js:821-845`) accepts user-supplied JSON, parses it, and applies the embedded `cfg` directly via `_applyState`. `_applyState` assigns `cfg = s.cfg` (`js/storage.js:425`). On the next render, every category id flows into an inline onclick:

```
js/intel-features.js:510
tb.innerHTML += `<button class="sv-chip ..." onclick="setFilterCategory('${c.id}')">${c.label}</button>`;
```

`ensureClassificationConfig` (`js/intel-features.js:155-175`) only trims and length-caps the id (`String(row.id || '').trim().slice(0, 64)`) — it does **not** strip quotes or HTML. `slugClassId` (the safe slugifier at `js/intel-features.js:247`) is only applied when the user creates a category through the UI (`classificationAdd`, line 390), not when a config arrives via import.

The CSP allows `'unsafe-inline'` for scripts (`index.html:34`), so a payload like `cfg.categories[0].id = "x'); alert(document.cookie); //"` executes immediately on render.

**Realistic attack scenario**: a user opens a "shared backup" `.json` file via Settings → Import or via the Web Share Target / File Handler entry points (`js/app.js:288-373`).

**Fix options** (pick one, ~5–15 lines):
1. Run `slugClassId` inside `ensureClassificationConfig` for every imported id.
2. Replace `'${c.id}'` with `${JSON.stringify(String(c.id))}` at `intel-features.js:510` (safest pattern, already used at `js/ui.js:93`).
3. Convert that whole loop to `addEventListener` and drop the inline handler.

Option 1 is the smallest blast radius; option 3 is the better long-term move (see H-2).

### H-2 — Inline event handlers force `script-src 'unsafe-inline'` in CSP

> ✅ **Fixed.** Every inline `on<event>="..."` in `index.html` was migrated to `data-action` + the central dispatcher in `js/event-delegation.js`. `'unsafe-inline'` is no longer in `script-src` (see `index.html:45` — the production CSP). `scripts/check-inline-handlers.mjs` is wired into CI (`.github/workflows/ci.yml`) and fails the build if any `on<event>=` reappears in `index.html` — so the protection can't quietly regress.

**Evidence**: `index.html:34` declares `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com`. The `'unsafe-inline'` is required because the codebase uses `onclick="..."` inline handlers in dozens of places (`index.html` nav tabs at lines 96, 112, 116, 120; many dynamically-rendered buttons in `js/tasks.js`, `js/ai.js`, `js/calfeeds.js`, `js/ui.js`, `js/intel-features.js`).

Once `'unsafe-inline'` is in `script-src`, CSP provides essentially zero defense against any future XSS bug — including H-1 above. CSP nonce/hash mode would also work but doesn't compose well with hand-rolled string-templated DOM construction.

**Fix**: migrate inline handlers to delegated `addEventListener` over time, then remove `'unsafe-inline'`. This is a multi-PR effort, not a one-shot fix. A reasonable first slice: convert `index.html`'s static nav handlers (`onclick="showTab('tasks')"` etc.) since those are hand-written and few in number.

---

## Medium-severity findings

### M-1 — Cache version is three-way coupled; CI guard misses one copy

> ✅ **Fixed.** `scripts/check-version-sync.mjs` now reads `js/pwa.js` (line 16) and verifies the inline-SW fallback string against `version.js`, in addition to the `sw.js` check. CI runs this as the "Version sync" step; the v48 cache rotation flushed all three to `odtaulai-v48` and the test enforces it.

**Evidence**: the canonical cache identifier (`odtaulai-v43`) is duplicated across three files:

- `js/version.js` — canonical (`window.ODTAULAI_RELEASE.swCache`)
- `sw.js:2` — `const CACHE_NAME = 'odtaulai-v43'`
- `js/pwa.js:52` — hardcoded fallback when `window.ODTAULAI_RELEASE` is absent: `: 'odtaulai-v43'`

`scripts/check-version-sync.mjs` regexes (1) and (2) only:
```
js/version.js:18  /swCache\s*:\s*['"]([^'"]+)['"]/
sw.js:26          /const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/
```

The `pwa.js` fallback can silently drift. Risk: if `version.js` fails to load (asset 404, partial cache), the inline SW gets registered with whatever the stale `pwa.js` literal says.

**Fix** (~3 lines): extend `check-version-sync.mjs` to also match the `pwa.js` literal, or load `version.js` and reference `swCache` instead of hardcoding the fallback.

---

### M-2 — `js/pwa.js` carries an inline manifest that duplicates `manifest.json`

**Evidence**: `js/pwa.js:18-35` constructs a full PWA manifest inline (name, short_name, theme_color, icons, etc.) for the `file://` fallback path. Every field must be kept in sync with `manifest.json`. Today both say `theme_color: '#0a1320'`, but there's no test or guard that they agree.

**Fix**: have `pwa.js` `fetch('./manifest.json')` and re-inline its contents as a Blob URL. Falls back to a minimal stub only if the fetch fails.

---

### M-3 — `js/utils.js:59` performs a top-level DOM mutation at module load

> ✅ **Fixed.** `js/utils.js:61` now wraps the call: `function setHeaderDate(){const el=gid('headerDate');if(el) el.textContent=dateStr();}`. `js/app.js:387` invokes it during init alongside the other `render*` calls. Tests that load `utils.js` standalone no longer crash on the missing `#headerDate`.

```
js/utils.js:59
gid('headerDate').textContent = dateStr();
```

This runs at script-evaluation time. It works today only because `<script src="js/utils.js">` is loaded after `<div id="headerDate">` exists in the document. Consequences:

- Any test that loads `utils.js` without `index.html` crashes with `TypeError: Cannot read properties of null (setting 'textContent')`. (`tests/utils-fmt.test.mjs` and `tests/utils-security.test.mjs` likely paper around this — they appear to test only individual pure functions.)
- Any future async-load reorder silently breaks the header date.

**Fix** (~3 lines): wrap in `function setHeaderDate(){ const el = gid('headerDate'); if(el) el.textContent = dateStr(); }` and call from `app.js` init alongside the other `render*` calls.

---

### M-4 — `intel-features.js:508-511` rebuilds a chip row inside a forEach loop

> ✅ **Fixed.** Resolved as a side effect of the H-1 migration. The chip row is now built via `createElement` once and listeners attached via `addEventListener` (no `innerHTML +=` inside the loop), eliminating both the O(n²) rewrite and the XSS interpolation site.

```
js/intel-features.js:508-511
tb.innerHTML = `<button ...>All Tags</button>`;
getActiveCategories().forEach(c => {
  tb.innerHTML += `<button ... onclick="setFilterCategory('${c.id}')">${c.label}</button>`;
});
```

Two problems: (a) O(n²) DOM rewrite as the browser re-parses the string each iteration; (b) any event listeners attached to existing children get stripped on every iteration. With ~7 default categories the perf impact is invisible, but it's a footgun once user-defined categories grow. (Also see H-1: this is the exact site of the XSS.)

**Fix** (~6 lines): build an HTML string once, then assign to the chip row exactly once — or use `createElement` per chip.

---

### M-5 — `js/app.js` is a 600-LOC kitchen sink with no direct test

`js/app.js` contains: global error handler, persistent storage request, storage-pressure check, online/offline indicator, SW update banner + reload flow, archive load/render/clear/export-CSV, daily report generation in two formats, app init, share-target handling, file-handler ingestion, day rollover, system-info renderer, intel-load orchestration. No `tests/app*.test.mjs` exists.

This is the single largest untested coordinator in the project. A regression here (e.g., day rollover not firing after wake-from-sleep) would be invisible to CI.

**Fix**: at minimum, extract day-rollover logic (`_handleDayRollover`, lines 422-465) and the share-target/file-handler IIFEs into a testable module. See the Coverage Matrix below for the full ranking.

---

## Low-severity findings

### L-1 — `pwa.js` polls install state with two layered timeouts

```
js/pwa.js:174-175
setTimeout(_syncInstallButtonForPlatform, 800);
setTimeout(_syncInstallButtonForPlatform, 2500);
```

These exist to compensate for `beforeinstallprompt` racing with platform detection. Working today but smelly — a `MutationObserver` on the document or a single delayed call gated on `_deferredInstallPrompt` would be cleaner. Low priority.

---

### L-2 — `escAttr()` is used inside inline JS handlers, but does not protect that context

> 🔵 **Obsolete.** The H-2 migration removed every inline JS handler in the codebase, so the antipattern this finding describes can no longer exist. `escAttr` is still used for HTML *attribute* values (its actual safe context) where it's correct.

`js/calfeeds.js:640-642`:
```
onclick="toggleCalFeedVisibility('${escAttr(f.id)}')"
```

`escAttr` HTML-escapes `'` to `&#39;` — which is correct for the *attribute* parser, but the HTML parser then decodes `&#39;` back to `'` *before* the JS engine sees the handler text. Inside the JS-string context that's a quote-break.

Today this is **not exploitable** because feed IDs are generated internally (`'cf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)` at `calfeeds.js:391`) and contain only `[a-z0-9_]`. But if a future code path accepts feed IDs from imported JSON or URL params, the same H-1-class injection becomes possible.

**Preventive fix**: replace `'${escAttr(x)}'` with `${JSON.stringify(String(x))}` for all inline-handler arg interpolation. The same anti-pattern appears at `js/intel-features.js:510` (already covered by H-1) and `js/ai.js:1321` (`aiToggleValue('${key}')` — `key` is from a hardcoded `VALUE_KEYS` array, currently safe).

---

### L-3 — Inline icon-only buttons rely on `title` for screen readers

Several dynamically-rendered icon-only buttons carry only `title="..."` (e.g., `js/calfeeds.js:640-642`: 👁/↻/×). `title` is not reliably announced by screen readers. Pair each with `aria-label`.

The static `index.html` markup is generally good — 67 ARIA attributes, skip-link, polite live region, `role="tablist"` with `aria-selected`. The gap is in dynamically-generated buttons.

---

## Test coverage matrix

Modules ranked by **untested user-facing surface area** (lines × user-impact):

| Module | LOC | Direct test? | Risk | Notes |
|---|---|---|---|---|
| `js/ui.js` | 2601 | **No** | High | Largest module. No `tests/ui*.test.mjs`. Some behaviors covered indirectly via `tasks-tree.test.mjs`, but command palette / detail-modal / board / what-next have nothing. |
| `js/app.js` | 598 | **No** | High | See M-5. Day rollover, share-target, file-handlers, archive export are all live and untested. |
| `js/audio.js` | 353 | **No** | Medium | Timer transition cues; silently breaking is plausible. |
| `js/pwa.js` | 176 | **No** | Medium | Install prompt + SW registration + file:// fallback. Hard to unit-test, but at least the inline manifest construction could be. |
| `js/nlparse.js` | 55 | **No** | Medium | Small, but parses user free-text — bugs are user-visible. |
| `js/ui-flip.js` | 153 | **No** | Low | Animation utility. |
| `js/icons.js` | 154 | **No** | Low | Icon registry, mostly data. |
| `js/ai.js` | 2533 | Partial (3) | — | `ai-classify-apply`, `ai-split`, `hybrid-ai`. ~1500 LOC of intel-features integration paths still untested. |
| `js/intel-features.js` | 1360 | Partial (1) | — | `category-config` covers config normalization. Classification render and life-area math are not directly tested. |

**Tests covering modules well**: `js/tasks.js` (4 tests), `js/timer.js` (2), `js/calfeeds.js` (2), `js/storage.js` (2), `js/utils.js` (2), `js/sync.js`, `js/embed-store.js`, `js/intel.js`, `js/tool-schema.js`, `js/version.js`.

---

## Out-of-scope / observations

- **Stash present** — `stash@{0}: WIP on fix/ui-audit-reactive-buttons-and-ribbon — fix: reactive tool buttons, ribbon safety nets, model version sync`. Belongs to a different branch but is unfinished work. Either pop on its origin branch or `git stash drop`.
- **`peerjs.min.js` is vendored** — sync feature uses PeerJS for WebRTC. The CSP allows `wss://*.peerjs.com` connections. Out of scope for this audit; worth a separate review for the sync trust model.
- **Accessibility on the static index.html is in good shape**. The gap is dynamic — every render path that produces icon-only buttons needs an `aria-label` audit pass.

---

## Recommended triage order

**Original list (April 2026):** H-1 → M-1 → M-3 → M-5 → H-2 → M-4 → M-2 → L-*

**Status as of v48 (May 2026):** H-1, H-2, M-1, M-3, M-4, L-2 are all closed (see annotations above). Open items, ordered by remaining risk:

1. **M-5** — extract day-rollover and share-target/file-handler IIFEs from `js/app.js`, add unit coverage. Highest remaining risk because day-rollover wakeup bugs are invisible to CI.
2. **M-2** — de-duplicate `pwa.js` inline manifest against `manifest.json` (fetch + reinline, fall back to stub). Drift is currently caught by humans, not tests.
3. **L-3** — accessibility sweep on dynamically-rendered icon-only buttons (`title` is not screen-reader reliable; pair with `aria-label`).
4. **L-1** — replace `pwa.js` install-state dual `setTimeout` polling with a `MutationObserver` or single gated call. Working today, smell.
