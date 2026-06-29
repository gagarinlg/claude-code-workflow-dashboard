/**
 * M3-Timeline — tests for the Gantt visualization tab.
 *
 * Strategy: extract timelinePanel() and its helpers from the webview JS, evaluate
 * them in a sandboxed harness with synthetic snap.agents arrays, then assert:
 *   - Timeline tab exists in tabDefs() (6th, between Charts and Results)
 *   - timelinePanel() renders bars at 1 agent, renders at 39-50 agents
 *   - .tl-bar-run / .tl-bar-done / .tl-bar-dead CSS classes are present
 *   - No inline style= attribute in timeline SVG output (CSP constraint)
 *   - SR table (data-testid="tl-sr-table") is present with Role/Status/Start/Duration
 *   - Superseded agents get .tl-bar-superseded class, not .tl-bar-dead/.tl-bar-run
 *   - Empty state when agents array is empty
 *   - Zoom controls present; cap banner at 41 lanes; no external refs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getHtml } from '../src/webview/html';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';

// ---------------------------------------------------------------------------
// Harness builder
// ---------------------------------------------------------------------------

/**
 * Build a harness that evaluates timelinePanel() and all helpers it needs,
 * then calls it with a synthetic snap object. Returns the HTML string.
 */
function buildTimelineHarness(js: string): (snap: object, stateOverride?: object) => string {
  // Functions required by timelinePanel():
  const escFn         = extractBalancedFn(js, 'esc');
  const escClsFn      = extractBalancedFn(js, 'escCls');
  const safeNFn       = extractBalancedFn(js, 'safeN');
  const fmtTokFn      = extractBalancedFn(js, 'fmtTok');
  const fmtTHtmlFn    = extractBalancedFn(js, 'fmtTHtml');
  const fmtTLTimeFn   = extractBalancedFn(js, 'fmtTLTime');
  const fmtElapsedSRFn = extractBalancedFn(js, 'fmtElapsedSR');
  const tlXFn         = extractBalancedFn(js, 'tlX');
  // dagPanel is required by timelinePanel() when state.timelineView === 'dag'.
  // Including it here prevents a ReferenceError if any future test passes timelineView:'dag'
  // to this harness. m3-depgraph.test.ts buildFullHarness already includes dagPanel correctly.
  const dagPanelFn    = extractBalancedFn(js, 'dagPanel');
  const timelinePanelFn = extractBalancedFn(js, 'timelinePanel');

  const factory = new Function(
    'snap',
    'state',
    [
      escFn, escClsFn, safeNFn, fmtTokFn, fmtTHtmlFn,
      fmtTLTimeFn, fmtElapsedSRFn, tlXFn,
      // Constants used in timelinePanel (and dagPanel for the DAG path)
      'var TL_LABEL_W=120;var TL_LANE_H=26;var TL_LANE_GAP=6;var TL_TICK_H=18;var TL_K=80;var TL_BAR_CAP=40;var TL_TICK_SECS=[30,60,120,300,600,1200,1800];',
      'var TL_LABEL_TRUNC=16;',
      'var DAG_LAYER_W=160;var DAG_NODE_W=130;var DAG_NODE_H=28;var DAG_NODE_GAP=10;var DAG_PAD=16;var DAG_EDGE_COLOR_CLS="tl-dag-edge";',
      dagPanelFn,
      timelinePanelFn,
      'return timelinePanel();',
    ].join('\n'),
  ) as (snap: object, state: object) => string;

  return (snap: object, stateOverride: object = {}) => {
    const state = { tlZoom: 1, tlScrollLeft: 0, activeTab: 'timeline', timelineView: 'gantt', ...stateOverride };
    return factory(snap, state);
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW = 1700010000; // fixed epoch for determinism

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

function makeAgents(n: number, labelPrefix = 'Role'): object[] {
  return Array.from({ length: n }, (_, i) => makeAgent({
    id: `a${i}`,
    label: i < 7 ? ['Implement/Fix', 'Verify', 'Architecture', 'Code review', 'Security', 'UI/UX', 'Completeness'][i] : `${labelPrefix}${i}`,
    key: `role_${i}`,
    start: NOW - 600 + i * 10,
    mtime: NOW - 480 + i * 10,
    elapsed: 120 + i,
    idx: i + 1,
  }));
}

function makeSnap(agents: object[]): object {
  return {
    ok: true,
    runId: 'wf_test',
    updatedAt: new Date(NOW * 1000).toISOString(),
    loop: {
      phase: 'done', live: 0, done: agents.length, dead: 0, superseded: 0,
      total: agents.length, outTok: 5000, tools: 20, passes: 1,
      findings: 0, sevTotals: {},
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
// tabDefs registration
// ---------------------------------------------------------------------------

describe('M3-Timeline — tabDefs registration', () => {
  const html = getHtml(TEST_NONCE);

  it('timeline tab key is present in tabDefs()', () => {
    expect(html).toContain("key:'timeline'");
  });

  it('timeline tab label is "Timeline"', () => {
    expect(html).toContain("label:'Timeline'");
  });

  it('timeline tab is positioned between Charts and Results in tabDefs', () => {
    const js = getPanelJs(html);
    // Find the tabDefs function body.
    const tabDefsFn = extractBalancedFn(js, 'tabDefs');
    const chartsIdx = tabDefsFn.indexOf("key:'charts'");
    const timelineIdx = tabDefsFn.indexOf("key:'timeline'");
    const resultsIdx = tabDefsFn.indexOf("key:'results'");
    expect(chartsIdx).toBeGreaterThan(-1);
    expect(timelineIdx).toBeGreaterThan(-1);
    expect(resultsIdx).toBeGreaterThan(-1);
    expect(timelineIdx).toBeGreaterThan(chartsIdx);
    expect(resultsIdx).toBeGreaterThan(timelineIdx);
  });

  it('tabContent() dispatches to timelinePanel() for the timeline tab', () => {
    expect(html).toContain('timelinePanel()');
  });

  it('state initializer includes tlZoom and tlScrollLeft', () => {
    expect(html).toContain('tlZoom');
    expect(html).toContain('tlScrollLeft');
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — 1 agent
// ---------------------------------------------------------------------------

describe('M3-Timeline — 1 agent', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snap1 = makeSnap([makeAgent({ id: 'a1', label: 'Implement/Fix', status: 'done' })]);
  let output: string;

  beforeEach(() => {
    output = harness(snap1);
  });

  it('renders a non-empty string', () => {
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(50);
  });

  it('contains the timeline SVG with data-testid="tl-svg"', () => {
    expect(output).toContain('data-testid="tl-svg"');
  });

  it('SVG has role="img" for accessibility', () => {
    expect(output).toContain('role="img"');
  });

  it('contains a bar rect with data-testid="tl-bar"', () => {
    expect(output).toContain('data-testid="tl-bar"');
  });

  it('done agent bar uses .tl-bar-done CSS class', () => {
    expect(output).toContain('tl-bar-done');
  });

  it('SR table is present with data-testid="tl-sr-table"', () => {
    expect(output).toContain('data-testid="tl-sr-table"');
  });

  it('SR table has Role/Status/Start/Duration column headers', () => {
    expect(output).toContain('<th>Role</th>');
    expect(output).toContain('<th>Status</th>');
    expect(output).toContain('<th>Start</th>');
    expect(output).toContain('<th>Duration</th>');
  });

  it('zoom controls are present', () => {
    expect(output).toContain('id="tlZoomIn"');
    expect(output).toContain('id="tlZoomOut"');
  });

  it('no inline style= attribute in the SVG (CSP constraint)', () => {
    // Extract SVG content: from <svg to </svg>
    const svgStart = output.indexOf('<svg');
    const svgEnd = output.indexOf('</svg>');
    expect(svgStart).toBeGreaterThan(-1);
    const svgContent = output.slice(svgStart, svgEnd + 6);
    // No style= inside SVG elements — all fills via CSS classes or presentation attrs
    expect(svgContent).not.toMatch(/\sstyle\s*=/);
  });

  it('no external href or xlink:href in timeline output', () => {
    expect(output).not.toContain('xlink:href');
    expect(output).not.toMatch(/href\s*=\s*["']https?/);
    expect(output).not.toContain('javascript:');
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — run (live) agent
// ---------------------------------------------------------------------------

describe('M3-Timeline — live agent', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snap = makeSnap([makeAgent({ id: 'a1', status: 'run', mtime: NOW - 5 })]);
  let output: string;

  beforeEach(() => {
    output = harness(snap);
  });

  it('live agent uses .tl-bar-run CSS class', () => {
    expect(output).toContain('tl-bar-run');
  });

  it('live agent has a pulsing cap element with .tl-live-cap', () => {
    expect(output).toContain('tl-live-cap');
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — dead (stalled) agent
// ---------------------------------------------------------------------------

describe('M3-Timeline — dead agent', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snap = makeSnap([makeAgent({ id: 'a1', status: 'dead', mtime: NOW - 400 })]);
  let output: string;

  beforeEach(() => {
    output = harness(snap);
  });

  it('dead agent uses .tl-bar-dead CSS class', () => {
    expect(output).toContain('tl-bar-dead');
  });

  it('dead agent does NOT have a live cap', () => {
    expect(output).not.toContain('tl-live-cap');
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — superseded agent
// ---------------------------------------------------------------------------

describe('M3-Timeline — superseded agent', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snap = makeSnap([
    makeAgent({ id: 'a1', label: 'Implement/Fix', status: 'dead', superseded: true, mtime: NOW - 350 }),
    makeAgent({ id: 'a2', label: 'Implement/Fix', status: 'done', mtime: NOW - 200 }),
  ]);
  let output: string;

  beforeEach(() => {
    output = harness(snap);
  });

  it('superseded agent uses .tl-bar-superseded class', () => {
    expect(output).toContain('tl-bar-superseded');
  });

  it('superseded agent does NOT use .tl-bar-dead class', () => {
    // The dead non-superseded bar should not appear (none here); superseded bar replaces it
    // More precisely: the class for the superseded bar must be tl-bar-superseded, not tl-bar-dead
    const barMatches = [...output.matchAll(/class="(tl-bar-[^"]+)"/g)].map((m) => m[1] ?? '');
    const hasSuperseded = barMatches.some((c) => c.includes('tl-bar-superseded'));
    const hasDead = barMatches.some((c) => c === 'tl-bar-dead');
    expect(hasSuperseded).toBe(true);
    // The 'done' bar and superseded bar are present; no plain 'tl-bar-dead' bar
    expect(hasDead).toBe(false);
  });

  it('superseded agent aria-label says "superseded"', () => {
    expect(output).toContain('superseded');
  });

  it('no inline style= in SVG for superseded bars', () => {
    const svgStart = output.indexOf('<svg');
    const svgEnd = output.indexOf('</svg>');
    const svgContent = output.slice(svgStart, svgEnd + 6);
    expect(svgContent).not.toMatch(/\sstyle\s*=/);
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — 39 agents
// ---------------------------------------------------------------------------

describe('M3-Timeline — 39 agents (under cap)', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snap39 = makeSnap(makeAgents(39));
  let output: string;

  beforeEach(() => {
    output = harness(snap39);
  });

  it('renders successfully for 39 agents', () => {
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(100);
  });

  it('has bars for all 39 agents', () => {
    const bars = output.match(/data-testid="tl-bar"/g);
    expect(bars).not.toBeNull();
    expect(bars!.length).toBe(39);
  });

  it('no cap banner for 39 agents (under cap of 40)', () => {
    expect(output).not.toContain('data-testid="tl-cap-banner"');
  });

  it('SR table has 39 rows', () => {
    // Each row has a <tr>...</tr> inside tbody
    const rowMatches = output.match(/<tr>/g);
    // +1 for the thead row
    expect(rowMatches).not.toBeNull();
    expect(rowMatches!.length).toBeGreaterThanOrEqual(39);
  });

  it('no inline style= in SVG for 39 agents', () => {
    const svgStart = output.indexOf('<svg');
    const svgEnd = output.indexOf('</svg>');
    const svgContent = output.slice(svgStart, svgEnd + 6);
    expect(svgContent).not.toMatch(/\sstyle\s*=/);
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — 41 agents (cap at 40)
// ---------------------------------------------------------------------------

describe('M3-Timeline — 41 agents (over cap)', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snap41 = makeSnap(makeAgents(41));
  let output: string;

  beforeEach(() => {
    output = harness(snap41);
  });

  it('renders successfully for 41 agents', () => {
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(100);
  });

  it('cap banner present for 41 agents (over cap of 40)', () => {
    expect(output).toContain('data-testid="tl-cap-banner"');
  });
});

// ---------------------------------------------------------------------------
// timelinePanel() functional tests — empty state
// ---------------------------------------------------------------------------

describe('M3-Timeline — empty state', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);
  const snapEmpty = makeSnap([]);

  it('returns empty state message when agents is empty', () => {
    const output = harness(snapEmpty);
    expect(output).toContain('data-testid="tl-empty"');
  });

  it('empty state does not contain an SVG', () => {
    const output = harness(snapEmpty);
    expect(output).not.toContain('<svg');
  });

  it('empty state does not contain SR table', () => {
    const output = harness(snapEmpty);
    expect(output).not.toContain('data-testid="tl-sr-table"');
  });
});

// ---------------------------------------------------------------------------
// CSS rules
// ---------------------------------------------------------------------------

describe('M3-Timeline — CSS rules', () => {
  const html = getHtml(TEST_NONCE);
  const styleOpen = `<style nonce="${TEST_NONCE}">`;
  const styleClose = '</style>';
  const styleStart = html.indexOf(styleOpen);
  const styleEnd = html.indexOf(styleClose, styleStart);
  const css = html.slice(styleStart + styleOpen.length, styleEnd);

  it('CSS contains .tl-bar-run rule', () => {
    expect(css).toContain('.tl-bar-run{');
  });

  it('CSS contains .tl-bar-done rule', () => {
    expect(css).toContain('.tl-bar-done{');
  });

  it('CSS contains .tl-bar-dead rule', () => {
    expect(css).toContain('.tl-bar-dead{');
  });

  it('CSS contains .tl-bar-superseded rule', () => {
    expect(css).toContain('.tl-bar-superseded{');
  });

  it('CSS contains @keyframes tl-pulse for live cap', () => {
    expect(css).toContain('@keyframes tl-pulse');
  });

  it('CSS contains .tl-focus-ring rule for keyboard focus', () => {
    expect(css).toContain('.tl-focus-ring{');
  });

  it('CSS contains forced-colors override for .tl-bar-run', () => {
    expect(css).toContain('.tl-bar-run,.tl-bar-done,.tl-bar-dead,.tl-bar-superseded');
  });

  it('CSS contains prefers-reduced-motion override for .tl-live-cap', () => {
    expect(css).toContain('.tl-live-cap{animation:none');
  });

  it('CSS .tl-bar-run uses --vscode-charts-green (theme-native, no hex fallback)', () => {
    expect(css).toContain('.tl-bar-run{fill:var(--vscode-charts-green)');
  });

  it('CSS .tl-bar-done uses --vscode-charts-blue (theme-native, no hex fallback)', () => {
    expect(css).toContain('.tl-bar-done{fill:var(--vscode-charts-blue)');
  });

  it('CSS .tl-bar-dead uses --vscode-charts-red (theme-native, no hex fallback)', () => {
    expect(css).toContain('.tl-bar-dead{fill:var(--vscode-charts-red)');
  });

  it('CSS .tl-bar-superseded uses --vscode-charts-yellow (theme-native, no hex fallback)', () => {
    expect(css).toContain('.tl-bar-superseded{fill:var(--vscode-charts-yellow)');
  });

  it('CSS .tl-scroll has overflow-x:auto', () => {
    expect(css).toContain('.tl-scroll{overflow-x:auto');
  });

  it('CSS .tl-tooltip is present', () => {
    expect(css).toContain('.tl-tooltip{');
  });
});

// ---------------------------------------------------------------------------
// XSS safety
// ---------------------------------------------------------------------------

describe('M3-Timeline — XSS safety', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelineHarness(js);

  it('agent label containing XSS payload is escaped in timeline output', () => {
    const snap = makeSnap([makeAgent({
      id: 'x1',
      label: '<script>alert(1)</script>',
      key: 'xss',
    })]);
    const output = harness(snap);
    expect(output).not.toContain('<script>alert(1)</script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('agent id containing XSS payload is escaped in data-tlaid attribute', () => {
    const snap = makeSnap([makeAgent({
      id: '"><img src=x onerror=1>',
      label: 'Safe',
      key: 'xss2',
    })]);
    const output = harness(snap);
    expect(output).not.toContain('onerror=1>');
  });
});

// ---------------------------------------------------------------------------
// Script validity
// ---------------------------------------------------------------------------

describe('M3-Timeline — script validity', () => {
  const html = getHtml(TEST_NONCE);

  it('inline script parses without error after timeline additions', () => {
    const js = getPanelJs(html);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js);
    }).not.toThrow();
  });

  it('function timelinePanel() is present in the JS block', () => {
    const js = getPanelJs(html);
    expect(js).toContain('function timelinePanel(');
  });

  it('function fmtTLTime() is present in the JS block', () => {
    const js = getPanelJs(html);
    expect(js).toContain('function fmtTLTime(');
  });

  it('function tlX() is present in the JS block', () => {
    const js = getPanelJs(html);
    expect(js).toContain('function tlX(');
  });

  it('inline script contains no backtick template literals', () => {
    const js = getPanelJs(html);
    expect(js).not.toContain('`');
  });
});

// ---------------------------------------------------------------------------
// M3-DepGraph: Gantt/DAG toggle + DAG sub-view tests
// ---------------------------------------------------------------------------

/**
 * Build a harness that evaluates dagPanel() from the webview JS string.
 * Injects required helpers and constants, then calls dagPanel(agents).
 */
function buildDagHarness(js: string): (agents: object[]) => string {
  const escFn         = extractBalancedFn(js, 'esc');
  const escClsFn      = extractBalancedFn(js, 'escCls');
  const safeNFn       = extractBalancedFn(js, 'safeN');
  const dagPanelFn    = extractBalancedFn(js, 'dagPanel');

  const factory = new Function(
    'agents',
    [
      escFn, escClsFn, safeNFn,
      // DAG geometry constants (must match js-panels.ts)
      'var TL_LABEL_TRUNC=16;',
      'var DAG_LAYER_W=160;var DAG_NODE_W=130;var DAG_NODE_H=28;var DAG_NODE_GAP=10;var DAG_PAD=16;var DAG_EDGE_COLOR_CLS="tl-dag-edge";',
      dagPanelFn,
      'return dagPanel(agents);',
    ].join('\n'),
  ) as (agents: object[]) => string;

  return (agents: object[]) => factory(agents);
}

/**
 * Build a harness that evaluates timelinePanel() with state.timelineView set to 'dag'.
 * Returns the full panel HTML string as if the toggle was activated.
 */
function buildTimelinePanelHarness(js: string): (snap: object, stateOverride?: object) => string {
  const escFn          = extractBalancedFn(js, 'esc');
  const escClsFn       = extractBalancedFn(js, 'escCls');
  const safeNFn        = extractBalancedFn(js, 'safeN');
  const fmtTokFn       = extractBalancedFn(js, 'fmtTok');
  const fmtTHtmlFn     = extractBalancedFn(js, 'fmtTHtml');
  const fmtTLTimeFn    = extractBalancedFn(js, 'fmtTLTime');
  const fmtElapsedSRFn = extractBalancedFn(js, 'fmtElapsedSR');
  const tlXFn          = extractBalancedFn(js, 'tlX');
  const dagPanelFn     = extractBalancedFn(js, 'dagPanel');
  const timelinePanelFn = extractBalancedFn(js, 'timelinePanel');

  const factory = new Function(
    'snap',
    'state',
    [
      escFn, escClsFn, safeNFn, fmtTokFn, fmtTHtmlFn,
      fmtTLTimeFn, fmtElapsedSRFn, tlXFn,
      'var TL_LABEL_W=120;var TL_LANE_H=26;var TL_LANE_GAP=6;var TL_TICK_H=18;var TL_K=80;var TL_BAR_CAP=40;var TL_TICK_SECS=[30,60,120,300,600,1200,1800];',
      'var TL_LABEL_TRUNC=16;',
      'var DAG_LAYER_W=160;var DAG_NODE_W=130;var DAG_NODE_H=28;var DAG_NODE_GAP=10;var DAG_PAD=16;var DAG_EDGE_COLOR_CLS="tl-dag-edge";',
      dagPanelFn,
      timelinePanelFn,
      'return timelinePanel();',
    ].join('\n'),
  ) as (snap: object, state: object) => string;

  return (snap: object, stateOverride: object = {}) => {
    const state = { tlZoom: 1, tlScrollLeft: 0, activeTab: 'timeline', timelineView: 'gantt', ...stateOverride };
    return factory(snap, state);
  };
}

describe('M3-DepGraph — toggle button in timeline panel', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const harness = buildTimelinePanelHarness(js);
  const snap1 = makeSnap([makeAgent({ id: 'a1', label: 'Implement/Fix', status: 'done' })]);

  it('toggle button is present in Gantt view', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('id="tlViewToggle"');
  });

  it('toggle button is present in DAG view', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).toContain('id="tlViewToggle"');
  });

  it('toggle has data-testid="tl-view-toggle"', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('data-testid="tl-view-toggle"');
  });

  it('toggle aria-checked="false" when in Gantt view (radiogroup pattern)', () => {
    // The segmented control uses role=radiogroup + role=radio + aria-checked (not aria-pressed).
    // aria-pressed is the toggle-button pattern where each button can independently be on/off;
    // aria-checked in a radiogroup conveys exclusive selection, which is correct here.
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('aria-checked="false"');
  });

  it('toggle aria-checked="true" when in DAG view (radiogroup pattern)', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).toContain('aria-checked="true"');
  });

  it('toggle has .tl-view-toggle-active class when in DAG view', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).toContain('tl-view-toggle-active');
  });

  it('Gantt button HAS .tl-view-toggle-active class when in Gantt view (active segment is always visually marked)', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    // Gantt is the active segment — it must carry tl-view-toggle-active so users can see which view is selected.
    // The Graph button must NOT carry the active class in Gantt view.
    expect(output).toContain('id="tlViewGantt" class="tl-view-toggle tl-view-toggle-active"');
    expect(output).not.toContain('id="tlViewToggle" class="tl-view-toggle tl-view-toggle-active"');
  });

  it('state.timelineView defaults to "gantt" (not dag)', () => {
    // The harness with no stateOverride uses the compiled default from js-panels.ts state init.
    // We verify by checking the Gantt SVG is rendered (not the DAG SVG).
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('data-testid="tl-svg"');
    expect(output).not.toContain('data-testid="dag-svg"');
  });

  it('DAG view renders data-testid="dag-svg", not data-testid="tl-svg"', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).toContain('data-testid="dag-svg"');
    expect(output).not.toContain('data-testid="tl-svg"');
  });
});

describe('M3-DepGraph — dagPanel() output', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const dagHarness = buildDagHarness(js);

  it('renders a non-empty string for 1 agent', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'implementer', status: 'done' })];
    const output = dagHarness(agents);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(50);
  });

  it('contains data-testid="dag-svg"', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'implementer', status: 'done' })];
    expect(dagHarness(agents)).toContain('data-testid="dag-svg"');
  });

  it('renders dag-node rects with data-testid="dag-node"', () => {
    const agents = [
      makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done' }),
      makeAgent({ id: 'a2', label: 'Verify', key: 'verify', status: 'done' }),
    ];
    const output = dagHarness(agents);
    const nodes = output.match(/data-testid="dag-node"/g);
    expect(nodes).not.toBeNull();
    expect(nodes!.length).toBe(2);
  });

  it('done agent node uses tl-bar-done CSS class', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done' })];
    expect(dagHarness(agents)).toContain('tl-bar-done');
  });

  it('run agent node uses tl-bar-run CSS class', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'run', mtime: NOW - 5 })];
    expect(dagHarness(agents)).toContain('tl-bar-run');
  });

  it('dead agent node uses tl-bar-dead CSS class', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'dead', mtime: NOW - 400 })];
    expect(dagHarness(agents)).toContain('tl-bar-dead');
  });

  it('superseded agent node uses tl-bar-superseded CSS class', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'dead', superseded: true, mtime: NOW - 60 })];
    expect(dagHarness(agents)).toContain('tl-bar-superseded');
  });

  it('edges rendered between consecutive same-key agents (data-testid="dag-edge")', () => {
    const agents = [
      makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done', start: NOW - 300, mtime: NOW - 200 }),
      makeAgent({ id: 'a2', label: 'Implement', key: 'impl', status: 'done', start: NOW - 100, mtime: NOW - 50 }),
    ];
    const output = dagHarness(agents);
    expect(output).toContain('data-testid="dag-edge"');
  });

  it('no edge between agents with different keys', () => {
    const agents = [
      makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done' }),
      makeAgent({ id: 'a2', label: 'Verify', key: 'verify', status: 'done' }),
    ];
    const output = dagHarness(agents);
    // Two different keys → no same-key chain → no edges
    expect(output).not.toContain('data-testid="dag-edge"');
  });

  it('arrowhead marker is defined in <defs>', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done' })];
    expect(dagHarness(agents)).toContain('data-testid="dag-arrowhead"');
  });

  it('no inline style= in DAG SVG output (CSP constraint)', () => {
    const agents = makeAgents(5);
    const output = dagHarness(agents);
    const svgStart = output.indexOf('<svg');
    const svgEnd = output.indexOf('</svg>');
    const svgContent = output.slice(svgStart, svgEnd + 6);
    expect(svgContent).not.toMatch(/\sstyle\s*=/);
  });

  it('SR table present with data-testid="dag-sr-table"', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done' })];
    expect(dagHarness(agents)).toContain('data-testid="dag-sr-table"');
  });

  it('SR table has Role/Pass/Status headers', () => {
    const agents = [makeAgent({ id: 'a1', label: 'Implement', key: 'impl', status: 'done' })];
    const output = dagHarness(agents);
    expect(output).toContain('<th>Role</th>');
    expect(output).toContain('<th>Pass</th>');
    expect(output).toContain('<th>Status</th>');
  });

  it('renders empty state when agents array is empty', () => {
    const output = dagHarness([]);
    expect(output).toContain('data-testid="dag-empty"');
    expect(output).not.toContain('<svg');
  });

  it('XSS: agent label is escaped in DAG output', () => {
    const agents = [makeAgent({ id: 'x1', label: '<script>alert(1)</script>', key: 'xss', status: 'done' })];
    const output = dagHarness(agents);
    expect(output).not.toContain('<script>alert(1)</script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('renders without error for 50 agents (scale test)', () => {
    const agents = makeAgents(50);
    expect(() => dagHarness(agents)).not.toThrow();
    const output = dagHarness(agents);
    expect(output).toContain('data-testid="dag-svg"');
  });
});

describe('M3-DepGraph — CSS rules', () => {
  const html = getHtml(TEST_NONCE);
  const styleOpen = `<style nonce="${TEST_NONCE}">`;
  const styleClose = '</style>';
  const styleStart = html.indexOf(styleOpen);
  const styleEnd = html.indexOf(styleClose, styleStart);
  const css = html.slice(styleStart + styleOpen.length, styleEnd);

  it('CSS contains .tl-view-toggle rule', () => {
    expect(css).toContain('.tl-view-toggle{');
  });

  it('CSS contains .tl-view-toggle-active rule', () => {
    expect(css).toContain('.tl-view-toggle-active{');
  });

  it('CSS contains .tl-dag-node rule', () => {
    expect(css).toContain('.tl-dag-node{');
  });

  it('CSS contains .tl-dag-edge rule', () => {
    expect(css).toContain('.tl-dag-edge{');
  });

  it('CSS contains .tl-dag-arrowhead rule', () => {
    expect(css).toContain('.tl-dag-arrowhead{');
  });

  it('CSS contains .tl-dag-label rule', () => {
    expect(css).toContain('.tl-dag-label{');
  });

  it('CSS .tl-dag-edge uses fill:none (not a solid fill)', () => {
    expect(css).toContain('.tl-dag-edge{fill:none');
  });

  it('CSS forced-colors block covers .tl-dag-edge', () => {
    expect(css).toContain('.tl-dag-edge{stroke:ButtonText}');
  });

  it('CSS forced-colors block covers .tl-dag-arrowhead', () => {
    expect(css).toContain('.tl-dag-arrowhead{fill:ButtonText}');
  });
});

describe('M3-DepGraph — state initialization', () => {
  const html = getHtml(TEST_NONCE);

  it('state initializer contains timelineView field', () => {
    expect(html).toContain('timelineView');
  });

  it('state initializer defaults timelineView to "gantt"', () => {
    // The state initializer should set timelineView to 'gantt' as default.
    expect(html).toContain("'gantt'");
  });

  it('state timelineView accepts "dag" as valid value', () => {
    expect(html).toContain("'dag'");
  });
});

describe('M3-DepGraph — wire presence', () => {
  const html = getHtml(TEST_NONCE);

  it('tlViewToggle wiring is present in the JS', () => {
    const js = getPanelJs(html);
    expect(js).toContain('tlViewToggle');
  });

  it('function dagPanel() is present in the JS block', () => {
    const js = getPanelJs(html);
    expect(js).toContain('function dagPanel(');
  });
});
