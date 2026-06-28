/**
 * Shared test helpers for extracting and inspecting the webview JS/HTML.
 *
 * Canonical implementations — duplicates in individual test files should be
 * replaced with imports from here (M3-tech-debt cleanup: findings F4+F5).
 */

export const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

/**
 * Extract the inline <script> content from the panel-mode HTML produced by
 * getHtml(). Slices from the nonce-tagged <script> open tag to the last
 * </script> close tag, returning just the JS source.
 */
export function getPanelJs(html: string): string {
  const scriptOpen = `<script nonce="${TEST_NONCE}">`;
  const scriptClose = '</script>';
  const scriptStart = html.indexOf(scriptOpen);
  const scriptEnd = html.lastIndexOf(scriptClose);
  return html.slice(scriptStart + scriptOpen.length, scriptEnd);
}

/**
 * Extract a balanced function declaration from a minified JS string.
 * Finds "function <name>(" then walks forward counting braces until the
 * top-level closing brace is found. Returns only that function body.
 *
 * The bodyStarted guard ensures that a '}' before the opening '{' (impossible
 * in valid JS but present as a safety net) does not prematurely terminate the
 * walk. This is the canonical version — the variant in m2-typed-results.ts
 * that drops the guard is subtly less correct.
 */
export function extractBalancedFn(js: string, name: string): string {
  const marker = `function ${name}(`;
  const start = js.indexOf(marker);
  if (start === -1) throw new Error(`${name} not found in webview JS`);
  let depth = 0;
  let i = start;
  let bodyStarted = false;
  while (i < js.length) {
    const ch = js[i];
    if (ch === '{') { depth++; bodyStarted = true; }
    else if (ch === '}') {
      depth--;
      if (bodyStarted && depth === 0) { return js.slice(start, i + 1); }
    }
    i++;
  }
  throw new Error(`${name}: could not find balanced closing brace`);
}
