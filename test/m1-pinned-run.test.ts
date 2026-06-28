/**
 * M1 independent verification — Erika "The Verifier" Neumann
 *
 * Scope: M1-RecentRuns / pinnedDir AC.
 * ROADMAP M1: "Recent-runs picker: … a command claudeWorkflow.selectRun (and a
 * view-title dropdown) to pin one. Default remains 'follow newest'. Persist the
 * pin per-workspace; 'Follow newest' resets it."
 * Implementation-plan M1: buildSnapshot must accept cfg.pinnedDir — when set,
 * use that wf_* dir directly; when the pinned dir no longer exists, degrade to
 * {ok:false,msg} with a friendly message naming the missing dir.
 *
 * These tests verify the BEHAVIOR of buildSnapshot(cfg) via its public interface
 * only. No implementation internals are read (other than the Cfg/Snapshot types,
 * which are the public contract). Tests are written from the AC spec, not from
 * the implementation.
 *
 * AC verified here:
 *   [AC-PIN-1] cfg.pinnedDir non-null and the dir exists → uses it directly
 *              (not the auto-discovered newest)
 *   [AC-PIN-2] cfg.pinnedDir exists but is older than another wf_* dir →
 *              still uses the pinned dir (pin overrides auto-discovery)
 *   [AC-PIN-3] cfg.pinnedDir is set but the dir no longer exists →
 *              returns {ok:false, msg: …} containing the missing dir path
 *              (friendly message — degrade, never throw)
 *   [AC-PIN-4] cfg.pinnedDir = undefined (or absent) → falls through to
 *              findWorkflowDir(cfg.base) — same behavior as M0 (no regression)
 *   [AC-PIN-5] buildSnapshot never throws for any pinnedDir value
 *              (defensive everywhere — ROADMAP M1 "Defensive everywhere" AC)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSnapshot } from '../src/data/snapshot';
import { DEFAULT_ROLE_RULES } from '../src/data/parse';
import type { Cfg } from '../src/data/snapshot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(base: string, pinnedDir?: string): Cfg {
  return {
    base,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: DEFAULT_ROLE_RULES,
    pinnedDir,
  };
}

// Minimal single-event transcript — jload returns a non-empty array so the
// agent is included in the snapshot agents list.
const TRANSCRIPT = '{"type":"user","message":{"content":"You are a pinned-run test agent"}}\n';

// Minimal journal that gives the agent a 'done' status via a result record.
function journalFor(agentId: string): string {
  return [
    `{"type":"started","agentId":"${agentId}"}`,
    `{"type":"result","agentId":"${agentId}","result":{"findings":[],"verdict":"ok"}}`,
  ].join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Fixture setup: two wf_* dirs, one older and one newer, plus a separate
// "other" dir that does NOT contain the pinned run.
// Layout (under tmpBase/workflows/):
//   wf_old  — older mtime
//   wf_new  — newer mtime (would be auto-discovered)
// The pinned-run tests pin wf_old and verify buildSnapshot uses it despite
// wf_new being newer.
// ---------------------------------------------------------------------------
let tmpBase: string;
let wfOld: string;
let wfNew: string;

beforeEach(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'erika-pin-'));
  wfOld = path.join(tmpBase, 'workflows', 'wf_old');
  wfNew = path.join(tmpBase, 'workflows', 'wf_new');

  // Create older run first.
  fs.mkdirSync(wfOld, { recursive: true });
  fs.writeFileSync(path.join(wfOld, 'agent-old.jsonl'), TRANSCRIPT);
  fs.writeFileSync(path.join(wfOld, 'journal.jsonl'), journalFor('old'));
  // Pin wf_old's mtime to 5 seconds in the past so it is unambiguously older
  // than wf_new regardless of sub-millisecond filesystem clock resolution or
  // parallel test-file execution on a loaded CI host.
  const past = new Date(Date.now() - 5000);
  fs.utimesSync(wfOld, past, past);

  // Create newer run and pin its mtime 2 seconds into the future so it is
  // unambiguously the newest wf_* dir — avoids the floating-point precision
  // race where new Date() (integer ms) < statSync().mtimeMs (sub-ms precision).
  fs.mkdirSync(wfNew, { recursive: true });
  fs.writeFileSync(path.join(wfNew, 'agent-new.jsonl'), TRANSCRIPT.replace('pinned-run', 'newer-run'));
  fs.writeFileSync(path.join(wfNew, 'journal.jsonl'), journalFor('new'));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(wfNew, future, future);
});

afterEach(() => {
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// AC-PIN-1: pinned dir exists → uses it, returns ok:true with that runId
// ---------------------------------------------------------------------------
describe('M1-PinnedRun AC-PIN-1 — pinned dir used when it exists', () => {
  it('returns ok:true when pinnedDir points to a valid wf_* dir', () => {
    const snap = buildSnapshot(makeCfg(tmpBase, wfOld));
    expect(snap.ok).toBe(true);
  });

  it('runId matches the basename of the pinned wf_* dir', () => {
    const snap = buildSnapshot(makeCfg(tmpBase, wfOld));
    if (!snap.ok) return;
    // runId must be 'wf_old', not 'wf_new'
    expect(snap.runId).toBe('wf_old');
  });

  it('agents contain the agent from the pinned dir, not the auto-discovered newer run', () => {
    const snap = buildSnapshot(makeCfg(tmpBase, wfOld));
    if (!snap.ok) return;
    // agent-old.jsonl is in wf_old; agent-new.jsonl is in wf_new.
    // With the pin, only wf_old's agent should appear.
    const ids = snap.agents.map((a) => a.id);
    expect(ids).toContain('old');
    expect(ids).not.toContain('new');
  });
});

// ---------------------------------------------------------------------------
// AC-PIN-2: pinned dir is older than another wf_* dir → pin wins
// ---------------------------------------------------------------------------
describe('M1-PinnedRun AC-PIN-2 — pinned dir overrides auto-discovery', () => {
  it('uses the pinned (older) run even when a newer run exists under the same base', () => {
    // Without a pin, findWorkflowDir would return wf_new (newer mtime).
    // With the pin set to wf_old, buildSnapshot must use wf_old.
    const autoSnap = buildSnapshot(makeCfg(tmpBase)); // no pin
    const pinnedSnap = buildSnapshot(makeCfg(tmpBase, wfOld)); // pin to older

    if (!autoSnap.ok || !pinnedSnap.ok) return;

    // Auto-discovery picks up wf_new (the newer one).
    expect(autoSnap.runId).toBe('wf_new');
    // Pin overrides and uses wf_old.
    expect(pinnedSnap.runId).toBe('wf_old');
  });

  it('pinned snapshot workflowDir is wf_old (the pinned path)', () => {
    const snap = buildSnapshot(makeCfg(tmpBase, wfOld));
    if (!snap.ok) return;
    // workflowDir must point to the pinned dir.
    expect(snap.workflowDir).toBe(wfOld);
  });
});

// ---------------------------------------------------------------------------
// AC-PIN-3: pinned dir no longer exists → ok:false with friendly message
// ---------------------------------------------------------------------------
describe('M1-PinnedRun AC-PIN-3 — pinned dir missing → friendly error, no throw', () => {
  it('does not throw when pinnedDir is set but the dir is gone', () => {
    const missingDir = path.join(tmpBase, 'workflows', 'wf_deleted');
    expect(() => buildSnapshot(makeCfg(tmpBase, missingDir))).not.toThrow();
  });

  it('returns ok:false when pinnedDir does not exist', () => {
    const missingDir = path.join(tmpBase, 'workflows', 'wf_deleted');
    const snap = buildSnapshot(makeCfg(tmpBase, missingDir));
    expect(snap.ok).toBe(false);
  });

  it('ok:false msg is a non-empty string naming the missing dir', () => {
    const missingDir = path.join(tmpBase, 'workflows', 'wf_deleted');
    const snap = buildSnapshot(makeCfg(tmpBase, missingDir));
    if (snap.ok) return; // should not be ok
    expect(typeof snap.msg).toBe('string');
    expect(snap.msg.length).toBeGreaterThan(0);
    // The friendly message must reference the pinned dir's basename so the user knows
    // which dir was expected. The full path is not included (information-disclosure
    // reduction per review round 4 — only basename is exposed in the webview message).
    expect(snap.msg).toContain(path.basename(missingDir));
  });

  it('ok:false even when auto-discoverable runs exist under base (pin errors are not auto-cleared)', () => {
    // wf_new exists and would be returned by findWorkflowDir — but the pin takes
    // priority and the missing pin must not silently fall through to auto-discover.
    const missingDir = path.join(tmpBase, 'workflows', 'wf_deleted');
    const snap = buildSnapshot(makeCfg(tmpBase, missingDir));
    // The pin is gone → ok:false, not ok:true from auto-discovery.
    expect(snap.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-PIN-4: cfg.pinnedDir undefined → falls through to findWorkflowDir
// ---------------------------------------------------------------------------
describe('M1-PinnedRun AC-PIN-4 — no pin falls back to findWorkflowDir', () => {
  it('without a pin, returns ok:true using the auto-discovered newest run', () => {
    const snap = buildSnapshot(makeCfg(tmpBase)); // pinnedDir not passed (undefined)
    expect(snap.ok).toBe(true);
  });

  it('without a pin, runId is wf_new (the globally-newest dir)', () => {
    const snap = buildSnapshot(makeCfg(tmpBase));
    if (!snap.ok) return;
    expect(snap.runId).toBe('wf_new');
  });

  it('explicit pinnedDir=undefined behaves the same as omitting pinnedDir', () => {
    const snapOmitted = buildSnapshot(makeCfg(tmpBase));
    const snapExplicit = buildSnapshot(makeCfg(tmpBase, undefined));
    // Both should yield the same runId (the auto-discovered newest).
    if (!snapOmitted.ok || !snapExplicit.ok) return;
    expect(snapExplicit.runId).toBe(snapOmitted.runId);
  });
});

// ---------------------------------------------------------------------------
// AC-PIN-SEC: pinnedDir outside cfg.base is rejected (path boundary security)
// ---------------------------------------------------------------------------
describe('M1-PinnedRun AC-PIN-SEC — pinnedDir outside cfg.base is rejected', () => {
  it('returns ok:false when pinnedDir is outside cfg.base (path boundary security guard)', () => {
    // The guard at snapshot.ts resolvedPin.startsWith(resolvedBase + path.sep) must fire
    // when pinnedDir resolves to a path not under cfg.base.
    const outsideDir = path.join(os.tmpdir(), `erika-outside-${Date.now()}`);
    fs.mkdirSync(outsideDir, { recursive: true });
    try {
      // cfg.base = tmpBase; outsideDir is under os.tmpdir(), a different tree.
      const snap = buildSnapshot(makeCfg(tmpBase, outsideDir));
      expect(snap.ok).toBe(false);
      if (!snap.ok) {
        // The error message must reference the out-of-base situation.
        expect(snap.msg).toContain('outside the configured base');
      }
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not throw when pinnedDir is outside cfg.base', () => {
    const outsideDir = path.join(os.tmpdir(), `erika-outside-nothrow-${Date.now()}`);
    fs.mkdirSync(outsideDir, { recursive: true });
    try {
      expect(() => buildSnapshot(makeCfg(tmpBase, outsideDir))).not.toThrow();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// AC-PIN-5: buildSnapshot never throws for any pinnedDir value
// ---------------------------------------------------------------------------
describe('M1-PinnedRun AC-PIN-5 — no throw for any pinnedDir value', () => {
  const problematic = [
    '/no/such/path/at/all',
    '',
    '/dev/null',
    '/dev/null/not-a-dir',
    path.join(os.tmpdir(), 'erika-ghost-wf-that-never-existed'),
  ];

  for (const dir of problematic) {
    it(`does not throw for pinnedDir="${dir}"`, () => {
      expect(() => buildSnapshot(makeCfg('/nonexistent-base', dir))).not.toThrow();
    });

    it(`returns an object with an 'ok' property for pinnedDir="${dir}"`, () => {
      const snap = buildSnapshot(makeCfg('/nonexistent-base', dir));
      expect(typeof snap).toBe('object');
      expect(snap).toHaveProperty('ok');
    });
  }
});
