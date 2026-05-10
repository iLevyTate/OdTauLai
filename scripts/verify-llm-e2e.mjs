// scripts/verify-llm-e2e.mjs
//
// One-shot verification that the on-device LLM in OdTauLai actually works
// end-to-end on a real model — not a stubbed-fixture test like the unit
// suite. Downloads Qwen2.5-0.5B-Instruct (the smallest preset with native
// <tool_call> XML support), feeds it a multi-op natural-language request,
// then asserts that the live `tasks` array mutated as expected.
//
// Run: node scripts/verify-llm-e2e.mjs
// Exits 0 on PASS, non-zero on FAIL with a diagnostic block.
//
// Not added to npm test — needs network + minutes of runtime.

import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT     = 8090;
const URL      = `http://127.0.0.1:${PORT}/`;
const MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';
const DTYPE    = 'q4';
const PROMPT   = 'Plan my day: archive every task older than a week and add a task to email Sarah tomorrow';

const STATE_KEY = 'stupind_state';
const GEN_KEY   = 'stupind_gen_cfg';

const ART_DIR = mkdtempSync(join(tmpdir(), 'llm-e2e-'));
const log = (step, msg) => console.log(`[${step}] ${msg}`);
const fail = (step, err) => {
  console.error(`\nFAIL at ${step}`);
  if(err) console.error(err.stack || err.message || err);
  console.error(`Artifacts: ${ART_DIR}`);
  process.exit(1);
};

function startServer(){
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    const onLine = (chunk) => {
      const s = chunk.toString();
      if(!ready && /Serving HTTP/i.test(s)){ ready = true; resolve(proc); }
    };
    proc.stderr.on('data', onLine);
    proc.stdout.on('data', onLine);
    proc.on('exit', (code) => { if(!ready) reject(new Error(`server exited ${code}`)); });
    setTimeout(() => { if(!ready) resolve(proc); }, 1500);
  });
}

const fixtureTasks = (() => {
  const today = new Date();
  const stamp = (offsetDays) => {
    const d = new Date(today.getTime() - offsetDays*24*3600*1000);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} 09:00:00`;
  };
  const base = (id, name, daysAgo) => ({
    id, name, totalSec: 0, sessions: 0,
    created: stamp(daysAgo), parentId: null, collapsed: false,
    status: 'open', priority: 'none', tags: [], dueDate: null, startDate: null,
    estimateMin: 0, description: '', starred: false, completedAt: null,
    listId: 1, archived: false, recur: null, order: id,
    remindAt: null, reminderFired: false, type: 'task',
    effort: null, energyLevel: null, blockedBy: [], checklist: [], notes: [],
    url: null, completionNote: null, category: null,
    valuesAlignment: [], valuesNote: null, completions: [],
    habitLastRecordedTotalSec: null,
  });
  return [
    base(101, 'Reorganize bookshelf', 14), // stale
    base(102, 'Sort old photo archive', 10), // stale
    base(103, 'Buy groceries', 0),           // fresh control
  ];
})();

function preSeedScript(){
  // Body returned as a string; injected via page.evaluateOnNewDocument so it
  // runs before the app's own <script> tags execute. We build the full state
  // blob the way storage.js expects so loadState() picks it up cleanly.
  // _validateState requires `tasks` array + `date` string. Other fields are
  // tolerated as missing and defaulted by the loader.
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const state = {
    date: dateKey,
    tasks: fixtureTasks,
    taskIdCtr: 200,
    activeTab: 'tasks',
    activeListId: 1,
    lists: [{ id: 1, name: 'Inbox' }],
    listIdCtr: 1,
    goals: [], goalIdCtr: 0,
    schemaVersion: 1,
  };
  const gen = {
    enabled: true,
    modelId: 'onnx-community/Qwen2.5-0.5B-Instruct',
    dtype: 'q4',
    timeoutSec: 120,
    downloadedIds: [],
    cfgVersion: 2,
  };
  return `
    try {
      localStorage.setItem(${JSON.stringify(STATE_KEY)}, ${JSON.stringify(JSON.stringify(state))});
      localStorage.setItem(${JSON.stringify(GEN_KEY)},   ${JSON.stringify(JSON.stringify(gen))});
    } catch (e) { console.error('preSeed failed', e); }
  `;
}

async function main(){
  const t0 = Date.now();
  log('01/06', `HTTP server starting on :${PORT}`);
  const server = await startServer();
  let browser;
  try {
    log('02/06', 'Launching browser (headless, WASM backend expected)');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      protocolTimeout: 300_000,
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('[pageerror]', e.message));
    page.on('console', (m) => {
      const t = m.type();
      if(t === 'error' || t === 'warning') console.error(`[browser ${t}]`, m.text());
    });

    await page.evaluateOnNewDocument(preSeedScript());

    log('03/06', `Pre-seed: 3 fixture tasks (stale=2, fresh=1); cfg.modelId=${MODEL_ID}`);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for app to finish booting + expose globals.
    await page.waitForFunction(
      // `tasks` is a script-scope `let` from js/timer.js — accessible as a
      // bare identifier in the page's main world but NOT on `window`.
      () => typeof window.genLoad === 'function' &&
            typeof window.cognitaskRun === 'function' &&
            typeof window.acceptProposedOps === 'function' &&
            typeof window.executeIntelOp === 'function' &&
            // eslint-disable-next-line no-undef
            (typeof tasks !== 'undefined' && Array.isArray(tasks)),
      { timeout: 30_000 }
    );

    // eslint-disable-next-line no-undef
    const seedCount = await page.evaluate(() => tasks.length);
    if(seedCount !== 3) fail('03/06', new Error(`expected 3 seeded tasks, got ${seedCount}`));

    log('04/06', `Downloading ${MODEL_ID} (this can take 1–3 min on cold cache)…`);
    const tDownload = Date.now();
    let lastPct = -10;
    page.on('console', (m) => {
      const txt = m.text();
      const mm = txt.match(/\bprogress\s+([\d.]+)/);
      if(mm){
        const pct = Math.floor(parseFloat(mm[1]));
        if(pct >= lastPct + 10){ lastPct = pct; log('04/06', `… ${pct}%`); }
      }
    });

    let loadErr = null;
    const loadResult = await page.evaluate(async (modelId, dtype) => {
      try {
        await window.genLoad(modelId, dtype, (p) => {
          if(p && typeof p.progress === 'number'){
            console.log(`progress ${p.progress.toFixed(1)} ${p.file || ''}`);
          }
        });
        return { ok: true, ready: window.isGenReady(), device: window.getGenDevice && window.getGenDevice() };
      } catch (e) {
        return { ok: false, message: String(e && e.message || e), lastError: window.getGenLastError && window.getGenLastError() };
      }
    }, MODEL_ID, DTYPE).catch((e) => ({ ok: false, message: String(e.message || e) }));

    const downloadSec = Math.round((Date.now() - tDownload) / 1000);

    if(!loadResult || !loadResult.ok || !loadResult.ready){
      console.error(`\nModel load FAILED after ${downloadSec}s`);
      console.error('  reason:', loadResult && (loadResult.message || JSON.stringify(loadResult.lastError)));
      console.error('  This usually means the sandbox cannot reach huggingface.co or cdn.jsdelivr.net.');
      console.error('  Falling back to stub-based unit tests so you still get an integration signal:\n');
      await browser.close().catch(() => {});
      server.kill();
      const code = await new Promise((res) => {
        const t = spawn('node', ['--test',
          'tests/ask-pipeline.test.mjs',
          'tests/tool-schema.test.mjs',
          'tests/gen-cfg.test.mjs',
          'tests/gen-native-tools.test.mjs',
          'tests/hybrid-ai.test.mjs',
        ], { stdio: 'inherit' });
        t.on('exit', res);
      });
      console.error(`\nVerdict: real-model path BLOCKED (network); stub tests exit=${code}`);
      process.exit(code === 0 ? 2 : 1);
    }

    log('05/06', `Model ready after ${downloadSec}s; backend=${loadResult.device || 'unknown'}`);

    log('06/06', `Submitting prompt: "${PROMPT}"`);
    const tInfer = Date.now();
    const askResult = await page.evaluate(async (q) => {
      try {
        const res = await window.cognitaskRun(q, {});
        return {
          ok: !!(res && res.ok),
          ops: (res && res.ops) || [],
          rejected: (res && res.rejected) || [],
          reason: res && res.reason,
          rawText: (res && res.rawText && res.rawText.slice(0, 400)) || '',
        };
      } catch (e) {
        return { ok: false, message: String(e.message || e) };
      }
    }, PROMPT);
    const inferSec = Math.round((Date.now() - tInfer) / 1000);

    writeFileSync(join(ART_DIR, 'ask-result.json'), JSON.stringify(askResult, null, 2));

    if(!askResult.ok){
      fail('06/06', new Error(`cognitaskRun returned !ok: ${askResult.reason || askResult.message || 'unknown'}\nraw: ${askResult.rawText || ''}`));
    }

    const opNames = askResult.ops.map(o => o.name);
    const archives = askResult.ops.filter(o => o.name === 'ARCHIVE_TASK');
    const creates  = askResult.ops.filter(o => o.name === 'CREATE_TASK');

    log('06/06', `Inference returned ${askResult.ops.length} op(s) in ${inferSec}s: [${opNames.join(', ')}]`);

    // Apply ops directly via executeIntelOp — we already validated through
    // cognitaskRun (which calls validateOps). Avoids depending on the Tools-
    // panel UI being mounted, which it might not be in this headless run.
    const applyResult = await page.evaluate(async (ops) => {
      const applied = [];
      for(const op of ops){
        try {
          const snap = window.executeIntelOp ? window.executeIntelOp(op) : null;
          applied.push({ name: op.name, ok: !!snap });
        } catch (e) {
          applied.push({ name: op.name, ok: false, error: String(e.message || e) });
        }
      }
      if(typeof window.saveState === 'function') window.saveState('verify-llm-e2e');
      // eslint-disable-next-line no-undef
      return { applied, finalTasks: tasks.map(t => ({ id: t.id, name: t.name, archived: !!t.archived, status: t.status })) };
    }, askResult.ops);

    writeFileSync(join(ART_DIR, 'final-state.json'), JSON.stringify(applyResult, null, 2));

    const finalTasks = applyResult.finalTasks;
    const stale1     = finalTasks.find(t => t.id === 101);
    const stale2     = finalTasks.find(t => t.id === 102);
    const fresh      = finalTasks.find(t => t.id === 103);
    const sarah      = finalTasks.find(t => /email.*sarah|sarah.*email/i.test(t.name));

    const checks = [
      { label: 'multi-op chain produced ARCHIVE + CREATE',
        pass: archives.length >= 1 && creates.length >= 1 },
      { label: 'at least one of the stale tasks (id 101/102) is now archived',
        pass: !!((stale1 && stale1.archived) || (stale2 && stale2.archived)) },
      { label: 'fresh control task (id 103) untouched',
        pass: !!(fresh && !fresh.archived && fresh.status === 'open') },
      { label: 'a new "email Sarah" task exists',
        pass: !!sarah },
    ];

    await page.screenshot({ path: join(ART_DIR, 'final.png'), fullPage: true });

    const passed = checks.filter(c => c.pass).length;
    console.log('\n=== Result ===');
    for(const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.label}`);
    console.log(`  ops produced: ARCHIVE_TASK x${archives.length}, CREATE_TASK x${creates.length}, other [${opNames.filter(n => n!=='ARCHIVE_TASK'&&n!=='CREATE_TASK').join(',')}]`);
    console.log(`  rejected: ${askResult.rejected.length}`);
    console.log(`  timing: download=${downloadSec}s, inference=${inferSec}s, total=${Math.round((Date.now()-t0)/1000)}s`);
    console.log(`  artifacts: ${ART_DIR}`);

    await browser.close();
    server.kill();

    if(passed === checks.length){
      console.log('\nPASS — LLM agentic loop verified end-to-end.');
      process.exit(0);
    }
    if(archives.length >= 1 && creates.length >= 1){
      console.log(`\nPARTIAL — ${passed}/${checks.length} checks passed. Multi-op shape correct but some assertions failed; see final-state.json.`);
      process.exit(3);
    }
    console.log(`\nFAIL — ${passed}/${checks.length} checks passed.`);
    process.exit(1);

  } catch (e) {
    if(browser) await browser.close().catch(() => {});
    server.kill();
    fail('main', e);
  }
}

main();
