import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSnapshot, SnapshotCache, MAX_FOLLOWED_RUNS } from '../src/data/snapshot';
import type { Cfg, Snapshot, SnapshotOk, RoleRule } from '../src/data/snapshot';
import { DEFAULT_ROLE_RULES } from '../src/data/parse';

// buildSnapshot(cfg, { cache }) must produce what a fresh buildSnapshot(cfg)
// produces, while reading only what changed since the previous build.

let base: string;
let wfDir: string;
let repo: string;

const line = (v: unknown): string => JSON.stringify(v) + '\n';

function assistant(text: string, tokens = 10): unknown {
  return { type: 'assistant', message: { usage: { output_tokens: tokens }, content: [{ type: 'text', text }] } };
}

function makeRun(name: string): string {
  const d = path.join(base, 'proj', 'sess', 'subagents', 'workflows', name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeAgent(d: string, id: string, events: unknown[], agentType?: string): void {
  fs.writeFileSync(path.join(d, `agent-${id}.jsonl`), events.map(line).join(''));
  if (agentType !== undefined) fs.writeFileSync(path.join(d, `agent-${id}.meta.json`), JSON.stringify({ agentType }));
}

function cfg(extra: Partial<Cfg> = {}): Cfg {
  return { base, repo: '', refreshMs: 4000, statusBar: true, roleRules: DEFAULT_ROLE_RULES, ...extra };
}

// Drop the fields that depend on the wall clock at build time.
function norm(s: Snapshot): unknown {
  const c = JSON.parse(JSON.stringify(s)) as Record<string, unknown>;
  delete c['updatedAt'];
  for (const a of (c['agents'] as Record<string, unknown>[] | undefined) ?? []) delete a['elapsed'];
  return c;
}

function ok(s: Snapshot): SnapshotOk {
  expect(s.ok).toBe(true);
  return s as SnapshotOk;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'snapcache-'));
  wfDir = makeRun('wf_one');
  writeAgent(wfDir, 'a1', [{ type: 'user', message: { content: 'You are the reviewer.' } }, assistant('looking')], 'workflow-plugins:code-reviewer');
  writeAgent(wfDir, 'a2', [{ type: 'user', message: { content: 'You are the implementer.' } }, assistant('fixing')]);
  fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), line({ type: 'started', agentId: 'a1' }));
  repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
});

afterEach(() => {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
});

describe('buildSnapshot with a SnapshotCache', () => {
  it('matches a fresh build and reads nothing when nothing changed', () => {
    const cache = new SnapshotCache();
    const first = buildSnapshot(cfg(), { cache });
    expect(cache.bytesRead).toBeGreaterThan(0);
    expect(norm(first)).toEqual(norm(buildSnapshot(cfg())));
    const second = buildSnapshot(cfg(), { cache });
    expect(cache.bytesRead).toBe(0);
    expect(norm(second)).toEqual(norm(first));
  });

  it('picks up appended transcript lines and journal results', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    fs.appendFileSync(path.join(wfDir, 'agent-a1.jsonl'), line(assistant('found a bug', 7)));
    fs.appendFileSync(path.join(wfDir, 'journal.jsonl'), line({
      type: 'result', agentId: 'a1',
      result: { verdict: 'CHANGES', findings: [{ severity: 'HIGH', title: 'Bug' }], filesChanged: ['src/x.ts'] },
    }));
    const inc = ok(buildSnapshot(cfg(), { cache }));
    expect(norm(inc)).toEqual(norm(buildSnapshot(cfg())));
    const a1 = inc.agents.find((a) => a.id === 'a1');
    expect(a1?.status).toBe('done');
    expect(a1?.tokens).toBe(17);
    expect(a1?.lastActivity).toBe('found a bug');
    expect(inc.allFindings).toHaveLength(1);
    expect(inc.changedByAgents).toEqual(['src/x.ts']);
  });

  it('a new agent file appears on the next build', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    writeAgent(wfDir, 'a3', [assistant('new')]);
    expect(ok(buildSnapshot(cfg(), { cache })).agents.map((a) => a.id).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('forgets agents whose files are gone', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    const run = cache.runs.get(wfDir);
    expect(run?.transcripts.size).toBe(2);
    expect(run?.metas.size).toBe(1);
    fs.rmSync(path.join(wfDir, 'agent-a1.jsonl'));
    fs.rmSync(path.join(wfDir, 'agent-a1.meta.json'));
    const s = ok(buildSnapshot(cfg(), { cache }));
    expect(s.agents.map((a) => a.id)).toEqual(['a2']);
    expect([...(run?.transcripts.keys() ?? [])]).toEqual(['agent-a2.jsonl']);
    expect(run?.metas.size).toBe(0);
  });

  it('re-reads meta.json when it changes', () => {
    const cache = new SnapshotCache();
    expect(ok(buildSnapshot(cfg(), { cache })).agents.find((a) => a.id === 'a1')?.label).toBe('Code review');
    fs.writeFileSync(path.join(wfDir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'workflow-plugins:security-reviewer', x: 1 }));
    expect(ok(buildSnapshot(cfg(), { cache })).agents.find((a) => a.id === 'a1')?.label).toBe('Security');
  });

  it('an agent whose transcript is over 10 MiB is shown', () => {
    // The old reader skipped transcripts over MAX_JSONL_BYTES entirely.
    writeAgent(wfDir, 'big', [{ type: 'user', message: { content: 'You are the planner.' } }, assistant('z'.repeat(11 * 1024 * 1024))]);
    const s = ok(buildSnapshot(cfg()));
    expect(s.agents.map((a) => a.id)).toContain('big');
  });

  it('an agent whose only line is still unterminated is shown (and counted once when completed)', () => {
    const cache = new SnapshotCache();
    fs.writeFileSync(path.join(wfDir, 'agent-a3.jsonl'), JSON.stringify(assistant('first', 4)));
    const s1 = ok(buildSnapshot(cfg(), { cache }));
    expect(s1.agents.find((a) => a.id === 'a3')?.tokens).toBe(4);
    fs.appendFileSync(path.join(wfDir, 'agent-a3.jsonl'), '\n' + line(assistant('second', 6)));
    const s2 = ok(buildSnapshot(cfg(), { cache }));
    expect(s2.agents.find((a) => a.id === 'a3')?.tokens).toBe(10);
    expect(norm(s2)).toEqual(norm(buildSnapshot(cfg())));
  });

  it('the snapshot tail is a copy: later builds do not change an earlier snapshot', () => {
    const cache = new SnapshotCache();
    const first = ok(buildSnapshot(cfg(), { cache }));
    const tailBefore = JSON.stringify(first.agents.find((a) => a.id === 'a2')?.tail);
    fs.appendFileSync(path.join(wfDir, 'agent-a2.jsonl'), line(assistant('more')));
    buildSnapshot(cfg(), { cache });
    expect(JSON.stringify(first.agents.find((a) => a.id === 'a2')?.tail)).toBe(tailBefore);
  });
});

describe('SnapshotOptions.byteBudget', () => {
  it('builds in slices: pending until everything is read, then equal to a fresh build', () => {
    for (let i = 0; i < 20; i++) fs.appendFileSync(path.join(wfDir, 'agent-a2.jsonl'), line(assistant(`step ${i} ${'z'.repeat(50)}`)));
    const cache = new SnapshotCache();
    let s: Snapshot;
    let slices = 0;
    do {
      s = buildSnapshot(cfg(), { cache, byteBudget: 256 });
      slices++;
    } while (cache.pending && slices < 1000);
    expect(slices).toBeGreaterThan(3);
    expect(cache.pending).toBe(false);
    expect(norm(s)).toEqual(norm(buildSnapshot(cfg())));
  });

  it('journal growth alone keeps the build pending until it is read', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    // Transcripts unchanged: only the journal is behind.
    for (let i = 0; i < 30; i++) fs.appendFileSync(path.join(wfDir, 'journal.jsonl'), line({ type: 'started', agentId: `x${i}`, pad: 'p'.repeat(40) }));
    buildSnapshot(cfg(), { cache, byteBudget: 64 });
    expect(cache.pending).toBe(true);
    let s: Snapshot;
    let slices = 0;
    do {
      s = buildSnapshot(cfg(), { cache, byteBudget: 64 });
      slices++;
    } while (cache.pending && slices < 1000);
    expect(norm(s)).toEqual(norm(buildSnapshot(cfg())));
  });
});

describe('SnapshotOptions.discover', () => {
  it('discover:false keeps the current run even when a newer one appears; discover:true switches', () => {
    const cache = new SnapshotCache();
    expect(ok(buildSnapshot(cfg(), { cache })).runId).toBe('wf_one');
    const newer = makeRun('wf_two');
    writeAgent(newer, 'b1', [assistant('b')]);
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(newer, future, future);
    expect(ok(buildSnapshot(cfg(), { cache, discover: false })).runId).toBe('wf_one');
    const switched = ok(buildSnapshot(cfg(), { cache, discover: true }));
    expect(switched.runId).toBe('wf_two');
    expect(switched.agents.map((a) => a.id)).toEqual(['b1']);
    // The previous run's state is kept: switching back reads nothing.
    fs.utimesSync(wfDir, new Date(Date.now() + 120_000), new Date(Date.now() + 120_000));
    expect(ok(buildSnapshot(cfg(), { cache, discover: true })).runId).toBe('wf_one');
    expect(cache.bytesRead).toBe(0);
  });

  it(`keeps the state of the ${MAX_FOLLOWED_RUNS} most recently used runs`, () => {
    const cache = new SnapshotCache();
    const dirs = [wfDir];
    for (let i = 0; i < MAX_FOLLOWED_RUNS; i++) {
      const d = makeRun(`wf_extra${i}`);
      writeAgent(d, `e${i}`, [assistant('e')]);
      dirs.push(d);
    }
    for (const d of dirs) buildSnapshot(cfg({ pinnedDir: d }), { cache });
    expect(cache.runs.size).toBe(MAX_FOLLOWED_RUNS);
    // The least recently used run (the first) was dropped and is read again.
    buildSnapshot(cfg({ pinnedDir: dirs[0] }), { cache });
    expect(cache.bytesRead).toBeGreaterThan(0);
    // The most recently used one before it is still kept.
    buildSnapshot(cfg({ pinnedDir: dirs[dirs.length - 1] }), { cache });
    expect(cache.bytesRead).toBe(0);
  });

  it('discover:false rediscovers when the cached run directory is gone', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    const other = makeRun('wf_other');
    writeAgent(other, 'c1', [assistant('c')]);
    fs.rmSync(wfDir, { recursive: true, force: true });
    expect(ok(buildSnapshot(cfg(), { cache, discover: false })).runId).toBe('wf_other');
  });

  it('discover:false re-resolves when base or pinnedDir changed', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    const pinned = makeRun('wf_pinned');
    writeAgent(pinned, 'p1', [assistant('p')]);
    const s = ok(buildSnapshot(cfg({ pinnedDir: pinned }), { cache, discover: false }));
    expect(s.runId).toBe('wf_pinned');
    expect(s.isPinned).toBe(true);
  });

  it('with nothing found, the cache holds no run and the error is returned', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    fs.rmSync(path.join(base, 'proj'), { recursive: true, force: true });
    const s = buildSnapshot(cfg(), { cache, discover: false });
    expect(s.ok).toBe(false);
    expect(cache.run).toBeNull();
  });
});

describe('SnapshotOptions.walkRepo', () => {
  it('walkRepo:false reuses the last list; walkRepo:true walks again', () => {
    const cache = new SnapshotCache();
    fs.writeFileSync(path.join(repo, 'one.ts'), 'x');
    expect(ok(buildSnapshot(cfg({ repo }), { cache })).changed).toEqual(['one.ts']);
    fs.writeFileSync(path.join(repo, 'two.ts'), 'y');
    expect(ok(buildSnapshot(cfg({ repo }), { cache, walkRepo: false })).changed).toEqual(['one.ts']);
    expect(ok(buildSnapshot(cfg({ repo }), { cache, walkRepo: true })).changed).toEqual(['one.ts', 'two.ts']);
  });

  it('walkRepo:false with no list for this repo gives null; no repo gives null', () => {
    const cache = new SnapshotCache();
    expect(ok(buildSnapshot(cfg({ repo }), { cache, walkRepo: false })).changed).toBeNull();
    buildSnapshot(cfg({ repo }), { cache });
    const otherRepo = path.join(base, 'other');
    fs.mkdirSync(otherRepo);
    expect(ok(buildSnapshot(cfg({ repo: otherRepo }), { cache, walkRepo: false })).changed).toBeNull();
    expect(ok(buildSnapshot(cfg(), { cache })).changed).toBeNull();
  });
});

describe('SnapshotCache.clear and error handling', () => {
  it('clear() makes the next build read everything again', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    cache.clear();
    expect(cache.run).toBeNull();
    expect(cache.runs.size).toBe(0);
    buildSnapshot(cfg(), { cache });
    expect(cache.bytesRead).toBeGreaterThan(0);
  });

  it('a build that throws never leaves the cache pending', () => {
    const cache = new SnapshotCache();
    buildSnapshot(cfg(), { cache });
    // Journal grows past the budget (pending), then classify() throws on the
    // bad roleRules for a2, which has no meta.json.
    for (let i = 0; i < 5; i++) fs.appendFileSync(path.join(wfDir, 'journal.jsonl'), line({ type: 'started', agentId: `x${i}` }));
    const s = buildSnapshot(cfg({ roleRules: null as unknown as RoleRule[] }), { cache, byteBudget: 1 });
    expect(s.ok).toBe(false);
    expect(cache.pending).toBe(false);
  });
});
