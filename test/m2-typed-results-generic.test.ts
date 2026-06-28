/**
 * M2-TypedResults-Generic — tests for the field-driven renderTypedResult.
 *
 * The new renderTypedResult dispatches by FIELD PATTERN, not agentType switch.
 * Tests cover:
 *   - Reviewer shape (verdict string + findings[]) renders typed view
 *   - Implementer shape (summary/filesChanged/booleans/numeric) renders typed view
 *   - Test-verifier shape (buildOk/lintOk/testsOk booleans + failures[]) renders typed view
 *   - Unknown agentType with arbitrary extra fields → generic key-value fallback (not raw JSON)
 *   - Malformed/throwing input degrades to collapsed raw text without throwing
 *   - verdict(string) badge: APPROVED→ok, /WORK|FAIL|REJECT/i→bad, else→neutral
 *   - findings[] are severity-sorted
 *   - summary with ## / ### sections → parsed structured view; without → plain text
 *   - filesChanged[] with count and ~40 cap
 *   - boolean flags matching /Ok$|^testsRun$|passed/i → ✓/✗ chips
 *   - failures[]/gaps[] → list (empty → 'none')
 *   - numeric counts → labeled values
 *   - raw JSON always in a collapsed <details> below the typed view
 *   - CSS classes for new elements (typed-verdict-neutral, typed-bool-chip)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getHtml } from '../src/webview/html';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';

/**
 * Build a harness that evaluates esc, safeN, escCls, rawJsonDetails,
 * parseImplementerMarkdown, renderGenericResult and renderTypedResult
 * (plus the SEV_ORDER / sevRank helpers and spec v3 #9/#10 module-level helpers) from the webview JS.
 */
function buildRendererHarness(js: string): (agentType: string | undefined, result: Record<string, unknown>) => string {
  const escLine = js.split('\n').find((l) => l.includes('function esc(s)'));
  if (!escLine) throw new Error('esc not found');
  const safeNLine = js.split('\n').find((l) => l.includes('function safeN(n)'));
  if (!safeNLine) throw new Error('safeN not found');
  const escClsLine = js.split('\n').find((l) => l.includes('function escCls(s)'));
  if (!escClsLine) throw new Error('escCls not found');

  const escFn = escLine.slice(escLine.indexOf('function esc(s)'));
  const safeNFn = safeNLine.slice(safeNLine.indexOf('function safeN(n)'));
  const escClsFn = escClsLine.slice(escClsLine.indexOf('function escCls(s)'));

  // Extract the SEV_ORDER var declaration and sevRank function (appear before the named renderers)
  const sevOrderMatch = js.match(/var SEV_ORDER=\[[^\]]+\];/);
  const sevOrderDecl = sevOrderMatch ? sevOrderMatch[0] : 'var SEV_ORDER=[];';
  const sevRankFn = extractBalancedFn(js, 'sevRank');

  const isBoolChipKeyFn = extractBalancedFn(js, 'isBoolChipKey');

  // Spec v3 corrections #9/#10: module-level helpers extracted from parseImplementerMarkdown.
  // parseImplementerMarkdown now calls these at the top level; they must be in scope.
  const normalizeFn = extractBalancedFn(js, 'normalizeLiteralEscapes');
  const applySpansFn = extractBalancedFn(js, 'applyInlineSpans');
  const renderInlineMdFn = extractBalancedFn(js, 'renderInlineMd');

  const fnNames = [
    'rawJsonDetails',
    'parseImplementerMarkdown',
    'renderGenericResult',
    'renderImplementerResult',
    'renderVerifierResult',
    'renderJudgeResult',
    'renderCompletenessResult',
    'renderTypedResult',
  ];
  const fns = fnNames.map((name) => extractBalancedFn(js, name)).join('\n');

  const code = `
    ${escFn}
    ${safeNFn}
    ${escClsFn}
    ${sevOrderDecl}
    ${normalizeFn}
    ${applySpansFn}
    ${renderInlineMdFn}
    ${sevRankFn}
    ${isBoolChipKeyFn}
    ${fns}
    return renderTypedResult;
  `;
  return new Function(code)() as (agentType: string | undefined, result: Record<string, unknown>) => string;
}

// ---------------------------------------------------------------------------
// CSS rules for new generic-renderer classes
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — CSS classes', () => {
  it('CSS contains .typed-verdict-neutral rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-verdict-neutral{');
  });

  it('CSS .typed-verdict-neutral uses opacity (not hardcoded color)', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.typed-verdict-neutral{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('opacity');
  });

  it('CSS contains .typed-bool-chips rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-bool-chips{');
  });

  it('CSS contains .typed-bool-chip rule', () => {
    expect(getHtml(TEST_NONCE)).toContain('.typed-bool-chip{');
  });

  it('CSS .typed-bool-chip uses --vscode-panel-border (theme-native)', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.typed-bool-chip{');
    const end = html.indexOf('}', idx);
    expect(html.slice(idx, end)).toContain('--vscode-panel-border');
  });

  it('forced-colors block covers typed-verdict-neutral', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('typed-verdict-neutral');
    // Should appear inside a forced-colors block
    const fcIdx = html.indexOf('@media (forced-colors:active)');
    expect(fcIdx).toBeGreaterThan(-1);
    const fcBlock = html.slice(fcIdx);
    expect(fcBlock).toContain('typed-verdict-neutral');
  });
});

// ---------------------------------------------------------------------------
// renderTypedResult: no longer dispatches via agentType switch
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — renderTypedResult is field-driven', () => {
  it('renderTypedResult function exists in webview JS', () => {
    expect(getPanelJs(getHtml(TEST_NONCE))).toContain('function renderTypedResult(');
  });

  it('renderTypedResult body does NOT contain per-agentType if-switch for implementer', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    // Field-driven: must not dispatch via agentType === 'implementer'
    expect(fn).not.toContain("==='implementer'");
    expect(fn).not.toContain("renderImplementerResult");
  });

  it('renderTypedResult body does NOT dispatch via agentType for test-verifier', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    expect(fn).not.toContain("==='test-verifier'");
    expect(fn).not.toContain("renderVerifierResult");
  });

  it('renderTypedResult body does NOT dispatch via agentType for judge', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    expect(fn).not.toContain("==='judge'");
    expect(fn).not.toContain("renderJudgeResult");
  });

  it('renderTypedResult body does NOT dispatch via agentType for completeness-critic', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    expect(fn).not.toContain("==='completeness-critic'");
    expect(fn).not.toContain("renderCompletenessResult");
  });

  it('renderTypedResult wraps output in try/catch (contains catch block)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    expect(fn).toContain('catch');
  });

  it('rawJsonDetails is called inside renderTypedResult (raw JSON always below typed view)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    expect(fn).toContain('rawJsonDetails');
  });
});

// ---------------------------------------------------------------------------
// Reviewer shape: verdict(string) + findings[]
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — reviewer shape (verdict + findings)', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('APPROVED verdict → typed-verdict-ok badge', () => {
    const out = render('code-reviewer', { verdict: 'APPROVED', findings: [] });
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('APPROVED');
  });

  it('NEEDS_WORK verdict → typed-verdict-bad badge (matches /WORK/i)', () => {
    const out = render('code-reviewer', { verdict: 'NEEDS_WORK', findings: [] });
    expect(out).toContain('typed-verdict-bad');
    expect(out).toContain('NEEDS_WORK');
  });

  it('FAIL verdict → typed-verdict-bad badge', () => {
    const out = render('security-reviewer', { verdict: 'FAIL', findings: [] });
    expect(out).toContain('typed-verdict-bad');
  });

  it('REJECT verdict → typed-verdict-bad badge', () => {
    const out = render('uiux-reviewer', { verdict: 'REJECT', findings: [] });
    expect(out).toContain('typed-verdict-bad');
  });

  it('unknown verdict string → typed-verdict-neutral badge', () => {
    const out = render('architect', { verdict: 'DEFERRED', findings: [] });
    expect(out).toContain('typed-verdict-neutral');
    expect(out).toContain('DEFERRED');
  });

  it('findings[] renders as a list with severity badges', () => {
    const out = render('code-reviewer', {
      verdict: 'NEEDS_WORK',
      findings: [
        { severity: 'HIGH', title: 'Missing auth check', location: 'src/api.ts:42', why: 'No guard', fix: 'Add guard' },
        { severity: 'LOW', title: 'Unused import', location: 'src/foo.ts:1', why: 'Dead code', fix: 'Remove it' },
      ],
    });
    expect(out).toContain('Findings');
    expect(out).toContain('Missing auth check');
    expect(out).toContain('Unused import');
    expect(out).toContain('HIGH');
    expect(out).toContain('LOW');
  });

  it('findings[] are severity-sorted (CRITICAL before LOW)', () => {
    const out = render('code-reviewer', {
      verdict: 'NEEDS_WORK',
      findings: [
        { severity: 'LOW', title: 'Minor thing' },
        { severity: 'CRITICAL', title: 'Big problem' },
        { severity: 'HIGH', title: 'Medium-big thing' },
      ],
    });
    // CRITICAL should appear before LOW in the output
    const critIdx = out.indexOf('Big problem');
    const lowIdx = out.indexOf('Minor thing');
    expect(critIdx).toBeLessThan(lowIdx);
  });

  it('empty findings[] → no Findings section rendered', () => {
    const out = render('code-reviewer', { verdict: 'APPROVED', findings: [] });
    expect(out).not.toContain('Findings (');
  });

  it('XSS in verdict is escaped', () => {
    const out = render('architect', { verdict: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('XSS in finding title is escaped', () => {
    const out = render('code-reviewer', {
      verdict: 'NEEDS_WORK',
      findings: [{ severity: 'HIGH', title: '<img src=x onerror=1>', why: 'bad', fix: 'fix it' }],
    });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('raw JSON details block always appears below the typed view', () => {
    const out = render('code-reviewer', { verdict: 'APPROVED', findings: [] });
    expect(out).toContain('raw-json-details');
    expect(out).toContain('Raw JSON');
  });

  it('does not produce bare JSON.stringify output for reviewer shape', () => {
    const out = render('code-reviewer', { verdict: 'APPROVED', findings: [{ severity: 'LOW', title: 'x' }] });
    expect(out).not.toContain('"verdict"');
    expect(out).not.toContain('"findings"');
  });
});

// ---------------------------------------------------------------------------
// Implementer shape: summary(string) + filesChanged[] + boolean flags + fixed count
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — implementer shape (fields)', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('summary plain text is shown when no ## sections present', () => {
    const out = render('implementer', { summary: 'Applied 3 patches cleanly.', filesChanged: [] });
    expect(out).toContain('typed-summary');
    expect(out).toContain('Applied 3 patches cleanly.');
  });

  it('summary with ## Implementation sections is parsed into structured view', () => {
    const md = '## Implementation: Some task\n### What Was Built\nA new module.\n### Status\nCOMPLETE';
    const out = render('implementer', { summary: md });
    // parseImplementerMarkdown produces .impl-report or similar structured output
    expect(out).toContain('impl-report');
    expect(out).toContain('COMPLETE');
  });

  it('filesChanged[] renders as file list with count', () => {
    const out = render('implementer', { filesChanged: ['src/a.ts', 'src/b.ts', 'src/c.ts'] });
    expect(out).toContain('Files changed (3)');
    expect(out).toContain('src/a.ts');
    expect(out).toContain('src/b.ts');
  });

  it('filesChanged[] caps at 40 and shows overflow count', () => {
    const files = Array.from({ length: 45 }, (_, i) => `file${i}.ts`);
    const out = render('implementer', { filesChanged: files });
    expect(out).toContain('+5 more');
    expect(out).toContain('Files changed (45)');
  });

  it('testsRun boolean chip renders with ✓ when true', () => {
    const out = render('implementer', { testsRun: true });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('✓');
    expect(out).toContain('testsRun');
  });

  it('testsRun boolean chip renders with ✗ when false', () => {
    const out = render('implementer', { testsRun: false });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('✗');
  });

  it('buildOk boolean chip rendered (key matches /Ok$/)', () => {
    const out = render('implementer', { buildOk: true });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('buildOk');
    expect(out).toContain('✓');
  });

  it('lintOk boolean chip rendered (key matches /Ok$/)', () => {
    const out = render('implementer', { lintOk: false });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('lintOk');
    expect(out).toContain('✗');
  });

  it('passed boolean chip rendered (key matches /passed/i)', () => {
    const out = render('implementer', { passed: true });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('passed');
    expect(out).toContain('✓');
  });

  it('fixed numeric count rendered as labeled value', () => {
    const out = render('implementer', { fixed: 7 });
    expect(out).toContain('fixed');
    expect(out).toContain('7');
  });

  it('does not produce bare JSON.stringify for implementer shape', () => {
    const out = render('implementer', { summary: 'ok', filesChanged: ['a.ts'], fixed: 1 });
    expect(out).not.toContain('"filesChanged"');
    expect(out).not.toContain('"summary"');
  });

  it('raw JSON details always present', () => {
    const out = render('implementer', { summary: 'done', filesChanged: [] });
    expect(out).toContain('raw-json-details');
  });
});

// ---------------------------------------------------------------------------
// Test-verifier shape: buildOk/lintOk/testsOk booleans + failures[]
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — test-verifier shape (fields)', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('testsOk=true renders typed-bool-chip with ✓', () => {
    const out = render('test-verifier', { testsOk: true, buildOk: true, lintOk: true });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('✓');
    expect(out).toContain('testsOk');
  });

  it('testsOk=false renders typed-bool-chip with ✗', () => {
    const out = render('test-verifier', { testsOk: false });
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('✗');
  });

  it('failures[] renders as a list with count', () => {
    const out = render('test-verifier', {
      testsOk: false,
      failures: ['test A: expected true but got false', 'test B: timeout'],
    });
    expect(out).toContain('Failures');
    expect(out).toContain('test A: expected true but got false');
    expect(out).toContain('test B: timeout');
  });

  it('failures[] empty → "none" shown', () => {
    const out = render('test-verifier', { testsOk: true, failures: [] });
    expect(out).toContain('Failures');
    expect(out).toContain('none');
  });

  it('gaps[] renders as a list', () => {
    const out = render('test-verifier', { gaps: ['src/parser.ts: branch not covered'] });
    expect(out).toContain('Gaps');
    expect(out).toContain('src/parser.ts: branch not covered');
  });

  it('coverageGaps[] renders as Coverage gaps section', () => {
    const out = render('test-verifier', { coverageGaps: ['fn foo uncovered'] });
    expect(out).toContain('Coverage gaps');
    expect(out).toContain('fn foo uncovered');
  });

  it('summary string renders as plain text section', () => {
    const out = render('test-verifier', { testsOk: true, summary: 'All 52 tests pass.' });
    expect(out).toContain('typed-summary');
    expect(out).toContain('All 52 tests pass.');
  });

  it('raw JSON is wrapped in collapsed details block (not bare dump) for test-verifier', () => {
    // The typed view renders chips/lists individually; raw JSON goes in <details>.
    const out = render('test-verifier', { testsOk: true, failures: [], summary: 'ok' });
    // Typed content present
    expect(out).toContain('typed-bool-chip');
    expect(out).toContain('Failures');
    // Raw JSON wrapped in details (not bare at top level)
    expect(out).toContain('raw-json-details');
  });
});

// ---------------------------------------------------------------------------
// Unknown agentType with arbitrary extra fields → generic key-value fallback
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — unknown agentType with extra fields', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('arbitrary string field is rendered in the generic kv table', () => {
    const out = render('some-future-agent', { phase: 'analysis', recommendation: 'refactor' });
    expect(out).toContain('phase');
    expect(out).toContain('analysis');
    expect(out).toContain('recommendation');
    expect(out).toContain('refactor');
  });

  it('arbitrary numeric field is rendered as a labeled value', () => {
    const out = render('some-future-agent', { score: 95 });
    expect(out).toContain('score');
    expect(out).toContain('95');
  });

  it('arbitrary boolean field (not matching chip pattern) rendered as yes/no', () => {
    const out = render('some-future-agent', { archived: true });
    // 'archived' doesn't match /Ok$|^testsRun$|passed/i → goes to generic kv
    expect(out).toContain('archived');
    expect(out).toContain('yes');
  });

  it('arbitrary array field rendered as bullet list', () => {
    const out = render('some-future-agent', { recommendations: ['use caching', 'reduce allocations'] });
    expect(out).toContain('recommendations');
    expect(out).toContain('use caching');
    expect(out).toContain('reduce allocations');
  });

  it('null field rendered as em-dash placeholder', () => {
    const out = render('some-future-agent', { detail: null });
    expect(out).toContain('detail');
    expect(out).toContain('—');
  });

  it('does not produce raw JSON.stringify output for unknown agentType', () => {
    const out = render('some-future-agent', { phase: 'done', items: ['x', 'y'] });
    expect(out).not.toContain('"phase"');
    expect(out).not.toContain('"items"');
  });

  it('raw JSON details block is present even for unknown agentType', () => {
    const out = render('some-future-agent', { phase: 'done' });
    expect(out).toContain('raw-json-details');
    expect(out).toContain('Raw JSON');
  });

  it('typed-kv class used (not raw pre dump) for unknown shape', () => {
    const out = render('some-future-agent', { step: 1, note: 'ok' });
    expect(out).toContain('typed-kv');
  });

  it('XSS in arbitrary field key is escaped', () => {
    const obj: Record<string, unknown> = {};
    obj['<script>'] = 'value';
    const out = render('some-future-agent', obj);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('XSS in arbitrary field value is escaped', () => {
    const out = render('some-future-agent', { msg: '<b>bold</b>' });
    expect(out).not.toContain('<b>bold</b>');
    expect(out).toContain('&lt;b&gt;');
  });
});

// ---------------------------------------------------------------------------
// Malformed / throwing input degrades silently to collapsed raw text
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — malformed input fails silently', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('null result returns "no structured result" message without throwing', () => {
    expect(() => {
      const out = render(undefined, null as unknown as Record<string, unknown>);
      expect(out).toContain('no structured result');
    }).not.toThrow();
  });

  it('undefined result returns "no structured result" message without throwing', () => {
    expect(() => {
      const out = render('implementer', undefined as unknown as Record<string, unknown>);
      expect(out).toContain('no structured result');
    }).not.toThrow();
  });

  it('non-object result (string) returns "no structured result" without throwing', () => {
    expect(() => {
      const out = render('implementer', 'bad input' as unknown as Record<string, unknown>);
      expect(out).toContain('no structured result');
    }).not.toThrow();
  });

  it('non-object result (number) returns "no structured result" without throwing', () => {
    expect(() => {
      const out = render('implementer', 42 as unknown as Record<string, unknown>);
      expect(out).toContain('no structured result');
    }).not.toThrow();
  });

  it('circular reference in result degrades to collapsed raw text without throwing', () => {
    // Create a circular structure that JSON.stringify cannot serialize
    const obj: Record<string, unknown> = { key: 'value' };
    obj['self'] = obj;
    // The try/catch in renderTypedResult should catch the JSON.stringify failure
    // inside rawJsonDetails and fall back gracefully
    expect(() => {
      const out = render('implementer', obj);
      // Should not throw — result is either the typed view or the fallback details block
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('empty object result returns "empty result" or renders without throwing', () => {
    expect(() => {
      const out = render('implementer', {});
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }).not.toThrow();
  });

  it('on fallback, output contains a <details> element (collapsed raw text)', () => {
    // Trigger the catch branch by providing a result whose field access throws.
    // We cannot easily force an exception in the field-scan loop from user data,
    // but we test the fallback path by verifying the error block structure exists in JS.
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'renderTypedResult');
    // The catch block must produce a raw-json-details element
    expect(fn).toContain('raw-json-details');
    expect(fn).toContain('parse error');
  });
});

// ---------------------------------------------------------------------------
// Verdict badge: exact spec for the three states
// ---------------------------------------------------------------------------
describe('M2-TypedResults-Generic — verdict badge states', () => {
  let render: ReturnType<typeof buildRendererHarness>;
  beforeAll(() => {
    render = buildRendererHarness(getPanelJs(getHtml(TEST_NONCE)));
  });

  it('APPROVED (exact) → typed-verdict-ok', () => {
    expect(render('architect', { verdict: 'APPROVED' })).toContain('typed-verdict-ok');
  });

  it('approved (lowercase) → typed-verdict-ok (case-insensitive match)', () => {
    expect(render('architect', { verdict: 'approved' })).toContain('typed-verdict-ok');
  });

  it('NEEDS_WORK → typed-verdict-bad (contains WORK)', () => {
    expect(render('architect', { verdict: 'NEEDS_WORK' })).toContain('typed-verdict-bad');
  });

  it('FAIL → typed-verdict-bad', () => {
    expect(render('architect', { verdict: 'FAIL' })).toContain('typed-verdict-bad');
  });

  it('REJECT → typed-verdict-bad', () => {
    expect(render('architect', { verdict: 'REJECT' })).toContain('typed-verdict-bad');
  });

  it('pending → typed-verdict-neutral (not ok or bad)', () => {
    const out = render('architect', { verdict: 'pending' });
    expect(out).toContain('typed-verdict-neutral');
    expect(out).not.toContain('typed-verdict-ok');
    expect(out).not.toContain('typed-verdict-bad');
  });

  it('IN_PROGRESS → typed-verdict-neutral', () => {
    const out = render('architect', { verdict: 'IN_PROGRESS' });
    expect(out).toContain('typed-verdict-neutral');
  });
});
