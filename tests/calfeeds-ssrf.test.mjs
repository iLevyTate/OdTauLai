/**
 * calfeeds.js — _calFetchUrlOk SSRF guard.
 * Regression for the audit finding: private IPs / loopback / link-local /
 * IPv6 ULA / link-local must be rejected so a malicious backup can't point
 * a "calendar feed" at internal services (e.g. router admin, AWS metadata).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'js', 'calfeeds.js'), 'utf8');

function extractFn(){
  const i = src.indexOf('function _calFetchUrlOk(');
  assert.ok(i >= 0, '_calFetchUrlOk must exist');
  // Walk braces from the first `{` after the signature.
  const sigEnd = src.indexOf('{', i);
  let depth = 0;
  let j = sigEnd;
  for(; j < src.length; j++){
    if(src[j] === '{') depth++;
    else if(src[j] === '}'){ depth--; if(depth === 0){ j++; break; } }
  }
  const body = src.slice(i, j);
  // Stub for the production env that the helper reads.
  return new Function('window', 'location', 'return (' + body.replace('function _calFetchUrlOk(', 'function _calFetchUrlOk(') + ')');
}

const fakeWin = { location: { href: 'https://example.com/' } };
const fakeLoc = { protocol: 'https:' };
const calFetchUrlOk = extractFn()(fakeWin, fakeLoc);

const BLOCKED = [
  // Audit-flagged ranges:
  'http://127.0.0.1/x',
  'http://127.5.5.5/x',
  'https://localhost/x',
  'https://10.0.0.1/x',
  'https://172.16.0.1/x',
  'https://172.31.255.255/x',
  'https://192.168.1.1/x',
  'http://169.254.169.254/latest/meta-data/',   // AWS metadata
  'http://169.254.1.1/admin',
  'http://0.0.0.0/x',
  'https://[::1]/x',
  'https://[::]/x',
  'https://[fe80::1]/x',
  'https://[fc00::1]/x',
  'https://[fd00::1]/x',
];

const ALLOWED = [
  'https://calendar.google.com/calendar/ical/example/basic.ics',
  'https://outlook.live.com/owa/calendar/x/calendar.ics',
  'https://example.com/feed.ics',
  'https://172.15.0.1/x',  // just outside 172.16/12
  'https://172.32.0.1/x',  // just outside 172.16/12
  'https://192.169.1.1/x', // just outside 192.168/16
  'https://169.253.1.1/x', // just outside 169.254/16
];

test('calfeeds SSRF: private/loopback/link-local ranges are rejected', () => {
  for(const u of BLOCKED){
    assert.strictEqual(calFetchUrlOk(u), false, `should block ${u}`);
  }
});

test('calfeeds SSRF: public hosts pass through', () => {
  for(const u of ALLOWED){
    assert.strictEqual(calFetchUrlOk(u), true, `should allow ${u}`);
  }
});

test('calfeeds SSRF: non-http(s) schemes are rejected', () => {
  for(const u of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi']){
    assert.strictEqual(calFetchUrlOk(u), false, `should block scheme: ${u}`);
  }
});
