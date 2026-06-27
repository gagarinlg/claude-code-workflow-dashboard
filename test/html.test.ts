import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';

// ---------------------------------------------------------------------------
// Helper: extract and evaluate the esc() function from the webview JS.
//
// getHtml() returns a static string — the embedded JS runs in the webview DOM,
// not under tsc. To test that esc() actually escapes a crafted XSS payload we
// extract the function definition from the template string and evaluate it in
// a sandboxed Function call. This is safe here (test-only, trusted source).
// ---------------------------------------------------------------------------
function extractEscFn(html: string): (s: unknown) => string {
  // esc is defined on a single line: function esc(s){...}
  // Match from "function esc" to the end of that logical line.
  // The function body contains nested braces so we can't use [^}]+.
  // Instead we extract the line that contains the declaration.
  const lines = html.split('\n');
  const line = lines.find((l) => l.includes('function esc(s)'));
  if (!line) throw new Error('esc() not found in getHtml() output');
  // Extract just the function definition by finding the balanced close.
  // Since the declaration and body are on one line we take everything from
  // "function esc" to the end of that token sequence.
  const start = line.indexOf('function esc(s)');
  const snippet = line.slice(start);
  // Wrap in a factory so we can return the function value.
  // new Function is intentional: evaluating trusted source extracted from getHtml().
  return new Function(`${snippet}\nreturn esc;`)() as (s: unknown) => string;
}

describe('getHtml', () => {
  it('returns a non-empty string', () => {
    const html = getHtml();
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the CSP meta tag', () => {
    expect(getHtml()).toContain('Content-Security-Policy');
  });

  it('contains the root element id', () => {
    expect(getHtml()).toContain('id="root"');
  });

  it('contains the bar element id', () => {
    expect(getHtml()).toContain('id="bar"');
  });

  it('contains the refreshBtn', () => {
    expect(getHtml()).toContain('id="refreshBtn"');
  });

  it('contains the guideBtn', () => {
    expect(getHtml()).toContain('id="guideBtn"');
  });

  it('contains the toggles element', () => {
    expect(getHtml()).toContain('id="toggles"');
  });

  it('contains the esc() helper with quote escaping (sev-key XSS fix)', () => {
    // The fix extended esc() to also escape " and ' — verify both are present
    const html = getHtml();
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('applies esc() to the severity key in overview() (sev-key XSS fix)', () => {
    // The fix: for(const s in L.sevTotals){const es=esc(s);sev+=...es...es...}
    const html = getHtml();
    expect(html).toContain('const es=esc(s)');
  });

  it('is idempotent — returns the same output on repeated calls', () => {
    expect(getHtml()).toBe(getHtml());
  });

  it('DOCTYPE declaration is present', () => {
    expect(getHtml()).toContain('<!DOCTYPE html>');
  });

  // -------------------------------------------------------------------------
  // XSS: exercise the embedded esc() function against a crafted severity key
  // -------------------------------------------------------------------------
  it('esc() escapes < and > in a crafted severity key (HTML-injection prevention)', () => {
    const esc = extractEscFn(getHtml());
    // An attacker-crafted severity string containing an HTML injection attempt
    const malicious = '<script>alert(1)</script>';
    const escaped = esc(malicious);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).toContain('&lt;');
    expect(escaped).toContain('&gt;');
  });

  it('esc() escapes & in crafted severity key', () => {
    const esc = extractEscFn(getHtml());
    expect(esc('HIGH & CRITICAL')).toContain('&amp;');
    expect(esc('HIGH & CRITICAL')).not.toContain(' & ');
  });

  it('esc() escapes double-quotes in crafted severity key (prevents attribute injection)', () => {
    const esc = extractEscFn(getHtml());
    // A severity like: HIGH" class="injected
    const malicious = 'HIGH" class="injected';
    const escaped = esc(malicious);
    expect(escaped).toContain('&quot;');
    expect(escaped).not.toContain('"');
  });

  it('esc() escapes single-quotes in crafted severity key', () => {
    const esc = extractEscFn(getHtml());
    const malicious = "HIGH' onmouseover='alert(1)";
    const escaped = esc(malicious);
    expect(escaped).toContain('&#39;');
    expect(escaped).not.toContain("'");
  });

  it('esc() returns empty string for null/undefined input', () => {
    const esc = extractEscFn(getHtml());
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });
});
