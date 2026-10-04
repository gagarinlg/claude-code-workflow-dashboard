import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlFollower, JOURNAL_OPS, TRANSCRIPT_OPS, newBudget } from '../src/data/incremental';
import { jload, agentStats, firstUserText, newAgentStats, foldAgentStats, cloneAgentStats, TAIL_LEN } from '../src/data/parse';

// The follower must give exactly what a one-shot jload() of the same bytes gives,
// however the bytes arrive: in one piece, appended over time, or read in slices.

let dir: string;
let fp: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-'));
  fp = path.join(dir, 'f.jsonl');
});

afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const line = (v: unknown): string => JSON.stringify(v) + '\n';

function follow(f: JsonlFollower<unknown[]>, budget = Infinity): unknown[] {
  return f.sync(fp, newBudget(budget)).acc;
}

// Read to completion in slices of `budget` bytes.
function followAll(f: JsonlFollower<unknown[]>, budget: number): { acc: unknown[]; slices: number } {
  let acc: unknown[] = [];
  let slices = 0;
  do {
    acc = follow(f, budget);
    slices++;
  } while (!f.complete && slices < 100_000);
  return { acc, slices };
}

describe('JsonlFollower — journal fold', () => {
  it('parses complete lines like jload (blank and malformed lines skipped)', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + '\n   \n' + 'not json\n' + line({ b: 2 }) + line(null) + line(7));
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(follow(f)).toEqual(jload(fp));
    expect(f.complete).toBe(true);
  });

  it('reads only the appended bytes on the next sync', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    const extra = line({ b: 2 });
    fs.appendFileSync(fp, extra);
    const budget = newBudget(Infinity);
    const acc = f.sync(fp, budget).acc;
    expect(acc).toEqual([{ a: 1 }, { b: 2 }]);
    expect(budget.bytesRead).toBe(Buffer.byteLength(extra));
  });

  it('does not read an unchanged file again', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    const budget = newBudget(Infinity);
    expect(f.sync(fp, budget).acc).toEqual([{ a: 1 }]);
    expect(budget.bytesRead).toBe(0);
  });

  it('does not even open an unchanged file', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // chmod 000 does not deny root
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    const st = fs.statSync(fp);
    fs.chmodSync(fp, 0o000);
    try {
      // Opening would fail and drop the state; the unchanged stat must short-circuit first.
      expect(f.sync(fp, newBudget(Infinity), st).acc).toEqual([{ a: 1 }]);
    } finally {
      fs.chmodSync(fp, 0o644);
    }
  });

  it('includes a valid unterminated last line, and counts it once when its newline arrives', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + JSON.stringify({ b: 2 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(follow(f)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(follow(f)).toEqual(jload(fp)); // unchanged: same view
    fs.appendFileSync(fp, '\n' + line({ c: 3 }));
    expect(follow(f)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('skips a line still being written, then parses it once complete', () => {
    const full = JSON.stringify({ type: 'assistant', text: 'hello' });
    fs.writeFileSync(fp, line({ a: 1 }) + full.slice(0, 10));
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(follow(f)).toEqual([{ a: 1 }]);
    fs.appendFileSync(fp, full.slice(10) + '\n');
    expect(follow(f)).toEqual([{ a: 1 }, JSON.parse(full)]);
  });

  it('the tentative last line does not leak into the committed state', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + JSON.stringify({ b: 2 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    // The writer replaces the tail: the committed state must not contain {b:2}.
    fs.truncateSync(fp, Buffer.byteLength(line({ a: 1 })));
    fs.appendFileSync(fp, line({ c: 3 }));
    expect(follow(f)).toEqual([{ a: 1 }, { c: 3 }]);
  });

  it('starts over when the file is truncated', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + line({ b: 2 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    fs.writeFileSync(fp, line({ z: 9 }));
    expect(follow(f)).toEqual([{ z: 9 }]);
  });

  it('starts over when the file is replaced by another one (new inode)', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    const tmp = path.join(dir, 'tmp.jsonl');
    fs.writeFileSync(tmp, line({ x: 1 }) + line({ y: 2 }) + line({ z: 3 }));
    fs.renameSync(tmp, fp);
    expect(follow(f)).toEqual([{ x: 1 }, { y: 2 }, { z: 3 }]);
  });

  it('starts over when the file was rewritten in place and grew', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    // Same inode, longer, and the byte before the old offset is no longer '\n'.
    const fd = fs.openSync(fp, 'r+');
    fs.writeSync(fd, line({ aaaa: 1111 }) + line({ b: 2 }), 0);
    fs.closeSync(fd);
    expect(follow(f)).toEqual([{ aaaa: 1111 }, { b: 2 }]);
  });

  it('reads in budgeted slices and ends with the same result', () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ i, pad: 'x'.repeat(i * 3) }));
    fs.writeFileSync(fp, rows.map(line).join(''));
    const f = new JsonlFollower(JOURNAL_OPS);
    const first = follow(f, 100);
    expect(f.complete).toBe(false);
    expect(first.length).toBeLessThan(rows.length);
    const { acc, slices } = followAll(f, 100);
    expect(acc).toEqual(rows);
    expect(slices).toBeGreaterThan(5);
  });

  it('makes progress on a line longer than the budget', () => {
    const big = { big: 'y'.repeat(100_000) };
    fs.writeFileSync(fp, line(big) + line({ after: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    const { acc } = followAll(f, 10);
    expect(acc).toEqual([big, { after: 1 }]);
  });

  it('after reading a line longer than the budget, the slice stops at that line', () => {
    const big = line({ big: 'y'.repeat(100_000) });
    const small = Array.from({ length: 2000 }, (_, i) => line({ i })).join('');
    fs.writeFileSync(fp, big + small);
    const f = new JsonlFollower(JOURNAL_OPS);
    const budget = newBudget(10_000);
    expect(f.sync(fp, budget).count).toBe(1);
    expect(budget.bytesRead).toBe(Buffer.byteLength(big));
    expect(followAll(f, 10_000).acc).toEqual(jload(fp));
  });

  it('keeps multi-byte UTF-8 intact across slice boundaries', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ t: `ä€😀 ${i} Grüße ✓`.repeat(i % 5 + 1) }));
    fs.writeFileSync(fp, rows.map(line).join(''));
    for (const budget of [1, 3, 7, 64]) {
      const f = new JsonlFollower(JOURNAL_OPS);
      expect(followAll(f, budget).acc).toEqual(rows);
    }
  });

  it('handles CRLF line endings like jload', () => {
    fs.writeFileSync(fp, '{"a":1}\r\n{"b":2}\r\n');
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(follow(f)).toEqual(jload(fp));
  });

  it('with no budget left, keeps the previous view and reports incomplete', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    fs.appendFileSync(fp, line({ b: 2 }));
    expect(f.sync(fp, newBudget(0)).acc).toEqual([{ a: 1 }]);
    expect(f.complete).toBe(false);
    expect(follow(f)).toEqual([{ a: 1 }, { b: 2 }]);
    expect(f.complete).toBe(true);
  });

  it('a missing file yields an empty, complete view', () => {
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(f.sync(path.join(dir, 'nope.jsonl'), newBudget(Infinity))).toEqual({ acc: [], count: 0 });
    expect(f.complete).toBe(true);
  });

  it('forgets its state when the file disappears', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    fs.rmSync(fp);
    expect(follow(f)).toEqual([]);
    fs.writeFileSync(fp, line({ b: 2 }));
    expect(follow(f)).toEqual([{ b: 2 }]);
  });

  it('a file that cannot be opened yields an empty, complete view', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // chmod 000 does not deny root
    fs.writeFileSync(fp, line({ a: 1 }));
    fs.chmodSync(fp, 0o000);
    try {
      const f = new JsonlFollower(JOURNAL_OPS);
      expect(f.sync(fp, newBudget(Infinity), fs.statSync(fp))).toEqual({ acc: [], count: 0 });
      expect(f.complete).toBe(true);
    } finally {
      fs.chmodSync(fp, 0o644);
    }
  });

  it('a read error drops the state (directory given as the file)', () => {
    const f = new JsonlFollower(JOURNAL_OPS);
    // Opening a directory succeeds on POSIX; reading it fails with EISDIR.
    const view = f.sync(dir, newBudget(Infinity), fs.statSync(dir));
    expect(view.count).toBe(0);
    expect(f.complete).toBe(true);
  });

  it('reset() forgets everything', () => {
    fs.writeFileSync(fp, line({ a: 1 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    follow(f);
    f.reset();
    const budget = newBudget(Infinity);
    expect(f.sync(fp, budget).acc).toEqual([{ a: 1 }]);
    expect(budget.bytesRead).toBeGreaterThan(0);
  });

  it('counts parsed values, including null and numbers (like jload().length)', () => {
    fs.writeFileSync(fp, line(null) + line(1) + '\n' + 'x\n' + line('s'));
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(f.sync(fp, newBudget(Infinity)).count).toBe(jload(fp).length);
  });
});

// --- Transcript fold ---

function assistant(text: string, usage: Record<string, number> = { output_tokens: 5 }, tool?: string): unknown {
  const content: unknown[] = [{ type: 'text', text }];
  if (tool) content.push({ type: 'tool_use', name: tool, input: { q: text } });
  return { type: 'assistant', message: { usage, content } };
}

function transcript(): unknown[] {
  const ev: unknown[] = [
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'no text here' }] } },
    { type: 'user', message: { content: 'You are the reviewer.\nReview X.' } },
    { type: 'user', message: { content: 'a later user turn' } },
  ];
  for (let i = 0; i < 45; i++) {
    ev.push(assistant(`step ${i}`, i % 3 ? { output_tokens: i } : { output_tokens: i, input_tokens: 2, cache_read_input_tokens: 3 }, i % 2 ? 'Read' : undefined));
  }
  ev.push(42, null, 'str', { type: 'assistant' }, { type: 'assistant', message: { content: 'not an array' } });
  return ev;
}

describe('TRANSCRIPT_OPS — same result as agentStats() + firstUserText()', () => {
  it('over a whole transcript, in one read and in slices', () => {
    const ev = transcript();
    fs.writeFileSync(fp, ev.map(line).join(''));
    for (const budget of [Infinity, 1, 200]) {
      const f = new JsonlFollower(TRANSCRIPT_OPS);
      let view;
      do { view = f.sync(fp, newBudget(budget)); } while (!f.complete);
      expect(view.acc.stats).toEqual(agentStats(ev));
      expect(view.acc.prompt).toBe(firstUserText(ev));
      expect(view.count).toBe(ev.length);
    }
  });

  it('while the transcript grows line by line', () => {
    const ev = transcript();
    const f = new JsonlFollower(TRANSCRIPT_OPS);
    fs.writeFileSync(fp, '');
    for (let i = 0; i < ev.length; i++) {
      fs.appendFileSync(fp, line(ev[i]));
      const view = f.sync(fp, newBudget(Infinity));
      const seen = ev.slice(0, i + 1);
      expect(view.acc.stats).toEqual(agentStats(seen));
      expect(view.acc.prompt ?? '').toBe(firstUserText(seen));
    }
  });

  it('an unterminated last line counts tentatively and does not touch the committed stats', () => {
    const ev = transcript();
    const last = assistant('tentative', { output_tokens: 1000, input_tokens: 7 }, 'Grep');
    fs.writeFileSync(fp, ev.map(line).join('') + JSON.stringify(last));
    const f = new JsonlFollower(TRANSCRIPT_OPS);
    const view = f.sync(fp, newBudget(Infinity));
    expect(view.acc.stats).toEqual(agentStats([...ev, last]));
    expect(view.count).toBe(jload(fp).length);
    // Once the line is terminated and more follows, it is counted exactly once.
    const next = assistant('after', { output_tokens: 3 });
    fs.appendFileSync(fp, '\n' + line(next));
    const after = f.sync(fp, newBudget(Infinity));
    expect(after.acc.stats).toEqual(agentStats([...ev, last, next]));
    expect(after.count).toBe(ev.length + 2);
  });

  it('a transcript whose only line is unterminated has count 1 (the agent is shown)', () => {
    fs.writeFileSync(fp, JSON.stringify(assistant('only')));
    const f = new JsonlFollower(TRANSCRIPT_OPS);
    expect(f.sync(fp, newBudget(Infinity)).count).toBe(jload(fp).length);
    expect(jload(fp)).toHaveLength(1);
  });

  it('prompt stays undefined while no user turn carries text', () => {
    fs.writeFileSync(fp, line(assistant('hi')));
    const f = new JsonlFollower(TRANSCRIPT_OPS);
    expect(f.sync(fp, newBudget(Infinity)).acc.prompt).toBeUndefined();
  });
});

describe('parse.ts accumulator helpers', () => {
  it('foldAgentStats keeps only the last TAIL_LEN activity entries', () => {
    const acc = newAgentStats();
    for (let i = 0; i < TAIL_LEN + 12; i++) foldAgentStats(acc, assistant(`t${i}`));
    expect(acc.tail).toHaveLength(TAIL_LEN);
    expect(acc.tail[0]?.text).toBe('t12');
  });

  it('cloneAgentStats is independent of the original', () => {
    const acc = newAgentStats();
    foldAgentStats(acc, assistant('one'));
    const copy = cloneAgentStats(acc);
    foldAgentStats(copy, assistant('two', { output_tokens: 9, input_tokens: 1 }));
    expect(acc.tail).toHaveLength(1);
    expect(acc.outTok).toBe(5);
    expect(acc.inTok).toBeUndefined();
    expect(copy.tail).toHaveLength(2);
  });
});
