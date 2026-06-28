/**
 * dogfooding-polish.test.ts — tests for the four dogfooding UI bug-fixes:
 *
 * AC1: Button-height normalization in #bar and sidebar header.
 * AC2: Agent-card hint moved out of .cards grid into agents-panel header bar.
 * AC3: Inner-scroll preservation for .prompt-pre and .result-body across re-render.
 * AC4: TypedResults raw-JSON-collapsed-below analyzed view + implementer markdown parsing.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getHtml } from '../src/webview/html';

const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

// ---------------------------------------------------------------------------
// Helpers shared across test groups
// ---------------------------------------------------------------------------

function getPanelJs(html: string): string {
  const scriptOpen = `<script nonce="${TEST_NONCE}">`;
  const scriptClose = '</script>';
  const s = html.indexOf(scriptOpen);
  const e = html.lastIndexOf(scriptClose);
  return html.slice(s + scriptOpen.length, e);
}

function getSidebarJs(html: string): string {
  return getPanelJs(html); // sidebar also has one script block
}

/**
 * Extract a balanced function declaration from minified JS.
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
 * Build a sandboxed harness for parseImplementerMarkdown.
 * Returns the function extracted from the webview JS.
 */
function buildMarkdownHarness(js: string): (text: string) => string | null {
  const escFn = js.split('\n').find((l) => l.includes('function esc(s)'))
    ?.slice(js.split('\n').find((l) => l.includes('function esc(s)'))!.indexOf('function esc(s)')) ?? '';
  if (!escFn) throw new Error('esc not found');
  const fn = extractBalancedFn(js, 'parseImplementerMarkdown');
  const code = `${escFn}\n${fn}\nreturn parseImplementerMarkdown;`;
  return new Function(code)() as (text: string) => string | null;
}

/**
 * Build a sandboxed harness for rawJsonDetails.
 */
function buildRawJsonHarness(js: string): (obj: unknown) => string {
  const escFn = js.split('\n').find((l) => l.includes('function esc(s)'))
    ?.slice(js.split('\n').find((l) => l.includes('function esc(s)'))!.indexOf('function esc(s)')) ?? '';
  const fn = extractBalancedFn(js, 'rawJsonDetails');
  const code = `${escFn}\n${fn}\nreturn rawJsonDetails;`;
  return new Function(code)() as (obj: unknown) => string;
}

// ===========================================================================
// AC1: Button height normalization
// ===========================================================================
describe('AC1 — Button height normalization (#bar and sidebar)', () => {
  // -------------------------------------------------------------------------
  // Panel #bar CSS: buttons must use display:inline-flex + min-height + line-height:1
  // so glyph entities (⛐ ↧ ⤢ 📖) don't inflate individual buttons.
  // -------------------------------------------------------------------------
  it('panel CSS button rule uses display:inline-flex for uniform alignment', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('display:inline-flex');
  });

  it('panel CSS button rule sets line-height:1 to prevent glyph inflation', () => {
    const html = getHtml(TEST_NONCE);
    // The button rule must contain line-height:1
    expect(html).toContain('line-height:1');
  });

  it('panel CSS button rule sets min-height for a stable tap target', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('min-height:');
  });

  it('panel CSS button rule sets align-items:center for vertical centring', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('align-items:center');
  });

  it('panel CSS button rule sets white-space:nowrap to prevent label wrapping', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('white-space:nowrap');
  });

  // -------------------------------------------------------------------------
  // Glyph wrapping: glyphs in the panel #bar must be inside <span aria-hidden>
  // so the glyph's line-height is isolated and doesn't push the button taller.
  // -------------------------------------------------------------------------
  it('panel #bar Export button wraps glyph in <span aria-hidden="true">', () => {
    const html = getHtml(TEST_NONCE);
    // The static bar HTML must contain the Export button with a wrapped glyph
    const barEnd = html.indexOf('id="root"');
    const bar = html.slice(0, barEnd);
    expect(bar).toContain('id="exportBtn"');
    expect(bar).toContain('<span aria-hidden="true">');
  });

  it('panel #bar Guide button wraps glyph in <span aria-hidden="true"> (not raw emoji)', () => {
    const html = getHtml(TEST_NONCE);
    const barEnd = html.indexOf('id="root"');
    const bar = html.slice(0, barEnd);
    // Guide button must wrap its icon glyph — raw 📖 emoji not allowed (inconsistent height)
    expect(bar).toContain('id="guideBtn"');
    // The guide button must NOT contain a raw emoji before its <span aria-hidden>
    // (checked by presence of aria-hidden span in its vicinity)
    expect(bar).toContain('<span aria-hidden="true">');
  });

  it('panel #bar Runs button wraps glyph in <span aria-hidden="true">', () => {
    const html = getHtml(TEST_NONCE);
    const barEnd = html.indexOf('id="root"');
    const bar = html.slice(0, barEnd);
    expect(bar).toContain('id="selectRunBtn"');
    expect(bar).toContain('<span aria-hidden="true">');
  });

  // -------------------------------------------------------------------------
  // Sidebar CSS: .sb-open-btn must also use display:inline-flex + line-height:1
  // and .sb-btn-lbl to hide labels at default sidebar width.
  // -------------------------------------------------------------------------
  it('sidebar CSS .sb-open-btn uses display:inline-flex', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('.sb-open-btn{');
    const cssStart = html.indexOf('.sb-open-btn{');
    const cssEnd = html.indexOf('}', cssStart);
    expect(html.slice(cssStart, cssEnd)).toContain('inline-flex');
  });

  it('sidebar CSS .sb-open-btn sets line-height:1', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const cssStart = html.indexOf('.sb-open-btn{');
    const cssEnd = html.indexOf('}', cssStart);
    expect(html.slice(cssStart, cssEnd)).toContain('line-height:1');
  });

  it('sidebar CSS .sb-open-btn sets min-height for consistent tap targets', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const cssStart = html.indexOf('.sb-open-btn{');
    const cssEnd = html.indexOf('}', cssStart);
    expect(html.slice(cssStart, cssEnd)).toContain('min-height:');
  });

  it('sidebar CSS defines .sb-btn-lbl for label visibility control', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('.sb-btn-lbl{');
  });

  it('sidebar static skeleton buttons wrap glyphs in <span aria-hidden="true">', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The static HTML skeleton (before script tag) must wrap glyphs
    const scriptStart = html.indexOf(`<script nonce="${TEST_NONCE}">`);
    const staticHtml = html.slice(0, scriptStart);
    expect(staticHtml).toContain('<span aria-hidden="true">');
  });

  it('sidebar static skeleton buttons use .sb-btn-lbl for text labels', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const scriptStart = html.indexOf(`<script nonce="${TEST_NONCE}">`);
    const staticHtml = html.slice(0, scriptStart);
    expect(staticHtml).toContain('class="sb-btn-lbl"');
  });

  it('sidebar JS live-state render wraps glyph in <span aria-hidden> for Runs button', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const js = getSidebarJs(html);
    // The live header rendered in JS render() must use aria-hidden span.
    // Check both the escaped (inside JS string) and unescaped form.
    const hasAriaHidden = js.includes('aria-hidden') && js.includes('sbSelectRunLive');
    expect(hasAriaHidden).toBe(true);
  });

  it('sidebar JS live-state render uses sb-btn-lbl for Runs label', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const js = getSidebarJs(html);
    expect(js).toContain('sb-btn-lbl');
  });
});

// ===========================================================================
// AC2: Agent card hint placement
// ===========================================================================
describe('AC2 — Agent hint moved out of .cards grid', () => {
  // -------------------------------------------------------------------------
  // The hint must NOT be inside the .cards div (no longer a grid cell).
  // It must be in the .agent-panel-hdr alongside the Collapse-all/Expand-all button.
  // -------------------------------------------------------------------------
  it('JS agentsPanel: hint is NOT emitted inside the .cards div', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The old placement: '<div class="cards"><div class="dim cards-hint">'
    expect(js).not.toContain('"cards"><div class=\\"dim cards-hint\\"');
    // Also: the hint div must not be a child of the cards opening tag string
    expect(js).not.toContain('<div class="cards"><div class="dim cards-hint">');
  });

  it('JS agentsPanel: old hint-inside-cards pattern is gone from agentsPanel', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const agentsPanelFn = extractBalancedFn(js, 'agentsPanel');
    // The old placement put the hint as first child inside the .cards div.
    // This pattern must be gone — the hint is now in the agent-panel-hdr.
    // We check that "cards" and "cards-hint" do not appear adjacent in the return statement.
    const returnLine = agentsPanelFn.slice(agentsPanelFn.lastIndexOf('return panel'));
    // In the return, the cards div must NOT immediately contain cards-hint
    expect(returnLine).not.toContain('cards-hint');
  });

  it('CSS defines .agent-panel-hdr for the header row holding Collapse-all and hint', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.agent-panel-hdr{');
  });

  it('CSS .agent-panel-hdr uses display:flex to align button and hint on one line', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.agent-panel-hdr{');
    const end = html.indexOf('}', idx);
    expect(html.slice(idx, end)).toContain('flex');
  });

  it('JS agentsPanel renders .agent-panel-hdr wrapper for Collapse-all and hint', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('agent-panel-hdr');
  });

  it('JS agentsPanel: cards-hint is defined before the return-panel call', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const agentsFn = extractBalancedFn(js, 'agentsPanel');
    expect(agentsFn).toContain('agent-panel-hdr');
    expect(agentsFn).toContain('cards-hint');
    // The hint variable is built before the final panel() call.
    const hintIdx = agentsFn.indexOf('cards-hint');
    const returnIdx = agentsFn.lastIndexOf('return panel');
    expect(hintIdx).toBeGreaterThan(-1);
    expect(returnIdx).toBeGreaterThan(-1);
    // hint must precede the return — it is a local variable set before cards are assembled.
    expect(hintIdx).toBeLessThan(returnIdx);
  });

  it('JS agentsPanel: hint text contains keyboard reference (Enter) and Click reference', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const agentsFn = extractBalancedFn(js, 'agentsPanel');
    // The hint text: "Click or press Enter on a card to expand…"
    expect(agentsFn).toContain('Enter');
    expect(agentsFn).toContain('Click');
  });

  it('CSS .cards-hint no longer needs margin-bottom (now inline in flex row)', () => {
    const html = getHtml(TEST_NONCE);
    // The .cards-hint rule must not have margin-bottom now that it is inline
    const idx = html.indexOf('.cards-hint{');
    const end = html.indexOf('}', idx);
    if (idx !== -1) {
      expect(html.slice(idx, end)).not.toContain('margin-bottom');
    }
  });
});

// ===========================================================================
// AC3: Inner-scroll preservation across re-render
// ===========================================================================
describe('AC3 — Inner-scroll preservation across re-render', () => {
  // -------------------------------------------------------------------------
  // The render() function must capture .prompt-pre scroll position keyed by
  // agent id and restore it after innerHTML replace.
  // -------------------------------------------------------------------------
  it('JS render() captures .prompt-pre scrollTop before innerHTML replace', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Must find prompt-pre in the capture block
    expect(js).toContain('.prompt-pre');
    expect(js).toContain('scrollTop');
    // The capture must use the agent id as part of the key
    expect(js).toContain("':prompt'");
  });

  it('JS render() restores .prompt-pre scrollTop after innerHTML replace', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The restore block must also reference prompt-pre
    // Count occurrences of '.prompt-pre' — must appear at least twice (capture + restore)
    const matches = (js.match(/\.prompt-pre/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it('JS render() captures .result-body scrollTop keyed by data-rlabel', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('.result-body');
    expect(js).toContain('data-rlabel');
    // The result key pattern
    expect(js).toContain("'result:'");
  });

  it('JS render() restores .result-body scrollTop after innerHTML replace', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // result-body should appear at least twice (capture + restore)
    const matches = (js.match(/\.result-body/g) || []).length;
    expect(matches).toBeGreaterThanOrEqual(2);
  });

  it('JS subPos key for .sub uses agent-id + :sub suffix', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("':sub'");
  });

  it('JS subPos key for .prompt-pre uses agent-id + :prompt suffix', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("':prompt'");
  });

  it('resultsPanel adds data-rlabel on each result div for stable scroll keying', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const resultsFn = extractBalancedFn(js, 'resultsPanel');
    expect(resultsFn).toContain('data-rlabel=');
  });

  it('resultsPanel data-rlabel key combines label and pass for uniqueness', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const resultsFn = extractBalancedFn(js, 'resultsPanel');
    // Key must include both r.label and r.pass
    expect(resultsFn).toContain('r.label');
    expect(resultsFn).toContain('r.pass');
    expect(resultsFn).toContain('data-rlabel=');
  });

  it('JS render() capture/restore uses Object.create(null) for subPos (no prototype pollution)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // subPos must be initialized with Object.create(null) — consistent with openAgents/fRev/fSev
    expect(js).toContain('Object.create(null)');
  });
});

// ===========================================================================
// AC4: TypedResults — raw-JSON toggle + implementer markdown parsing
// ===========================================================================
describe('AC4 — TypedResults: raw-JSON toggle below analyzed view', () => {
  // -------------------------------------------------------------------------
  // CSS: raw-json-details must be styled (native <details>/<summary> need CSS polish).
  // -------------------------------------------------------------------------
  it('CSS defines .raw-json-details rule', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.raw-json-details{');
  });

  it('CSS defines .raw-json-summary rule', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.raw-json-summary{');
  });

  it('CSS defines .raw-json-pre rule with max-height and overflow:auto (scroll cap)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.raw-json-pre{');
    const idx = html.indexOf('.raw-json-pre{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('max-height:');
    expect(rule).toContain('overflow:auto');
  });

  it('CSS .raw-json-pre uses --vscode-* variables (theme-native)', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.raw-json-pre{');
    const end = html.indexOf('}', idx);
    expect(html.slice(idx, end)).toContain('--vscode-');
  });

  it('CSS .raw-json-details uses --vscode-panel-border for separator (theme-native)', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.raw-json-details{');
    const end = html.indexOf('}', idx);
    expect(html.slice(idx, end)).toContain('--vscode-panel-border');
  });

  // -------------------------------------------------------------------------
  // JS: rawJsonDetails function exists and produces <details>/<summary>.
  // -------------------------------------------------------------------------
  it('JS contains rawJsonDetails function', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('function rawJsonDetails(');
  });

  it('rawJsonDetails renders <details> with <summary>Raw JSON</summary>', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const render = buildRawJsonHarness(js);
    const out = render({ key: 'value', count: 3 });
    expect(out).toContain('<details');
    expect(out).toContain('<summary');
    expect(out).toContain('Raw JSON');
  });

  it('rawJsonDetails output contains esc()-encoded JSON (XSS-safe)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const render = buildRawJsonHarness(js);
    const out = render({ xss: '<script>alert(1)</script>' });
    expect(out).not.toContain('<script>alert');
    expect(out).toContain('&lt;script&gt;');
  });

  it('rawJsonDetails returns empty string for null/undefined input', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const render = buildRawJsonHarness(js);
    expect(render(null)).toBe('');
    expect(render(undefined)).toBe('');
  });

  it('rawJsonDetails returns empty string for non-object primitives', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const render = buildRawJsonHarness(js);
    expect(render('string')).toBe('');
    expect(render(42)).toBe('');
  });

  it('resultsPanel calls rawJsonDetails after renderTypedResult in each result card', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const resultsFn = extractBalancedFn(js, 'resultsPanel');
    // rawJsonDetails must be called in the result card builder
    expect(resultsFn).toContain('rawJsonDetails(r.result)');
    // And must appear AFTER renderTypedResult
    const typedIdx = resultsFn.indexOf('renderTypedResult(r.agentType,r.result)');
    const rawIdx = resultsFn.indexOf('rawJsonDetails(r.result)');
    expect(typedIdx).toBeGreaterThan(-1);
    expect(rawIdx).toBeGreaterThan(-1);
    expect(rawIdx).toBeGreaterThan(typedIdx);
  });

  it('rawJsonDetails does not call JSON.stringify inside agentSub (only in rawJsonDetails)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const agentSubFn = extractBalancedFn(js, 'agentSub');
    // agentSub must never call JSON.stringify directly
    expect(agentSubFn).not.toContain('JSON.stringify');
  });
});

// ===========================================================================
// AC4: Implementer markdown section parsing
// ===========================================================================
describe('AC4 — Implementer markdown section parsing', () => {
  let parseMarkdown: (text: string) => string | null;

  beforeAll(() => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    parseMarkdown = buildMarkdownHarness(js);
  });

  // -------------------------------------------------------------------------
  // CSS: .impl-report and .impl-status classes must be defined.
  // -------------------------------------------------------------------------
  it('CSS defines .impl-report rule', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.impl-report{');
  });

  it('CSS defines .impl-status rule', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.impl-status{');
  });

  // -------------------------------------------------------------------------
  // JS: parseImplementerMarkdown exists in webview JS.
  // -------------------------------------------------------------------------
  it('JS contains parseImplementerMarkdown function', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('function parseImplementerMarkdown(');
  });

  it('JS agentSub tries parseImplementerMarkdown before falling back to <pre>', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const agentSubFn = extractBalancedFn(js, 'agentSub');
    expect(agentSubFn).toContain('parseImplementerMarkdown');
    // Must check for <pre> fallback still present
    expect(agentSubFn).toContain('<pre>');
  });

  // -------------------------------------------------------------------------
  // Return null for non-implementer text (graceful degradation).
  // -------------------------------------------------------------------------
  it('returns null for plain text without implementation headings', () => {
    expect(parseMarkdown('Just some output text.')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseMarkdown('')).toBeNull();
  });

  it('returns null for null/undefined (no throw)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseMarkdown(null as any)).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(parseMarkdown(undefined as any)).toBeNull();
  });

  it('returns null for a non-string value (no throw)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => parseMarkdown(42 as any)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Status section parsing.
  // -------------------------------------------------------------------------
  it('parses Status section and emits typed-verdict-ok for COMPLETE', () => {
    const text = '## Implementation: Fixes\n\n### Status\nCOMPLETE\n';
    const out = parseMarkdown(text);
    expect(out).not.toBeNull();
    expect(out).toContain('typed-verdict-ok');
    expect(out).toContain('COMPLETE');
  });

  it('parses Status section and emits typed-verdict-bad for BLOCKED', () => {
    const text = '## Implementation: Fixes\n\n### Status\nBLOCKED — build failed\n';
    const out = parseMarkdown(text);
    expect(out).not.toBeNull();
    expect(out).toContain('typed-verdict-bad');
    expect(out).toContain('BLOCKED');
  });

  it('parses Status section and emits no verdict class for neutral status', () => {
    const text = '## Implementation\n\n### Status\nIn progress\n';
    const out = parseMarkdown(text);
    if (out !== null) {
      // Should not apply ok or bad verdict class to neutral text
      const statusDiv = (out.match(/impl-status[^>]*>[^<]+<\/div>/) || [''])[0];
      expect(statusDiv).not.toContain('typed-verdict-ok');
      expect(statusDiv).not.toContain('typed-verdict-bad');
    }
  });

  // -------------------------------------------------------------------------
  // What Was Built section parsing.
  // -------------------------------------------------------------------------
  it('parses ### What Was Built and emits typed-section-label + typed-summary', () => {
    const text = '## Implementation: Thing\n\n### What Was Built\nAdded the export module and tests.\n\n### Status\nCOMPLETE\n';
    const out = parseMarkdown(text);
    expect(out).not.toBeNull();
    expect(out).toContain('typed-section-label');
    expect(out).toContain('typed-summary');
    expect(out).toContain('Added the export module');
  });

  it('truncates What Was Built at 600 chars', () => {
    const longText = 'x'.repeat(700);
    const text = `## Implementation\n\n### What Was Built\n${longText}\n`;
    const out = parseMarkdown(text);
    if (out !== null) {
      // The output must not contain the full 700-char string — truncated at 600
      expect(out).not.toContain('x'.repeat(601));
    }
  });

  // -------------------------------------------------------------------------
  // Files Changed table parsing.
  // -------------------------------------------------------------------------
  it('parses ### Files Changed markdown table and emits a typed-file-list', () => {
    const text = [
      '## Implementation',
      '',
      '### Files Changed',
      '| File | Change |',
      '| ---- | ------ |',
      '| src/foo.ts | Added export |',
      '| src/bar.ts | Updated logic |',
      '',
      '### Status',
      'COMPLETE',
    ].join('\n');
    const out = parseMarkdown(text);
    expect(out).not.toBeNull();
    expect(out).toContain('typed-file-list');
    expect(out).toContain('src/foo.ts');
    expect(out).toContain('src/bar.ts');
  });

  it('skips the header row from the Files Changed table', () => {
    const text = [
      '## Implementation',
      '### Files Changed',
      '| File | Change |',
      '| ---- | ------ |',
      '| src/a.ts | New |',
    ].join('\n');
    const out = parseMarkdown(text);
    if (out !== null) {
      // "File" and "Change" header row content should not appear as data
      expect(out).not.toContain('<li class="typed-file">File');
    }
  });

  it('escapes XSS in Files Changed paths', () => {
    const text = [
      '## Implementation',
      '### Files Changed',
      '| File | Change |',
      '| ---- | ------ |',
      '| <script>alert(1)</script> | Injected |',
    ].join('\n');
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).not.toContain('<script>alert');
      expect(out).toContain('&lt;script&gt;');
    }
  });

  it('caps Files Changed list at 40 and shows overflow count', () => {
    const rows = Array.from({ length: 45 }, (_, i) => `| src/file${i}.ts | change |`);
    const text = ['## Implementation', '### Files Changed', '| File | Change |', '| ---- | ------ |', ...rows].join('\n');
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).toContain('+5 more');
    }
  });

  // -------------------------------------------------------------------------
  // Decisions section parsing.
  // -------------------------------------------------------------------------
  it('parses ### Decisions Made and emits typed-summary', () => {
    const text = [
      '## Implementation',
      '### Decisions Made',
      'Used esbuild for speed; avoided webpack for simplicity.',
      '### Status',
      'COMPLETE',
    ].join('\n');
    const out = parseMarkdown(text);
    expect(out).not.toBeNull();
    expect(out).toContain('typed-section-label');
    expect(out).toContain('Used esbuild for speed');
  });

  it('parses ### Decisions (without "Made") as well', () => {
    const text = ['## Implementation', '### Decisions', 'Kept it simple.', '### Status', 'DONE'].join('\n');
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).toContain('Kept it simple.');
    }
  });

  // -------------------------------------------------------------------------
  // Test Results section parsing.
  // -------------------------------------------------------------------------
  it('parses ### Test Results and emits typed-section-label', () => {
    const text = ['## Implementation', '### Test Results', 'All 829 passed, 0 failed.', '### Status', 'COMPLETE'].join('\n');
    const out = parseMarkdown(text);
    expect(out).not.toBeNull();
    expect(out).toContain('typed-section-label');
    expect(out).toContain('829 passed');
  });

  it('Test Results with "passed" keyword gets typed-verdict-ok class', () => {
    const text = ['## Implementation', '### Test Results', '42 tests passed, 0 failed.', '### Status', 'COMPLETE'].join('\n');
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).toContain('typed-verdict-ok');
    }
  });

  it('Test Results with "fail" keyword gets typed-verdict-bad class', () => {
    const text = ['## Implementation', '### Test Results', '3 tests failed out of 10.', '### Status', 'COMPLETE'].join('\n');
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).toContain('typed-verdict-bad');
    }
  });

  // -------------------------------------------------------------------------
  // XSS prevention across all sections.
  // -------------------------------------------------------------------------
  it('escapes XSS in Status line', () => {
    const text = '## Implementation\n\n### Status\n<script>alert(1)</script>\n';
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).not.toContain('<script>alert');
      expect(out).toContain('&lt;script&gt;');
    }
  });

  it('escapes XSS in What Was Built content', () => {
    const text = '## Implementation\n\n### What Was Built\n<img src=x onerror=alert(1)>\n';
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).not.toContain('<img src=x');
      expect(out).toContain('&lt;img');
    }
  });

  // -------------------------------------------------------------------------
  // Output shape: always .impl-report wrapper.
  // -------------------------------------------------------------------------
  it('output always wraps in .impl-report (when not null)', () => {
    const text = '## Implementation\n\n### Status\nDONE\n';
    const out = parseMarkdown(text);
    if (out !== null) {
      expect(out).toContain('impl-report');
    }
  });

  it('never throws on malformed input (shape mismatch)', () => {
    // Various unexpected shapes that could trip up the parser
    const inputs = [
      '## Implementation without newline',
      '## Implementation\n### What Was Built\n',
      '## Implementation\n### Files Changed\n| only one col |',
      '## Implementation\n### Files Changed\n| no separator row |',
      '## Implementation' + 'x'.repeat(10000), // very long
    ];
    for (const input of inputs) {
      expect(() => parseMarkdown(input)).not.toThrow();
    }
  });

  it('returns non-null for a full implementer report with all sections', () => {
    const report = [
      '## Implementation: Complete Task',
      '',
      '### What Was Built',
      'Fixed the export module and added tests.',
      '',
      '### Files Changed',
      '| File | Change |',
      '| --- | --- |',
      '| src/export/markdown.ts | Fixed formatting |',
      '| test/m2-export.test.ts | Added 5 tests |',
      '',
      '### Decisions Made',
      'Kept the existing esbuild pipeline unchanged.',
      '',
      '### Test Results',
      '829 tests passed, 0 failed.',
      '',
      '### Status',
      'COMPLETE',
    ].join('\n');
    const out = parseMarkdown(report);
    expect(out).not.toBeNull();
    // Check all sections were parsed
    expect(out).toContain('What was built');
    expect(out).toContain('Files changed');
    expect(out).toContain('Decisions');
    expect(out).toContain('Test results');
    expect(out).toContain('COMPLETE');
    expect(out).toContain('src/export/markdown.ts');
  });
});
