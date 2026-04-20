# One-off: replace :root through legacy block with tokens + foundation; keep DESIGN SYSTEM OVERLAY onward.
import pathlib
p = pathlib.Path(__file__).resolve().parents[1] / "css" / "main.css"
s = p.read_text(encoding="utf-8")

NEW_ROOT = r'''  :root{
    /* —— Design system (canonical) —— */
    --font-sans:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
    --font-mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
    --fs-xs:0.6875rem;--fs-sm:0.75rem;--fs-md:0.875rem;--fs-base:1rem;--fs-lg:1.125rem;--fs-xl:1.25rem;--fs-2xl:1.75rem;--fs-hero:2.5rem;
    --lh-tight:1.25;--lh-normal:1.5;--lh-loose:1.65;
    --fw-regular:400;--fw-medium:500;--fw-semibold:600;--fw-bold:700;
    --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;--sp-5:20px;--sp-6:24px;--sp-8:32px;--sp-10:40px;
    --r-xs:4px;--r-sm:8px;--r-md:12px;--r-lg:16px;--r-xl:20px;--r-full:999px;
    --ease-standard:cubic-bezier(0.2,0.8,0.2,1);--ease-emphasized:cubic-bezier(0.3,0,0,1);
    --dur-fast:120ms;--dur-med:200ms;--dur-slow:320ms;
    --surface-0:#0a1320;--surface-1:#111a2c;--surface-2:#172335;--surface-3:#1e2c42;
    --fg-default:#e8edf5;--fg-muted:#a8b3c5;--fg-subtle:#6b7a8f;--fg-disabled:#4a5668;
    --border-subtle:#152238;--border-default:#1e2c42;--border-strong:#2a3a54;
    --overlay-scrim:rgba(5,10,18,0.72);
    --brand:#6aa8ff;--brand-hover:#7db3ff;
    --brand-bg:rgba(106,168,255,0.12);--brand-border:rgba(106,168,255,0.3);
    --success:#30d158;--success-bg:rgba(48,209,88,0.12);--success-border:rgba(48,209,88,0.3);
    --warning:#ff9f0a;--warning-bg:rgba(255,159,10,0.12);--warning-border:rgba(255,159,10,0.3);
    --danger:#ff453a;--danger-bg:rgba(255,69,58,0.12);--danger-border:rgba(255,69,58,0.3);
    --info:#48b5e0;--info-bg:rgba(72,181,224,0.12);--info-border:rgba(72,181,224,0.35);
    --purple:#bf5af2;--purple-bg:rgba(191,90,242,0.12);--purple-border:rgba(191,90,242,0.3);
    --pink:#ff375f;
    --elev-0:none;--elev-1:0 1px 2px rgba(0,0,0,0.28);--elev-2:0 4px 16px rgba(0,0,0,0.28);--elev-3:0 12px 40px rgba(0,0,0,0.45);
    /* Legacy aliases */
    --bg-0:var(--surface-0);--bg-1:var(--surface-1);--bg-2:var(--surface-2);--bg-3:var(--surface-3);
    --border:var(--border-default);--text-1:var(--fg-default);--text-2:var(--fg-muted);--text-3:var(--fg-subtle);--text-4:var(--fg-disabled);
    --accent:var(--brand);--accent-bg:var(--brand-bg);--accent-border:var(--brand-border);
    --work:var(--accent);--work-glow:rgba(106,168,255,0.4);--work-bg:#0d1a2d;--work-border:#1a2d44;
    --short:var(--success);--short-glow:rgba(48,209,88,0.4);--short-bg:#0d2818;--short-border:#1a4a2a;
    --long:var(--warning);--long-glow:rgba(255,159,10,0.4);--long-bg:#1a1508;--long-border:#3a2a10;
    --shadow-1:var(--elev-1);--shadow-2:var(--elev-2);--shadow-3:var(--elev-3);
    color-scheme:dark;
  }
  body.light-theme{
    color-scheme:light;
    --surface-0:#f4f6fa;--surface-1:#ffffff;--surface-2:#f8fafc;--surface-3:#e3e8f0;
    --fg-default:#0f172a;--fg-muted:#475569;--fg-subtle:#64748b;--fg-disabled:#94a3b8;
    --border-subtle:#e2e8f0;--border-default:#e3e8f0;--border-strong:#c7d0de;
    --overlay-scrim:rgba(15,23,42,0.45);
    --bg-0:var(--surface-0);--bg-1:var(--surface-1);--bg-2:var(--surface-2);--bg-3:var(--surface-3);
    --border:var(--border-default);--text-1:var(--fg-default);--text-2:var(--fg-muted);--text-3:var(--fg-subtle);--text-4:var(--fg-disabled);
    --work-bg:#f0f6fd;--work-border:#d0e3f7;--short-bg:#f0fdf4;--short-border:#d1f0dc;--long-bg:#fff9ed;--long-border:#fde6b8;
  }
'''

INJECTION = r'''
  /* —— Foundation (single source; merged from removed legacy block) —— */
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @keyframes modalSlide{from{transform:translateY(-20px);opacity:0}to{transform:translateY(0);opacity:1}}
  .modal-overlay{position:fixed;inset:0;background:var(--overlay-scrim);backdrop-filter:blur(8px);z-index:1000;display:none;align-items:flex-start;justify-content:center;padding:40px 16px;overflow-y:auto}
  .modal-overlay.open{display:flex;animation:fadeIn .2s}
  .modal-close{margin-left:auto;width:28px;height:28px;min-width:28px;min-height:28px;background:transparent;border:1px solid var(--border-strong);border-radius:var(--r-sm);color:var(--text-3);font-size:14px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;justify-content:center}
  .modal-close:hover{color:var(--danger);border-color:var(--danger-border)}
  .iform{display:flex;flex-wrap:wrap;gap:var(--sp-2);align-items:flex-end;padding:var(--sp-3);background:var(--bg-0);border-radius:var(--r-md);border:1px solid var(--border-subtle);margin-bottom:10px}
  .ilist{display:flex;flex-direction:column;gap:5px}
  .iitem{display:flex;align-items:center;gap:var(--sp-2);padding:8px 10px;border-radius:var(--r-md);background:var(--bg-2);border:1px solid var(--border);transition:background .2s,border-color .2s}
  .iitem.flash{background:var(--accent-bg);border-color:var(--accent-border)}
  .idot{width:7px;height:7px;border-radius:50%;background:var(--bg-3);flex-shrink:0;transition:.3s}
  .idot.active{background:var(--accent);box-shadow:0 0 6px var(--accent-border)}
  .idot.flash{background:var(--info);box-shadow:0 0 10px var(--info-border)}
  .iinfo{flex:1;min-width:0}.iname{font-size:11px;font-weight:600;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .imeta{font-size:9px;color:var(--text-3);margin-top:1px}
  .istat{text-align:right;flex-shrink:0}.ifires{font-size:13px;font-weight:700;color:var(--accent)}.ifires.flash{color:var(--info)}
  .inext{font-size:8px;color:var(--text-3);margin-top:1px}
  .irm{width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--border);border-radius:var(--r-xs);color:var(--text-4);font-size:11px;flex-shrink:0}
  .iempty{text-align:center;padding:10px 0;color:var(--text-4);font-size:10px;letter-spacing:1px}
  .log-list{display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto}
  .history{display:flex;gap:3px;flex-wrap:wrap;margin-top:12px;justify-content:center}
  .hblock{width:14px;height:14px;border-radius:3px}.hw{background:var(--work);opacity:.8}.hs{background:var(--short);opacity:.6}.hl{background:var(--long);opacity:.6}
  .hist-day{padding:12px;background:var(--bg-1);border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:8px;cursor:pointer;transition:border-color .2s}
  .hist-day:hover{border-color:var(--border-strong)}
  .hist-day-hdr{display:flex;align-items:center;gap:10px}
  .hist-day-date{font-size:12px;font-weight:600;color:var(--text-2);flex:1}
  .hist-day-stats{display:flex;gap:12px;font-size:10px;color:var(--text-3)}
  .hist-day-stat{display:flex;align-items:center;gap:4px}
  .hist-day-detail{margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:none;animation:fadeIn .2s}
  .hist-day.open .hist-day-detail{display:block}
  .hist-day-section{margin-bottom:8px}
  .hist-day-section-title{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--text-4);margin-bottom:4px}
  .hist-goal{font-size:10px;color:var(--text-3);padding:2px 0}
  .hist-log{font-size:10px;color:var(--text-3);padding:2px 0}
  .hist-task{font-size:10px;color:var(--text-3);padding:2px 0}
'''

start = s.find("  :root{")
if start == -1:
    raise SystemExit("no :root")
marker = "  /* =================================================================== */\n  /* =========== DESIGN SYSTEM OVERLAY"
idx = s.find(marker)
if idx == -1:
    raise SystemExit("no DESIGN SYSTEM marker")
new_s = s[:start] + NEW_ROOT + "\n" + INJECTION + s[idx:]
p.write_text(new_s, encoding="utf-8")
print("OK", len(new_s), "bytes")
