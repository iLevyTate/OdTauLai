#!/usr/bin/env node
/**
 * One-shot migration helper: rewrite inline on<event>="fn(args)" attributes
 * to data-action / data-on<event> + data-args, so the delegated dispatcher
 * in js/event-delegation.js can take over.
 *
 * Usage: node scripts/migrate-inline-handlers.mjs index.html [more files...]
 *
 * Mechanical strategy:
 *   1. on<event>="fn()"               -> data-on<event>="fn"  (click -> data-action)
 *   2. on<event>="fn('s')"            -> data-on<event>="fn" data-arg="s"
 *   3. on<event>="fn(<simple-args>)"  -> data-on<event>="fn" data-args='[...]'
 *   4. Anything more complex (multi-statement, this.value, conditionals) is
 *      left untouched and printed to stderr so the human can convert it.
 *
 * Simple args = numbers, single-quoted strings without nested quotes,
 * true/false/null. `this.value` / `this.checked` are flagged as complex
 * because the delegated handler must read from event.target instead.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const EVENT_NAMES = [
  'click', 'change', 'input', 'submit', 'keydown', 'keyup', 'keypress',
  'paste', 'focus', 'blur', 'toggle',
];

const SIMPLE_ARG_RE = /^(?:'[^'\\]*'|"[^"\\]*"|-?\d+(?:\.\d+)?|true|false|null|this\.value|this\.checked)$/;

function tokenizeArgs(raw){
  const out = [];
  let cur = '', depth = 0, inSingle = false, inDouble = false;
  for(let i = 0; i < raw.length; i++){
    const c = raw[i];
    if(c === '\\' && i + 1 < raw.length){ cur += c + raw[i+1]; i++; continue; }
    if(c === "'" && !inDouble){ inSingle = !inSingle; cur += c; continue; }
    if(c === '"' && !inSingle){ inDouble = !inDouble; cur += c; continue; }
    if(!inSingle && !inDouble){
      if(c === '(' || c === '[' || c === '{') depth++;
      else if(c === ')' || c === ']' || c === '}') depth--;
      if(c === ',' && depth === 0){ out.push(cur.trim()); cur = ''; continue; }
    }
    cur += c;
  }
  if(cur.trim()) out.push(cur.trim());
  return out;
}

function asJsonValue(arg){
  if(arg === 'true')  return true;
  if(arg === 'false') return false;
  if(arg === 'null')  return null;
  if(/^-?\d+(?:\.\d+)?$/.test(arg)) return Number(arg);
  return arg.slice(1, -1);
}

function migrateLine(line, complexLog, file, lineNo){
  const callRe = /\son(\w+)="([^"]*)"/g;
  return line.replace(callRe, (m, event, body) => {
    if(!EVENT_NAMES.includes(event)) return m;
    const dataAttr = event === 'click' ? 'data-action' : `data-on${event}`;
    body = body.trim();
    let mm = /^([a-zA-Z_$][\w$]*)\(\)\s*;?\s*$/.exec(body);
    if(mm){ return ` ${dataAttr}="${mm[1]}"`; }
    mm = /^([a-zA-Z_$][\w$]*)\((.*)\)\s*;?\s*$/.exec(body);
    if(mm){
      const fnName = mm[1];
      const args = tokenizeArgs(mm[2]);
      if(!args.length) return ` ${dataAttr}="${fnName}"`;
      if(!args.every(a => SIMPLE_ARG_RE.test(a))){
        complexLog.push(`${file}:${lineNo}  ${m}`);
        return m;
      }
      if(args.some(a => a === 'this.value' || a === 'this.checked')){
        complexLog.push(`${file}:${lineNo}  ${m}  (uses this.value/this.checked)`);
        return m;
      }
      if(args.length === 1){
        const v = asJsonValue(args[0]);
        if(typeof v === 'string'){
          const esc = v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          return ` ${dataAttr}="${fnName}" data-arg="${esc}"`;
        }
        return ` ${dataAttr}="${fnName}" data-args='${JSON.stringify([v])}'`;
      }
      return ` ${dataAttr}="${fnName}" data-args='${JSON.stringify(args.map(asJsonValue))}'`;
    }
    complexLog.push(`${file}:${lineNo}  ${m}`);
    return m;
  });
}

function migrateFile(path){
  const orig = readFileSync(path, 'utf-8');
  const lines = orig.split(/\r?\n/);
  const complexLog = [];
  const out = lines.map((l, i) => migrateLine(l, complexLog, path, i + 1)).join('\n');
  if(out !== orig){
    writeFileSync(path, out, 'utf-8');
    const before = (orig.match(/\son\w+="/g) || []).length;
    const after  = (out.match(/\son\w+="/g) || []).length;
    console.log(`OK ${path}  ${before - after} handler(s) migrated, ${after} left`);
  } else {
    console.log(`-- ${path}  no changes`);
  }
  if(complexLog.length){
    console.log(`   Complex (left for human review):`);
    complexLog.forEach(s => console.log(`     ${s}`));
  }
}

const targets = process.argv.slice(2);
if(!targets.length){
  console.error('Usage: node scripts/migrate-inline-handlers.mjs <file> [...]');
  process.exit(1);
}
targets.forEach(migrateFile);

