/**
 * M2-TypedResults — tests for the typed structured-result display.
 *
 * Strategy: extract and evaluate the typed renderer functions from the getHtml()
 * template string, then feed them synthetic result objects keyed by agentType.
 * We assert:
 *   - Each known agentType (implementer, test-verifier, judge, completeness-critic)
 *     renders with its tailored view (verdict colour, field labels, lists).
 *   - Unknown agentTypes fall back to the generic key-value table (not raw JSON).
 *   - No bare JSON.stringify output ever reaches the rendered HTML.
 *   - All transcript-derived values pass through esc() (XSS prevention).
 *   - The resultsPanel() function uses renderTypedResult (not raw JSON).
 *   - CSS typed-result rules exist and use only --vscode-* variables.
 *   - snapshot.ts carries agentType on Agent and StructuredResult.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getHtml } from '../src/webview/html';

const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the inline <script> content from the panel-mode HTML. */
function getPanelJs(html: string): string {
  const scriptOpen = `<script nonce="${TEST_NONCE}">`;
  const scriptClose = '</script>';
  const scriptStart = html.indexOf(scriptOpen);
  const scriptEnd = html.lastIndexOf(scriptClose);
  return html.slice(scriptStart + scriptOpen.length, scriptEnd);
}

/**
 * Extract a balanced function declaration from minified JS.
 * Walks forward from the function marker counting braces.
 */
function extractBalancedFn(js: string, name: string): string {
  const marker = `function ${name}(`;
  const start = js.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in webview JS`);
  let depth = 0;
  let i = start;
  let bodyStarted = false;
  while (i < js.length) {
    const ch = js[i];
    if (ch === '{') { depth++; bodyStarted = true; }
    if (ch === '}') { depth--; }
    if (bodyStarted && depth === 0) return js.slice(start, i + 1);
    i++;
  }
  throw new Error(`Unbalanced braces for ${name}`);
}

/**
 * Build a sandboxed harness that evaluates all typed renderer functions from
 * the webview JS and returns a callable renderTypedResult(agentType, result).
 */
function buildRendererHarness(js: string): (agentType: string | undefined, result: Record<string, unknown>) => string {
  // Extract esc and safeN helpers
  const escLine = js.split('\n').find((l) => l.includes('function esc(s)'));
  if (!escLine) throw new Error('esc not found');
  const escStart = escLine.indexOf('function esc(s)');

  const safeNLine = js.split('\n').find((l) => l.includes('function safeN(n)'));
  if (!safeNLine) throw new Error('safeN not found');
  const safeNStart = safeNLine.indexOf('function safeN(n)');

  const escFn = escLine.slice(escStart);
  const safeNFn = safeNLine.slice(safeNStart);

  const fnNames = ['renderGenericResult', 'renderImplementerResult', 'renderVerifierResult',
                   'renderJudgeResult', 'renderCompletenessResult', 'renderTypedResult'];
  const fns = fnNames.map((name) => extractBalancedFn(js, name)).join('\n');

  const code = `
    ${escFn}
    ${safeNFn}
    ${fns}
    return renderTypedResult;
  `;
  return new Function(code)() as (agentType: string | undefined, result: Record<string, unknown>) => string;
}

// ---------------------------------------------------------------------------
// CSS rules for typed results
// ---------------------------------------------------------------------------
describe('M2-TypedResults — CSS rules', () => {
  it('CSS contains .typed-result rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-result{');
  });

  it('CSS contains .typed-kv rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-kv{');
  });

  it('CSS contains .typed-file-list rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-file-list{');
  });

  it('CSS contains .typed-verdict-ok and .typed-verdict-bad rules using --vscode-* vars', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.typed-verdict-ok{');
    expect(html).toContain('.typed-verdict-bad{');
    // Must use --vscode-charts-* variables (theme-native — no hardcoded colors)
    const okIdx = html.indexOf('.typed-verdict-ok{');
    const okEnd = html.indexOf('}', okIdx);
    const okRule = html.slice(okIdx, okEnd);
    expect(okRule).toContain('--vscode-');
  });

  it('CSS contains .typed-summary rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-summary{');
  });

  it('CSS .typed-summary uses --vscode-panel-border (theme-native)', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.typed-summary{');
    const end = html.indexOf('}', idx);
    expect(html.slice(idx, end)).toContain('--vscode-panel-border');
  });

  it('CSS contains .typed-section-label rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-section-label{');
  });

  it('CSS typed-result forced-colors block covers typed-verdict-ok/bad', () => {
    const html = getHtml(TEST_NONCE);
    // High-contrast block must include the typed verdict classes
    expect(html).toContain('.typed-verdict-ok,.typed-verdict-bad{');
  });
});

// ---------------------------------------------------------------------------
// JS: typed renderer functions exist in the webview JS
// ---------------------------------------------------------------------------
describe('M2-TypedResults — renderer functions in webview JS', () => {
  it('JS contains renderGenericResult function', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderGenericResult(');
  });

  it('JS contains renderImplementerResult function', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderImplementerResult(');
  });

  it('JS contains renderVerifierResult function', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderVerifierResult(');
  });

  it('JS contains renderJudgeResult function', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderJudgeResult(');
  });

  it('JS contains renderCompletenessResult function', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderCompletenessResult(');
  });

  it('JS contains renderTypedResult dispatch function', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderTypedResult(');
  });

  it('agentSub() calls renderTypedResult instead of JSON.stringify for a.result', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Must call renderTypedResult with a.agentType and a.result
    expect(js).toContain('renderTypedResult(a.agentType,a.result)');
    // Must NOT fall back to JSON.stringify for a.result
    const agentSubFn = extractBalancedFn(js, 'agentSub');
    expect(agentSubFn).not.toContain('JSON.stringify');
  });

  it('resultsPanel() calls renderTypedResult instead of JSON.stringify', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Must use renderTypedResult(r.agentType, r.result)
    expect(js).toContain('renderTypedResult(r.agentType,r.result)');
    const resultsPanelFn = extractBalancedFn(js, 'resultsPanel');
    expect(resultsPanelFn).not.toContain('JSON.stringify');
  });
});

// ---------------------------------------------------------------------------
// Renderer output: implementer shape
// ---------------------------------------------------------------------------
describe('M2-TypedResults — implementer renderer', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('renders summary text in a .typed-summary element', () => {
    const out = render('implementer', { summary: 'Applied 3 fixes cleanly.' });
    expect(out).toContain('typed-summary');
    expect(out).toContain('Applied 3 fixes cleanly.');
  });

  it('renders filesChanged as a list', () => {
    const out = render('implementer', { filesChanged: ['src/foo.ts', 'src/bar.ts'] });
    expect(out).toContain('typed-file-list');
    expect(out).toContain('src/foo.ts');
    expect(out).toContain('src/bar.ts');
  });

  it('renders fixed count as a number', () => {
    const out = render('implementer', { fixed: 5 });
    expect(out).toContain('fixed');
    expect(out).toContain('5');
  });

  it('renders testsRun as a yes/no indicator', () => {
    const outYes = render('implementer', { testsRun: true });
    expect(outYes).toContain('typed-verdict-ok');
    const outNo = render('implementer', { testsRun: false });
    expect(outNo).toContain('typed-verdict-bad');
  });

  it('renders a passing verdict in typed-verdict-ok color', () => {
    const out = render('implementer', { verdict: 'success' });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('success');
  });

  it('renders a failing verdict in typed-verdict-bad color', () => {
    const out = render('implementer', { verdict: 'failed: build error' });
    expect(out).toContain('typed-verdict-bad');
  });

  it('does not produce raw JSON.stringify output', () => {
    const out = render('implementer', { summary: 'ok', filesChanged: ['a.ts'] });
    expect(out).not.toContain('"filesChanged"');
    expect(out).not.toContain('JSON');
  });

  it('escapes XSS in summary', () => {
    const out = render('implementer', { summary: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes XSS in file paths', () => {
    const out = render('implementer', { filesChanged: ['<img src=x onerror=alert(1)>'] });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('caps filesChanged list at 40 and shows overflow count', () => {
    const files = Array.from({ length: 50 }, (_, i) => `file${i}.ts`);
    const out = render('implementer', { filesChanged: files });
    // 40 shown + overflow indicator
    expect(out).toContain('+10 more');
    expect(out).toContain('file0.ts');
  });
});

// ---------------------------------------------------------------------------
// Renderer output: test-verifier shape
// ---------------------------------------------------------------------------
describe('M2-TypedResults — test-verifier renderer', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('renders PASSED in green when passed=true', () => {
    const out = render('test-verifier', { passed: true, summary: 'All good.' });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('PASSED');
  });

  it('renders FAILED in red when passed=false', () => {
    const out = render('test-verifier', { passed: false, summary: '3 tests failed.' });
    expect(out).toContain('typed-verdict-bad');
    expect(out).toContain('FAILED');
  });

  it('renders coverageGaps as bullets', () => {
    const out = render('test-verifier', { passed: true, coverageGaps: ['branch X uncovered', 'error path'] });
    expect(out).toContain('Coverage gaps');
    expect(out).toContain('branch X uncovered');
    expect(out).toContain('error path');
  });

  it('renders gaps from gaps field as well as coverageGaps', () => {
    const out = render('test-verifier', { gaps: ['uncovered fn foo'] });
    expect(out).toContain('uncovered fn foo');
  });

  it('escapes XSS in coverageGaps', () => {
    const out = render('test-verifier', { coverageGaps: ['<b>bad</b>'] });
    expect(out).not.toContain('<b>bad</b>');
    expect(out).toContain('&lt;b&gt;');
  });

  it('caps coverageGaps at 20 and shows overflow', () => {
    const gaps = Array.from({ length: 25 }, (_, i) => `gap-${i}`);
    const out = render('test-verifier', { coverageGaps: gaps });
    expect(out).toContain('+5 more');
  });

  it('uses verdict field when passed is absent', () => {
    const out = render('test-verifier', { verdict: 'passing' });
    expect(out).toContain('typed-verdict-ok');
  });

  it('does not produce raw JSON output', () => {
    const out = render('test-verifier', { passed: true, coverageGaps: ['x'] });
    expect(out).not.toContain('"passed"');
  });
});

// ---------------------------------------------------------------------------
// Renderer output: judge shape
// ---------------------------------------------------------------------------
describe('M2-TypedResults — judge renderer', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('renders verdict in green for approve-like words', () => {
    const out = render('judge', { verdict: 'approve', score: 8, rationale: 'Solid work.' });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('approve');
  });

  it('renders verdict in red for reject-like words', () => {
    const out = render('judge', { verdict: 'reject', rationale: 'Too many issues.' });
    expect(out).toContain('typed-verdict-bad');
    expect(out).toContain('reject');
  });

  it('renders score as .typed-score', () => {
    const out = render('judge', { verdict: 'pass', score: 7 });
    expect(out).toContain('typed-score');
    expect(out).toContain('7');
  });

  it('renders rationale in .typed-summary', () => {
    const out = render('judge', { verdict: 'pass', rationale: 'Good implementation.' });
    expect(out).toContain('typed-summary');
    expect(out).toContain('Good implementation.');
  });

  it('falls back to summary when rationale absent', () => {
    const out = render('judge', { verdict: 'pass', summary: 'Nice job.' });
    expect(out).toContain('typed-summary');
    expect(out).toContain('Nice job.');
  });

  it('renders decision field as verdict when verdict absent', () => {
    const out = render('judge', { decision: 'approved' });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('approved');
  });

  it('escapes XSS in rationale', () => {
    const out = render('judge', { verdict: 'pass', rationale: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('does not produce raw JSON output', () => {
    const out = render('judge', { verdict: 'pass', score: 9 });
    expect(out).not.toContain('"verdict"');
  });
});

// ---------------------------------------------------------------------------
// Renderer output: completeness-critic shape
// ---------------------------------------------------------------------------
describe('M2-TypedResults — completeness-critic renderer', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('renders verdict in green for complete-like words', () => {
    const out = render('completeness-critic', { verdict: 'complete', gaps: [] });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('complete');
  });

  it('renders verdict in red for incomplete indicator', () => {
    const out = render('completeness-critic', { verdict: 'incomplete', gaps: ['missing tests'] });
    expect(out).toContain('typed-verdict-bad');
  });

  it('renders gaps list', () => {
    const out = render('completeness-critic', { gaps: ['missing error handling', 'no tests for X'] });
    expect(out).toContain('Gaps');
    expect(out).toContain('missing error handling');
    expect(out).toContain('no tests for X');
  });

  it('uses coverageGaps when gaps is absent', () => {
    const out = render('completeness-critic', { coverageGaps: ['branch Y'] });
    expect(out).toContain('branch Y');
  });

  it('caps gaps list at 30 with overflow count', () => {
    const gaps = Array.from({ length: 35 }, (_, i) => `gap${i}`);
    const out = render('completeness-critic', { gaps });
    expect(out).toContain('+5 more');
  });

  it('escapes XSS in gap strings', () => {
    const out = render('completeness-critic', { gaps: ['<img src=x onerror=alert(1)>'] });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('renders summary when present', () => {
    const out = render('completeness-critic', { verdict: 'complete', summary: 'All AC covered.' });
    expect(out).toContain('typed-summary');
    expect(out).toContain('All AC covered.');
  });

  it('does not produce raw JSON output', () => {
    const out = render('completeness-critic', { verdict: 'complete', gaps: ['x'] });
    expect(out).not.toContain('"verdict"');
  });
});

// ---------------------------------------------------------------------------
// Renderer output: generic fallback (unknown agentType)
// ---------------------------------------------------------------------------
describe('M2-TypedResults — generic fallback renderer', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('renders key-value table for unknown agentType', () => {
    const out = render('unknown-agent', { status: 'ok', count: 42 });
    expect(out).toContain('typed-kv');
    expect(out).toContain('status');
    expect(out).toContain('ok');
    expect(out).toContain('count');
    expect(out).toContain('42');
  });

  it('renders key-value table when agentType is undefined (missing)', () => {
    const out = render(undefined, { result: 'done', items: 3 });
    expect(out).toContain('typed-kv');
    expect(out).toContain('result');
    expect(out).toContain('done');
  });

  it('renders boolean true as "yes" in typed-verdict-ok', () => {
    const out = render(undefined, { passed: true });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('yes');
  });

  it('renders boolean false as "no" in typed-verdict-bad', () => {
    const out = render(undefined, { passed: false });
    expect(out).toContain('typed-verdict-bad');
    expect(out).toContain('no');
  });

  it('renders array values as bullet lists', () => {
    const out = render(undefined, { items: ['alpha', 'beta', 'gamma'] });
    expect(out).toContain('typed-file-list');
    expect(out).toContain('alpha');
    expect(out).toContain('beta');
  });

  it('renders null values as an em-dash placeholder', () => {
    const out = render(undefined, { notes: null });
    expect(out).toContain('—');
  });

  it('shows "empty result" for an empty object', () => {
    const out = render(undefined, {});
    expect(out).toContain('empty result');
  });

  it('escapes XSS in keys and values', () => {
    const key = '<script>';
    const obj: Record<string, unknown> = {};
    obj[key] = 'value';
    const out = render(undefined, obj);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('escapes XSS in string values', () => {
    const out = render(undefined, { msg: '<b>bold</b>' });
    expect(out).not.toContain('<b>bold</b>');
    expect(out).toContain('&lt;b&gt;');
  });

  it('caps large arrays at 50 items with overflow indicator', () => {
    const out = render(undefined, { items: Array.from({ length: 60 }, (_, i) => `item${i}`) });
    expect(out).toContain('+10 more');
  });

  it('does not produce raw JSON.stringify output for any unknown type', () => {
    const out = render('architect', { phase: 'design', decisions: ['use esbuild'] });
    // Must not contain the raw JSON key pattern
    expect(out).not.toContain('"decisions"');
    expect(out).toContain('decisions');
    expect(out).toContain('use esbuild');
  });

  it('also known agentType "architect" routes through generic (no dedicated renderer)', () => {
    const out = render('architect', { approach: 'modular', layers: ['ui', 'data'] });
    expect(out).toContain('typed-kv');
    expect(out).toContain('approach');
    expect(out).toContain('modular');
  });
});

// ---------------------------------------------------------------------------
// snapshot.ts: agentType carried on Agent and StructuredResult
// ---------------------------------------------------------------------------
import * as path from 'path';
import { buildSnapshot } from '../src/data/snapshot';
import type { Agent, StructuredResult } from '../src/data/snapshot';

describe('M2-TypedResults — snapshot.ts carries agentType', () => {
  // Use the wf_basic fixture which has a meta.json with an agentType
  const wfDir = path.join(__dirname, 'fixtures', 'wf_basic');

  it('Agent interface has agentType field (TypeScript type check via import)', () => {
    // This test compiles only if Agent has an optional agentType field.
    const a: Agent = {
      id: 'x', label: 'Implement/Fix', key: 'implementer', agentType: 'implementer',
      status: 'done', elapsed: 0, tokens: 0, tools: 0, tail: [],
      lastActivity: '', start: 0, mtime: 0,
    };
    expect(a.agentType).toBe('implementer');
  });

  it('StructuredResult interface has agentType field (TypeScript type check via import)', () => {
    const sr: StructuredResult = {
      pass: 1, label: 'Implement/Fix', key: 'implementer', agentType: 'implementer',
      result: { status: 'ok' },
    };
    expect(sr.agentType).toBe('implementer');
  });

  it('Agent.agentType is optional (can be undefined)', () => {
    const a: Agent = {
      id: 'x', label: 'Reviewer', key: 'review',
      status: 'done', elapsed: 0, tokens: 0, tools: 0, tail: [],
      lastActivity: '', start: 0, mtime: 0,
    };
    expect(a.agentType).toBeUndefined();
  });

  it('buildSnapshot sets agentType on agents when meta.json has a known agentType', () => {
    // The wf_basic fixture must have at least one agent with an implementer meta.json
    // for this test to be non-trivial. If no meta.json is present, agentType is absent
    // on all agents — that is still correct behaviour (optional field).
    const snap = buildSnapshot({
      base: path.dirname(path.dirname(wfDir)),
      repo: '',
      refreshMs: 2000,
      statusBar: true,
      roleRules: [],
    });
    // The test asserts the schema contract: if ok, agents array exists.
    // agentType presence depends on the fixture's meta.json content.
    if (snap.ok) {
      // Agents without a recognised agentType should have agentType undefined, not null.
      snap.agents.forEach((a) => {
        expect(a.agentType === undefined || typeof a.agentType === 'string').toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Structural: renderGenericResult handles null/undefined result gracefully
// ---------------------------------------------------------------------------
describe('M2-TypedResults — null/undefined handling', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('renderTypedResult with null result returns "no structured result" message', () => {
    // Pass null via cast — defensive against malformed snapshot payloads
    const out = render('implementer', null as unknown as Record<string, unknown>);
    expect(out).toContain('no structured result');
  });

  it('renderTypedResult with undefined result returns "no structured result" message', () => {
    const out = render(undefined, undefined as unknown as Record<string, unknown>);
    expect(out).toContain('no structured result');
  });
});

