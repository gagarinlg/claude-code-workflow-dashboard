/**
 * Chat tab — buildSnapshot() integration tests.
 *
 * Covers: snap.chat populated from a workspace's records directory, the
 * common case of no chat file at all (backward compatible — identical to
 * pre-Chat-tab behaviour), runId-based selection when multiple chat files
 * exist, and the incremental-cache behaviour that lets chat updates surface
 * through the existing poll/watcher refresh cadence without a new timer
 * (discover vs. non-discover ticks, per SnapshotCache).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSnapshot, SnapshotCache } from '../src/data/snapshot';
import type { Cfg, Snapshot, SnapshotOk } from '../src/data/snapshot';
import { DEFAULT_ROLE_RULES } from '../src/data/parse';

let base: string;
let workspace: string;

const line = (v: unknown): string => JSON.stringify(v) + '\n';

function makeRun(name: string): string {
  const d = path.join(base, 'proj', 'sess', 'subagents', 'workflows', name);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeAgent(d: string, id: string): void {
  fs.writeFileSync(
    path.join(d, `agent-${id}.jsonl`),
    line({ type: 'user', message: { content: 'You are the implementer.' } }),
  );
}

function cfg(extra: Partial<Cfg> = {}): Cfg {
  return { base, repo: '', refreshMs: 4000, statusBar: true, roleRules: DEFAULT_ROLE_RULES, ...extra };
}

function ok(s: Snapshot): SnapshotOk {
  expect(s.ok).toBe(true);
  return s as SnapshotOk;
}

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-snapshot-'));
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-workspace-'));
});

afterEach(() => {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(workspace, { recursive: true, force: true }); } catch {}
});

function writeChat(content: string, name = 'chat-wf_run.md'): string {
  const dir = path.join(workspace, '.review-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
}

// ---------------------------------------------------------------------------
// Backward compatibility — no workspace / no chat file
// ---------------------------------------------------------------------------
describe('buildSnapshot — chat field, backward compatibility', () => {
  it('snap.chat is null when workspaceFolders is omitted (pre-existing Cfg shape)', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const snap = ok(buildSnapshot(cfg()));
    expect(snap.chat).toBeNull();
  });

  it('snap.chat is null when workspaceFolders is [] (no workspace open)', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [] })));
    expect(snap.chat).toBeNull();
  });

  it('snap.chat is null when the workspace has no .review-tmp directory at all', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
    expect(snap.chat).toBeNull();
  });

  it('every other field is unaffected when chat is absent (no regression in existing contract)', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
    expect(snap.agents).toHaveLength(1);
    expect(snap.runId).toBe('wf_run');
  });
});

// ---------------------------------------------------------------------------
// Chat file discovered and surfaced on the snapshot
// ---------------------------------------------------------------------------
describe('buildSnapshot — chat file found', () => {
  it('populates snap.chat from a matching chat-<runId>.md in the workspace records dir', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    writeChat('## Klaus\nFound an issue.\n', 'chat-wf_run.md');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
    expect(snap.chat).not.toBeNull();
    expect(snap.chat!.turns).toHaveLength(1);
    expect(snap.chat!.sourceFile).toBe('chat-wf_run.md');
  });

  it('picks the chat file whose runId matches the active run among several candidates', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    writeChat('## Klaus\nwrong run\n', 'chat-wf_other.md');
    writeChat('## Gerda\nright run\n', 'chat-wf_run.md');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
    expect(snap.chat!.turns[0]!.author).toBe('Gerda');
  });

  it('falls back to a team-review-* file when no chat-<runId>.md matches', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    writeChat('## Klaus\nfull audit notes\n', 'team-review-full-20261014-1200.md');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
    expect(snap.chat).not.toBeNull();
    expect(snap.chat!.sourceFile).toBe('team-review-full-20261014-1200.md');
  });

  it('honours a configured recordsDir', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const dir = path.join(workspace, 'custom-records');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chat-wf_run.md'), '## Klaus\nhi\n');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace], recordsDir: 'custom-records' })));
    expect(snap.chat).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Incremental cache behaviour — discover vs. non-discover ticks
// ---------------------------------------------------------------------------
describe('buildSnapshot — chat incremental cache', () => {
  it('a non-discover tick still re-reads the same resolved chat file when its mtime changed', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const chatPath = writeChat('## Klaus\nfirst message\n');
    const cache = new SnapshotCache();
    const c = cfg({ workspaceFolders: [workspace] });

    const first = ok(buildSnapshot(c, { cache }));
    expect(first.chat!.turns).toHaveLength(1);
    expect(first.chat!.turns[0]!.body).toBe('first message');

    // Append a turn and bump mtime forward so the cheap re-stat on the next
    // (non-discover) tick detects the change — this is the live-update path
    // that piggybacks on the existing poll/watcher refresh cadence.
    fs.writeFileSync(chatPath, '## Klaus\nfirst message\n## Gerda\nsecond message\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(chatPath, future, future);

    const second = ok(buildSnapshot(c, { cache, discover: false }));
    expect(second.chat!.turns).toHaveLength(2);
    expect(second.chat!.turns[1]!.body).toBe('second message');
  });

  it('does not re-read the chat file on a non-discover tick when its mtime is unchanged', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const chatPath = writeChat('## Klaus\noriginal\n');
    // Pin mtime to an exact, fixed instant (not "whatever the OS assigned on
    // write") so the two fs.utimesSync calls below are guaranteed to produce
    // byte-identical mtimeMs values — stat()-roundtripping a real write's mtime
    // through a millisecond-precision Date can lose a sub-ms fraction on some
    // filesystems, making the two timestamps compare unequal even though
    // "nothing really changed" was the intent.
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    fs.utimesSync(chatPath, fixedTime, fixedTime);
    const cache = new SnapshotCache();
    const c = cfg({ workspaceFolders: [workspace] });

    const first = ok(buildSnapshot(c, { cache }));
    expect(first.chat!.turns[0]!.body).toBe('original');

    // Rewrite the file's bytes but restore the exact same fixed mtime — a
    // non-discover tick must not pay for re-parsing content whose mtime it did
    // not observe changing.
    fs.writeFileSync(chatPath, '## Klaus\nmutated-but-same-mtime\n');
    fs.utimesSync(chatPath, fixedTime, fixedTime);

    const second = ok(buildSnapshot(c, { cache, discover: false }));
    expect(second.chat!.turns[0]!.body).toBe('original');
  });

  it('re-resolves from scratch on a discover tick even when nothing else changed (covers a newly-added chat file)', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const cache = new SnapshotCache();
    const c = cfg({ workspaceFolders: [workspace] });

    const first = ok(buildSnapshot(c, { cache }));
    expect(first.chat).toBeNull();

    // The chat file did not exist on the first build — simulate it appearing
    // mid-run (a workflow starting its discussion phase after the dashboard
    // already attached). Only a discover tick is expected to notice it.
    writeChat('## Klaus\nnow it exists\n');

    const stillCached = ok(buildSnapshot(c, { cache, discover: false }));
    expect(stillCached.chat).toBeNull();

    const rediscovered = ok(buildSnapshot(c, { cache, discover: true }));
    expect(rediscovered.chat).not.toBeNull();
  });

  it('degrades to null gracefully when the previously-resolved chat file is deleted', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const chatPath = writeChat('## Klaus\nhi\n');
    const cache = new SnapshotCache();
    const c = cfg({ workspaceFolders: [workspace] });

    const first = ok(buildSnapshot(c, { cache }));
    expect(first.chat).not.toBeNull();

    fs.rmSync(chatPath);
    expect(() => buildSnapshot(c, { cache, discover: false })).not.toThrow();
    const second = ok(buildSnapshot(c, { cache, discover: false }));
    expect(second.chat).toBeNull();
  });

  it('re-resolves when recordsDir changes between builds even without an explicit discover request', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    writeChat('## Klaus\ndefault dir\n'); // under .review-tmp
    const dir2 = path.join(workspace, 'alt-dir');
    fs.mkdirSync(dir2, { recursive: true });
    fs.writeFileSync(path.join(dir2, 'chat-wf_run.md'), '## Gerda\nalt dir\n');

    const cache = new SnapshotCache();
    const first = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] }), { cache }));
    expect(first.chat!.turns[0]!.author).toBe('Klaus');

    // Context changed (recordsDir differs from what the cache remembers) — must
    // re-resolve regardless of the discover flag, matching _changed()'s repo-key check.
    const second = ok(buildSnapshot(cfg({ workspaceFolders: [workspace], recordsDir: 'alt-dir' }), { cache, discover: false }));
    expect(second.chat!.turns[0]!.author).toBe('Gerda');
  });

  it('clear() resets the chat cache so the next build re-resolves from scratch', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    writeChat('## Klaus\nhi\n');
    const cache = new SnapshotCache();
    const c = cfg({ workspaceFolders: [workspace] });
    ok(buildSnapshot(c, { cache }));
    cache.clear();
    expect(() => buildSnapshot(c, { cache, discover: false })).not.toThrow();
    const snap = ok(buildSnapshot(c, { cache, discover: false }));
    expect(snap.chat).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Defensive — malformed chat file never breaks the whole snapshot
// ---------------------------------------------------------------------------
describe('buildSnapshot — chat defensive behaviour', () => {
  it('a chat file with no recognisable structure still produces ok:true with a raw fallback turn', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    writeChat('just some free-form notes, no headings or rules');
    const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
    expect(snap.chat).not.toBeNull();
    expect(snap.chat!.malformed).toBe(true);
    expect(snap.chat!.turns).toHaveLength(1);
  });

  it('an unreadable chat file does not throw and degrades to chat:null', () => {
    const wfDir = makeRun('wf_run');
    writeAgent(wfDir, 'a1');
    const chatPath = writeChat('## Klaus\nhi\n');
    try {
      fs.chmodSync(chatPath, 0o000);
      expect(() => buildSnapshot(cfg({ workspaceFolders: [workspace] }))).not.toThrow();
      const snap = ok(buildSnapshot(cfg({ workspaceFolders: [workspace] })));
      expect(snap.chat).toBeNull();
    } finally {
      try { fs.chmodSync(chatPath, 0o644); } catch {}
    }
  });
});
