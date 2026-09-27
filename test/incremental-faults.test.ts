import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlFollower, JOURNAL_OPS, newBudget } from '../src/data/incremental';
import { jload } from '../src/data/parse';

// Races and I/O errors the follower must survive without hanging the extension
// host or corrupting its state. fs is wrapped so a test can make fstat report a
// stale size or make one readSync call fail.

const ctl = vi.hoisted(() => ({ fstatExtra: 0, reads: 0, failReadAt: 0, maxReads: 0 }));

vi.mock('fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs')>();
  const fstatSync = ((fd: number) => {
    const st = real.fstatSync(fd);
    if (!ctl.fstatExtra) return st;
    // A size the file no longer has, as if it shrank right after the fstat.
    return Object.assign(Object.create(Object.getPrototypeOf(st) as object) as fs.Stats, st, { size: st.size + ctl.fstatExtra });
  }) as typeof real.fstatSync;
  const readSync = ((...args: Parameters<typeof real.readSync>) => {
    ctl.reads++;
    if (ctl.maxReads && ctl.reads > ctl.maxReads) throw new Error('readSync called too often: the read loop is spinning');
    if (ctl.failReadAt && ctl.reads === ctl.failReadAt) throw new Error('EIO: simulated read error');
    return real.readSync(...args);
  }) as typeof real.readSync;
  return { ...real, default: { ...real, fstatSync, readSync }, fstatSync, readSync };
});

let dir: string;
let fp: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-faults-'));
  fp = path.join(dir, 'f.jsonl');
  Object.assign(ctl, { fstatExtra: 0, reads: 0, failReadAt: 0, maxReads: 0 });
});

afterEach(() => {
  Object.assign(ctl, { fstatExtra: 0, failReadAt: 0, maxReads: 0 });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
});

const line = (v: unknown): string => JSON.stringify(v) + '\n';

describe('JsonlFollower under races and read errors', () => {
  it('returns when the file is shorter than fstat reported and ends without a newline', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + line({ b: 2 }) + '{"c":3');
    ctl.fstatExtra = 17;
    ctl.maxReads = 1000;
    const f = new JsonlFollower(JOURNAL_OPS);
    const view = f.sync(fp, newBudget(Infinity));
    expect(ctl.reads).toBeLessThan(10);
    expect(view.acc).toEqual(jload(fp));
    expect(f.complete).toBe(true);
  });

  it('the same with an unterminated last line that is valid JSON', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + JSON.stringify({ c: 3 }));
    ctl.fstatExtra = 100;
    ctl.maxReads = 1000;
    const f = new JsonlFollower(JOURNAL_OPS);
    expect(f.sync(fp, newBudget(Infinity)).acc).toEqual([{ a: 1 }, { c: 3 }]);
    expect(ctl.reads).toBeLessThan(10);
  });

  it('a read error part-way through a slice drops the state instead of counting lines twice', () => {
    fs.writeFileSync(fp, line({ a: 1 }) + line({ b: 2 }));
    const f = new JsonlFollower(JOURNAL_OPS);
    f.sync(fp, newBudget(Infinity));
    fs.appendFileSync(fp, Array.from({ length: 10 }, (_, i) => line({ i })).join(''));
    // Read 1 checks the byte before the offset, read 2 consumes one line (budget
    // 10 bytes), read 3 fails after that line was folded.
    ctl.failReadAt = ctl.reads + 3;
    f.sync(fp, newBudget(10));
    ctl.failReadAt = 0;
    let acc: unknown[] = [];
    let slices = 0;
    do {
      acc = f.sync(fp, newBudget(10)).acc;
      slices++;
    } while (!f.complete && slices < 1000);
    expect(acc).toEqual(jload(fp));
  });
});
