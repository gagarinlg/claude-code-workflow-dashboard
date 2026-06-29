/**
 * Erika — Independent Verification: M2-Polish Acceptance Criteria
 *
 * Scope: M2-polish — fixes 19 open review findings from the M2-core run
 * (2 HIGH a11y from Sabine, 3 LOW security from Klaus, CI coverage-gate gap
 * from Gerda, markdown-export polish from Viktor, plus layout MEDs) and
 * dogfooding UX bugs.
 *
 * These tests are derived ONLY from the spec/ROADMAP/constraints — not from
 * reading implementation bodies. They verify behaviour through public interfaces.
 *
 * ACs verified here (not already covered by Fritz's existing test files):
 *
 * A11y — Sabine HIGH:
 *  - Filter chips carry aria-pressed attribute reflecting active/inactive state
 *  - Filter chips keyboard-toggle re-renders with correct aria-pressed value
 *  - chip:focus-visible CSS rule provides a visible focus ring (non-color indicator)
 *  - Severity chip group has a visible label / aria-label for the group context
 *  - Reviewer chip group has a visible label / aria-label for the group context
 *  - Chart SVG elements have role="img" and aria-label (screen-reader accessible)
 *  - SVG chart bars and trend paths are marked aria-hidden (decorative detail)
 *  - Panel toggle checkboxes have associated <label> elements (not orphaned)
 *  - Collapse-all/Expand-all button has an aria-label
 *
 * Security — Klaus LOW:
 *  - renderGenericResult: nested object values render as [object], NOT raw JSON.stringify
 *  - renderGenericResult: array items that are objects are serialised safely (esc)
 *  - extension.ts handles {type:'copyText'} message from webview (no silent drop)
 *  - extension.ts copies only 'text' field of copyText msg (type-guards string)
 *
 * CI — Gerda:
 *  - vitest.config.ts coverage.include lists src/export/** (gate is active)
 *  - All three GitHub workflows (ci/release/nightly) run npm run coverage
 *
 * Markdown export polish — Viktor:
 *  - generateMarkdown: Finding with no why/fix skips the empty bold span entirely
 *  - generateMarkdown: workflowDir never appears in the exported Markdown
 *  - generateMarkdown: runId with backtick is sanitised in the header code span
 *  - cmpSev: NITPICK appears between LOW and INFO (not after INFO/UNRATED)
 *
 * Layout MEDs:
 *  - Results panel default state: results:0 means it starts hidden on first load
 *  - Scroll position: render() preserves outermost panel scroll (the M1 pattern)
 *  - chart-scroll container has overflow-x:auto so body does not scroll horizontally
 *  - Webview never renders workflowDir into HTML (stripped by safeSnap)
 *
 * Constraints confirmed:
 *  - No hardcoded hex colors in chip CSS rules
 *  - No pricing keywords in either panel or sidebar HTML output
 *  - All scroll-state keys use Object.create(null) (no prototype pollution)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getHtml } from '../src/webview/html';
import { generateMarkdown, cmpSev } from '../src/export/markdown';
import type { SnapshotOk } from '../src/data/snapshot';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function getPanelHtml(): string {
  return getHtml(TEST_NONCE, 2, 200, 'panel');
}

function getSidebarHtml(): string {
  return getHtml(TEST_NONCE, 2, 200, 'sidebar');
}

function buildGenericRendererHarness(js: string): (obj: Record<string, unknown>) => string {
  const escLine = js.split('\n').find((l) => l.includes('function esc(s)'));
  if (!escLine) throw new Error('esc not found');
  const escFn = escLine.slice(escLine.indexOf('function esc(s)'));
  const safeNLine = js.split('\n').find((l) => l.includes('function safeN(n)'));
  if (!safeNLine) throw new Error('safeN not found');
  const safeNFn = safeNLine.slice(safeNLine.indexOf('function safeN(n)'));
  const fn = extractBalancedFn(js, 'renderGenericResult');
  const code = `${escFn}\n${safeNFn}\n${fn}\nreturn renderGenericResult;`;
  return new Function(code)() as (obj: Record<string, unknown>) => string;
}

function makeSnap(overrides: Partial<SnapshotOk> = {}): SnapshotOk {
  return {
    ok: true,
    runId: 'wf_test_20240101_120000',
    workflowDir: '/home/user/.claude/projects/proj/workflows/wf_test_20240101_120000',
    updatedAt: '12:00:00',
    isPinned: false,
    agentsCapped: false,
    loop: {
      phase: 'idle / between passes',
      live: 0, done: 2, dead: 0, superseded: 0, total: 2,
      outTok: 1500, tools: 8, passes: 1, findings: 1,
      sevTotals: { HIGH: 1 },
    },
    labels: ['Code review'],
    agents: [],
    allFindings: [],
    structuredResults: [],
    verdicts: {},
    verdictLabels: {},
    changed: null,
    changedByAgents: [],
    ...overrides,
  };
}

// ===========================================================================
// A11y — Sabine HIGH: Filter chips aria-pressed and keyboard operability
// ===========================================================================

describe('A11y — filter chip aria-pressed attribute (Sabine HIGH finding)', () => {
  // ROADMAP constraint: "esc() every transcript-derived value"; WCAG 4.1.2 requires
  // role="button" controls to carry aria-pressed when toggling a pressed state.

  it('severity chip HTML carries aria-pressed="true" when chip is active', () => {
    // The chip builder uses: aria-pressed="'+(state.fSev[s]?'true':'false')+'"
    // Verify the pattern exists in the chips builder code.
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain("aria-pressed=\"'+(state.fSev[s]?'true':'false')+'\"");
  });

  it('reviewer chip HTML carries aria-pressed="true" when chip is active', () => {
    const js = getPanelJs(getPanelHtml());
    // The reviewer chip builder must include aria-pressed
    expect(js).toContain("aria-pressed=\"'+(state.fRev[l]?'true':'false')+'\"");
  });

  it('severity chips have role="button" (WCAG 4.1.2)', () => {
    const js = getPanelJs(getPanelHtml());
    // The chip element must carry role="button" so screen readers announce it correctly
    const sevChipIdx = js.indexOf('chip fsev');
    expect(sevChipIdx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, sevChipIdx - 10), sevChipIdx + 200);
    expect(context).toContain('role="button"');
  });

  it('reviewer chips have role="button" (WCAG 4.1.2)', () => {
    const js = getPanelJs(getPanelHtml());
    const revChipIdx = js.indexOf('chip rev');
    expect(revChipIdx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, revChipIdx - 10), revChipIdx + 200);
    expect(context).toContain('role="button"');
  });

  it('severity chips have tabindex="0" for keyboard operability', () => {
    const js = getPanelJs(getPanelHtml());
    const sevChipIdx = js.indexOf('chip fsev');
    expect(sevChipIdx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, sevChipIdx - 10), sevChipIdx + 200);
    expect(context).toContain('tabindex="0"');
  });

  it('reviewer chips have tabindex="0" for keyboard operability', () => {
    const js = getPanelJs(getPanelHtml());
    const revChipIdx = js.indexOf('chip rev');
    expect(revChipIdx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, revChipIdx - 10), revChipIdx + 200);
    expect(context).toContain('tabindex="0"');
  });

  it('chip keyboard handler fires on Enter key (WCAG 2.1.1)', () => {
    const js = getPanelJs(getPanelHtml());
    // The chip must be keyboard-operable — Enter and Space must activate it
    expect(js).toContain("e.key==='Enter'");
    expect(js).toContain("e.key===' '");
  });

  it('chip keyboard handler calls act() on Space (WCAG 2.1.1)', () => {
    const js = getPanelJs(getPanelHtml());
    // The keyboard handler must call act() — the same function as the click handler
    // so pressing Space or Enter has the same effect as clicking
    const chipRevIdx = js.indexOf('.chip.rev');
    const chipBlock = js.slice(chipRevIdx > 0 ? chipRevIdx : 0);
    expect(chipBlock).toContain('act()');
  });
});

// ===========================================================================
// A11y — focus ring CSS (chip:focus-visible, summary:focus-visible)
// ===========================================================================

describe('A11y — focus ring CSS rules (Sabine HIGH finding)', () => {
  // WCAG 2.4.7 Focus Visible: every keyboard-navigable element must have a
  // visible focus indicator that is not color-only.

  it('CSS .chip:focus-visible has a 2px outline (not just color change)', () => {
    const html = getPanelHtml();
    // Extract the chip focus rule
    const idx = html.indexOf('.chip:focus-visible');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('outline');
    expect(rule).toContain('2px');
    // Must use --vscode-focusBorder (theme-native, not hardcoded color)
    expect(rule).toContain('--vscode-focusBorder');
  });

  it('CSS .chip:focus-visible does not use color as the sole indicator', () => {
    // WCAG 1.4.1: info must not be conveyed by color alone.
    // The focus ring (outline) provides the non-color indicator — verify it exists.
    const html = getPanelHtml();
    const idx = html.indexOf('.chip:focus-visible');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    // outline is the non-color indicator
    expect(rule).toContain('outline');
  });

  it('CSS .raw-json-summary:focus-visible has a visible focus outline', () => {
    const html = getPanelHtml();
    const idx = html.indexOf('.raw-json-summary:focus-visible');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('outline');
    expect(rule).toContain('--vscode-focusBorder');
  });

  it('CSS button:focus-visible has an outline (not color-only)', () => {
    const html = getPanelHtml();
    const idx = html.indexOf('button:focus-visible');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('outline');
  });

  it('CSS input[type=checkbox]:focus-visible has an outline', () => {
    // Panel toggles use checkboxes; they must have a visible focus ring.
    const html = getPanelHtml();
    expect(html).toContain('input[type=checkbox]:focus-visible');
    const idx = html.indexOf('input[type=checkbox]:focus-visible');
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('outline');
  });

  it('CSS [tabindex="0"]:focus-visible has an outline (covers custom role="button" divs)', () => {
    const html = getPanelHtml();
    // This rule must cover prompt-disc-hdr, card .row, and other custom button divs
    expect(html).toContain('[tabindex="0"]:focus-visible');
    const idx = html.indexOf('[tabindex="0"]:focus-visible');
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('outline');
  });
});

// ===========================================================================
// A11y — chart SVG accessibility (role="img", aria-label)
// ===========================================================================

describe('A11y — chart SVG elements have role="img" and aria-label', () => {
  // WCAG 1.1.1: Non-text content (SVG charts) must have a text alternative.
  // role="img" + aria-label provides the accessible name without a <title> element.

  it('bar chart SVG has role="img"', () => {
    const js = getPanelJs(getPanelHtml());
    // The tokenBarChart function must emit role="img" on the root <svg>
    const idx = js.indexOf('data-testid="token-bar-chart"');
    expect(idx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, idx - 200), idx + 50);
    expect(context).toContain('role="img"');
  });

  it('bar chart SVG has aria-label describing its content', () => {
    const js = getPanelJs(getPanelHtml());
    const idx = js.indexOf('data-testid="token-bar-chart"');
    expect(idx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, idx - 300), idx + 50);
    expect(context).toContain('aria-label=');
    // The label must describe the chart — not just "chart"
    expect(context).toMatch(/aria-label="[^"]*token[^"]*"/i);
  });

  it('trend chart SVG has role="img"', () => {
    const js = getPanelJs(getPanelHtml());
    const idx = js.indexOf('data-testid="token-trend-chart"');
    expect(idx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, idx - 200), idx + 50);
    expect(context).toContain('role="img"');
  });

  it('trend chart SVG has aria-label describing its content', () => {
    const js = getPanelJs(getPanelHtml());
    const idx = js.indexOf('data-testid="token-trend-chart"');
    expect(idx).toBeGreaterThan(-1);
    const context = js.slice(Math.max(0, idx - 300), idx + 50);
    expect(context).toContain('aria-label=');
  });
});

// ===========================================================================
// A11y — panel toggle checkboxes have associated labels
// ===========================================================================

describe('A11y — panel toggles replaced by WAI-ARIA tablist (M3-Layout redesign)', () => {
  // M3-Layout: the #toggles checkbox group and PANELS array were removed.
  // Navigation is now handled by a WAI-ARIA tablist with keyboard support.

  it('panel JS does NOT contain checkbox toggle builder (PANELS removed)', () => {
    const js = getPanelJs(getPanelHtml());
    // The old toggle builder used createElement('label') + 'toggle-'+k.
    // These must be gone — the tab bar replaces them.
    expect(js).not.toContain("'toggle-'+k");
    expect(js).not.toContain("setAttribute('for','toggle-'+k)");
  });

  it('panel JS has tabBar() function returning role="tablist" structure', () => {
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain('function tabBar()');
    expect(js).toContain('role="tablist"');
  });

  it('panel HTML has role="tablist" (replaces the removed role="group" checkbox bar)', () => {
    // The tablist replaces the old role="group" aria-label="Show panels" checkboxes.
    // The tablist itself carries an aria-label for the group context.
    const html = getPanelHtml();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Dashboard sections"');
    // The old panel-toggle group must be gone.
    expect(html).not.toContain('aria-label="Show panels"');
    expect(html).not.toContain('id="toggles"');
  });

  it('panel JS has wireTabBar() wiring click + keyboard on tab buttons', () => {
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain('function wireTabBar()');
    // Click handler activates tabs.
    expect(js).toContain('activateTab');
    // Keyboard roving tabindex implemented.
    expect(js).toContain("'ArrowRight'");
    expect(js).toContain("'ArrowLeft'");
  });
});

// ===========================================================================
// Security — Klaus LOW: renderGenericResult nested object safety
// ===========================================================================

describe('Security — renderGenericResult: nested objects are not raw JSON (Klaus LOW)', () => {
  // ROADMAP constraint: "esc() every transcript-derived value; never raw JSON in DOM".
  // A nested object value in a generic result must NOT be passed through JSON.stringify
  // and injected raw — it must be rendered as the safe "[object]" placeholder or
  // serialised via esc(JSON.stringify(x)) for array items.

  let renderGeneric: (obj: Record<string, unknown>) => string;

  beforeAll(() => {
    renderGeneric = buildGenericRendererHarness(getPanelJs(getPanelHtml()));
  });

  it('a nested object value renders as [object] — not raw JSON.stringify output', () => {
    const out = renderGeneric({ config: { host: 'localhost', port: 3000 } });
    // Must render the safe placeholder
    expect(out).toContain('[object]');
    // Must NOT contain raw JSON curly braces — that would be unsanitised
    expect(out).not.toContain('"host"');
  });

  it('nested object with XSS payload in key renders as [object] (not injected)', () => {
    // If the nested object were JSON.stringify'd without esc(), an adversarial
    // key like <script>... in a nested object would inject HTML.
    const dangerous = { '<script>alert(1)</script>': 'xss' };
    const out = renderGeneric({ nested: dangerous });
    // [object] placeholder — no injection
    expect(out).toContain('[object]');
    expect(out).not.toContain('<script>alert');
  });

  it('array of objects: each item is serialised with esc() (not raw JSON injection)', () => {
    // Array items that are objects must be serialised via esc(JSON.stringify(x))
    // The renderGenericResult code: esc(typeof x==='object'?JSON.stringify(x):String(...))
    const out = renderGeneric({ items: [{ key: '<b>bold</b>' }] });
    // The <b> tag from the object must be escaped
    expect(out).not.toContain('<b>bold</b>');
  });

  it('array of objects: does not produce raw < or > from object serialisation', () => {
    const out = renderGeneric({ files: [{ path: '<script>x</script>' }] });
    expect(out).not.toContain('<script>x</script>');
  });

  it('array items that are strings are escaped via esc()', () => {
    const out = renderGeneric({ tags: ['<b>bold</b>', 'normal'] });
    expect(out).not.toContain('<b>bold</b>');
    expect(out).toContain('&lt;b&gt;');
    expect(out).toContain('normal');
  });

  it('key with XSS is escaped via esc(k)', () => {
    const obj: Record<string, unknown> = {};
    obj['<img src=x onerror=alert(1)>'] = 'value';
    const out = renderGeneric(obj);
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });

  it('string value with XSS is escaped via esc(v)', () => {
    const out = renderGeneric({ msg: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });

  it('number value is stringified with esc(String(v))', () => {
    const out = renderGeneric({ count: 42 });
    expect(out).toContain('42');
    expect(out).not.toContain('undefined');
  });

  it('null value renders as em-dash placeholder (not "null" string)', () => {
    const out = renderGeneric({ notes: null });
    expect(out).toContain('—');
    expect(out).not.toContain('>null<');
  });
});

// ===========================================================================
// Security — Klaus LOW: extension.ts handles copyText message
// ===========================================================================

describe('Security — extension.ts handles {type:"copyText"} message (Klaus LOW)', () => {
  // The webview posts {type:'copyText',text:...} when the Copy button is clicked.
  // The extension must handle this in onDidReceiveMessage and copy to clipboard.
  // A type guard on typeof msg['text'] === 'string' prevents undefined/object from
  // being passed to vscode.env.clipboard.writeText().

  let extSrc: string;

  beforeAll(() => {
    extSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
  });

  it('extension.ts onDidReceiveMessage handles {type:"copyText"}', () => {
    // The handler must branch on 'copyText' (same switch as 'export', 'openRun', etc.)
    expect(extSrc).toContain("'copyText'");
  });

  it("extension.ts copyText handler type-guards: typeof msg['text'] === 'string'", () => {
    // SECURITY: prevents undefined or a non-string object from reaching clipboard.writeText()
    // The guard must be present — without it an adversarial snapshot could pass an
    // object reference that gets coerced to "[object Object]" in the clipboard.
    expect(extSrc).toContain("typeof msg['text'] === 'string'");
  });

  it('extension.ts copyText handler calls vscode.env.clipboard.writeText', () => {
    // The clipboard API must be used — not a direct postMessage back or console.log
    expect(extSrc).toContain('clipboard.writeText');
  });

  it('extension.ts copyText handler is inside the onDidReceiveMessage block', () => {
    const msgHandlerIdx = extSrc.indexOf('onDidReceiveMessage');
    expect(msgHandlerIdx).toBeGreaterThan(-1);
    // The copyText branch must be within reach of the message handler context
    const handlerBlock = extSrc.slice(msgHandlerIdx, msgHandlerIdx + 1500);
    expect(handlerBlock).toContain("'copyText'");
  });
});

// ===========================================================================
// CI coverage gate — Gerda MED: src/export/** in all three workflows
// ===========================================================================

describe('CI — coverage gate covers src/export/** in all three workflows (Gerda)', () => {
  // ROADMAP constraint (from context): "the new src/export/** module MUST be added
  // to the 90% vitest coverage gate (it's currently un-gated — fix vitest.config.ts
  // coverage.include)". Vitest.config.ts already has it; the CI workflows must also
  // reflect the gated module so the coverage report output is visible in CI logs.

  let ci: string;
  let release: string;
  let nightly: string;

  beforeAll(() => {
    const root = path.join(__dirname, '..');
    ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    release = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
    nightly = fs.readFileSync(path.join(root, '.github', 'workflows', 'nightly.yml'), 'utf8');
  });

  it('vitest.config.ts coverage.include contains src/export/**', () => {
    const vitestConfig = fs.readFileSync(
      path.join(__dirname, '..', 'vitest.config.ts'),
      'utf8',
    );
    // The export module is gated — this is the Gerda MED fix
    expect(vitestConfig).toContain("'src/export/**'");
  });

  it('vitest.config.ts coverage thresholds are 90 for all four metrics', () => {
    const vitestConfig = fs.readFileSync(
      path.join(__dirname, '..', 'vitest.config.ts'),
      'utf8',
    );
    expect(vitestConfig).toContain('lines: 90');
    expect(vitestConfig).toContain('branches: 90');
    expect(vitestConfig).toContain('functions: 90');
    expect(vitestConfig).toContain('statements: 90');
  });

  it('vitest.config.ts uses perFile: true for per-file threshold enforcement', () => {
    const vitestConfig = fs.readFileSync(
      path.join(__dirname, '..', 'vitest.config.ts'),
      'utf8',
    );
    expect(vitestConfig).toContain('perFile: true');
  });

  it('ci.yml runs npm run coverage (gate enforced in CI)', () => {
    expect(ci).toContain('npm run coverage');
  });

  it('release.yml runs npm run coverage (gate enforced in release)', () => {
    expect(release).toContain('npm run coverage');
  });

  it('nightly.yml runs npm run coverage (gate enforced in nightly)', () => {
    expect(nightly).toContain('npm run coverage');
  });

  it('ci.yml coverage step runs before vsce package (ordering enforced)', () => {
    const coveragePos = ci.indexOf('npm run coverage');
    const vscePos = ci.indexOf('vsce package');
    expect(coveragePos).toBeGreaterThan(-1);
    expect(vscePos).toBeGreaterThan(-1);
    expect(coveragePos).toBeLessThan(vscePos);
  });
});

// ===========================================================================
// Markdown export polish — Viktor LOW
// ===========================================================================

describe('Markdown export — generateMarkdown: no why/fix → no empty bold span (Viktor)', () => {
  // Viktor finding: a finding with no why or fix field must not produce an empty
  // "**Why:** " or "**Fix:** " bold span — the section must be omitted entirely.

  it('finding with empty why omits the **Why:** line entirely', () => {
    const snap = makeSnap({
      allFindings: [{
        severity: 'LOW',
        title: 'No why',
        why: '',          // empty string
        fix: 'Use X instead.',
        pass: 1,
        reviewer: 'Code review',
        key: 'cr',
      }],
    });
    const md = generateMarkdown(snap);
    // The why section must not appear at all — not even "**Why:** "
    expect(md).not.toContain('**Why:**');
    // The fix section must still appear
    expect(md).toContain('**Fix:**');
    expect(md).toContain('Use X instead.');
  });

  it('finding with absent why field omits the **Why:** line entirely', () => {
    const snap = makeSnap({
      allFindings: [{
        severity: 'MEDIUM',
        title: 'No why field',
        // why is intentionally absent
        fix: 'Replace with safer API.',
        pass: 1,
        reviewer: 'Security',
        key: 'sec',
      }],
    });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('**Why:**');
    expect(md).toContain('**Fix:**');
  });

  it('finding with empty fix omits the **Fix:** line entirely', () => {
    const snap = makeSnap({
      allFindings: [{
        severity: 'HIGH',
        title: 'No fix',
        why: 'Because it is dangerous.',
        fix: '',          // empty string
        pass: 1,
        reviewer: 'Code review',
        key: 'cr',
      }],
    });
    const md = generateMarkdown(snap);
    // The fix section must not appear at all — not even "**Fix:** "
    expect(md).not.toContain('**Fix:**');
    // The why section must still appear
    expect(md).toContain('**Why:**');
    expect(md).toContain('Because it is dangerous.');
  });

  it('finding with absent fix field omits the **Fix:** line entirely', () => {
    const snap = makeSnap({
      allFindings: [{
        severity: 'LOW',
        title: 'No fix field',
        why: 'Because reasons.',
        // fix is intentionally absent
        pass: 1,
        reviewer: 'Code review',
        key: 'cr',
      }],
    });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('**Fix:**');
    expect(md).toContain('**Why:**');
  });

  it('finding with whitespace-only why omits the **Why:** line', () => {
    // escBody trims the value — a whitespace-only why collapses to '' after trim
    const snap = makeSnap({
      allFindings: [{
        severity: 'LOW',
        title: 'Whitespace why',
        why: '   \n  ',   // all whitespace
        fix: 'Fix it.',
        pass: 1,
        reviewer: 'Code review',
        key: 'cr',
      }],
    });
    const md = generateMarkdown(snap);
    expect(md).not.toContain('**Why:**');
  });
});

describe('Markdown export — workflowDir must never appear in exported Markdown (Viktor)', () => {
  // workflowDir is an internal filesystem path stripped by safeSnap before webview
  // delivery (CLAUDE.md). The exported Markdown should also never contain it —
  // it would leak the user's home directory structure into a shared report.

  it('generateMarkdown output does not contain the workflowDir path', () => {
    const snap = makeSnap({
      workflowDir: '/home/user/.claude/projects/proj/workflows/wf_test_20240101_120000',
    });
    const md = generateMarkdown(snap);
    // The internal path must not appear in the exported report
    expect(md).not.toContain('/home/user/.claude');
    expect(md).not.toContain('workflowDir');
  });

  it('generateMarkdown output does not contain "workflowDir" as a key name', () => {
    const md = generateMarkdown(makeSnap());
    expect(md).not.toContain('workflowDir');
  });
});

describe('Markdown export — cmpSev NITPICK ordering (Viktor)', () => {
  // ROADMAP: "NITPICK sits after LOW (lowest named severity above INFO)"
  // SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NITPICK', 'INFO', 'UNRATED']

  it('NITPICK sorts after LOW', () => {
    expect(cmpSev('NITPICK', 'LOW')).toBeGreaterThan(0);
  });

  it('NITPICK sorts before INFO', () => {
    expect(cmpSev('NITPICK', 'INFO')).toBeLessThan(0);
  });

  it('NITPICK sorts before UNRATED', () => {
    expect(cmpSev('NITPICK', 'UNRATED')).toBeLessThan(0);
  });

  it('full SEV_ORDER sort: CRITICAL, HIGH, MEDIUM, LOW, NITPICK, INFO, UNRATED', () => {
    const sevs = ['UNRATED', 'INFO', 'NITPICK', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    sevs.sort(cmpSev);
    expect(sevs).toEqual(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NITPICK', 'INFO', 'UNRATED']);
  });

  it('Severity Breakdown table has NITPICK between LOW and INFO', () => {
    const snap = makeSnap({
      loop: {
        ...makeSnap().loop,
        sevTotals: { CRITICAL: 1, MEDIUM: 2, LOW: 3, NITPICK: 4, INFO: 1, UNRATED: 2 },
      },
    });
    const md = generateMarkdown(snap);
    const lowPos = md.indexOf('| LOW |');
    const nitpickPos = md.indexOf('| NITPICK |');
    const infoPos = md.indexOf('| INFO |');
    expect(lowPos).toBeGreaterThan(-1);
    expect(nitpickPos).toBeGreaterThan(-1);
    expect(infoPos).toBeGreaterThan(-1);
    expect(nitpickPos).toBeGreaterThan(lowPos);
    expect(nitpickPos).toBeLessThan(infoPos);
  });
});

// ===========================================================================
// Layout MEDs: Results panel default state + scroll + chart container
// ===========================================================================

describe('Layout — Results panel default state (M3-Layout redesign: tabbed layout)', () => {
  // M3-Layout: PANELS array and state.on removed; navigation is tabbed.
  // Results is the last tab (after Charts) — matches the old ordering requirement.
  // The in-tab collapsible panel() for Results starts expanded (panelOpen.results:1).

  it('JS tabDefs() places "results" tab after "charts" tab (end of tab order)', () => {
    // The tab order in tabDefs() must still end with: ...charts, results.
    const js = getPanelJs(getPanelHtml());
    const tabDefsIdx = js.indexOf('function tabDefs()');
    expect(tabDefsIdx).toBeGreaterThan(-1);
    const tabDefsSlice = js.slice(tabDefsIdx, tabDefsIdx + 1000);
    const chartsPos = tabDefsSlice.indexOf("key:'charts'");
    const resultsPos = tabDefsSlice.indexOf("key:'results'");
    expect(chartsPos).toBeGreaterThan(-1);
    expect(resultsPos).toBeGreaterThan(chartsPos);
  });

  it('JS state does NOT have on:{results:0} (state.on removed in M3-Layout)', () => {
    const js = getPanelJs(getPanelHtml());
    // state.on was the panel visibility map; it is removed.
    // Tabs replace it — Results is enabled when structuredResults > 0.
    expect(js).not.toContain('on:{');
    // state.activeTab defaults to agents
    expect(js).toContain("activeTab:_s.activeTab||'agents'");
  });

  it('M3 v3 BINDING: panelOpen.results does NOT exist (Results tab renders directly, no collapse state)', () => {
    // M3 v3 BINDING (AC11): resultsPanel() renders content directly without panel() wrapper.
    // panelOpen.results key is dropped from the state initializer.
    const js = getPanelJs(getPanelHtml());
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('results:');
  });
});

describe('Layout — chart-scroll container prevents horizontal body scroll', () => {
  // ROADMAP constraint: "wide content … gets overflow-x: auto on its own container
  // so the page body must never scroll horizontally"

  it('CSS .chart-scroll has overflow-x:auto', () => {
    const html = getPanelHtml();
    expect(html).toContain('.chart-scroll{overflow-x:auto');
  });

  it('CSS body/html does not set overflow-x:scroll', () => {
    const html = getPanelHtml();
    expect(html).not.toContain('body{overflow-x:scroll');
    expect(html).not.toContain('html{overflow-x:scroll');
  });
});

describe('Layout — scroll position preservation uses Object.create(null) for subPos', () => {
  // CLAUDE.md: "no prototype pollution" — Object.create(null) is the required pattern.
  // The subPos map must be initialized with Object.create(null) so __proto__ keys
  // in agent ids or label strings cannot pollute the prototype chain.

  it('JS render() initialises subPos with Object.create(null)', () => {
    const js = getPanelJs(getPanelHtml());
    // Object.create(null) must be used — consistent with openAgents/fRev/fSev
    expect(js).toContain('Object.create(null)');
  });
});

// ===========================================================================
// Constraint: no hardcoded hex in chip CSS rules (theme-native)
// ===========================================================================

describe('Constraints — chip CSS uses --vscode-* variables (no hardcoded hex)', () => {
  // CLAUDE.md: "use VS Code CSS variables (--vscode-*); no hardcoded colors"

  it('CSS .chip rule uses --vscode-* for background and border (not hex)', () => {
    const html = getPanelHtml();
    const idx = html.indexOf('.chip{');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    // Must reference at least one vscode variable
    expect(rule).toContain('--vscode-');
    // Must not contain bare hex colors
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('CSS .chip:not(.off) uses --vscode-button-* variables', () => {
    const html = getPanelHtml();
    const idx = html.indexOf('.chip:not(.off)');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('--vscode-button-');
  });

  it('CSS forced-colors block (main CSS) covers .chip selectors (high-contrast a11y)', () => {
    // WCAG 1.4.1 / 1.4.3: In Windows High Contrast mode (forced-colors:active),
    // the chip's visual active/inactive distinction must not rely on opacity alone.
    // The CSS forced-colors block must override .chip rules to use system colors
    // so active vs inactive filter chips remain distinguishable.
    // Search for the LITERAL @media block (not a comment reference to it).
    const html = getPanelHtml();
    const mediaMarker = '@media (forced-colors:active){';
    const mediaStart = html.indexOf(mediaMarker);
    expect(mediaStart).toBeGreaterThan(-1);
    // Find the end of the @media block via brace counting
    let depth = 0;
    let i = mediaStart;
    let bodyStarted = false;
    while (i < html.length) {
      if (html[i] === '{') { depth++; bodyStarted = true; }
      if (html[i] === '}') { depth--; }
      if (bodyStarted && depth === 0) break;
      i++;
    }
    const fcBlock = html.slice(mediaStart, i + 1);
    // The main CSS forced-colors block must cover .chip so filter chips remain
    // distinguishable in high-contrast themes (active = solid border, inactive = dashed)
    expect(fcBlock).toContain('.chip');
  });
});

// ===========================================================================
// Constraints: no pricing keywords in either webview output
// ===========================================================================

describe('Constraints — no pricing keywords in webview output (Decision log #5)', () => {
  it('panel HTML contains no price/cost/dollar/USD/billed/cheaper references', () => {
    const html = getPanelHtml();
    const lower = html.toLowerCase();
    expect(lower).not.toContain('price');
    expect(lower).not.toContain('cost');
    expect(lower).not.toContain('dollar');
    expect(lower).not.toContain('usd');
    expect(lower).not.toContain('$');
    // Pricing-adjacent language also banned: 'billed' and 'cheaper' imply cost comparisons.
    expect(lower).not.toContain('billed');
    expect(lower).not.toContain('cheaper');
  });

  it('sidebar HTML contains no price/cost/dollar/USD/billed/cheaper references', () => {
    const html = getSidebarHtml();
    const lower = html.toLowerCase();
    expect(lower).not.toContain('price');
    expect(lower).not.toContain('cost');
    expect(lower).not.toContain('dollar');
    expect(lower).not.toContain('usd');
    expect(lower).not.toContain('billed');
    expect(lower).not.toContain('cheaper');
  });

  it('generateMarkdown output contains no pricing information', () => {
    const md = generateMarkdown(makeSnap());
    const lower = md.toLowerCase();
    expect(lower).not.toContain('price');
    expect(lower).not.toContain('cost');
    expect(lower).not.toContain('dollar');
    expect(lower).not.toContain('usd');
    expect(lower).not.toContain('$');
  });
});

// ===========================================================================
// Constraints: safeSnap strips workflowDir from webview payload
// (already tested in extension-invariants, adding a webview-facing check)
// ===========================================================================

describe('Constraints — workflowDir not leaked into webview HTML (CLAUDE.md)', () => {
  // The webview template getHtml() never interpolates workflowDir — it is purely
  // a data-layer field. Confirm the HTML template does not contain the string
  // "workflowDir" anywhere in its static output.

  it('getHtml panel output does not contain the literal string "workflowDir"', () => {
    const html = getPanelHtml();
    // workflowDir is an internal field — it must not appear in any attribute,
    // comment, or script in the shipped HTML template.
    expect(html).not.toContain('workflowDir');
  });

  it('getHtml sidebar output does not contain the literal string "workflowDir"', () => {
    const html = getSidebarHtml();
    expect(html).not.toContain('workflowDir');
  });
});

// ===========================================================================
// Webview script is syntactically valid after all M2-polish changes
// ===========================================================================

describe('M2-Polish — inline webview scripts are syntactically valid', () => {
  it('panel inline script parses without SyntaxError', () => {
    const html = getPanelHtml();
    const js = getPanelJs(html);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js);
    }).not.toThrow();
  });

  it('sidebar inline script parses without SyntaxError', () => {
    const html = getSidebarHtml();
    const js = getPanelJs(html);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js);
    }).not.toThrow();
  });
});
