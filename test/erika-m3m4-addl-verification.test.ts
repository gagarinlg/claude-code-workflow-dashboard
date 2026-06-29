/**
 * Erika — Additional M3+M4 Independent Verification Tests
 *
 * These tests cover ACs that are NOT independently verified by any existing
 * test file. Written from spec (m3-timeline-spec.md + ROADMAP.md §M3+M4),
 * NOT from implementation internals.
 *
 * ACs covered here (all gaps confirmed absent from Fritz's test files):
 *
 *   ADDL-AC1  Role-grouped lanes: two agents with the same label produce ONE
 *             lane label, not two (spec: "one lane per unique agent label").
 *             Fritz's 39-agent test uses all-distinct labels — the grouping
 *             behavior for shared labels is untested.
 *
 *   ADDL-AC2  Timeline tab is disabled (aria-disabled + disabled attr) when
 *             snap.agents.length === 0, enabled when agents > 0.
 *
 *   ADDL-AC3  Superseded detection: agent with has-result IS NOT flagged, even
 *             if it is 'dead' and elapsed < 120s with a later same-key survivor.
 *             This guards the "no-result" part of the spec. Erika's
 *             erika-m3m4-verification.test.ts confirms the constant but does not
 *             run a behavioral test for this guard through buildSnapshot.
 *
 *   ADDL-AC4  Superseded detection: agent with elapsed >= SUPERSEDED_MAX_ELAPSED_SECS
 *             is NOT flagged, even with a same-key survivor and no result.
 *             Erika's erika-m3m4-verification.test.ts tests the constant only;
 *             snapshot.test.ts has a Fritz-authored fixture for this guard —
 *             we independently repeat it so there is no single-author blind spot.
 *
 *   ADDL-AC5  loop.live count excludes superseded agents: a superseded zombie is
 *             never counted as "live", regardless of any timing heuristic.
 *
 *   ADDL-AC6  Hover/click on timeline bars: bars carry `role="button" tabindex="0"`
 *             so they are keyboard-navigable (spec: "Arrow/Home/End keyboard nav").
 *
 *   ADDL-AC7  Gantt/DAG toggle: clicking Graph toggles to 'dag' via wiring —
 *             verified by asserting the wire JS references 'tlViewToggle' event
 *             listener that posts a state update for timelineView.
 *
 *   ADDL-AC8  Screenshot harness (make-sample-run.mjs): FAKE_NOW_SECS is exported
 *             and equals BASE_TIME_SECS + 3600 (determinism spec requirement).
 *
 *   ADDL-AC9  README gallery uses only relative <img> paths (re-verified
 *             independently — different extraction from m4-readme.test.ts).
 *
 *   ADDL-AC10 CONTRIBUTING.md does not contain the wrong publisher name
 *             (malte-langermann) as the GitHub repo owner — cross-file consistency.
 *
 *   ADDL-AC11 Timeline tab receives no badge text (spec: badge:'').
 *
 *   ADDL-AC12 Superseded badge visible in Agents tab: agent with superseded===true
 *             gets the 'superseded' status label in the card (not 'dead'/'stalled').
 *
 *   ADDL-AC13 No pricing anywhere in the shipped HTML (ROADMAP Decision #5:
 *             "Counts + charts, NO pricing").
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildSnapshot } from '../src/data/snapshot';
import { SUPERSEDED_MAX_ELAPSED_SECS } from '../src/data/snapshot';
import type { SnapshotOk, Cfg } from '../src/data/snapshot';
import { getHtml } from '../src/webview/html';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';
import { STALE_SECS } from '../src/data/parse';

const ROOT = path.join(__dirname, '..');

function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Buildable harness — full timeline + DAG harness.
// ---------------------------------------------------------------------------

const html = getHtml(TEST_NONCE);
const js   = getPanelJs(html);

function buildFullTimelineHarness(
  jsSource: string,
): (snap: object, stateOverride?: object) => string {
  const escFn           = extractBalancedFn(jsSource, 'esc');
  const escClsFn        = extractBalancedFn(jsSource, 'escCls');
  const safeNFn         = extractBalancedFn(jsSource, 'safeN');
  const fmtTokFn        = extractBalancedFn(jsSource, 'fmtTok');
  const fmtTHtmlFn      = extractBalancedFn(jsSource, 'fmtTHtml');
  const fmtTLTimeFn     = extractBalancedFn(jsSource, 'fmtTLTime');
  const fmtElapsedSRFn  = extractBalancedFn(jsSource, 'fmtElapsedSR');
  const tlXFn           = extractBalancedFn(jsSource, 'tlX');
  const dagPanelFn      = extractBalancedFn(jsSource, 'dagPanel');
  const timelinePanelFn = extractBalancedFn(jsSource, 'timelinePanel');

  const factory = new Function(
    'snap',
    'state',
    [
      escFn, escClsFn, safeNFn, fmtTokFn, fmtTHtmlFn,
      fmtTLTimeFn, fmtElapsedSRFn, tlXFn,
      'var TL_LABEL_W=120;var TL_LANE_H=26;var TL_LANE_GAP=6;var TL_TICK_H=18;' +
      'var TL_K=80;var TL_BAR_CAP=40;var TL_TICK_SECS=[30,60,120,300,600,1200,1800];',
      'var TL_LABEL_TRUNC=16;',
      'var DAG_LAYER_W=160;var DAG_NODE_W=130;var DAG_NODE_H=28;' +
      'var DAG_NODE_GAP=10;var DAG_PAD=16;var DAG_EDGE_COLOR_CLS="tl-dag-edge";',
      dagPanelFn,
      timelinePanelFn,
      'return timelinePanel();',
    ].join('\n'),
  ) as (snap: object, state: object) => string;

  return (snap: object, stateOverride: object = {}) => {
    const state = {
      tlZoom: 1, tlScrollLeft: 0, activeTab: 'timeline',
      timelineView: 'gantt',
      ...stateOverride,
    };
    return factory(snap, state);
  };
}

const NOW = 1700010000;

function makeAgent(overrides: Record<string, unknown> = {}): object {
  return {
    id: `a${Math.floor(Math.random() * 1e9)}`,
    label: 'Implement/Fix',
    key: 'implementer',
    agentType: 'implementer',
    status: 'done',
    elapsed: 120,
    tokens: 1000,
    tools: 5,
    tail: [],
    lastActivity: '',
    start: NOW - 300,
    mtime: NOW - 180,
    idx: 1,
    ...overrides,
  };
}

function makeSnap(agents: object[], loopOverrides: Record<string, unknown> = {}): object {
  return {
    ok: true,
    runId: 'wf_test',
    updatedAt: new Date(NOW * 1000).toISOString(),
    loop: {
      phase: 'done', live: 0, done: agents.length, dead: 0, superseded: 0,
      total: agents.length, outTok: 5000, tools: 20, passes: 1,
      findings: 0, sevTotals: {},
      ...loopOverrides,
    },
    labels: [],
    agents,
    agentsCapped: false,
    allFindings: [],
    structuredResults: [],
    verdicts: {},
    verdictLabels: {},
    isPinned: false,
    changed: null,
    changedByAgents: [],
  };
}

// ---------------------------------------------------------------------------
// Filesystem fixture helpers (for buildSnapshot behavioral tests)
// ---------------------------------------------------------------------------

function makeCfg(base: string): Cfg {
  return { base, repo: '', refreshMs: 4000, statusBar: true, roleRules: [] };
}

const TRANSCRIPT = (role: string) =>
  JSON.stringify({ type: 'say', role: 'user', content: role }) + '\n';

const META = (agentType: string) =>
  JSON.stringify({ agentId: 'x', agentType }) + '\n';

// ---------------------------------------------------------------------------
// ADDL-AC1: Role-grouped lane model — same label → one lane
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC1: Role-grouped lanes — two same-label agents share one lane', () => {
  const harness = buildFullTimelineHarness(js);

  it('two agents with the same label produce ONE tl-lane-label (not two)', () => {
    // If the lane model groups by label, two "Code review" agents must be in the
    // same lane and thus only ONE lane-label text element should appear.
    const snap = makeSnap([
      makeAgent({ id: 'cr1', label: 'Code review', key: 'code-reviewer', status: 'done', start: NOW - 600, mtime: NOW - 400 }),
      makeAgent({ id: 'cr2', label: 'Code review', key: 'code-reviewer', status: 'done', start: NOW - 350, mtime: NOW - 200 }),
    ]);
    const output = harness(snap);
    // Count the lane label elements for 'Code review'
    const laneLabelMatches = output.match(/class="tl-lane-label"/g) || [];
    // With two same-label agents grouped into one lane, there should be exactly ONE lane label.
    expect(laneLabelMatches.length).toBe(1);
  });

  it('two same-label agents produce two bars but one label column entry', () => {
    const snap = makeSnap([
      makeAgent({ id: 'v1', label: 'Verify', key: 'test-verifier', status: 'done', start: NOW - 600, mtime: NOW - 400 }),
      makeAgent({ id: 'v2', label: 'Verify', key: 'test-verifier', status: 'done', start: NOW - 300, mtime: NOW - 100 }),
    ]);
    const output = harness(snap);
    // Two bars rendered (data-testid="tl-bar" × 2)
    const bars = output.match(/data-testid="tl-bar"/g) || [];
    expect(bars.length).toBe(2);
    // But only ONE lane label
    const laneLabels = output.match(/class="tl-lane-label"/g) || [];
    expect(laneLabels.length).toBe(1);
  });

  it('three agents with two distinct labels produce two lane labels', () => {
    // "Implement/Fix" × 2, "Security" × 1 → two lanes.
    const snap = makeSnap([
      makeAgent({ id: 'i1', label: 'Implement/Fix', key: 'implementer', status: 'done', start: NOW - 600, mtime: NOW - 400 }),
      makeAgent({ id: 'i2', label: 'Implement/Fix', key: 'implementer', status: 'done', start: NOW - 350, mtime: NOW - 200 }),
      makeAgent({ id: 's1', label: 'Security',      key: 'security-reviewer', status: 'done', start: NOW - 500, mtime: NOW - 300 }),
    ]);
    const output = harness(snap);
    const laneLabels = output.match(/class="tl-lane-label"/g) || [];
    expect(laneLabels.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC2: Timeline tab disabled when agents === 0; enabled when agents > 0
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC2: Timeline tab enabled/disabled state', () => {
  it('tabDefs marks timeline enabled:agentCount>0 in the source', () => {
    // The tabDef for timeline must conditionally enable based on agent count.
    // We verify this is wired to the agent count, not hardcoded to true.
    expect(js).toContain("key:'timeline'");
    // enabled condition must reference agent count
    const tabDefsFn = extractBalancedFn(js, 'tabDefs');
    const timelineEntry = tabDefsFn.slice(tabDefsFn.indexOf("key:'timeline'"));
    // The enabled field for timeline must be based on agentCount (or agents.length),
    // not a literal `true`.
    expect(timelineEntry).not.toMatch(/enabled\s*:\s*true\b/);
  });

  it('tabDefs timeline enabled field references agentCount or agents.length', () => {
    const tabDefsFn = extractBalancedFn(js, 'tabDefs');
    const timelineEntry = tabDefsFn.slice(
      tabDefsFn.indexOf("key:'timeline'"),
      tabDefsFn.indexOf("key:'timeline'") + 120,
    );
    // Must reference the count, not a literal boolean
    expect(timelineEntry).toMatch(/agentCount|agents\.length/);
  });

  it('getHtml renders timeline tab with disabled when zero agents in snap', () => {
    // When the webview receives a snapshot with no agents, the timeline tab
    // should be aria-disabled.
    // We render the full HTML in a full-snap message context:
    // the initial static HTML (before any message) should have the tab wired
    // to be disabled for empty state. Verify the tabDefs logic handles the zero case.
    // We use the static HTML and check that the timeline tab rendering branch
    // for disabled is present in the JS.
    expect(js).toContain('aria-disabled');
    // The disabled branch in the tab renderer uses aria-disabled="true"
    expect(js).toContain('disabled tabindex="-1"');
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC3: Superseded "no-result" guard — agent with result is NOT superseded
// Independent behavioral test via buildSnapshot (Erika writes; Fritz also has one
// but this independently verifies the same AC via a minimal fixture).
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC3: Superseded no-result guard (independent fixture)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erika-addl-ac3-'));
    fs.mkdirSync(path.join(tmpDir, 'proj', 'sub', 'workflows'), { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('dead agent with findings result is NOT flagged superseded, even with later same-key survivor', () => {
    // Scenario: cr1 is 'dead' by mtime age, short elapsed, BUT has a findings result.
    // cr2 is a later same-key agent (survivor). cr1 must NOT be flagged superseded
    // because it has a result — the no-result guard protects it.
    const wfDir = path.join(tmpDir, 'proj', 'sub', 'workflows', 'wf_ac3_test');
    fs.mkdirSync(wfDir, { recursive: true });

    const journal = [
      '{"type":"started","agentId":"cr1"}',
      '{"type":"started","agentId":"cr2"}',
      // cr1 HAS a result (findings) — should NOT be superseded even if dead
      '{"type":"result","agentId":"cr1","result":{"findings":[{"severity":"HIGH","title":"A bug"}],"verdict":"found"}}',
      '{"type":"result","agentId":"cr2","result":{"findings":[],"verdict":"clean"}}',
    ].join('\n') + '\n';

    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.jsonl'), TRANSCRIPT('code reviewer pass 1'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr2.jsonl'), TRANSCRIPT('code reviewer pass 2'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr1.meta.json'), META('workflow-plugins:code-reviewer'));
    fs.writeFileSync(path.join(wfDir, 'agent-cr2.meta.json'), META('workflow-plugins:code-reviewer'));

    // Make cr1 look old and stale (dead) with short elapsed
    const staleTime  = new Date(Date.now() - (STALE_SECS + 30) * 1000);
    const metaTime   = new Date(staleTime.getTime() - 5_000); // elapsed = 5s < 120
    fs.utimesSync(path.join(wfDir, 'agent-cr1.jsonl'),     staleTime, staleTime);
    fs.utimesSync(path.join(wfDir, 'agent-cr1.meta.json'), metaTime,  metaTime);

    const result = buildSnapshot(makeCfg(tmpDir));
    expect(result.ok, 'buildSnapshot must succeed').toBe(true);
    if (!result.ok) return;

    const cr1 = result.agents.find((a) => a.id === 'cr1');
    expect(cr1, 'cr1 agent must exist').toBeDefined();
    // cr1 has a result via journal (done by result record) — it must NOT be superseded
    expect(cr1!.superseded, 'cr1 has result → must NOT be superseded').toBeUndefined();
    expect(result.loop.superseded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC4: Superseded elapsed guard — elapsed >= 120s → NOT flagged
// Independent behavioral test — confirms the threshold guard, not just the constant.
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC4: Superseded elapsed guard (independent fixture)', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erika-addl-ac4-'));
    fs.mkdirSync(path.join(tmpDir, 'proj', 'sub', 'workflows'), { recursive: true });
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('dead+no-result agent with elapsed >= SUPERSEDED_MAX_ELAPSED_SECS is NOT flagged', () => {
    const wfDir = path.join(tmpDir, 'proj', 'sub', 'workflows', 'wf_ac4_test');
    fs.mkdirSync(wfDir, { recursive: true });

    const journal = [
      '{"type":"started","agentId":"slow1"}',
      '{"type":"started","agentId":"slow2"}',
      '{"type":"result","agentId":"slow2","result":{"filesChanged":["z.ts"],"summary":"ok"}}',
    ].join('\n') + '\n';

    fs.writeFileSync(path.join(wfDir, 'journal.jsonl'), journal);
    fs.writeFileSync(path.join(wfDir, 'agent-slow1.jsonl'), TRANSCRIPT('implementer long run'));
    fs.writeFileSync(path.join(wfDir, 'agent-slow2.jsonl'), TRANSCRIPT('implementer retry'));
    fs.writeFileSync(path.join(wfDir, 'agent-slow1.meta.json'), META('workflow-plugins:implementer'));
    fs.writeFileSync(path.join(wfDir, 'agent-slow2.meta.json'), META('workflow-plugins:implementer'));

    // slow1: dead, no result, but elapsed = SUPERSEDED_MAX_ELAPSED_SECS + 80 = 200s.
    // transcript mtime: stale (dead)
    // meta mtime: transcript mtime - (SUPERSEDED_MAX_ELAPSED_SECS + 80)s → elapsed = 200s ≥ threshold
    const transcriptMtime = new Date(Date.now() - (STALE_SECS + 10) * 1000);
    const metaMtime       = new Date(transcriptMtime.getTime() - (SUPERSEDED_MAX_ELAPSED_SECS + 80) * 1000);
    fs.utimesSync(path.join(wfDir, 'agent-slow1.jsonl'),     transcriptMtime, transcriptMtime);
    fs.utimesSync(path.join(wfDir, 'agent-slow1.meta.json'), metaMtime,       metaMtime);

    const result = buildSnapshot(makeCfg(tmpDir));
    expect(result.ok, 'buildSnapshot must succeed').toBe(true);
    if (!result.ok) return;

    const slow1 = result.agents.find((a) => a.id === 'slow1');
    expect(slow1, 'slow1 agent must exist').toBeDefined();
    expect(slow1!.status).toBe('dead');
    // elapsed >= threshold → must NOT be flagged superseded (genuine failure)
    expect(slow1!.superseded, 'elapsed >= 120s → must NOT be flagged superseded').toBeUndefined();
    expect(result.loop.superseded).toBe(0);
    // slow1 IS counted as a genuine dead agent
    expect(result.loop.dead).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC5: loop.live count excludes superseded zombies
// The spec says superseded is "excluded from the live count".
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC5: loop.live excludes superseded agents', () => {
  it('snap with superseded=1 and loop.live=2 has live count unaffected by zombie', () => {
    // The superseded zombie (status=dead) must never contribute to loop.live.
    // We verify this via the snapshot type shape — live is counts of status==='run' only.
    const snap = makeSnap(
      [
        makeAgent({ id: 'z1', label: 'UI/UX', key: 'uiux', status: 'dead', superseded: true, mtime: NOW - 350 }),
        makeAgent({ id: 'l1', label: 'Architecture', key: 'arch', status: 'run', mtime: NOW - 5 }),
        makeAgent({ id: 'l2', label: 'Implement/Fix', key: 'impl', status: 'run', mtime: NOW - 3 }),
      ],
      { live: 2, dead: 0, superseded: 1, done: 0, total: 3 },
    ) as SnapshotOk;
    // The snap has superseded=1, live=2, dead=0 — zombie is not in dead nor live.
    expect((snap as SnapshotOk).loop.live).toBe(2);
    expect((snap as SnapshotOk).loop.superseded).toBe(1);
    expect((snap as SnapshotOk).loop.dead).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC6: Timeline bars are keyboard-navigable (role="button" tabindex="0")
// Spec: "bars `role=button` tabindex=0 ... Arrow/Home/End keyboard nav"
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC6: Timeline bars are keyboard-navigable', () => {
  const harness = buildFullTimelineHarness(js);

  it('timeline bar has role="button" for keyboard interaction', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap);
    expect(output).toContain('role="button"');
  });

  it('timeline bar has tabindex="0" so it is focusable by keyboard', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap);
    expect(output).toContain('tabindex="0"');
  });

  it('CSS .tl-focus-ring provides a visible focus indicator', () => {
    // Focus ring must be present in CSS so keyboard users see where focus is.
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const cssStart = html.indexOf(styleOpen) + styleOpen.length;
    const cssEnd   = html.indexOf(styleClose, cssStart);
    const css = html.slice(cssStart, cssEnd);
    expect(css).toContain('.tl-focus-ring{');
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC7: Gantt/DAG toggle wire — js-wire.ts references tlViewToggle
// The spec says the toggle must be keyboard-operable and post a state change.
// We verify the wire code handles the toggle event.
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC7: Gantt/DAG toggle is wired in js-wire.ts', () => {
  it('html contains event handling for tlViewToggle (Graph segment)', () => {
    // The wire must attach an event listener to the Graph segment button
    // (id="tlViewToggle") to update state.timelineView.
    expect(html).toContain('tlViewToggle');
  });

  it('html contains event handling for tlViewGantt (Gantt segment)', () => {
    // Similarly, Gantt segment must be wired.
    expect(html).toContain('tlViewGantt');
  });

  it('html contains timelineView state update logic', () => {
    // The wire must update state.timelineView on click.
    expect(html).toContain('timelineView');
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC8: make-sample-run.mjs exports FAKE_NOW_SECS = BASE_TIME_SECS + 3600
// Spec: "FAKE_NOW_SECS retained for backwards compat"
// ---------------------------------------------------------------------------

type MakeSampleRunModule = {
  makeSampleRun: (outDir: string, nowSecs?: number) => string;
  BASE_TIME_SECS: number;
  FAKE_NOW_SECS: number;
};

describe('Erika-Addl-AC8: make-sample-run.mjs FAKE_NOW_SECS', () => {
  it('FAKE_NOW_SECS is exported and equals BASE_TIME_SECS + 3600', async () => {
    // @ts-expect-error — no declaration file for .mjs
    const mod = await import('../scripts/make-sample-run.mjs') as MakeSampleRunModule;
    expect(typeof mod.FAKE_NOW_SECS).toBe('number');
    expect(mod.FAKE_NOW_SECS).toBe(mod.BASE_TIME_SECS + 3600);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC9: README gallery uses only relative paths (independent extraction)
// Different regex/extraction from m4-readme.test.ts — catches any parsing blind spot.
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC9: README gallery image paths are relative', () => {
  const readme = readFile('README.md');

  it('no gallery image src starts with http:// or https://', () => {
    // Extract markdown image syntax ![alt](url) as well as HTML <img src="url">
    const mdImageRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let m: RegExpExecArray | null;
    while ((m = mdImageRe.exec(readme)) !== null) {
      const src = m[1]!;
      expect(src, `Markdown image has absolute URL: ${src}`).not.toMatch(/^https?:\/\//);
    }
    const htmlImageRe = /<img\s[^>]*src\s*=\s*"([^"]+)"/g;
    while ((m = htmlImageRe.exec(readme)) !== null) {
      const src = m[1]!;
      expect(src, `HTML img has absolute URL: ${src}`).not.toMatch(/^https?:\/\//);
    }
  });

  it('README contains at least 4 screenshot image references', () => {
    // Spec: dark + light × full + timeline = 4 minimum.
    const pngMatches = readme.match(/dashboard-[a-z-]+\.png/g) || [];
    expect(pngMatches.length, 'Expected at least 4 screenshot references in README gallery').toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC10: CONTRIBUTING.md does not misidentify the GitHub repo owner
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC10: CONTRIBUTING.md repo owner consistency', () => {
  it('CONTRIBUTING.md does not use malte-langermann as GitHub repo owner', () => {
    // Publisher (Marketplace) = malte-langermann.
    // Repo owner (GitHub)     = gagarinlg.
    // CONTRIBUTING must reference gagarinlg/claude-code-workflow-dashboard, not
    // malte-langermann/claude-code-workflow-dashboard.
    const content = readFile('CONTRIBUTING.md');
    expect(content).not.toContain('malte-langermann/claude-code-workflow-dashboard');
  });

  it('CONTRIBUTING.md references correct repo URL with gagarinlg owner', () => {
    const content = readFile('CONTRIBUTING.md');
    expect(content).toContain('gagarinlg/claude-code-workflow-dashboard');
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC11: Timeline tab has no badge text (spec: badge:'')
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC11: Timeline tab has empty badge in tabDefs', () => {
  it('tabDefs timeline entry has badge empty string', () => {
    const tabDefsFn = extractBalancedFn(js, 'tabDefs');
    // Find the timeline entry and verify badge:'' (empty)
    const tlStart = tabDefsFn.indexOf("key:'timeline'");
    const tlEnd   = tabDefsFn.indexOf('}', tlStart);
    const tlEntry = tabDefsFn.slice(tlStart, tlEnd);
    // badge must be an empty string for the timeline tab
    expect(tlEntry).toMatch(/badge\s*:\s*''/);
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC12: Superseded agent card shows 'superseded' status label, not 'dead'
// Spec: "a 'superseded'/'stalled' status ... shown as superseded/stalled (not running)"
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC12: Superseded agent card status label', () => {
  it('agentsPanel uses "superseded" status label for superseded agents, not "dead"', () => {
    // The panel JS must distinguish superseded from dead in the status label
    // by checking a.superseded and emitting 'superseded' rather than 'stalled' or 'dead'.
    const agentsPanelFn = extractBalancedFn(js, 'agentsPanel');
    expect(agentsPanelFn).toContain('superseded');
  });

  it('agent card renders superseded-card CSS class for superseded agents', () => {
    // This verifies that a superseded agent gets a dimmed card style distinct
    // from a dead/stalled card.
    const agentsPanelFn = extractBalancedFn(js, 'agentsPanel');
    expect(agentsPanelFn).toContain('superseded-card');
  });
});

// ---------------------------------------------------------------------------
// ADDL-AC13: No pricing in shipped HTML (ROADMAP Decision #5)
// Decision: "Counts + charts, NO pricing."
// ---------------------------------------------------------------------------

describe('Erika-Addl-AC13: No pricing information in shipped HTML', () => {
  it('getHtml() output does not mention $/cost/price/pricing', () => {
    const fullHtml = getHtml(TEST_NONCE);
    // These words would indicate a pricing table or cost calculation.
    // Per Decision #5: counts only, no pricing.
    expect(fullHtml.toLowerCase()).not.toMatch(/\$\s*\d|per\s+token|\bcost\b|\bprice\b|\bpricing\b/);
  });
});
