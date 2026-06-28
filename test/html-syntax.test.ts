import { describe, it, expect } from 'vitest';
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
