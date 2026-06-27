import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';
import { CHANGED_MAX_SECS } from '../src/data/snapshot';

const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

// ---------------------------------------------------------------------------
// Helper: extract and evaluate the esc() function from the webview JS.
//
// getHtml(TEST_NONCE) returns a static string — the embedded JS runs in the webview DOM,
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
  if (!line) throw new Error('esc() not found in getHtml(TEST_NONCE) output');
  // Extract just the function definition by finding the balanced close.
  // Since the declaration and body are on one line we take everything from
  // "function esc" to the end of that token sequence.
  const start = line.indexOf('function esc(s)');
  const snippet = line.slice(start);
  // Wrap in a factory so we can return the function value.
  // new Function is intentional: evaluating trusted source extracted from getHtml(TEST_NONCE).
  return new Function(`${snippet}\nreturn esc;`)() as (s: unknown) => string;
}

describe('getHtml', () => {
  it('returns a non-empty string', () => {
    const html = getHtml(TEST_NONCE);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains the CSP meta tag', () => {
    expect(getHtml(TEST_NONCE)).toContain('Content-Security-Policy');
  });

  it('contains the root element id', () => {
    expect(getHtml(TEST_NONCE)).toContain('id="root"');
  });

  it('contains the bar element id', () => {
    expect(getHtml(TEST_NONCE)).toContain('id="bar"');
  });

  it('contains the refreshBtn', () => {
    expect(getHtml(TEST_NONCE)).toContain('id="refreshBtn"');
  });

  it('contains the guideBtn', () => {
    expect(getHtml(TEST_NONCE)).toContain('id="guideBtn"');
  });

  it('contains the toggles element', () => {
    expect(getHtml(TEST_NONCE)).toContain('id="toggles"');
  });

  it('contains the esc() helper with quote escaping (sev-key XSS fix)', () => {
    // The fix extended esc() to also escape " and ' — verify both are present
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
  });

  it('applies esc() to the severity key in overview() (sev-key XSS fix)', () => {
    // The fix: for(const s in L.sevTotals){const es=esc(s);sev+=...es...es...}
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('const es=esc(s)');
  });

  it('is idempotent — returns the same output on repeated calls', () => {
    expect(getHtml(TEST_NONCE)).toBe(getHtml(TEST_NONCE));
  });

  it('DOCTYPE declaration is present', () => {
    expect(getHtml(TEST_NONCE)).toContain('<!DOCTYPE html>');
  });

  // -------------------------------------------------------------------------
  // XSS: exercise the embedded esc() function against a crafted severity key
  // -------------------------------------------------------------------------
  it('esc() escapes < and > in a crafted severity key (HTML-injection prevention)', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    // An attacker-crafted severity string containing an HTML injection attempt
    const malicious = '<script>alert(1)</script>';
    const escaped = esc(malicious);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).toContain('&lt;');
    expect(escaped).toContain('&gt;');
  });

  it('esc() escapes & in crafted severity key', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    expect(esc('HIGH & CRITICAL')).toContain('&amp;');
    expect(esc('HIGH & CRITICAL')).not.toContain(' & ');
  });

  it('esc() escapes double-quotes in crafted severity key (prevents attribute injection)', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    // A severity like: HIGH" class="injected
    const malicious = 'HIGH" class="injected';
    const escaped = esc(malicious);
    expect(escaped).toContain('&quot;');
    expect(escaped).not.toContain('"');
  });

  it('esc() escapes single-quotes in crafted severity key', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    const malicious = "HIGH' onmouseover='alert(1)";
    const escaped = esc(malicious);
    expect(escaped).toContain('&#39;');
    expect(escaped).not.toContain("'");
  });

  it('esc() returns empty string for null/undefined input', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  // -------------------------------------------------------------------------
  // CSP nonce — verify the nonce is threaded into both the CSP header and the
  // <script> tag so the legitimate script is allowed.
  // -------------------------------------------------------------------------
  it('CSP uses nonce-based script-src, not unsafe-inline', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain(`'nonce-${TEST_NONCE}'`);
    // script-src must NOT use 'unsafe-inline'; style-src may still use it.
    const cspMatch = html.match(/Content-Security-Policy[^>]+content="([^"]+)"/);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch![1]!;
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
  });

  it('script tag carries the nonce attribute', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain(`<script nonce="${TEST_NONCE}">`);
  });

  // -------------------------------------------------------------------------
  // XSS regression: agentSub() severity escaping
  // -------------------------------------------------------------------------
  it('agentSub uses var es=esc() pattern for severity (not raw f.severity)', () => {
    // The fix: a.findings.map(f=>{var es=esc(f.severity||'UNRATED');return ...'sev '+es...
    const html = getHtml(TEST_NONCE);
    // Must contain the escaped-variable pattern in agentSub
    expect(html).toContain("var es=esc(f.severity||'UNRATED')");
  });

  // -------------------------------------------------------------------------
  // XSS regression: findingsPanel() chip builder severity escaping
  // -------------------------------------------------------------------------
  it('findingsPanel chip builder escapes a crafted severity key in data-sev AND text (XSS-safe, no breakout)', () => {
    const html = getHtml(TEST_NONCE);
    const esc = extractEscFn(html);
    // Behavioural test: run the ACTUAL chip-builder statement from the webview JS against a
    // crafted severity key, instead of asserting fragile generated-source substrings. The
    // severity key is transcript-derived (untrusted), so it must never break out of the
    // data-sev attribute or inject markup. (Escaping round-trips: the browser decodes entities
    // on parse, so el.dataset.sev returns the raw key — state lookups are unaffected.)
    const line = html.split('\n').find((l) => l.includes('data-sev="'));
    if (!line) throw new Error('chip builder (data-sev=) not found in getHtml output');
    // new Function is intentional: evaluating trusted source extracted from getHtml().
    const buildChips = new Function(
      'sevs', 'state', 'esc', `let chips='';${line}\nreturn chips;`,
    ) as (sevs: string[], state: { fSev: Record<string, unknown> }, esc: (s: unknown) => string) => string;

    const payload = '"><img src=x onerror=alert(1)>';
    const chips = buildChips([payload], { fSev: {} }, esc);
    // No attribute breakout and no live markup — the payload is fully escaped.
    expect(chips).not.toContain('<img');
    expect(chips).not.toContain('"><');
    // The escaped form is present (used for both data-sev and the visible text).
    expect(chips).toContain(esc(payload));
    expect(chips).not.toContain(`data-sev="${payload}"`);
    // A normal enum severity is byte-identical (esc is a no-op), so the state-key round-trip
    // and existing behaviour are preserved.
    expect(buildChips(['HIGH'], { fSev: {} }, esc)).toContain('data-sev="HIGH"');
  });

  // -------------------------------------------------------------------------
  // XSS regression: findingsPanel() finding row severity escaping
  // -------------------------------------------------------------------------
  it('findingsPanel finding row uses esev=esc() for severity class and text', () => {
    const html = getHtml(TEST_NONCE);
    // The fix introduces: var esev=esc(f.severity||'UNRATED');
    expect(html).toContain("var esev=esc(f.severity||'UNRATED')");
  });

  // -------------------------------------------------------------------------
  // XSS regression: agentsPanel() a.id in data-aid
  // -------------------------------------------------------------------------
  it('agentsPanel escapes a.id in data-aid attribute via esc()', () => {
    const html = getHtml(TEST_NONCE);
    // The fix wraps a.id with esc(): data-aid="'+esc(a.id)+'"
    expect(html).toContain('esc(a.id)');
    // Must NOT contain the raw unescaped form
    expect(html).not.toContain('"data-aid=\\"\'"+a.id+');
  });

  // -------------------------------------------------------------------------
  // Error-state buttons: emptyRefresh and emptyGuide IDs + wiring
  // -------------------------------------------------------------------------
  it('error-state HTML contains emptyRefresh and emptyGuide button ids', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('id="emptyRefresh"');
    expect(html).toContain('id="emptyGuide"');
  });

  it('JS contains null-guarded getElementById wiring for emptyRefresh and emptyGuide', () => {
    const html = getHtml(TEST_NONCE);
    // The null-guarded patterns: var er=...; if(er)er.onclick=... and var eg=...; if(eg)eg.onclick=...
    expect(html).toContain('if(er)er.onclick');
    expect(html).toContain('if(eg)eg.onclick');
  });

  // -------------------------------------------------------------------------
  // Static bar elements: refreshBtn, guideBtn, toggles, meta must be present
  // -------------------------------------------------------------------------
  it('static bar contains refreshBtn, guideBtn, toggles, meta element ids', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('id="refreshBtn"');
    expect(html).toContain('id="guideBtn"');
    expect(html).toContain('id="toggles"');
    expect(html).toContain('id="meta"');
  });

  // -------------------------------------------------------------------------
  // wire() null-guard for .row
  // -------------------------------------------------------------------------
  it('wire() uses null guard before setting row click handler', () => {
    const html = getHtml(TEST_NONCE);
    // The guard: const row=c.querySelector('.row'); if(row){ ... }
    // This protects against a card having no .row child.
    expect(html).toContain("const row=c.querySelector('.row')");
    expect(html).toContain('if(row){row.addEventListener');
  });

  // -------------------------------------------------------------------------
  // CHANGED_MAX_SECS sync: getHtml() accepts changedMaxMin and injects it as a
  // JS constant so changedPanel() builds the correct title without a hardcoded
  // literal. Callers (extension.ts) pass CHANGED_MAX_SECS/60 — this test
  // verifies the injection works for any value.
  // -------------------------------------------------------------------------
  it('getHtml injects changedMaxMin as CHANGED_MAX_MIN JS constant', () => {
    const html = getHtml(TEST_NONCE, CHANGED_MAX_SECS / 60);
    // The injected constant must appear in the script block
    expect(html).toContain(`const CHANGED_MAX_MIN=${CHANGED_MAX_SECS / 60}`);
  });

  it('getHtml uses default changedMaxMin=2 when no arg passed (matches CHANGED_MAX_SECS=120)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('const CHANGED_MAX_MIN=2');
  });

  it('getHtml changedMaxMin param changes the injected constant', () => {
    const html3 = getHtml(TEST_NONCE, 3);
    expect(html3).toContain('const CHANGED_MAX_MIN=3');
    const html5 = getHtml(TEST_NONCE, 5);
    expect(html5).toContain('const CHANGED_MAX_MIN=5');
  });
});
