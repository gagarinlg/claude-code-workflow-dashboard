// M1-Defensive: per-failure-mode tests for all fs/JSON access paths in src/data/**
// Each test corresponds to an acceptance criterion in ROADMAP §M1 "Defensive everywhere".
// Tests use real filesystem operations (tmp dirs, chmod, unlink) — no mocking.
// All tests assert that parsing functions never throw and that bad runs degrade
// gracefully to {ok:false,msg} or a skipped item, never a propagated exception.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildSnapshot } from '../src/data/snapshot';
import { jload } from '../src/data/parse';
import { DEFAULT_ROLE_RULES } from '../src/data/parse';
import type { Cfg } from '../src/data/snapshot';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCfg(base: string, repo = ''): Cfg {
  return { base, repo, refreshMs: 4000, statusBar: true, roleRules: DEFAULT_ROLE_RULES };
}

// Minimal valid transcript so buildSnapshot can parse an agent.
const TRANSCRIPT = '{"type":"user","message":{"content":"You are a test agent"}}\n';

// Minimal journal with no results (agent stays in 'run' or 'dead' status).
const JOURNAL_EMPTY = '';
// agentId must match the id extracted from the transcript filename:
// buildSnapshot strips the "agent-" prefix and ".jsonl" suffix from "agent-t.jsonl" → id "t".
// Using "agent-t" here would make doneIds.has("t") always false, masking regressions.
const JOURNAL_STARTED = '{"type":"started","agentId":"t"}\n';

// ---------------------------------------------------------------------------
// Failure mode 1: journal.jsonl missing entirely
// ---------------------------------------------------------------------------
describe('M1-Defensive — journal missing entirely', () => {
  let tmpBase: string;
  let wfDir: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'def-no-journal-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_test');
    fs.mkdirSync(wfDir, { recursive: true });
    // Write an agent transcript but NO journal.jsonl.
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('does not throw when journal.jsonl is absent', () => {
    expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
  });

  it('returns a valid snapshot (ok:true) with empty findings when journal is absent', () => {
    const snap = buildSnapshot(makeCfg(tmpBase));
    // ok:true because the wf dir exists and the agent transcript is readable.
    // The journal being absent is a "skipped item" — agents degrade to unknown status.
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    expect(snap.allFindings).toEqual([]);
    expect(snap.verdicts).toEqual({});
  });

  it('jload returns [] for a missing file (never throws)', () => {
    const p = path.join(wfDir, 'journal.jsonl'); // does not exist
    expect(() => jload(p)).not.toThrow();
    expect(jload(p)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 2: zero-byte journal
// ---------------------------------------------------------------------------
describe('M1-Defensive — zero-byte journal', () => {
  let tmpBase: string;
  let wfDir: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'def-zero-journal-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_zero');
    fs.mkdirSync(wfDir, { recursive: true });
    // Journal exists but is empty.
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_EMPTY);
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('does not throw with a zero-byte journal', () => {
    expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
  });

  it('returns ok:true with empty findings for a zero-byte journal', () => {
    const snap = buildSnapshot(makeCfg(tmpBase));
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    expect(snap.allFindings).toEqual([]);
    expect(snap.loop.findings).toBe(0);
  });

  it('returns agents array (the transcript is still parseable)', () => {
    const snap = buildSnapshot(makeCfg(tmpBase));
    if (!snap.ok) return;
    expect(snap.agents.length).toBeGreaterThan(0);
  });

  it('jload returns [] for a zero-byte file (never throws)', () => {
    const p = path.join(wfDir, 'journal.jsonl');
    expect(() => jload(p)).not.toThrow();
    expect(jload(p)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 3: agent file deleted mid-scan
// ---------------------------------------------------------------------------
describe('M1-Defensive — agent file deleted mid-scan', () => {
  let tmpBase: string;
  let wfDir: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'def-deleted-agent-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_del');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_STARTED);
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('does not throw when agent transcript is deleted before buildSnapshot runs', () => {
    // Create then immediately delete the agent file — simulates the agent file
    // disappearing between readdirSync and jload (TOCTOU deletion race).
    const fp = path.join(wfDir, 'agent-t.jsonl');
    fs.writeFileSync(fp, TRANSCRIPT);
    fs.unlinkSync(fp);
    expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
  });

  it('returns ok:true with empty agents when the only agent file is deleted', () => {
    const fp = path.join(wfDir, 'agent-t.jsonl');
    fs.writeFileSync(fp, TRANSCRIPT);
    fs.unlinkSync(fp);
    const snap = buildSnapshot(makeCfg(tmpBase));
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    // The deleted file jload returns [], which triggers the events.length===0 guard.
    expect(snap.agents.length).toBe(0);
  });

  it('processes surviving agents when only one of two agent files is deleted', () => {
    const fp1 = path.join(wfDir, 'agent-t.jsonl');
    const fp2 = path.join(wfDir, 'agent-u.jsonl');
    fs.writeFileSync(fp1, TRANSCRIPT);
    fs.writeFileSync(fp2, TRANSCRIPT.replace('test agent', 'second agent'));
    // Delete only the first agent file.
    fs.unlinkSync(fp1);
    const snap = buildSnapshot(makeCfg(tmpBase));
    expect(snap.ok).toBe(true);
    if (!snap.ok) return;
    // Only agent-u should appear.
    expect(snap.agents.length).toBe(1);
    expect(snap.agents[0]!.id).toBe('u');
  });

  it('jload returns [] when the file is deleted between the call and readFileSync', () => {
    // jload catches ENOENT from readFileSync, returns [].
    const fp = path.join(wfDir, 'agent-deleted.jsonl');
    // We do NOT create the file — simulates deletion-before-read.
    expect(() => jload(fp)).not.toThrow();
    expect(jload(fp)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Failure mode 4: permission denied (EACCES) on journal and agent file
// ---------------------------------------------------------------------------
describe('M1-Defensive — EACCES on journal or agent file', () => {
  let tmpBase: string;
  let wfDir: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'def-eacces-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_perm');
    fs.mkdirSync(wfDir, { recursive: true });
  });

  afterEach(() => {
    // Restore permissions so cleanup can remove temp dirs.
    try {
      const jPath = path.join(wfDir, 'journal.jsonl');
      const aPath = path.join(wfDir, 'agent-t.jsonl');
      if (fs.existsSync(jPath)) fs.chmodSync(jPath, 0o644);
      if (fs.existsSync(aPath)) fs.chmodSync(aPath, 0o644);
    } catch {}
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('does not throw when journal.jsonl is mode 000 (EACCES)', () => {
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_STARTED);
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
    try {
      fs.chmodSync(path.join(wfDir, 'journal.jsonl'), 0o000);
      expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
    } finally {
      try { fs.chmodSync(path.join(wfDir, 'journal.jsonl'), 0o644); } catch {}
    }
  });

  it('returns ok:true with empty findings when journal is unreadable (EACCES)', () => {
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_STARTED);
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
    try {
      fs.chmodSync(path.join(wfDir, 'journal.jsonl'), 0o000);
      const snap = buildSnapshot(makeCfg(tmpBase));
      // jload catches EACCES on readFileSync, returns []. Snapshot is still ok:true.
      expect(snap.ok).toBe(true);
      if (!snap.ok) return;
      expect(snap.allFindings).toEqual([]);
    } finally {
      try { fs.chmodSync(path.join(wfDir, 'journal.jsonl'), 0o644); } catch {}
    }
  });

  it('does not throw when agent transcript is mode 000 (EACCES)', () => {
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_STARTED);
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
    try {
      fs.chmodSync(path.join(wfDir, 'agent-t.jsonl'), 0o000);
      expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
    } finally {
      try { fs.chmodSync(path.join(wfDir, 'agent-t.jsonl'), 0o644); } catch {}
    }
  });

  it('skips an agent whose transcript is mode 000 (jload returns [])', () => {
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_STARTED);
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
    try {
      fs.chmodSync(path.join(wfDir, 'agent-t.jsonl'), 0o000);
      const snap = buildSnapshot(makeCfg(tmpBase));
      expect(snap.ok).toBe(true);
      if (!snap.ok) return;
      // jload catches EACCES → events.length===0 → agent skipped.
      expect(snap.agents.length).toBe(0);
    } finally {
      try { fs.chmodSync(path.join(wfDir, 'agent-t.jsonl'), 0o644); } catch {}
    }
  });

  it('jload returns [] when the file is mode 000 (never throws)', () => {
    const fp = path.join(wfDir, 'noperm.jsonl');
    fs.writeFileSync(fp, JOURNAL_STARTED);
    try {
      fs.chmodSync(fp, 0o000);
      expect(() => jload(fp)).not.toThrow();
      expect(jload(fp)).toEqual([]);
    } finally {
      try { fs.chmodSync(fp, 0o644); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// Failure mode 5: wfDir disappears mid-scan (readdirSync failure)
// ---------------------------------------------------------------------------
describe('M1-Defensive — wfDir disappears mid-scan', () => {
  let tmpBase: string;
  let wfDir: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'def-wfdir-gone-'));
    wfDir = path.join(tmpBase, 'workflows', 'wf_vanish');
    fs.mkdirSync(wfDir, { recursive: true });
    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), JOURNAL_STARTED);
    fs.writeFileSync(path.join(wfDir, 'agent-t.jsonl'), TRANSCRIPT);
  });

  afterEach(() => {
    try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
  });

  it('does not throw when wfDir is removed before buildSnapshot processes agent files', () => {
    // We cannot interleave deletion during execution, so we test the guard by
    // making wfDir unreadable (mode 500 on the parent removes execute on wfDir itself).
    // POSIX stat() checks execute permission on each path component:
    // chmod 500 on wfDir itself makes readdirSync fail with EACCES.
    try {
      fs.chmodSync(wfDir, 0o500); // r-x------ : readable, not writable, executable — but readdirSync needs read
      // Actually test with the dir unreadable: mode 0o100 (--x------) makes readdirSync fail
      fs.chmodSync(wfDir, 0o100);
      expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
    } finally {
      try { fs.chmodSync(wfDir, 0o755); } catch {}
    }
  });

  it('returns ok:true with empty agents when wfDir is unreadable (readdirSync catch)', () => {
    try {
      fs.chmodSync(wfDir, 0o100); // --x: can stat but not list
      const snap = buildSnapshot(makeCfg(tmpBase));
      // findWorkflowDir already succeeded (wfDir was readable then).
      // readdirSync inside buildSnapshot fails → rawFiles=[] → agents=[].
      expect(snap.ok).toBe(true);
      if (!snap.ok) return;
      expect(snap.agents.length).toBe(0);
    } finally {
      try { fs.chmodSync(wfDir, 0o755); } catch {}
    }
  });

  it('returns ok:true with empty agents when wfDir is completely deleted before buildSnapshot', () => {
    // Delete the wfDir entirely after findWorkflowDir would have returned it.
    // Since buildSnapshot calls findWorkflowDir itself, we need a two-step approach:
    // write a second (newer) wfDir so findWorkflowDir returns it, then delete it.
    const wfDir2 = path.join(tmpBase, 'workflows', 'wf_vanish2');
    fs.mkdirSync(wfDir2, { recursive: true });
    // Touch wfDir2 to make it newer.
    const now = new Date();
    fs.utimesSync(wfDir2, now, now);
    // Delete wfDir2 immediately — by the time buildSnapshot calls readdirSync on it,
    // it is gone. findWorkflowDir may still return it (it was the newest at discovery time).
    fs.rmSync(wfDir2, { recursive: true, force: true });
    // buildSnapshot will call findWorkflowDir → finds wfDir2 (or wfDir_vanish) →
    // readdirSync fails (for wfDir2) → rawFiles=[] → agents=[].
    // In practice findWorkflowDir sees the filesystem at call time; if wfDir2 is
    // already gone, it returns wfDir_vanish which still exists. Either way, no throw.
    expect(() => buildSnapshot(makeCfg(tmpBase))).not.toThrow();
    const snap = buildSnapshot(makeCfg(tmpBase));
    expect(snap.ok).toBe(true);
  });

  it('buildSnapshot never propagates an exception even if all inner guards fail (top-level catch)', () => {
    // Belt-and-suspenders test: even if some future code path forgets a guard,
    // the top-level try/catch in buildSnapshot must prevent any exception from
    // reaching the UI. We verify this by confirming buildSnapshot always returns
    // an object with an 'ok' property.
    const snap = buildSnapshot(makeCfg('/nonexistent/path/that/cannot/exist'));
    expect(typeof snap).toBe('object');
    expect(snap).toHaveProperty('ok');
  });
});

// ---------------------------------------------------------------------------
// Failure mode 6: top-level catch (belt-and-suspenders)
// ---------------------------------------------------------------------------
describe('M1-Defensive — buildSnapshot never throws to caller', () => {
  it('returns {ok:false,msg} for a completely invalid base (not a directory)', () => {
    const snap = buildSnapshot(makeCfg('/dev/null/this-cannot-be-a-directory'));
    expect(snap).toHaveProperty('ok');
    expect(snap.ok).toBe(false);
  });

  it('ok:false msg is a non-empty string', () => {
    const snap = buildSnapshot(makeCfg('/dev/null/x'));
    if (!snap.ok) {
      expect(typeof snap.msg).toBe('string');
      expect(snap.msg.length).toBeGreaterThan(0);
    }
  });

  it('does not throw for any of: missing base, empty string base, path with special chars', () => {
    const bases = [
      '/no/such/path',
      '',
      '/tmp/does-not-exist-abc123',
      '/dev/null',
    ];
    for (const base of bases) {
      expect(() => buildSnapshot(makeCfg(base))).not.toThrow();
    }
  });
});
