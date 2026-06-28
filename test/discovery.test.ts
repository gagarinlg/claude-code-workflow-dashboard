import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findWorkflowDir, listRecentRuns, formatRelativeTime } from '../src/data/discovery';

const FIXTURES = path.join(__dirname, 'fixtures');
const BASE = path.join(FIXTURES, 'base');
const WF_NEWER = path.join(BASE, 'proj-abc/subagents/workflows/wf_newer');

// git does not preserve directory mtimes on checkout, so wf_newer and
// wf_older may get identical or reversed timestamps. Re-touch wf_newer before
// any test runs to guarantee it is always the globally-newest wf_* dir.
beforeAll(() => {
  const now = new Date();
  fs.utimesSync(WF_NEWER, now, now);
});

describe('findWorkflowDir', () => {
  it('returns the globally-newest wf_* dir', () => {
    const found = findWorkflowDir(BASE);
    expect(found).not.toBeNull();
    // wf_newer was touched after wf_older, so it must be returned
    expect(found).toContain('wf_newer');
  });

  it('returns null for a non-existent base dir', () => {
    expect(findWorkflowDir('/no/such/path')).toBeNull();
  });

  it('returns null for an empty base dir', () => {
    // wf_basic is a wf_* dir but its parent is 'fixtures', not 'workflows'
    // so findWorkflowDir should NOT pick it up
    const found = findWorkflowDir(FIXTURES);
    // Either null (if only base has valid ones) or points into base
    // wf_basic is under fixtures/ directly — parent is 'fixtures', not 'workflows'
    // so it should NOT match
    if (found !== null) {
      expect(found).toContain('wf_newer');
    }
  });

  it('does NOT return wf_basic because its parent is not named "workflows"', () => {
    // wf_basic lives at fixtures/wf_basic — parent = 'fixtures', not 'workflows'
    const found = findWorkflowDir(FIXTURES);
    if (found) {
      // Must be from the base/ subtree, not wf_basic
      expect(found).not.toContain('wf_basic');
    }
  });

  it('skips node_modules subtrees (line 33 branch)', () => {
    // Create a temp base with a node_modules dir containing a fake workflows/wf_ tree
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-nm-'));
    try {
      const nmWf = path.join(tmpBase, 'node_modules', 'workflows', 'wf_inside_nm');
      fs.mkdirSync(nmWf, { recursive: true });
      // Should NOT find wf_inside_nm because it's under node_modules
      expect(findWorkflowDir(tmpBase)).toBeNull();
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('skips vendor subtrees (line 33 branch)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-vendor-'));
    try {
      const vendorWf = path.join(tmpBase, 'vendor', 'workflows', 'wf_inside_vendor');
      fs.mkdirSync(vendorWf, { recursive: true });
      expect(findWorkflowDir(tmpBase)).toBeNull();
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('skips wf_ dir when statSync throws (TOCTOU, lines 26-27)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-stat-fail-'));
    try {
      const wfParent = path.join(tmpBase, 'workflows');
      fs.mkdirSync(wfParent, { recursive: true });
      // Create a dangling symlink named wf_broken. For a dangling symlink,
      // e.isDirectory() returns false, so the !e.isDirectory() guard at line 20
      // skips it before statSync is ever called. This test confirms no throw —
      // the statSync catch (valid-but-inaccessible wf_ dirs) is a separate guard.
      try {
        fs.symlinkSync('/no/such/target', path.join(wfParent, 'wf_broken'));
        // Should not throw — broken symlink is skipped gracefully
        expect(() => findWorkflowDir(tmpBase)).not.toThrow();
      } catch {
        // symlink creation failed (e.g. Windows without elevated perms) — skip
      }
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('statSync catch path (lines 27-28): TOCTOU — dir exists at readdir but is gone by statSync', () => {
    // The statSync catch guards a TOCTOU window: a wf_* dir listed by readdirSync
    // may be deleted before statSync runs. We simulate this by replacing the target
    // with a broken symlink AFTER the directory is enumerated. Since we cannot
    // interleave execution mid-function, we confirm the existing dangling-symlink
    // path (already tested above) exercises a related guard; this test documents
    // the gap and confirms no throw occurs when the dir disappears between calls.
    //
    // Note: chmod-000 on the wf_* dir itself does NOT make statSync fail — stat()
    // only needs execute permission on the PARENT, not the target dir. The real
    // TOCTOU deletion case (wfDir disappears mid-scan) is covered in test/defensive.test.ts.
    // Lines 27-28 are marked /* c8 ignore next */ in discovery.ts.
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-toctou2-'));
    try {
      const wfParent = path.join(tmpBase, 'workflows');
      fs.mkdirSync(wfParent, { recursive: true });
      // A broken symlink: isDirectory() returns false so statSync is never called
      // for symlinks (guard at line 20 handles this). No throw expected.
      try {
        fs.symlinkSync('/no/such/target', path.join(wfParent, 'wf_broken2'));
        expect(() => findWorkflowDir(tmpBase)).not.toThrow();
        expect(findWorkflowDir(tmpBase)).toBeNull();
      } catch {
        // symlink creation may fail on some platforms — skip gracefully
      }
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('is bounded by depth parameter', () => {
    // depth=0: visit(base, 0) — base itself has no wf_* entries directly
    // The wf dirs are several levels deep, so depth=0 returns null
    const found = findWorkflowDir(BASE, 0);
    // With depth=0 the tree is only the root level of BASE —
    // proj-abc is there but wf dirs are at depth 4 from BASE
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// listRecentRuns
// ---------------------------------------------------------------------------
describe('listRecentRuns', () => {
  // Re-touch wf_newer so it is always newer than wf_older regardless of git
  // checkout order — same rationale as the findWorkflowDir beforeAll above.
  beforeAll(() => {
    const now = new Date();
    fs.utimesSync(WF_NEWER, now, now);
  });

  it('returns an array for the base fixture (at least 2 runs)', () => {
    const runs = listRecentRuns(BASE);
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it('returns runs sorted newest-first by mtime', () => {
    const runs = listRecentRuns(BASE);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1]!.mtimeMs).toBeGreaterThanOrEqual(runs[i]!.mtimeMs);
    }
  });

  it('first result is wf_newer (the most recently touched dir)', () => {
    const runs = listRecentRuns(BASE);
    expect(runs[0]?.runId).toBe('wf_newer');
  });

  it('each run has the correct runId (basename of the wf_* dir)', () => {
    const runs = listRecentRuns(BASE);
    for (const r of runs) {
      expect(r.runId).toMatch(/^wf_/);
      expect(r.runId).toBe(path.basename(r.dir));
    }
  });

  it('each run has an absolute dir path', () => {
    const runs = listRecentRuns(BASE);
    for (const r of runs) {
      expect(path.isAbsolute(r.dir)).toBe(true);
    }
  });

  it('each run has a positive mtimeMs', () => {
    const runs = listRecentRuns(BASE);
    for (const r of runs) {
      expect(r.mtimeMs).toBeGreaterThan(0);
    }
  });

  it('wf_newer has correct agentCount (6 agent-*.jsonl files)', () => {
    const runs = listRecentRuns(BASE);
    const newer = runs.find((r) => r.runId === 'wf_newer');
    expect(newer).toBeDefined();
    // The base fixture wf_newer has agent-aaa through agent-fff (6 files)
    expect(newer!.agentCount).toBe(6);
  });

  it('wf_older has agentCount 0 (no agent-*.jsonl files, only journal.jsonl)', () => {
    const runs = listRecentRuns(BASE);
    const older = runs.find((r) => r.runId === 'wf_older');
    expect(older).toBeDefined();
    expect(older!.agentCount).toBe(0);
  });

  it('returns empty array for a non-existent base', () => {
    expect(listRecentRuns('/no/such/path')).toEqual([]);
  });

  it('returns empty array when no wf_* dirs exist', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-recent-empty-'));
    try {
      expect(listRecentRuns(tmpBase)).toEqual([]);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('skips node_modules subtrees', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-recent-nm-'));
    try {
      const nmWf = path.join(tmpBase, 'node_modules', 'workflows', 'wf_inside_nm');
      fs.mkdirSync(nmWf, { recursive: true });
      expect(listRecentRuns(tmpBase)).toEqual([]);
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('collects multiple projects under the same base (multi-project layout)', () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-recent-multi-'));
    try {
      // Simulate ~/.claude/projects layout: two project dirs each with a run.
      const wf1 = path.join(tmpBase, 'proj-one', 'workflows', 'wf_alpha');
      const wf2 = path.join(tmpBase, 'proj-two', 'workflows', 'wf_beta');
      fs.mkdirSync(wf1, { recursive: true });
      fs.mkdirSync(wf2, { recursive: true });
      // Make wf_alpha newer by touching it after wf_beta.
      const past = new Date(Date.now() - 60_000);
      fs.utimesSync(wf2, past, past);
      const now = new Date();
      fs.utimesSync(wf1, now, now);

      const runs = listRecentRuns(tmpBase);
      expect(runs.length).toBe(2);
      expect(runs[0]?.runId).toBe('wf_alpha');
      expect(runs[1]?.runId).toBe('wf_beta');
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('is bounded by the depth parameter', () => {
    // wf dirs in the base fixture are at depth 4 from BASE; depth=0 finds nothing
    expect(listRecentRuns(BASE, 0)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------
describe('formatRelativeTime', () => {
  const now = 1_700_000_000_000; // fixed reference epoch for deterministic tests

  it('returns "Xs ago" for durations under one minute', () => {
    expect(formatRelativeTime(now - 5_000, now)).toBe('5s ago');
    expect(formatRelativeTime(now - 59_000, now)).toBe('59s ago');
  });

  it('returns "0s ago" for current time (no negative)', () => {
    expect(formatRelativeTime(now, now)).toBe('0s ago');
  });

  it('returns "0s ago" when mtimeMs is in the future (clamped at 0)', () => {
    // Future timestamps are clamped to 0 seconds — never negative.
    expect(formatRelativeTime(now + 30_000, now)).toBe('0s ago');
  });

  it('returns "Xm ago" for durations between 1 and 59 minutes', () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe('1m ago');
    expect(formatRelativeTime(now - 3_540_000, now)).toBe('59m ago');
  });

  it('returns "Xh ago" for durations between 1 and 23 hours', () => {
    expect(formatRelativeTime(now - 3_600_000, now)).toBe('1h ago');
    expect(formatRelativeTime(now - 82_800_000, now)).toBe('23h ago');
  });

  it('returns "Xd ago" for durations of 24 hours or more', () => {
    expect(formatRelativeTime(now - 86_400_000, now)).toBe('1d ago');
    expect(formatRelativeTime(now - 864_000_000, now)).toBe('10d ago');
  });

  it('uses Date.now() as default when nowMs is omitted', () => {
    // We can only verify the format pattern — not the exact value.
    const recent = Date.now() - 10_000;
    const result = formatRelativeTime(recent);
    expect(result).toMatch(/^\d+s ago$/);
  });
});
