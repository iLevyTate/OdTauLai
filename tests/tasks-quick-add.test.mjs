/**
 * parseQuickAdd in js/tasks.js — the natural-language quick-add parser.
 *
 * The user types tokens like "@urgent #work !star ~daily tomorrow buy milk"
 * and we extract structured props. This is a high-traffic regression magnet:
 * every quick-add bug starts here.
 *
 * parseQuickAdd uses todayISO() and `new Date()` internally. We inject a fixed
 * todayISO; for tomorrow/next-week/weekday we only verify shape (the calendar
 * math depends on real Date.now()).
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadParser(fixedTodayISO) {
  const src = readFileSync(join(root, 'js', 'tasks.js'), 'utf8');
  const s = src.indexOf('function parseQuickAdd(raw)');
  const e = src.indexOf('async function addTask()', s);
  assert.ok(s >= 0 && e > s, 'slice parseQuickAdd');
  const block = src.slice(s, e);
  return new Function('todayISO',
    `${block}\nreturn parseQuickAdd;`,
  )(() => fixedTodayISO);
}

test('parseQuickAdd: plain text returns name with no props', () => {
  const parse = loadParser('2026-04-27');
  const r = parse('buy milk');
  assert.equal(r.name, 'buy milk');
  assert.deepEqual(r.props, {});
});

test('parseQuickAdd: @priority extracted (urgent/high/normal/low, case-insensitive)', () => {
  const parse = loadParser('2026-04-27');
  assert.equal(parse('buy milk @urgent').props.priority, 'urgent');
  assert.equal(parse('buy milk @HIGH').props.priority, 'high');
  assert.equal(parse('buy milk @Normal').props.priority, 'normal');
  assert.equal(parse('buy milk @low').props.priority, 'low');
  assert.equal(parse('buy milk @urgent').name, 'buy milk');
});

test('parseQuickAdd: @priority requires leading whitespace (token at start of text is NOT extracted)', () => {
  // Regex is /\s@(urgent|...)/ — no leading space at position 0 means no match.
  // Locking this contract: leading-position tokens stay in the name.
  const parse = loadParser('2026-04-27');
  const r = parse('@urgent buy milk');
  assert.equal(r.props.priority, undefined);
  assert.equal(r.name, '@urgent buy milk');
});

test('parseQuickAdd: #tags accumulate (multiple), name strips them', () => {
  const parse = loadParser('2026-04-27');
  const r = parse('clean garage #home #weekend');
  assert.deepEqual(r.props.tags, ['home', 'weekend']);
  assert.equal(r.name, 'clean garage');
});

test('parseQuickAdd: !star and !pin both set starred=true (case-insensitive)', () => {
  const parse = loadParser('2026-04-27');
  assert.equal(parse('email boss !star').props.starred, true);
  assert.equal(parse('email boss !pin').props.starred, true);
  assert.equal(parse('email boss !PIN').props.starred, true);
  assert.equal(parse('email boss !star').name, 'email boss');
});

test('parseQuickAdd: ~recur extracted (daily/weekdays/weekly/monthly)', () => {
  const parse = loadParser('2026-04-27');
  assert.equal(parse('standup ~daily').props.recur, 'daily');
  assert.equal(parse('email triage ~weekdays').props.recur, 'weekdays');
  assert.equal(parse('review ~WEEKLY').props.recur, 'weekly');
  assert.equal(parse('rent ~Monthly').props.recur, 'monthly');
});

test('parseQuickAdd: "today" → injected fixedTodayISO', () => {
  const parse = loadParser('2026-04-27');
  assert.equal(parse('buy milk today').props.dueDate, '2026-04-27');
  assert.equal(parse('buy milk today').name, 'buy milk');
});

test('parseQuickAdd: "tomorrow" / "tmrw" → ISO-shaped date, both spellings produce the same value', () => {
  const parse = loadParser('2026-04-27');
  const r = parse('buy milk tomorrow');
  const r2 = parse('buy milk tmrw');
  assert.match(r.props.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.props.dueDate, r2.props.dueDate);
  assert.equal(r.name, 'buy milk');
  assert.equal(r2.name, 'buy milk');
});

test('parseQuickAdd: "next week" → ISO-shaped date, name stripped', () => {
  const parse = loadParser('2026-04-27');
  const r = parse('plan trip next week');
  assert.match(r.props.dueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(r.name, 'plan trip');
});

test('parseQuickAdd: weekday short forms (sun/mon/tue/wed/thu/fri/sat) map to a date', () => {
  const parse = loadParser('2026-04-27');
  for (const day of ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']) {
    const r = parse(`haircut ${day}`);
    assert.match(r.props.dueDate, /^\d{4}-\d{2}-\d{2}$/, `dueDate for ${day}`);
    assert.equal(r.name, 'haircut', `name stripped for ${day}`);
  }
});

test('parseQuickAdd: weekday long forms — only sun/mon/fri+day match (parser gap)', () => {
  // Regex is /\b(sun|mon|tue|wed|thu|fri|sat)(?:day)?\b/i — the optional "day"
  // suffix only forms a real word for sun+day/mon+day/fri+day. The full forms
  // tuesday/wednesday/thursday/saturday have extra letters between the 3-char
  // prefix and "day" and so DON'T match. This is a parser limitation worth
  // fixing; for now we lock in current behavior so a fix will surface as a
  // visible test update rather than silent behavior change.
  const parse = loadParser('2026-04-27');
  for (const day of ['sunday', 'monday', 'friday']) {
    const r = parse(`haircut ${day}`);
    assert.match(r.props.dueDate, /^\d{4}-\d{2}-\d{2}$/, `${day} parses today`);
  }
  for (const day of ['tuesday', 'wednesday', 'thursday', 'saturday']) {
    const r = parse(`haircut ${day}`);
    assert.equal(r.props.dueDate, undefined, `${day} NOT parsed (known gap)`);
    assert.equal(r.name, `haircut ${day}`, `${day} stays in name (known gap)`);
  }
});

test('parseQuickAdd: combined tokens — every type at once', () => {
  const parse = loadParser('2026-04-27');
  const r = parse('finish report @high #work !star ~weekly today');
  assert.equal(r.props.priority, 'high');
  assert.deepEqual(r.props.tags, ['work']);
  assert.equal(r.props.starred, true);
  assert.equal(r.props.recur, 'weekly');
  assert.equal(r.props.dueDate, '2026-04-27');
  assert.equal(r.name, 'finish report');
});

test('parseQuickAdd: token-only input — empty name after stripping', () => {
  // Note the leading space: the priority/star/recur regexes require \s before
  // the marker, so a token at position 0 won't match (locked in by test above).
  // To get a fully-tokenized input that reduces to empty name, every token
  // needs a leading space.
  const parse = loadParser('2026-04-27');
  const r = parse(' @urgent #work today');
  assert.equal(r.props.priority, 'urgent');
  assert.deepEqual(r.props.tags, ['work']);
  assert.equal(r.props.dueDate, '2026-04-27');
  assert.equal(r.name, '');
});

test('parseQuickAdd: collapses multiple spaces left behind by token removal', () => {
  const parse = loadParser('2026-04-27');
  const r = parse('write   notes  @urgent  today');
  assert.equal(r.name, 'write notes');
});

// ─────────────────────────────────────────────────────────────────────────────
// TODO(human): Two conflict-resolution contracts the parser exhibits but
// we haven't *locked in* with a test. The current code matches first-and-done
// for non-tag tokens. Decide if that's correct UX, then add a test (or change
// the parser if you want the last token to win).
//
// Behavior #1 — duplicate priorities:
//   parse('task @urgent @low')
//   currently → { name: 'task @low', props: { priority: 'urgent' } }
//   First @-token wins; the second stays in the name.
//
// Behavior #2 — multiple date phrases:
//   parse('buy milk today tomorrow')
//   currently → today wins (else-if order); 'tomorrow' stays in the name.
//
// Add 5–10 lines of tests for whichever contract you want to commit to.
// If you want both to "last token wins", change the parser instead and write
// the tests against the new behavior.
// ─────────────────────────────────────────────────────────────────────────────
