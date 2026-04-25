/**
 * Centralized configuration — single source of truth for CDN URLs, model
 * identifiers, and localStorage/IndexedDB key names.
 *
 * Loaded before all other app modules (see index.html script order).
 * Modules reference `ODTAULAI_CONFIG.*` instead of maintaining their own
 * copies, eliminating version-drift and duplicated magic strings.
 */
window.ODTAULAI_CONFIG = Object.freeze({
  // ── CDN dependencies ─────────────────────────────────────────────────────
  TRANSFORMERS_CDN: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.1',
  CHRONO_CDN:       'https://cdn.jsdelivr.net/npm/chrono-node@2.7.7/+esm',

  // ── Embedding models ─────────────────────────────────────────────────────
  EMBED_MODEL_WEBGPU: 'Xenova/bge-base-en-v1.5',
  EMBED_MODEL_WASM:   'Xenova/bge-small-en-v1.5',
  EMBED_DIM_WEBGPU:   768,
  EMBED_DIM_WASM:     384,
  /** Version string for IndexedDB migration — bump when model or dim strategy changes */
  EMBED_MODEL_VER:    'bge-base-en-v1.5-migration-v2',

  // ── localStorage keys ────────────────────────────────────────────────────
  STORAGE_KEYS: Object.freeze({
    STATE:              'stupind_state',
    ARCHIVE:            'stupind_archive',
    GEN_CFG:            'stupind_gen_cfg',
    GEN_HISTORY:        'stupind_gen_history',
    V16_MIGRATED:       'stupind_v16_migrated',
    CARD_DENSITY:       'stupind_card_density',
    SHOW_DONE_ALL:      'stupind_show_done_all',
    SWIPE_TIP_DISMISSED:'odtaulai_swipe_tip_dismissed',
    TB_SNOOZE:          'odtaulai_tb_snooze',
    SYNC_PEER:          'stupind_peer_id_v2',
    SYNC_PEER_V1:       'stupind_peer_id',
    SYNC_ROOM:          'stupind_sync_room',
    ARCHIVED_PREFIX:    'stupind_archived_',
    CAL_FEEDS:          'stupind_calfeeds',
    CAL_FEEDS_PROXY:    'stupind_calfeeds_proxy',
    INTEL_CFG:          'stupind_intel_cfg',
  }),

  // ── IndexedDB databases ──────────────────────────────────────────────────
  IDB: Object.freeze({
    INTEL_DB:  'stupind_intel',
    BACKUP_DB: 'stupind_backup',
  }),

  // ── Timer intervals (ms) ─────────────────────────────────────────────────
  REMINDER_CHECK_MS: 30_000,
  SW_UPDATE_CHECK_MS: 30 * 60 * 1000,
});
