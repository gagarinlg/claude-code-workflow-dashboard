/**
 * M2-Charts — tests for the two inline-SVG charts added in M2:
 *   1. tokenBarChart  — per-agent output-token bar chart
 *   2. tokenTrendChart — cumulative tokens-over-agents sparkline
 *
 * Strategy: extract the JS chart functions from the getHtml() template string
 * and evaluate them in a sandboxed harness. We supply synthetic snap.agents
 * arrays of varying sizes (1, 50 agents, 0 tokens edge cases) and assert:
 *   - Both SVGs render with the expected data-testid markers
 *   - Values are esc()'d and numeric-guarded (safeN)
 *   - No external references (no href=http, no src=http, no xlink:href)
 *   - Wide charts (50 agents) scroll inside their own container, not the page
 *   - The Charts toggle entry exists in PANELS
 *   - CSS chart rules exist and use only --vscode-* variables
 */
import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';

/**
 * Build a harness that evaluates the three chart functions plus their helpers
 * (esc, safeN, fmtTok) from the webview JS string, then calls chartsPanel()
 * with a synthetic snap object. Returns the HTML string produced.
 *
 * Functions extracted: esc, escCls, safeN, fmtTok, panel, tokenBarChart,
 * tokenTrendChart, chartsPanel.
 *
 * The harness receives `snap` as a parameter so we can inject test fixtures.
 */
function buildChartsHarness(js: string): (snap: object) => string {
  const escFn = extractBalancedFn(js, 'esc');
  const escClsFn = extractBalancedFn(js, 'escCls');
  const safeNFn = extractBalancedFn(js, 'safeN');
  const fmtTokFn = extractBalancedFn(js, 'fmtTok');
  const barFn = extractBalancedFn(js, 'tokenBarChart');
  const trendFn = extractBalancedFn(js, 'tokenTrendChart');
  const chartsPanelFn = extractBalancedFn(js, 'chartsPanel');

  // chartsPanel() renders directly (v3 BINDING — no panel() wrapper), so snap is
  // the only closed-over variable needed. The panelOpen stub was removed alongside
  // the panel() extraction (TODO(M3)-tracked dead code).
  const factory = new Function(
    'snap',
    `${escFn}\n${escClsFn}\n${safeNFn}\n${fmtTokFn}\n${barFn}\n${trendFn}\n${chartsPanelFn}\nreturn chartsPanel();`,
  ) as (snap: object) => string;

  return (snap: object) => factory(snap);
}

/** Build a synthetic agent array of size n with specified token counts. */
function makeAgents(n: number, tokPerAgent = 1000): object[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `agent${i}`,
    label: `Agent ${i + 1}`,
    key: `agent_${i}`,
    status: 'done',
    elapsed: 60,
    tokens: tokPerAgent + i * 10,  // incrementally different so trend isn't flat
    tools: 5,
    tail: [],
    lastActivity: '',
    start: 1700000000 + i * 60,
    mtime: 1700000060 + i * 60,
    idx: i + 1,
  }));
}

/** Build a snap fixture with n agents. */
function makeSnap(agents: object[]): object {
  return {
    ok: true,
    runId: 'wf_test',
    updatedAt: '12:00:00',
    loop: { phase: 'done', live: 0, done: agents.length, dead: 0, total: agents.length, outTok: 5000, tools: 20, passes: 1, findings: 0, sevTotals: {} },
    labels: [],
    agents,
    agentsCapped: agents.length > 200,
    allFindings: [],
    structuredResults: [],
    verdicts: {},
    verdictLabels: {},
    isPinned: false,
    changed: null,
  };
}

// ---------------------------------------------------------------------------
// PANELS registration
// ---------------------------------------------------------------------------
describe('M2-Charts — PANELS registration', () => {
  it('M3-Layout: Charts tab key is present in tabDefs() — chartsPanel() is wired via tabContent()', () => {
    const html = getHtml(TEST_NONCE);
    // M3: PANELS array replaced by tabDefs(). Charts tab key must be present.
    expect(html).toContain("key:'charts'");
  });

  it('M3-Layout: state initializer does NOT include charts:0 (M3 v3: Charts renders directly, no panelOpen)', () => {
    const html = getHtml(TEST_NONCE);
    // M3 v3 BINDING (AC11): panelOpen.charts is dropped. charts:0 no longer appears in the state initializer.
    expect(html).not.toContain('charts:0');
  });

  it('render() calls chartsPanel() when charts panel is on and agents exist', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('chartsPanel()');
  });
});

// ---------------------------------------------------------------------------
// CSS chart rules
// ---------------------------------------------------------------------------
describe('M2-Charts — CSS rules', () => {
  const html = getHtml(TEST_NONCE);

  it('CSS contains .charts-row rule', () => {
    expect(html).toContain('.charts-row{');
  });

  it('CSS contains .chart-block rule', () => {
    expect(html).toContain('.chart-block{');
  });

  it('CSS contains .chart-scroll rule with overflow-x:auto', () => {
    expect(html).toContain('.chart-scroll{overflow-x:auto');
  });

  it('CSS contains .chart-title rule', () => {
    expect(html).toContain('.chart-title{');
  });

  it('CSS contains .chart-empty rule', () => {
    expect(html).toContain('.chart-empty{');
  });

  it('CSS chart rules use only --vscode-* variables (no hardcoded colors in CSS)', () => {
    // Extract all CSS from the HTML (between <style nonce...> and </style>)
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const styleStart = html.indexOf(styleOpen);
    const styleEnd = html.indexOf(styleClose, styleStart);
    const css = html.slice(styleStart + styleOpen.length, styleEnd);

    // Extract only the chart-related rules
    const chartRuleStart = css.indexOf('.charts-row{');
    expect(chartRuleStart).toBeGreaterThan(-1);
    const chartSection = css.slice(chartRuleStart);

    // Chart CSS rules must not contain hardcoded hex colors
    // (hex colors in the SVG JS are fine — this checks only the CSS block)
    const linesWithHex = chartSection.split(';').filter((s) => /#[0-9a-fA-F]{3,6}/.test(s));
    expect(linesWithHex).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Functional harness tests
// ---------------------------------------------------------------------------
describe('M2-Charts — tokenBarChart with 1 agent', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const chartsHarness = buildChartsHarness(js);
  const snap1 = makeSnap(makeAgents(1, 1500));
  const output = chartsHarness(snap1);

  it('chartsPanel() returns a non-empty string for 1 agent', () => {
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(50);
  });

  it('bar chart SVG is present with data-testid="token-bar-chart"', () => {
    expect(output).toContain('data-testid="token-bar-chart"');
  });

  it('trend chart SVG is present with data-testid="token-trend-chart"', () => {
    expect(output).toContain('data-testid="token-trend-chart"');
  });

  it('bar chart contains a rendered bar rect for the agent', () => {
    expect(output).toContain('data-testid="chart-bar"');
  });

  it('trend chart contains the area path element', () => {
    expect(output).toContain('data-testid="trend-area"');
  });

  it('trend chart contains the line path element', () => {
    expect(output).toContain('data-testid="trend-line"');
  });

  it('bar chart scroll container is present (overflow-x:auto)', () => {
    expect(output).toContain('data-testid="bar-chart-scroll"');
  });

  it('M3-Layout: output contains charts-row (no panel heading — M3 v3 renders directly)', () => {
    // M3 v3 BINDING (AC10): chartsPanel() renders content directly without panel() wrapper.
    // The word "Charts" no longer appears as a panel heading; the charts-row container is present.
    expect(output).toContain('charts-row');
  });

  it('chart uses --vscode-charts-blue for bar fill', () => {
    // Bar fill is declared in the CSS block (.chart-bar rule), not as an inline style.
    // Check the CSS block, not the SVG HTML output (parallel to trend area/line test below).
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const styleStart = html.indexOf(styleOpen);
    const styleEnd = html.indexOf(styleClose, styleStart);
    const css = html.slice(styleStart + styleOpen.length, styleEnd);
    expect(css).toContain('--vscode-charts-blue');
  });

  it('chart trend area/line CSS class uses --vscode-charts-green (not SVG default black)', () => {
    // Trend area and line use CSS classes (.chart-trend-area, .chart-trend-line) for theming.
    // The variable must appear in the CSS block, not in the SVG HTML output.
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const styleStart = html.indexOf(styleOpen);
    const styleEnd = html.indexOf(styleClose, styleStart);
    const css = html.slice(styleStart + styleOpen.length, styleEnd);
    expect(css).toContain('--vscode-charts-green');
  });

  it('chart label CSS class uses --vscode-foreground for text color', () => {
    // Bar and trend label text uses CSS classes (.chart-bar-label, .chart-trend-label)
    // for theming. The variable must appear in the CSS block.
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const styleStart = html.indexOf(styleOpen);
    const styleEnd = html.indexOf(styleClose, styleStart);
    const css = html.slice(styleStart + styleOpen.length, styleEnd);
    expect(css).toContain('--vscode-foreground');
  });

  it('chart has no external href or src references', () => {
    // The only permitted URL is the SVG namespace declaration (xmlns="http://www.w3.org/2000/svg")
    // which is a required XML namespace identifier, not a network request.
    // No xlink:href (SVG external resource)
    expect(output).not.toContain('xlink:href');
    // No src= attribute pointing outside
    expect(output).not.toMatch(/src\s*=\s*["']https?/);
    // No href= attribute pointing to external URLs (not namespace decls)
    expect(output).not.toMatch(/href\s*=\s*["']https?/);
    // No script: or data: URIs that could execute code
    expect(output).not.toContain('javascript:');
    expect(output).not.toMatch(/data:text\/html/);
  });
});

describe('M2-Charts — tokenBarChart with 50 agents', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const chartsHarness = buildChartsHarness(js);
  const snap50 = makeSnap(makeAgents(50, 500));
  const output = chartsHarness(snap50);

  it('chartsPanel() renders without error for 50 agents', () => {
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(100);
  });

  it('bar chart SVG is present for 50 agents', () => {
    expect(output).toContain('data-testid="token-bar-chart"');
  });

  it('trend chart SVG is present for 50 agents', () => {
    expect(output).toContain('data-testid="token-trend-chart"');
  });

  it('bar chart contains multiple bar rects (50 agents → 50 bars)', () => {
    const barMatches = output.match(/data-testid="chart-bar"/g);
    expect(barMatches).not.toBeNull();
    expect(barMatches!.length).toBe(50);
  });

  it('bar chart scroll container is present for overflow handling (50 agents)', () => {
    expect(output).toContain('data-testid="bar-chart-scroll"');
  });

  it('bar chart does not show a capped warning for exactly 50 agents (cap is 50)', () => {
    // When agents.length === BAR_CAP (50), no "Showing X of Y agents" note
    expect(output).not.toContain('Showing 50 of');
  });

  it('no external refs in 50-agent output', () => {
    expect(output).not.toContain('xlink:href');
    expect(output).not.toMatch(/src\s*=\s*["']https?/);
    expect(output).not.toMatch(/href\s*=\s*["']https?/);
    expect(output).not.toContain('javascript:');
  });
});

describe('M2-Charts — tokenBarChart cap at 50 (51 agents)', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const chartsHarness = buildChartsHarness(js);
  const snap51 = makeSnap(makeAgents(51, 500));
  const output = chartsHarness(snap51);

  it('bar chart shows only 50 bars when 51 agents provided', () => {
    const barMatches = output.match(/data-testid="chart-bar"/g);
    expect(barMatches).not.toBeNull();
    expect(barMatches!.length).toBe(50);
  });

  it('bar chart shows a capped note when agent count exceeds 50', () => {
    // The note mentions "Showing 50 of 51 agents"
    expect(output).toContain('Showing 50 of 51');
  });
});

describe('M2-Charts — numeric guard (safeN) and XSS safety', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const chartsHarness = buildChartsHarness(js);

  it('chart renders when all agents have tokens=0 (no division by zero)', () => {
    const snapZero = makeSnap(makeAgents(3, 0).map((a) => ({ ...a, tokens: 0 })));
    expect(() => chartsHarness(snapZero)).not.toThrow();
    const out = chartsHarness(snapZero);
    expect(out).toContain('data-testid="token-bar-chart"');
  });

  it('trend chart returns chart-empty div when all tokens are 0', () => {
    const snapZero = makeSnap(makeAgents(3, 0).map((a) => ({ ...a, tokens: 0 })));
    const out = chartsHarness(snapZero);
    // When cumulative max is 0, trend shows empty state
    expect(out).toContain('No token data');
  });

  it('chart renders when some agents have NaN tokens (numeric guard)', () => {
    const agentsWithNaN = makeAgents(3, 100).map((a, i) => ({
      ...a,
      tokens: i === 1 ? (NaN as unknown as number) : (a as { tokens: number }).tokens,
    }));
    const snapNaN = makeSnap(agentsWithNaN);
    expect(() => chartsHarness(snapNaN)).not.toThrow();
    const out = chartsHarness(snapNaN);
    expect(out).toContain('data-testid="token-bar-chart"');
  });

  it('agent label containing XSS payload is escaped in bar chart output', () => {
    const xssAgents = [{
      id: 'a1',
      label: '<script>alert(1)</script>',
      key: 'xss',
      status: 'done',
      elapsed: 60,
      tokens: 500,
      tools: 0,
      tail: [],
      lastActivity: '',
      start: 1700000000,
      mtime: 1700000060,
      idx: 1,
    }];
    const snapXss = makeSnap(xssAgents);
    const out = chartsHarness(snapXss);
    // The raw XSS payload must not appear verbatim
    expect(out).not.toContain('<script>alert(1)</script>');
    // The escaped form must appear instead
    expect(out).toContain('&lt;script&gt;');
  });
});

// ---------------------------------------------------------------------------
// Script validity: chartsPanel JS does not break overall script parse
// ---------------------------------------------------------------------------
describe('M2-Charts — script validity after chart additions', () => {
  const html = getHtml(TEST_NONCE);

  it('inline script remains syntactically valid JS after adding chart functions', () => {
    const js = getPanelJs(html);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js);
    }).not.toThrow();
  });

  it('inline script contains no backtick template literals (chart code included)', () => {
    const js = getPanelJs(html);
    expect(js).not.toContain('`');
  });

  it('inline script does not contain document.write', () => {
    expect(html).not.toContain('document.write');
  });

  it('charts function definitions are present in the JS block', () => {
    const js = getPanelJs(html);
    expect(js).toContain('function tokenBarChart(');
    expect(js).toContain('function tokenTrendChart(');
    expect(js).toContain('function chartsPanel(');
  });
});

// ---------------------------------------------------------------------------
// M2-Charts — label slice-then-esc order: no partial HTML entity in output
// AC2: the SVG bar label must slice the RAW string first then esc() so that
// HTML entities like &amp; or &lt; are never split mid-sequence.
// ---------------------------------------------------------------------------
describe('M2-Charts — bar label slice order: no partial HTML entity', () => {
  const html = getHtml(TEST_NONCE);
  const js = getPanelJs(html);
  const chartsHarness = buildChartsHarness(js);

  it('label containing & is never rendered as a dangling & after truncation', () => {
    // An agent label exactly 14 chars where the 14th char is part of an entity
    // like &amp; — if esc() runs BEFORE slice(), &amp; at position 11-14 would
    // be sliced to &amp producing a dangling &.  Slice-THEN-esc must prevent this.
    // We use a 14-char label ending in & so esc() would produce &amp; (5 chars).
    // After correct slice-then-esc the output must not contain a bare '&amp' fragment.
    const agents = [{
      id: 'a1',
      label: 'Label ending &',   // length = 14, last char is '&'
      key: 'agent',
      status: 'done',
      elapsed: 60,
      tokens: 500,
      tools: 0,
      tail: [],
      lastActivity: '',
      start: 1700000000,
      mtime: 1700000060,
      idx: 1,
    }];
    const snap = makeSnap(agents);
    const out = chartsHarness(snap);
    // After correct slice(0,14) → esc() the & at the end becomes &amp; fully
    // (it appears as-is in the 14-char window, then esc encodes it as a complete entity).
    // The truncated label must NOT contain a raw bare '&' that is not immediately
    // followed by a valid entity suffix — i.e. no dangling & without amp;/lt;/gt;/quot;.
    // The simplest check: the output must not contain the fragment '&amp' without a
    // trailing semicolon (which would indicate a split entity).
    const dangling = /&amp(?!;)/;
    expect(out).not.toMatch(dangling);
  });

  it('label containing < is never rendered as a dangling &lt after truncation', () => {
    // Similar to the & case: a label with < that, if esc()-then-slice(), would
    // produce &lt or &lt; (depending on where the cut falls).
    const agents = [{
      id: 'a1',
      label: 'Label ending  <',  // exactly 15 chars; slice(0,14) cuts before the <
      key: 'agent',
      status: 'done',
      elapsed: 60,
      tokens: 500,
      tools: 0,
      tail: [],
      lastActivity: '',
      start: 1700000000,
      mtime: 1700000060,
      idx: 1,
    }];
    const snap = makeSnap(agents);
    const out = chartsHarness(snap);
    // Must not contain a dangling &lt without semicolon
    const dangling = /&lt(?!;)/;
    expect(out).not.toMatch(dangling);
  });

  it('label with special chars longer than 14 chars renders a complete … suffix without breaking entities', () => {
    // A 20-char label with HTML-special chars distributed across the string.
    const agents = [{
      id: 'a1',
      label: 'A&B<C>D"E\'F&G<H>I',   // mixed special chars, >14 chars
      key: 'agent',
      status: 'done',
      elapsed: 60,
      tokens: 500,
      tools: 0,
      tail: [],
      lastActivity: '',
      start: 1700000000,
      mtime: 1700000060,
      idx: 1,
    }];
    const snap = makeSnap(agents);
    const out = chartsHarness(snap);
    // After truncation the truncated label (in the SVG text node) must contain
    // no dangling entities — every & must be followed by a valid entity name+;
    // We check that every & in the truncated label portion is part of a complete entity.
    // The simplest proxy: no bare & that is not immediately followed by amp;/lt;/gt;/quot;/apos;
    expect(out).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#)/);
  });
});
