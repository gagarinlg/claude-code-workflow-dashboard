/**
 * M4-Screenshots — fixture generator tests.
 *
 * Strategy: call makeSampleRun() into a temp dir, then assert:
 *   - All expected files exist (transcripts + meta.json + journal.jsonl)
 *   - buildSnapshot() succeeds against the generated fixture
 *   - Snapshot shape matches expectations (agent counts, findings, superseded, etc.)
 *   - Fixture is deterministic: two calls with the same outDir produce byte-equal files
 *   - The fixture includes: multi-pass review, verify agent, live agents, dead agent,
 *     superseded zombie, retry agent
 *   - Fixed timestamps ensure snap.agents have deterministic start/mtime values
 *   - scripts/make-sample-run.mjs is importable and exports makeSampleRun + BASE_TIME_SECS
 *   - package.json has the make-fixture and screenshots scripts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { buildSnapshot } from '../src/data/snapshot';
import type { SnapshotOk } from '../src/data/snapshot';

// ---------------------------------------------------------------------------
// Import the fixture generator (ESM .mjs via dynamic import — vitest handles it)
// ---------------------------------------------------------------------------

// Types for the make-sample-run.mjs module (no declaration file).
type MakeSampleRunModule = {
  makeSampleRun: (outDir: string, nowSecs?: number) => string;
  BASE_TIME_SECS: number;
  FAKE_NOW_SECS: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a snapshot cfg pointing at the fixture base.
 * buildSnapshot requires the discovery structure:
 *   <base>/<proj>/<anything>/workflows/<wf_*>
 * So we create the intermediate dirs and put the fixture inside 'workflows/'.
 */
function makeFixtureBase(tmpDir: string): string {
  const workflowsDir = path.join(tmpDir, 'proj', 'sub', 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });
  return workflowsDir;
}

// ---------------------------------------------------------------------------
// Fixture setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let wfDir: string;
let snap: SnapshotOk;
let makeSampleRun: MakeSampleRunModule['makeSampleRun'];
let BASE_TIME_SECS: number;
let FAKE_NOW_SECS: number;

beforeAll(async () => {
  // Dynamic import of the ESM .mjs — vitest/vite-node resolves and transforms it.
  // @ts-expect-error — no declaration file for .mjs; types supplied by MakeSampleRunModule above.
  const mod = await import('../scripts/make-sample-run.mjs') as MakeSampleRunModule;
  makeSampleRun = mod.makeSampleRun;
  BASE_TIME_SECS = mod.BASE_TIME_SECS;
  FAKE_NOW_SECS = mod.FAKE_NOW_SECS;

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-fixture-'));
  const workflowsBase = makeFixtureBase(tmpDir);
  wfDir = makeSampleRun(workflowsBase);
  const result = buildSnapshot({
    base: tmpDir,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: [],
  });
  if (!result.ok) throw new Error(`buildSnapshot failed: ${result.msg}`);
  snap = result as SnapshotOk;
});

afterAll(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// File structure
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — file structure', () => {
  it('wfDir exists and is a directory', () => {
    expect(fs.statSync(wfDir).isDirectory()).toBe(true);
  });

  it('journal.jsonl exists', () => {
    expect(fs.existsSync(path.join(wfDir, 'journal.jsonl'))).toBe(true);
  });

  it('all expected agent transcript files exist', () => {
    const ids = [
      'cr1review', 'sec1review', 'impl1fix',
      'uiux1zombie', 'uiux2retry',
      'cr2review', 'verify1run', 'completeness1dead',
      'arch1live', 'impl2live',
    ];
    for (const id of ids) {
      const p = path.join(wfDir, `agent-${id}.jsonl`);
      expect(fs.existsSync(p), `transcript missing: agent-${id}.jsonl`).toBe(true);
    }
  });

  it('all expected agent meta.json files exist', () => {
    const ids = [
      'cr1review', 'sec1review', 'impl1fix',
      'uiux1zombie', 'uiux2retry',
      'cr2review', 'verify1run', 'completeness1dead',
      'arch1live', 'impl2live',
    ];
    for (const id of ids) {
      const p = path.join(wfDir, `agent-${id}.meta.json`);
      expect(fs.existsSync(p), `meta missing: agent-${id}.meta.json`).toBe(true);
    }
  });

  it('journal.jsonl contains exactly 10 started events', () => {
    const lines = fs.readFileSync(path.join(wfDir, 'journal.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const started = lines.filter((r) => r['type'] === 'started');
    expect(started).toHaveLength(10);
  });

  it('journal.jsonl contains exactly 6 result events', () => {
    const lines = fs.readFileSync(path.join(wfDir, 'journal.jsonl'), 'utf8')
      .split('\n').filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const results = lines.filter((r) => r['type'] === 'result');
    expect(results).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// Meta.json agentType values
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — meta.json content', () => {
  it('cr1review meta has agentType code-reviewer', () => {
    const m = JSON.parse(fs.readFileSync(path.join(wfDir, 'agent-cr1review.meta.json'), 'utf8')) as Record<string, unknown>;
    expect(m['agentType']).toBe('workflow-plugins:code-reviewer');
  });

  it('uiux1zombie meta has agentType uiux-reviewer', () => {
    const m = JSON.parse(fs.readFileSync(path.join(wfDir, 'agent-uiux1zombie.meta.json'), 'utf8')) as Record<string, unknown>;
    expect(m['agentType']).toBe('workflow-plugins:uiux-reviewer');
  });

  it('uiux2retry meta has agentType uiux-reviewer (same as zombie)', () => {
    const m = JSON.parse(fs.readFileSync(path.join(wfDir, 'agent-uiux2retry.meta.json'), 'utf8')) as Record<string, unknown>;
    expect(m['agentType']).toBe('workflow-plugins:uiux-reviewer');
  });

  it('verify1run meta has agentType test-verifier', () => {
    const m = JSON.parse(fs.readFileSync(path.join(wfDir, 'agent-verify1run.meta.json'), 'utf8')) as Record<string, unknown>;
    expect(m['agentType']).toBe('workflow-plugins:test-verifier');
  });

  it('arch1live meta has agentType architect', () => {
    const m = JSON.parse(fs.readFileSync(path.join(wfDir, 'agent-arch1live.meta.json'), 'utf8')) as Record<string, unknown>;
    expect(m['agentType']).toBe('workflow-plugins:architect');
  });
});

// ---------------------------------------------------------------------------
// buildSnapshot shape
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — buildSnapshot shape', () => {
  it('ok is true', () => {
    expect(snap.ok).toBe(true);
  });

  it('runId is wf_screenshot_fixture', () => {
    expect(snap.runId).toBe('wf_screenshot_fixture');
  });

  it('has exactly 10 agents', () => {
    expect(snap.agents).toHaveLength(10);
  });

  it('loop.total is 10', () => {
    expect(snap.loop.total).toBe(10);
  });

  it('loop.done is 6 (cr1, sec1, impl1, uiux2, cr2, verify)', () => {
    expect(snap.loop.done).toBe(6);
  });

  it('loop.passes is 2 (code-reviewer ran twice)', () => {
    expect(snap.loop.passes).toBe(2);
  });

  it('allFindings contains findings from both review passes', () => {
    expect(snap.allFindings.length).toBeGreaterThan(0);
  });

  it('allFindings contains HIGH severity findings', () => {
    const highs = snap.allFindings.filter((f) => f.severity === 'HIGH');
    expect(highs.length).toBeGreaterThan(0);
  });

  it('allFindings contains LOW severity findings', () => {
    const lows = snap.allFindings.filter((f) => f.severity === 'LOW');
    expect(lows.length).toBeGreaterThan(0);
  });

  it('structuredResults contains the verify result', () => {
    const verifyResult = snap.structuredResults.find((r) => r.agentType === 'test-verifier');
    expect(verifyResult).toBeDefined();
    expect(verifyResult?.result).toMatchObject({ buildOk: true, testsOk: true, lintOk: true });
  });

  it('implementer result is in structuredResults', () => {
    const implResult = snap.structuredResults.find((r) => r.agentType === 'implementer');
    expect(implResult).toBeDefined();
    expect((implResult?.result as Record<string, unknown>)?.['testsRun']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Superseded detection
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — superseded detection', () => {
  it('uiux1zombie is superseded', () => {
    const zombie = snap.agents.find((a) => a.id === 'uiux1zombie');
    expect(zombie).toBeDefined();
    expect(zombie?.superseded).toBe(true);
  });

  it('uiux2retry is NOT superseded', () => {
    const retry = snap.agents.find((a) => a.id === 'uiux2retry');
    expect(retry).toBeDefined();
    expect(retry?.superseded).toBeUndefined();
  });

  it('loop.superseded is 1', () => {
    expect(snap.loop.superseded).toBe(1);
  });

  it('superseded agent does not count toward loop.dead (genuine dead only)', () => {
    // completeness1dead is the only genuine dead agent (not superseded)
    expect(snap.loop.dead).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Live agents
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — live agents', () => {
  it('arch1live status is run', () => {
    const a = snap.agents.find((a) => a.id === 'arch1live');
    expect(a?.status).toBe('run');
  });

  it('impl2live status is run', () => {
    const a = snap.agents.find((a) => a.id === 'impl2live');
    expect(a?.status).toBe('run');
  });

  it('loop.live is 2', () => {
    expect(snap.loop.live).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Dead agent
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — dead agent', () => {
  it('completeness1dead status is dead', () => {
    const a = snap.agents.find((a) => a.id === 'completeness1dead');
    expect(a?.status).toBe('dead');
  });

  it('completeness1dead is NOT superseded (it stalled, not retried)', () => {
    const a = snap.agents.find((a) => a.id === 'completeness1dead');
    expect(a?.superseded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Determinism: same outDir → byte-equal files
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — determinism', () => {
  it('two calls produce byte-equal journal.jsonl', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-det-'));
    try {
      const workflowsDir2 = path.join(tmpDir2, 'proj', 'sub', 'workflows');
      fs.mkdirSync(workflowsDir2, { recursive: true });
      const wfDir2 = makeSampleRun(workflowsDir2) as string;
      const j1 = fs.readFileSync(path.join(wfDir, 'journal.jsonl'), 'utf8');
      const j2 = fs.readFileSync(path.join(wfDir2, 'journal.jsonl'), 'utf8');
      expect(j1).toBe(j2);
    } finally {
      try { fs.rmSync(tmpDir2, { recursive: true, force: true }); } catch {}
    }
  });

  it('two calls produce byte-equal agent transcripts', () => {
    const tmpDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'm4-det2-'));
    try {
      const workflowsDir3 = path.join(tmpDir3, 'proj', 'sub', 'workflows');
      fs.mkdirSync(workflowsDir3, { recursive: true });
      const wfDir3 = makeSampleRun(workflowsDir3) as string;
      // Check a few transcripts for byte equality
      for (const id of ['cr1review', 'impl1fix', 'uiux1zombie']) {
        const f1 = fs.readFileSync(path.join(wfDir, `agent-${id}.jsonl`), 'utf8');
        const f2 = fs.readFileSync(path.join(wfDir3, `agent-${id}.jsonl`), 'utf8');
        expect(f1, `agent-${id}.jsonl should be identical`).toBe(f2);
      }
    } finally {
      try { fs.rmSync(tmpDir3, { recursive: true, force: true }); } catch {}
    }
  });

  it('BASE_TIME_SECS is a fixed epoch (not Date.now())', () => {
    // 1742032800 = 2025-03-15T10:00:00Z — a fixed historical time, not a moving target
    expect(BASE_TIME_SECS).toBe(1742032800);
    expect(typeof BASE_TIME_SECS).toBe('number');
  });

  it('FAKE_NOW_SECS is BASE_TIME_SECS + 3600 (retained for backwards compat)', () => {
    expect(FAKE_NOW_SECS).toBe(BASE_TIME_SECS + 3600);
  });
});

// ---------------------------------------------------------------------------
// Package.json scripts
// ---------------------------------------------------------------------------

describe('M4-Screenshots — package.json scripts', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  it('scripts.screenshots exists and runs screenshot.mjs', () => {
    expect(pkg.scripts['screenshots']).toContain('screenshot.mjs');
  });

  it('scripts.make-fixture exists and runs make-sample-run.mjs', () => {
    expect(pkg.scripts['make-fixture']).toContain('make-sample-run.mjs');
  });
});

// ---------------------------------------------------------------------------
// Script file existence
// ---------------------------------------------------------------------------

describe('M4-Screenshots — script files exist', () => {
  const root = path.join(__dirname, '..');

  it('scripts/make-sample-run.mjs exists', () => {
    expect(fs.existsSync(path.join(root, 'scripts', 'make-sample-run.mjs'))).toBe(true);
  });

  it('scripts/screenshot.mjs exists', () => {
    expect(fs.existsSync(path.join(root, 'scripts', 'screenshot.mjs'))).toBe(true);
  });

  it('screenshot.mjs imports make-sample-run.mjs', () => {
    const src = fs.readFileSync(path.join(root, 'scripts', 'screenshot.mjs'), 'utf8');
    expect(src).toContain('make-sample-run.mjs');
  });

  it('screenshot.mjs does NOT use a live ~/.claude run (no CCWD_BASE / os.homedir wf_ discovery)', () => {
    const src = fs.readFileSync(path.join(root, 'scripts', 'screenshot.mjs'), 'utf8');
    // Must not derive base from homedir for a live run anymore
    expect(src).not.toContain("os.homedir(), '.claude/projects'");
  });

  it('make-sample-run.mjs exports makeSampleRun as a named export', () => {
    expect(typeof makeSampleRun).toBe('function');
  });

  it('make-sample-run.mjs exports BASE_TIME_SECS as a named export', () => {
    expect(typeof BASE_TIME_SECS).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Screenshot gallery — media/screenshots/ directory and committed PNG files.
//
// These tests guard against a README.md gallery that references screenshot files
// that have not been committed. The screenshots are generated by `npm run screenshots`
// and must be committed before a release. If they are absent, CI will catch it here.
//
// Files are generated by scripts/screenshot.mjs into media/screenshots/; if this
// test fails locally, run `npm run screenshots` first (requires Playwright + Chromium).
// ---------------------------------------------------------------------------

describe('M4-Screenshots — media/screenshots gallery files committed', () => {
  const root = path.join(__dirname, '..');
  const screenshotsDir = path.join(root, 'media', 'screenshots');

  // The directory must exist regardless of whether screenshots have been generated.
  it('media/screenshots/ directory exists', () => {
    expect(fs.existsSync(screenshotsDir)).toBe(true);
    expect(fs.statSync(screenshotsDir).isDirectory()).toBe(true);
  });

  // The README gallery references these specific files. If they are missing, the
  // gallery renders broken images on the Marketplace listing.
  // To regenerate: npm run screenshots (requires Playwright Chromium — see PUBLISHING.md).
  const galleryFiles = [
    'dashboard-dark.png',
    'dashboard-light.png',
    'dashboard-dark-timeline.png',
    'dashboard-light-timeline.png',
  ];

  for (const file of galleryFiles) {
    it(`${file} exists in media/screenshots/ (run 'npm run screenshots' if missing)`, () => {
      expect(fs.existsSync(path.join(screenshotsDir, file))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Agents tab data: label correctness
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — agent label correctness', () => {
  it('cr1review label is "Code review"', () => {
    const a = snap.agents.find((a) => a.id === 'cr1review');
    expect(a?.label).toBe('Code review');
  });

  it('sec1review label is "Security"', () => {
    const a = snap.agents.find((a) => a.id === 'sec1review');
    expect(a?.label).toBe('Security');
  });

  it('impl1fix label is "Implement/Fix"', () => {
    const a = snap.agents.find((a) => a.id === 'impl1fix');
    expect(a?.label).toBe('Implement/Fix');
  });

  it('verify1run label is "Verify"', () => {
    const a = snap.agents.find((a) => a.id === 'verify1run');
    expect(a?.label).toBe('Verify');
  });

  it('arch1live label is "Architecture"', () => {
    const a = snap.agents.find((a) => a.id === 'arch1live');
    expect(a?.label).toBe('Architecture');
  });

  it('completeness1dead label is "Completeness"', () => {
    const a = snap.agents.find((a) => a.id === 'completeness1dead');
    expect(a?.label).toBe('Completeness');
  });

  it('uiux1zombie label is "UI/UX"', () => {
    const a = snap.agents.find((a) => a.id === 'uiux1zombie');
    expect(a?.label).toBe('UI/UX');
  });

  it('uiux2retry label is "UI/UX"', () => {
    const a = snap.agents.find((a) => a.id === 'uiux2retry');
    expect(a?.label).toBe('UI/UX');
  });
});

// ---------------------------------------------------------------------------
// changedByAgents (filesChanged from implementer result)
// ---------------------------------------------------------------------------

describe('M4-Screenshots fixture — changedByAgents', () => {
  it('changedByAgents is non-empty (implementer reported filesChanged)', () => {
    expect(snap.changedByAgents.length).toBeGreaterThan(0);
  });

  it('changedByAgents includes src/data/snapshot.ts', () => {
    expect(snap.changedByAgents).toContain('src/data/snapshot.ts');
  });

  it('changedByAgents is sorted', () => {
    const sorted = [...snap.changedByAgents].sort();
    expect(snap.changedByAgents).toEqual(sorted);
  });
});
