import { describe, it, expect, beforeAll } from 'vitest';
import { getHtml } from '../src/webview/html';

// REGRESSION GUARD — read this if the test fails.
//
// The webview's inline client <script> is assembled from a JS *template literal*
// (the `JS` const) inside src/webview/html.ts. A single quote written as `\'`
// inside that backtick template is a valid escape that COLLAPSES TO A BARE `'`
// at build time. So a line meant to read:
//
//     return '['+attr+'=\''+CSS.escape(val)+'\']';     // intent: [attr='val']
//
// is emitted into the webview as:
//
//     return '['+attr+'=''+CSS.escape(val)+'']';        // two adjacent string literals!
//
// which is `SyntaxError: Unexpected string`. The ENTIRE inline script then fails
// to parse, the `window.addEventListener('message', …)` snapshot listener never
// attaches, and the dashboard is stuck forever on "Looking for an active workflow
// run…" — it never even reaches the empty-state render. This exact bug shipped in
// M0 because the existing html.test.ts only asserts string markers, not validity.
//
// FIX when this fails with "Unexpected string": inside the JS template literal use
// `\\'` (escaped backslash + quote) so the emitted webview JS contains a real `\'`
// inside its single-quoted string. See the `sel(attr,val)` helper in html.ts.
//
// This test PARSES the generated script (it does not execute it), so any syntax
// error — present or future — fails here loudly instead of silently in the webview.
describe('getHtml: generated inline script is syntactically valid', () => {
  function extractScript(html: string): string {
    const m = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
    expect(m, 'inline <script nonce=…> block must be present in getHtml output').toBeTruthy();
    return (m as RegExpMatchArray)[1] ?? '';
  }

  it('parses without a SyntaxError (default / editor-panel render)', () => {
    const js = extractScript(getHtml('NONCE', 2, 200));
    // new Function() compiles (parses) the body without running it; a syntax
    // error in the generated webview script throws right here.
    // Stub the browser globals referenced at top level so the Function constructor
    // does not throw a ReferenceError before we reach parse validation.
    // The function is constructed but never invoked — parse-time validation only.
    expect(() => new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js)).not.toThrow();
  });

  it('contains no literal </script> that would prematurely close the tag', () => {
    const js = extractScript(getHtml('NONCE', 2, 200));
    expect(/<\/script/i.test(js)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseImplementerMarkdown — pins the RegExp behaviour so future template-literal
// escaping edits break a test rather than silently degrading the typed result view.
// The function is extracted from the panel JS by compiling the script in a sandbox
// and reading it back via the Function return value.
// ---------------------------------------------------------------------------
describe('parseImplementerMarkdown: section extraction', () => {
  // Extract parseImplementerMarkdown from the generated panel JS.
  let parse: (text: string | null | undefined) => string | null;

  beforeAll(() => {
    const html = getHtml('NONCE', 2, 200);
    const m = html.match(/<script nonce="[^"]*">([\s\S]*?)<\/script>/);
    expect(m, 'panel <script> block must be present').toBeTruthy();
    const js = (m as RegExpMatchArray)[1] ?? '';
    // Build a wrapper that returns the parseImplementerMarkdown function.
    // Stub required globals: acquireVsCodeApi (used at top level before parse fn).
    const apiStub = { getState: () => ({}), setState: () => undefined, postMessage: () => undefined };
    const docStub = { getElementById: () => null, querySelectorAll: () => [] };
    const winStub = { addEventListener: () => undefined, scrollY: 0, scrollTo: () => undefined };
    const cssStub = { escape: (s: string) => s };
    const wrapper = new Function(
      'acquireVsCodeApi', 'document', 'window', 'CSS',
      js + '\nreturn parseImplementerMarkdown;'
    );
    parse = wrapper(
      () => apiStub, docStub, winStub, cssStub
    ) as (text: string | null | undefined) => string | null;
    expect(typeof parse).toBe('function');
  });

  it('returns null for null input', () => {
    expect(parse(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parse('')).toBeNull();
  });

  it('returns null for text with no implementation headings', () => {
    expect(parse('Hello world\nNo headings here.')).toBeNull();
  });

  it('returns non-null for text with ## Implementation heading', () => {
    const text = '## Implementation: Foo\n### Status\nCOMPLETE\n';
    const result = parse(text);
    expect(result).not.toBeNull();
    expect(result).toContain('COMPLETE');
  });

  it('returns non-null for text with only ### What Was Built (no other sections)', () => {
    const text = '### What Was Built\nAdded a feature.\n';
    const result = parse(text);
    expect(result).not.toBeNull();
    expect(result).toContain('Added a feature');
  });

  it('parses Status section and applies verdict class for COMPLETE', () => {
    const text = [
      '## Implementation: test',
      '### Status',
      'COMPLETE',
      '',
      '### What Was Built',
      'Built something.',
    ].join('\n');
    const result = parse(text);
    expect(result).not.toBeNull();
    expect(result).toContain('typed-verdict-ok');
    expect(result).toContain('COMPLETE');
  });

  it('parses Status section and applies verdict-bad class for BLOCKED', () => {
    const text = [
      '## Implementation: test',
      '### Status',
      'BLOCKED — missing dependency',
    ].join('\n');
    const result = parse(text);
    expect(result).not.toBeNull();
    expect(result).toContain('typed-verdict-bad');
  });

  it('parses Files Changed section with a markdown table', () => {
    const text = [
      '## Implementation: test',
      '### Status',
      'COMPLETE',
      '### Files Changed',
      '| File | Change |',
      '| --- | --- |',
      '| src/foo.ts | added helper |',
      '| src/bar.ts | updated types |',
    ].join('\n');
    const result = parse(text);
    expect(result).not.toBeNull();
    expect(result).toContain('src/foo.ts');
    expect(result).toContain('src/bar.ts');
    expect(result).toContain('Files changed (2)');
  });

  it('parses all five sections without throwing', () => {
    const text = [
      '## Implementation: full test',
      '### Status',
      'COMPLETE',
      '### What Was Built',
      'Built everything.',
      '### Files Changed',
      '| File | Change |',
      '| --- | --- |',
      '| src/a.ts | new |',
      '### Decisions Made',
      'Used approach X.',
      '### Test Results',
      '42 passed, 0 failed',
    ].join('\n');
    const result = parse(text);
    expect(result).not.toBeNull();
    expect(result).toContain('Built everything');
    expect(result).toContain('src/a.ts');
    expect(result).toContain('Used approach X');
    expect(result).toContain('42 passed');
  });
});
