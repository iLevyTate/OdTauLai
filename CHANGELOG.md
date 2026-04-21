# Changelog

## v26 — 2026-04-21

- Security: CSP meta tag, XSS hardening (attribute contexts, smart-add tags), inbound P2P accept/reject gate, sync timestamp clamping, calendar fetch URL/timeout/size limits, CSV formula injection mitigation, aligned inline service worker cache policy with main `sw.js`.
- Correctness: midnight rollover archives then resets daily counters safely; local `completedAt` timestamps for “done today”; `resumeTimer` restarts keepalive; monthly recurrence day clamp; RRULE `COUNT=0` returns no occurrences; calendar month navigation uses local `YYYY-MM`.
- Performance / UX: debounced auto-save; chunked duplicate-similarity scans; single-flight `intelLoad` / Schwartz embeddings; filters summary line; command palette footer hints; search clear + semantic pill; swipe tip + today-banner snooze; drag handle when sort is manual; export toasts; floating mini timer wording in README.
- DX: `js/version.js` release anchor, `LICENSE`, docs (`SECURITY`, `CONTRIBUTING`, `ARCHITECTURE`), CI smoke tests for version ↔ service worker sync.
