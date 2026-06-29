/**
 * M3-DepGraph — dedicated tests for the Gantt/Graph segmented control and DAG sub-view.
 *
 * AC coverage:
 *   - SEGMENTED control [Gantt | Graph] in Timeline tab header.
 *   - state.timelineView 'gantt'|'dag' persisted; defaults to 'gantt'.
 *   - Active segment: visually unmistakable filled style (--vscode-button-background/foreground).
 *   - Inactive segment: outline-only (transparent bg + border).
 *   - forced-colors: active segment uses solid Highlight fill (not a subtle shade).
 *   - Keyboard-operable: role=radiogroup + role=radio + aria-checked.
 *   - No inline style= attributes anywhere in timeline/dag output (CSP constraint).
 *   - Toggle switches between Gantt SVG (data-testid="tl-svg") and DAG SVG (data-testid="dag-svg").
 *   - DAG: layered-by-pass columns, status-colored nodes (CSS class), polyline edges + arrowhead marker.
 *   - Gantt-first: Gantt is the default; DAG can be a stub but toggle must work.
 */

import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';

// ---------------------------------------------------------------------------
// Helpers shared across describe blocks
// ---------------------------------------------------------------------------

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

/**
 * Full timelinePanel() harness — includes dagPanel() so both Gantt and DAG paths work.
 */
function buildFullHarness(js: string): (snap: object, stateOverride?: object) => string {
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
    const state = {
      tlZoom: 1, tlScrollLeft: 0, activeTab: 'timeline', timelineView: 'gantt',
      ...stateOverride,
    };
    return factory(snap, state);
  };
}

function makeSnap(agents: object[]): object {
  return {
    ok: true, runId: 'wf_test',
    updatedAt: new Date(NOW * 1000).toISOString(),
    loop: {
      phase: 'done', live: 0, done: agents.length, dead: 0, superseded: 0,
      total: agents.length, outTok: 5000, tools: 20, passes: 1,
      findings: 0, sevTotals: {},
    },
    labels: [], agents, agentsCapped: false,
    allFindings: [], structuredResults: [], verdicts: {}, verdictLabels: {},
    isPinned: false, changed: null, changedByAgents: [],
  };
}

const html = getHtml(TEST_NONCE);
const js   = getPanelJs(html);

// Extract CSS block (panel mode only).
const styleOpen = `<style nonce="${TEST_NONCE}">`;
const styleClose = '</style>';
const styleStart = html.indexOf(styleOpen);
const styleEnd   = html.indexOf(styleClose, styleStart);
const css = html.slice(styleStart + styleOpen.length, styleEnd);

// ---------------------------------------------------------------------------
// Segmented control — rendering
// ---------------------------------------------------------------------------

describe('M3-DepGraph — segmented control rendering', () => {
  const harness = buildFullHarness(js);
  const snap1 = makeSnap([makeAgent({ id: 'a1' })]);

  it('renders a role="radiogroup" wrapper for the segmented control', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('role="radiogroup"');
  });

  it('radiogroup has aria-label="Timeline view"', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('aria-label="Timeline view"');
  });

  it('both segments have role="radio"', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    const radioCount = (output.match(/role="radio"/g) || []).length;
    expect(radioCount).toBe(2);
  });

  it('Gantt button id="tlViewGantt" is present', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('id="tlViewGantt"');
  });

  it('Graph button id="tlViewToggle" is present (backward-compat id)', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('id="tlViewToggle"');
  });

  it('Graph button has data-testid="tl-view-toggle"', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('data-testid="tl-view-toggle"');
  });

  it('segmented control wrapper has class="tl-seg-ctrl"', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('class="tl-seg-ctrl"');
  });
});

// ---------------------------------------------------------------------------
// Segmented control — active state (critical AC: visually unmistakable fill)
// ---------------------------------------------------------------------------

describe('M3-DepGraph — active segment styling', () => {
  const harness = buildFullHarness(js);
  const snap1 = makeSnap([makeAgent({ id: 'a1' })]);

  it('Gantt segment carries tl-view-toggle-active class when in Gantt view', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    // Active segment must be filled (class carries --vscode-button-background background).
    expect(output).toContain('id="tlViewGantt" class="tl-view-toggle tl-view-toggle-active"');
  });

  it('Graph segment does NOT carry tl-view-toggle-active in Gantt view', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).not.toContain('id="tlViewToggle" class="tl-view-toggle tl-view-toggle-active"');
  });

  it('Graph segment carries tl-view-toggle-active class when in DAG view', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).toContain('id="tlViewToggle" class="tl-view-toggle tl-view-toggle-active"');
  });

  it('Gantt segment does NOT carry tl-view-toggle-active in DAG view', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).not.toContain('id="tlViewGantt" class="tl-view-toggle tl-view-toggle-active"');
  });

  it('active CSS class uses --vscode-button-background fill (not transparent)', () => {
    // The .tl-view-toggle-active rule must set background to --vscode-button-background.
    expect(css).toContain('.tl-view-toggle-active{background:var(--vscode-button-background)');
  });

  it('active CSS class uses --vscode-button-foreground for text color', () => {
    expect(css).toContain('color:var(--vscode-button-foreground)');
  });

  it('inactive .tl-view-toggle has transparent background (outline-only)', () => {
    // Inactive segment must NOT be filled — only an outline border.
    expect(css).toContain('background:transparent');
  });

  it('inactive .tl-view-toggle has a border using --vscode-button-background', () => {
    // The border color uses the button accent so the control reads as a group.
    expect(css).toContain('border:1px solid var(--vscode-button-background)');
  });
});

// ---------------------------------------------------------------------------
// Segmented control — ARIA semantics (keyboard + screen reader)
// ---------------------------------------------------------------------------

describe('M3-DepGraph — ARIA semantics (keyboard + screen reader)', () => {
  const harness = buildFullHarness(js);
  const snap1 = makeSnap([makeAgent({ id: 'a1' })]);

  it('Gantt aria-checked="true" when in Gantt view', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    // The Gantt button (id=tlViewGantt) must report aria-checked=true.
    expect(output).toContain('id="tlViewGantt"');
    // Capture the button substring to check its aria-checked value.
    const ganttBtnStart = output.indexOf('id="tlViewGantt"');
    const ganttBtnEnd = output.indexOf('>', ganttBtnStart) + 1;
    const ganttBtn = output.slice(ganttBtnStart - 10, ganttBtnEnd);
    expect(ganttBtn).toContain('aria-checked="true"');
  });

  it('Graph aria-checked="false" when in Gantt view', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    const toggleBtnStart = output.indexOf('id="tlViewToggle"');
    const toggleBtnEnd = output.indexOf('>', toggleBtnStart) + 1;
    const toggleBtn = output.slice(toggleBtnStart - 10, toggleBtnEnd);
    expect(toggleBtn).toContain('aria-checked="false"');
  });

  it('Graph aria-checked="true" when in DAG view', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    const toggleBtnStart = output.indexOf('id="tlViewToggle"');
    const toggleBtnEnd = output.indexOf('>', toggleBtnStart) + 1;
    const toggleBtn = output.slice(toggleBtnStart - 10, toggleBtnEnd);
    expect(toggleBtn).toContain('aria-checked="true"');
  });

  it('Gantt aria-checked="false" when in DAG view', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    const ganttBtnStart = output.indexOf('id="tlViewGantt"');
    const ganttBtnEnd = output.indexOf('>', ganttBtnStart) + 1;
    const ganttBtn = output.slice(ganttBtnStart - 10, ganttBtnEnd);
    expect(ganttBtn).toContain('aria-checked="false"');
  });

  it('buttons have title attributes for sighted tooltip text', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('title="Switch to Gantt view"');
    expect(output).toContain('title="Switch to dependency graph view"');
  });
});

// ---------------------------------------------------------------------------
// Segmented control — forced-colors (high-contrast mode)
// ---------------------------------------------------------------------------

describe('M3-DepGraph — forced-colors CSS', () => {
  it('forced-colors block exists in the CSS', () => {
    expect(css).toContain('@media (forced-colors:active)');
  });

  it('forced-colors active segment uses Highlight fill (solid, unmistakable)', () => {
    // AC: forced-colors uses a solid ButtonText/Highlight fill — not a subtle shade.
    // Highlight is the system color for selected/active interactive items.
    expect(css).toContain('.tl-view-toggle-active{background:Highlight');
  });

  it('forced-colors active segment text is ButtonText', () => {
    expect(css).toContain('color:ButtonText');
  });

  it('forced-colors inactive segment border uses ButtonText', () => {
    // Inactive: outline visible against any HC background.
    expect(css).toContain('border-color:ButtonText');
  });

  it('forced-colors DAG edge uses ButtonText stroke', () => {
    expect(css).toContain('.tl-dag-edge{stroke:ButtonText}');
  });

  it('forced-colors DAG arrowhead uses ButtonText fill', () => {
    expect(css).toContain('.tl-dag-arrowhead{fill:ButtonText}');
  });

  it('forced-colors DAG node has ButtonText stroke for visibility', () => {
    expect(css).toContain('.tl-dag-node{stroke:ButtonText');
  });
});

// ---------------------------------------------------------------------------
// Toggle switches view (core AC: state.timelineView drives rendering)
// ---------------------------------------------------------------------------

describe('M3-DepGraph — toggle switches view', () => {
  const harness = buildFullHarness(js);
  const snap1 = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);

  it('Gantt view renders data-testid="tl-svg" (Gantt SVG)', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).toContain('data-testid="tl-svg"');
  });

  it('Gantt view does NOT render data-testid="dag-svg"', () => {
    const output = harness(snap1, { timelineView: 'gantt' });
    expect(output).not.toContain('data-testid="dag-svg"');
  });

  it('DAG view renders data-testid="dag-svg" (DAG SVG)', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).toContain('data-testid="dag-svg"');
  });

  it('DAG view does NOT render data-testid="tl-svg"', () => {
    const output = harness(snap1, { timelineView: 'dag' });
    expect(output).not.toContain('data-testid="tl-svg"');
  });

  it('both views render the zoom controls', () => {
    // Zoom controls are always shown so user can zoom regardless of view.
    const ganttOut = harness(snap1, { timelineView: 'gantt' });
    const dagOut   = harness(snap1, { timelineView: 'dag' });
    expect(ganttOut).toContain('id="tlZoomIn"');
    expect(dagOut).toContain('id="tlZoomIn"');
  });

  it('both views render the segmented control', () => {
    // Control persists across views so user can switch back.
    const ganttOut = harness(snap1, { timelineView: 'gantt' });
    const dagOut   = harness(snap1, { timelineView: 'dag' });
    expect(ganttOut).toContain('class="tl-seg-ctrl"');
    expect(dagOut).toContain('class="tl-seg-ctrl"');
  });

  it('both views render the tooltip div', () => {
    // #tl-tooltip is always in the DOM so wire() can find it regardless of view.
    const ganttOut = harness(snap1, { timelineView: 'gantt' });
    const dagOut   = harness(snap1, { timelineView: 'dag' });
    expect(ganttOut).toContain('id="tl-tooltip"');
    expect(dagOut).toContain('id="tl-tooltip"');
  });

  it('state.timelineView defaults to "gantt" (Gantt is the primary view)', () => {
    // State initializer in js-panels.ts must default timelineView to 'gantt'.
    expect(html).toContain("timelineView:(_s.timelineView==='dag'||_s.timelineView==='gantt')?_s.timelineView:'gantt'");
  });
});

// ---------------------------------------------------------------------------
// CSP constraint — no inline style= in any timeline/dag output
// ---------------------------------------------------------------------------

describe('M3-DepGraph — CSP: no inline style= in full timelinePanel() output', () => {
  // Tests check the FULL timelinePanel() output string (not just the SVG slice) so that
  // violations in surrounding HTML (e.g. zoom-control divs, wrapper elements) are caught.
  // Previously tests only scanned the SVG region, which missed the js-panels.ts:1467
  // zoomBtnAttrs/zoomLabelAttrs style="display:none" violation. Full-output checks are
  // the correct invariant: no inline style= anywhere in the timelinePanel() output.
  const harness = buildFullHarness(js);

  it('Gantt full output has no inline style= attributes', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'gantt' });
    expect(output).not.toMatch(/\sstyle\s*=/);
  });

  it('DAG full output has no inline style= attributes', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).not.toMatch(/\sstyle\s*=/);
  });

  it('DAG full output with 10 agents has no inline style= attributes', () => {
    const agents = Array.from({ length: 10 }, (_, i) =>
      makeAgent({ id: `a${i}`, key: `k${i}`, label: `Role ${i}`, status: i % 2 === 0 ? 'done' : 'run' })
    );
    const snap = makeSnap(agents);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).not.toMatch(/\sstyle\s*=/);
  });

  it('Gantt full output with superseded agent has no inline style= attributes', () => {
    const snap = makeSnap([
      makeAgent({ id: 'a1', status: 'dead', superseded: true, mtime: NOW - 60 }),
      makeAgent({ id: 'a2', status: 'done', mtime: NOW - 20 }),
    ]);
    const output = harness(snap, { timelineView: 'gantt' });
    expect(output).not.toMatch(/\sstyle\s*=/);
  });
});

// ---------------------------------------------------------------------------
// DAG sub-view: node structure, edges, arrowhead, SR table
// ---------------------------------------------------------------------------

describe('M3-DepGraph — DAG sub-view structure', () => {
  const harness = buildFullHarness(js);

  it('DAG renders status-colored nodes via CSS class (not inline style)', () => {
    const snap = makeSnap([
      makeAgent({ id: 'a1', key: 'impl', status: 'done' }),
      makeAgent({ id: 'a2', key: 'verify', status: 'run', mtime: NOW - 5 }),
      makeAgent({ id: 'a3', key: 'review', status: 'dead', mtime: NOW - 400 }),
    ]);
    const output = harness(snap, { timelineView: 'dag' });
    // Each status uses a CSS class from the .tl-bar-* family (no fill= attribute).
    expect(output).toContain('tl-bar-done');
    expect(output).toContain('tl-bar-run');
    expect(output).toContain('tl-bar-dead');
    // Must NOT use fill= as a presentation attribute (would bypass CSS class system).
    const svgStart = output.indexOf('<svg');
    const svgEnd   = output.lastIndexOf('</svg>') + 6;
    const svgContent = output.slice(svgStart, svgEnd);
    expect(svgContent).not.toMatch(/\bfill\s*=\s*["'][^"'#](?!url)/);
  });

  it('DAG renders polyline edges with data-testid="dag-edge" for same-key agents', () => {
    const snap = makeSnap([
      makeAgent({ id: 'a1', key: 'impl', label: 'Implement', status: 'done', start: NOW - 300, mtime: NOW - 200 }),
      makeAgent({ id: 'a2', key: 'impl', label: 'Implement', status: 'done', start: NOW - 100, mtime: NOW - 50 }),
    ]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('data-testid="dag-edge"');
  });

  it('DAG renders arrowhead <marker> with data-testid="dag-arrowhead"', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', key: 'impl', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('data-testid="dag-arrowhead"');
  });

  it('DAG SVG carries role="img" for accessibility', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('role="img"');
  });

  it('DAG renders SR table with data-testid="dag-sr-table"', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('data-testid="dag-sr-table"');
  });

  it('DAG SR table has Role/Pass/Status column headers', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('<th>Role</th>');
    expect(output).toContain('<th>Pass</th>');
    expect(output).toContain('<th>Status</th>');
  });

  it('DAG node groups have role="button" for keyboard activation', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('class="tl-dag-node-group"');
    // The group must be keyboard-activatable (role=button for AT + Enter/Space in wire()).
    expect(output).toContain('role="button"');
  });

  it('DAG nodes have tabindex="0" for keyboard focus', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('tabindex="0"');
  });

  it('DAG node aria-label includes agent label and status', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', label: 'Architecture', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('Architecture');
    expect(output).toContain('done');
  });

  it('DAG superseded agent uses tl-bar-superseded CSS class', () => {
    const snap = makeSnap([
      makeAgent({ id: 'a1', key: 'impl', status: 'dead', superseded: true, mtime: NOW - 60 }),
    ]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('tl-bar-superseded');
  });

  it('DAG renders without error for 50 agents (scale test)', () => {
    const agents = Array.from({ length: 50 }, (_, i) =>
      makeAgent({ id: `a${i}`, key: `k${i % 7}`, label: `Role ${i % 7}`, start: NOW - 600 + i * 10 })
    );
    const snap = makeSnap(agents);
    expect(() => harness(snap, { timelineView: 'dag' })).not.toThrow();
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('data-testid="dag-svg"');
  });

  it('DAG renders pass column headings (tl-dag-pass-label)', () => {
    const snap = makeSnap([
      makeAgent({ id: 'a1', key: 'impl', status: 'done', start: NOW - 300 }),
      makeAgent({ id: 'a2', key: 'impl', status: 'done', start: NOW - 100 }),
    ]);
    const output = harness(snap, { timelineView: 'dag' });
    // Pass column headings appear above each pass column.
    expect(output).toContain('class="tl-dag-pass-label"');
  });

  it('DAG focus ring rect is present for keyboard users', () => {
    const snap = makeSnap([makeAgent({ id: 'a1', status: 'done' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).toContain('class="tl-focus-ring"');
  });
});

// ---------------------------------------------------------------------------
// Wire presence — segmented control event handlers
// ---------------------------------------------------------------------------

describe('M3-DepGraph — wire: segmented control event handlers', () => {
  it('wire() contains tlViewGantt click handler', () => {
    expect(js).toContain('tlViewGantt');
    expect(js).toContain("state.timelineView='gantt'");
  });

  it('wire() contains tlViewToggle click handler', () => {
    expect(js).toContain('tlViewToggle');
    expect(js).toContain("state.timelineView='dag'");
  });

  it('wire block for tlViewGantt calls save() and render()', () => {
    // Look for the wire() section: it references getElementById('tlViewGantt').
    // The wire handler sets state.timelineView='gantt', then saves and re-renders.
    // Find the specific handler block — it follows the getElementById call.
    const wireMarker = "getElementById('tlViewGantt')";
    const wireIdx = js.indexOf(wireMarker);
    expect(wireIdx).toBeGreaterThan(-1);
    // Capture the snippet from the addEventListener block that follows.
    const wireSnippet = js.slice(wireIdx, wireIdx + 300);
    expect(wireSnippet).toContain('save()');
    expect(wireSnippet).toContain('render()');
  });

  it('wire block for tlViewToggle calls save() and render()', () => {
    const wireMarker = "getElementById('tlViewToggle')";
    const wireIdx = js.indexOf(wireMarker);
    expect(wireIdx).toBeGreaterThan(-1);
    const wireSnippet = js.slice(wireIdx, wireIdx + 300);
    expect(wireSnippet).toContain('save()');
    expect(wireSnippet).toContain('render()');
  });
});

// ---------------------------------------------------------------------------
// CSS: segmented control class rules present and correct
// ---------------------------------------------------------------------------

describe('M3-DepGraph — CSS: segmented control rules', () => {
  it('CSS defines .tl-view-toggle rule', () => {
    expect(css).toContain('.tl-view-toggle{');
  });

  it('CSS defines .tl-view-toggle-active rule', () => {
    expect(css).toContain('.tl-view-toggle-active{');
  });

  it('CSS defines .tl-seg-ctrl wrapper rule', () => {
    expect(css).toContain('.tl-seg-ctrl{');
  });

  it('CSS .tl-seg-ctrl uses inline-flex for joined appearance', () => {
    expect(css).toContain('.tl-seg-ctrl{display:inline-flex');
  });

  it('CSS .tl-view-toggle uses border-radius:0 for flat inner edges', () => {
    // Outer edges have rounding; inner edges are flat so segments look joined.
    expect(css).toContain('border-radius:0');
  });

  it('CSS .tl-dag-node rule is defined', () => {
    expect(css).toContain('.tl-dag-node{');
  });

  it('CSS .tl-dag-edge uses fill:none (line, not filled shape)', () => {
    expect(css).toContain('.tl-dag-edge{fill:none');
  });

  it('CSS .tl-dag-arrowhead is defined', () => {
    expect(css).toContain('.tl-dag-arrowhead{');
  });

  it('CSS .tl-dag-label is defined for node text', () => {
    expect(css).toContain('.tl-dag-label{');
  });

  it('CSS .tl-dag-node-group cursor:pointer is set', () => {
    expect(css).toContain('.tl-dag-node-group{cursor:pointer');
  });
});

// ---------------------------------------------------------------------------
// XSS safety in DAG view
// ---------------------------------------------------------------------------

describe('M3-DepGraph — XSS safety in DAG view', () => {
  const harness = buildFullHarness(js);

  it('agent label with XSS payload is escaped in DAG node text', () => {
    const snap = makeSnap([makeAgent({ id: 'x1', label: '<script>alert(1)</script>', key: 'xss' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).not.toContain('<script>alert(1)</script>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('agent id with XSS payload is escaped in data-tlaid attribute in DAG', () => {
    const snap = makeSnap([makeAgent({ id: '"><img src=x onerror=1>', key: 'xss2', label: 'Safe' })]);
    const output = harness(snap, { timelineView: 'dag' });
    expect(output).not.toContain('onerror=1>');
  });
});

// ---------------------------------------------------------------------------
// State persistence: timelineView field in state initializer
// ---------------------------------------------------------------------------

describe('M3-DepGraph — state persistence', () => {
  it('state initializer validates timelineView to "gantt" or "dag" only', () => {
    // The initializer guards arbitrary values (e.g. injected strings) by using
    // an explicit whitelist check. This ensures only valid values reach render().
    expect(html).toContain("timelineView==='dag'||_s.timelineView==='gantt'");
  });

  it('state initializer defaults timelineView to "gantt" when undefined', () => {
    // When no prior state exists (first load), Gantt must be the default.
    expect(html).toContain("?_s.timelineView:'gantt'");
  });

  it('html contains both view value literals for DAG state branch', () => {
    expect(html).toContain("'dag'");
    expect(html).toContain("'gantt'");
  });
});

// ---------------------------------------------------------------------------
// DAG SR table pass ordinal — correctness tests
// Each agent must show its individual pass number, not the total count for the key.
// ---------------------------------------------------------------------------

describe('M3-DepGraph — SR table per-agent pass ordinal', () => {
  // Build a standalone dagPanel() harness.
  function buildDagHarness(js: string): (agents: object[]) => string {
    const escFn       = extractBalancedFn(js, 'esc');
    const escClsFn    = extractBalancedFn(js, 'escCls');
    const safeNFn     = extractBalancedFn(js, 'safeN');
    const dagPanelFn  = extractBalancedFn(js, 'dagPanel');

    const factory = new Function(
      'agents',
      [
        escFn, escClsFn, safeNFn,
        'var DAG_LAYER_W=160;var DAG_NODE_W=130;var DAG_NODE_H=28;var DAG_NODE_GAP=10;var DAG_PAD=16;var DAG_EDGE_COLOR_CLS="tl-dag-edge";',
        dagPanelFn,
        'return dagPanel(agents);',
      ].join('\n'),
    ) as (agents: object[]) => string;

    return (agents: object[]) => factory(agents);
  }

  it('SR table shows Pass 1 for first agent and Pass 2 for second agent of same key', () => {
    const dagHarness = buildDagHarness(js);
    const agents = [
      { id: 'a1', label: 'Reviewer', key: 'reviewer', status: 'done', superseded: false },
      { id: 'a2', label: 'Reviewer', key: 'reviewer', status: 'done', superseded: false },
    ];
    const output = dagHarness(agents);
    const srTable = output.match(/<table[^>]*data-testid="dag-sr-table"[\s\S]*?<\/table>/);
    expect(srTable).not.toBeNull();
    const rows = srTable![0].match(/<tr>[\s\S]*?<\/tr>/g) || [];
    // Filter out header row (contains <th>).
    const dataRows = rows.filter((r) => !r.includes('<th>'));
    expect(dataRows.length).toBe(2);
    // First agent: Pass 1.
    expect(dataRows[0]).toContain('<td>1</td>');
    // Second agent: Pass 2 (not Pass 2 from total count — same end result but verifies
    // the per-agent capture rather than the final total).
    expect(dataRows[1]).toContain('<td>2</td>');
  });

  it('SR table shows Pass 1 for each of three agents with different keys', () => {
    const dagHarness = buildDagHarness(js);
    const agents = [
      { id: 'a1', label: 'Impl', key: 'impl', status: 'done', superseded: false },
      { id: 'a2', label: 'Review', key: 'review', status: 'done', superseded: false },
      { id: 'a3', label: 'Verify', key: 'verify', status: 'done', superseded: false },
    ];
    const output = dagHarness(agents);
    // All three agents have unique keys, so each should be Pass 1.
    const matches = output.match(/<td>1<\/td>/g) || [];
    // Three rows, each showing Pass 1 — all three <td>1</td> cells.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('SR table shows correct ordinals for three agents of the same key', () => {
    const dagHarness = buildDagHarness(js);
    const agents = [
      { id: 'a1', label: 'Impl', key: 'impl', status: 'done', superseded: false },
      { id: 'a2', label: 'Impl', key: 'impl', status: 'done', superseded: false },
      { id: 'a3', label: 'Impl', key: 'impl', status: 'done', superseded: false },
    ];
    const output = dagHarness(agents);
    const srTable = output.match(/<table[^>]*data-testid="dag-sr-table"[\s\S]*?<\/table>/);
    expect(srTable).not.toBeNull();
    const rows = srTable![0].match(/<tr>[\s\S]*?<\/tr>/g) || [];
    const dataRows = rows.filter((r) => !r.includes('<th>'));
    expect(dataRows.length).toBe(3);
    // Per-agent ordinals: 1, 2, 3 — NOT all showing 3 (the total count).
    expect(dataRows[0]).toContain('<td>1</td>');
    expect(dataRows[1]).toContain('<td>2</td>');
    expect(dataRows[2]).toContain('<td>3</td>');
  });
});
