import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getHtml } from '../src/webview/html';
import { CHANGED_MAX_SECS } from '../src/data/snapshot';
import { getPanelJs, extractBalancedFn } from './helpers/webview';

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

  it('does NOT contain the toggles element (removed in tabbed layout redesign)', () => {
    expect(getHtml(TEST_NONCE)).not.toContain('id="toggles"');
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
    // Null-guarded addEventListener wiring (CSP-safe convention; .onclick is banned):
    //   var er=...; if(er)er.addEventListener('click',...) and similarly for eg.
    expect(html).toContain('if(er)er.addEventListener');
    expect(html).toContain('if(eg)eg.addEventListener');
  });

  // -------------------------------------------------------------------------
  // Static bar elements: refreshBtn, guideBtn, toggles, meta must be present
  // -------------------------------------------------------------------------
  it('static bar contains refreshBtn, guideBtn, meta element ids (no toggles in tabbed layout)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('id="refreshBtn"');
    expect(html).toContain('id="guideBtn"');
    expect(html).not.toContain('id="toggles"');
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

  it('getHtml uses default changedMaxMin=15 when no arg passed (matches CHANGED_MAX_SECS=900)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('const CHANGED_MAX_MIN=15');
  });

  it('getHtml changedMaxMin param changes the injected constant', () => {
    const html3 = getHtml(TEST_NONCE, 3);
    expect(html3).toContain('const CHANGED_MAX_MIN=3');
    const html5 = getHtml(TEST_NONCE, 5);
    expect(html5).toContain('const CHANGED_MAX_MIN=5');
  });
});

// ---------------------------------------------------------------------------
// M1-EmptyState: empty-state HTML structure and script well-formedness
// ---------------------------------------------------------------------------
describe('M1-EmptyState — friendly empty state and script validity', () => {
  // -------------------------------------------------------------------------
  // Empty-state container: the !snap.ok branch must render a container with
  // the data-testid="empty-state" marker so tests (and future UI automation)
  // can locate it without coupling to volatile class names.
  // -------------------------------------------------------------------------
  it('!snap.ok branch renders data-testid="empty-state" container', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('data-testid="empty-state"');
  });

  it('!snap.ok branch renders a friendly "No Workflow run found" heading', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('No Workflow run found');
  });

  it('!snap.ok branch renders data-testid="empty-msg" element for snap.msg', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('data-testid="empty-msg"');
  });

  it('!snap.ok branch wires emptyRefresh button to api.postMessage refresh', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('id="emptyRefresh"');
    // The wiring uses null-guarded getElementById with postMessage type:'refresh'
    expect(html).toContain("api.postMessage({type:'refresh'})");
  });

  it('!snap.ok branch wires emptyGuide button to api.postMessage guide', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('id="emptyGuide"');
    // The wiring uses null-guarded getElementById with postMessage type:'guide'
    expect(html).toContain("api.postMessage({type:'guide'})");
  });

  it('!snap.ok branch uses esc(snap.msg) to sanitize the error message', () => {
    const html = getHtml(TEST_NONCE);
    // The JS source must apply esc() to snap.msg, not inject it raw.
    // esc(snap.msg) prevents XSS if the base path contains special chars.
    expect(html).toContain('esc(snap.msg)');
  });

  it('empty-state HTML contains a hint mentioning Workflows Glob Base setting', () => {
    const html = getHtml(TEST_NONCE);
    // AC: inform user how to configure the search path
    expect(html).toContain('Workflows Glob Base');
  });

  it('empty-state HTML contains a hint mentioning Workflow() run', () => {
    const html = getHtml(TEST_NONCE);
    // AC: explain what to start to make the empty state go away
    expect(html).toContain('Workflow()');
  });

  // -------------------------------------------------------------------------
  // CSS: empty-state uses theme-native --vscode-* variables only.
  // -------------------------------------------------------------------------
  it('CSS contains .empty-state rule using --vscode-* variables (theme-native)', () => {
    const html = getHtml(TEST_NONCE);
    // Must define the .empty-state class
    expect(html).toContain('.empty-state{');
    // Must use at least one --vscode-* custom property
    const emptyStateCssStart = html.indexOf('.empty-state{');
    const emptyStateCssEnd = html.indexOf('}', emptyStateCssStart);
    const emptyStateCss = html.slice(emptyStateCssStart, emptyStateCssEnd);
    expect(emptyStateCss).toContain('--vscode-');
  });

  // -------------------------------------------------------------------------
  // Script well-formedness: the inline <script> block must parse without error.
  //
  // The context note records a real crash: 'Failed to execute write on Document:
  // Unexpected string' when the webview inline script contained a syntax error
  // (unescaped/unbalanced string in the serialized snapshot injection).
  //
  // We test this by extracting the JS content from between the <script> tags
  // and running it through new Function() — a parse-time check that rejects
  // any syntactically malformed JS before it reaches the webview runtime.
  //
  // acquireVsCodeApi, window, document, CSS are stubbed so the script can be
  // parsed without a browser environment.  We only care about parse errors,
  // not runtime errors from the missing DOM.
  // -------------------------------------------------------------------------
  it('inline script block is syntactically valid JS (no parse errors)', () => {
    const html = getHtml(TEST_NONCE);
    // Extract everything between the opening <script nonce="..."> and </script>
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const scriptStart = html.indexOf(scriptOpen);
    const scriptEnd = html.lastIndexOf(scriptClose);
    expect(scriptStart).toBeGreaterThan(-1);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const scriptContent = html.slice(scriptStart + scriptOpen.length, scriptEnd);
    expect(scriptContent.length).toBeGreaterThan(100);

    // new Function() parses without executing. Stub the browser globals the script
    // references at top level so the Function constructor does not throw a ReferenceError
    // before we reach the point of interest (acquireVsCodeApi, document, window, CSS).
    // We wrap in a function that receives these as parameters — parse-time validation only.
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', scriptContent);
    }).not.toThrow();
  });

  it('inline script does not contain document.write (forbidden — breaks webview)', () => {
    const html = getHtml(TEST_NONCE);
    // document.write() is the specific cause of the "Unexpected string" crash noted
    // in the context: it cannot be used in a nonce-CSP webview and breaks the sidebar.
    expect(html).not.toContain('document.write');
  });

  it('inline script does not contain unescaped backtick template literals (breakage risk)', () => {
    const html = getHtml(TEST_NONCE);
    // Extract only the script block to avoid false positives from the HTML template.
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const scriptStart = html.indexOf(scriptOpen);
    const scriptEnd = html.lastIndexOf(scriptClose);
    const scriptContent = html.slice(scriptStart + scriptOpen.length, scriptEnd);
    // Backtick template literals inside the inline script are safe in isolation,
    // but if the outer getHtml() template string ever interpolates them they risk
    // breaking the surrounding template. This test documents the constraint.
    // Currently the JS constant uses no template literals, so this is a zero-regression guard.
    expect(scriptContent).not.toContain('`');
  });

  // -------------------------------------------------------------------------
  // Status-bar idle state: when snap is null or ok:false, the status bar must
  // show idle text without throwing. Verified structurally through the source.
  // -------------------------------------------------------------------------
  it('extension.ts updateStatusBar() shows idle text when latest is falsy (no errors on launch)', () => {
    // Read extension.ts and verify the else-branch sets non-throwing idle text.
    // Importing extension.ts is not possible (requires vscode mock), so we verify
    // the source structure as a behavioral proxy — same pattern as the watcher tests.
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
    // The idle branch must set statusItem.text to a non-empty string (Workflow Dashboard label)
    expect(src).toContain("statusItem.text = '$(circuit-board) Workflow Dashboard'");
    // The idle branch tooltip must mention "No active workflow run"
    expect(src).toContain('No active workflow run found');
    // statusItem.show() must be called (not just set — the item must be visible)
    expect(src).toContain('statusItem.show()');
  });
});

// ---------------------------------------------------------------------------
// M1-SidebarUX: getHtml sidebar mode
// ---------------------------------------------------------------------------
describe('M1-SidebarUX — sidebar mode', () => {
  // -------------------------------------------------------------------------
  // Presence of sidebar-mode marker: the root element must carry data-mode="sidebar"
  // so tests and future automation can distinguish the two render modes.
  // -------------------------------------------------------------------------
  it('sidebar mode root element has data-mode="sidebar" marker', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('data-mode="sidebar"');
  });

  // -------------------------------------------------------------------------
  // "Open full dashboard" affordance: the button must be present in the static
  // HTML skeleton (before any snapshot arrives) so it is immediately clickable.
  // -------------------------------------------------------------------------
  it('sidebar mode contains the openFull button with correct data-testid', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('data-testid="open-full-btn"');
  });

  it('sidebar JS posts {type:"openFull"} (the openFull message type)', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain("type:'openFull'");
  });

  // -------------------------------------------------------------------------
  // Compact summary markers: sidebar must render phase, live/done/dead KPIs
  // and active-agents section (verified via data-testid attributes).
  // -------------------------------------------------------------------------
  it('sidebar JS renders sidebar-header with phase section', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('data-testid="sidebar-header"');
    expect(html).toContain('data-testid="sidebar-phase"');
  });

  it('sidebar JS renders sidebar-agents section', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('data-testid="sidebar-agents"');
  });

  it('sidebar JS renders sidebar-findings section when findings exist', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('data-testid="sidebar-findings"');
  });

  // -------------------------------------------------------------------------
  // No horizontal overflow: the sidebar CSS must set overflow-x:hidden on body
  // so the pane never clips or scrolls horizontally at its default width.
  // -------------------------------------------------------------------------
  it('sidebar CSS sets overflow-x:hidden on body to prevent horizontal scroll', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('overflow-x:hidden');
  });

  // -------------------------------------------------------------------------
  // No six-panel chrome in sidebar: the sidebar must NOT render the panel-toggle
  // bar, the "Guide" button, or the "Refresh" top-bar button that appear in
  // the full editor panel — their IDs would conflict if both modes were loaded
  // simultaneously and they waste precious sidebar width.
  // -------------------------------------------------------------------------
  it('sidebar mode does not render the full panel toggle bar', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).not.toContain('id="toggles"');
  });

  it('sidebar mode does not render the guideBtn bar element', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).not.toContain('id="guideBtn"');
  });

  it('sidebar mode does not render the full-panel refreshBtn bar element', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).not.toContain('id="refreshBtn"');
  });

  // -------------------------------------------------------------------------
  // Panel mode unchanged: calling getHtml without the mode arg (or with
  // mode:'panel') still produces the original six-panel layout.
  // -------------------------------------------------------------------------
  it('panel mode (default) does NOT contain the toggles bar (replaced by tab bar in redesign)', () => {
    // M3-Layout redesign: panel checkboxes removed, replaced by WAI-ARIA tablist.
    expect(getHtml(TEST_NONCE)).not.toContain('id="toggles"');
    expect(getHtml(TEST_NONCE, 2, 200, 'panel')).not.toContain('id="toggles"');
    // Tab bar must be present instead
    expect(getHtml(TEST_NONCE)).toContain('role="tablist"');
    expect(getHtml(TEST_NONCE)).toContain('id="tab-bar"');
  });

  it('panel mode does NOT contain sidebar data-mode attribute', () => {
    expect(getHtml(TEST_NONCE)).not.toContain('data-mode="sidebar"');
  });

  // -------------------------------------------------------------------------
  // Script well-formedness: the sidebar inline script must be syntactically
  // valid JS. This guards against the "Unexpected string" crash noted in the
  // context (a syntax error in the inline script crashes the webview).
  // -------------------------------------------------------------------------
  it('sidebar inline script is syntactically valid JS (no parse errors)', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const scriptStart = html.indexOf(scriptOpen);
    const scriptEnd = html.lastIndexOf(scriptClose);
    expect(scriptStart).toBeGreaterThan(-1);
    expect(scriptEnd).toBeGreaterThan(scriptStart);
    const scriptContent = html.slice(scriptStart + scriptOpen.length, scriptEnd);
    expect(scriptContent.length).toBeGreaterThan(50);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', scriptContent);
    }).not.toThrow();
  });

  it('sidebar inline script does not contain document.write', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).not.toContain('document.write');
  });

  it('sidebar inline script does not contain backtick template literals', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const scriptStart = html.indexOf(scriptOpen);
    const scriptEnd = html.lastIndexOf(scriptClose);
    const scriptContent = html.slice(scriptStart + scriptOpen.length, scriptEnd);
    expect(scriptContent).not.toContain('`');
  });

  // -------------------------------------------------------------------------
  // CSP: sidebar mode must also include a nonce-based CSP header.
  // -------------------------------------------------------------------------
  it('sidebar mode has Content-Security-Policy with nonce', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(`'nonce-${TEST_NONCE}'`);
  });

  // -------------------------------------------------------------------------
  // extension.ts: attachWebview passes 'sidebar' mode for DashboardViewProvider
  // and handles the openFull message type.
  // -------------------------------------------------------------------------
  it('extension.ts attachWebview passes sidebar mode for DashboardViewProvider', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
    // The DashboardViewProvider must call attachWebview with 'sidebar'.
    // F13 (round-5): uses view-scoped viewDisposables instead of ctx.subscriptions
    // to prevent disposable leaks on repeated resolveWebviewView() calls.
    expect(src).toContain("attachWebview(view.webview, viewDisposables, 'sidebar')");
  });

  it('extension.ts onDidReceiveMessage handles openFull type by executing claudeWorkflow.open', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
    expect(src).toContain("msg['type'] === 'openFull'");
    expect(src).toContain("vscode.commands.executeCommand('claudeWorkflow.open')");
  });

  it('package.json view/title menus include claudeWorkflow.open when view == claudeWorkflow.dashboard', () => {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'package.json'),
      'utf8',
    )) as {
      contributes?: {
        menus?: {
          'view/title'?: Array<{ command: string; when: string }>;
        };
      };
    };
    const viewTitleMenus = pkg.contributes?.menus?.['view/title'] ?? [];
    const openEntry = viewTitleMenus.find(
      (m) => m.command === 'claudeWorkflow.open' && m.when.includes('claudeWorkflow.dashboard'),
    );
    expect(openEntry).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // XSS regression: sidebar severity badge must use escCls() (whitespace-safe)
  // not esc() for the CSS class token. A severity string with a space would
  // otherwise split into two CSS class tokens, breaking the color rules.
  // -------------------------------------------------------------------------
  it('sidebar JS contains escCls() definition (whitespace-to-underscore replacement)', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // escCls must be defined in the sidebar JS
    expect(html).toContain('function escCls(s)');
    expect(html).toContain("replace(/[\\t\\n\\r ]+/g,'_')");
  });

  it('sidebar severity badge uses escCls() for CSS class token (not raw esc())', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The badge builder must use ec (escCls result) for the class attribute token
    // and es (esc result) for the visible text — both must appear.
    expect(html).toContain('var ec=escCls(s)');
    // The badge HTML must use ec for class token: class="sev '+ec+'"
    expect(html).toContain("'<span class=\"sev '+ec+'\">'");
  });

  it('sidebar severity badge class does not contain raw space when severity has a space', () => {
    // Exercise the actual badge-builder logic with a crafted severity that contains a space.
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // Extract the sidebar JS
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const sStart = html.indexOf(scriptOpen);
    const sEnd = html.lastIndexOf(scriptClose);
    const sidebarJs = html.slice(sStart + scriptOpen.length, sEnd);
    // Extract and evaluate the badge-building loop
    // Find the line containing the badge builder
    const lines = sidebarJs.split('\n');
    const badgeLine = lines.find((l) => l.includes("badges+='<span class=\"sev '"));
    if (!badgeLine) throw new Error('sidebar badge builder line not found');
    // Build a minimal evaluable harness: define esc, escCls, safeN, sevTotals, badges, then the loop body.
    const harness = `
      function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
      function escCls(s){return esc(s).replace(/[\\t\\n\\r ]+/g,'_');}
      function safeN(n){var v=+n;return isFinite(v)?v:0;}
      var sevTotals=Object.create(null);
      sevTotals['HIGH MEDIUM']=3;
      var badges='';
      for(var s in sevTotals){${badgeLine}}
      return badges;
    `;
    const result = new Function(harness)() as string;
    // The class token must not contain a raw space (would add unintended CSS class)
    const classMatch = result.match(/class="sev ([^"]+)"/);
    expect(classMatch).not.toBeNull();
    expect(classMatch![1]).not.toContain(' ');
    // The visible text is the HTML-escaped severity (spaces preserved in text, not in class)
    expect(result).toContain('HIGH_MEDIUM');
  });

  // -------------------------------------------------------------------------
  // UX: sidebar active agent status pill must display 'live' for run status,
  // not the internal string 'run'. The full panel does the same via statusLabel.
  // -------------------------------------------------------------------------
  it('sidebar JS maps status run to display label "live" in agent rows', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The mapping: a.status==='run'?'live':es
    expect(html).toContain("a.status==='run'?'live'");
  });

  // -------------------------------------------------------------------------
  // Empty-state testid: the sidebar !snap.ok branch must use a distinct testid
  // so tests can assert the sidebar-specific empty-state without coupling to
  // the panel-mode empty-state testid.
  // -------------------------------------------------------------------------
  it('sidebar JS empty-state branch uses data-testid="empty-state-sidebar"', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The sidebar empty-state branch must use the sidebar-specific testid.
    // A rename to anything else would go undetected without this assertion.
    expect(html).toContain('data-testid="empty-state-sidebar"');
  });

  // -------------------------------------------------------------------------
  // Spec v3 correction #7: sidebar changed-files section uses changedByAgents
  // as the primary source so completed runs still show file activity.
  // -------------------------------------------------------------------------
  it('sidebar JS uses changedByAgents as primary source for changed-files section', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The sidebar JS template must reference snap.changedByAgents in the changed section.
    // If a future commit reverts to snap.changed-only, this test catches the regression.
    expect(html).toContain('changedByAgents');
  });
});

// ---------------------------------------------------------------------------
// M1-ClearFilters: 'Clear filters' button placement and wiring
// ---------------------------------------------------------------------------
describe('M1-ClearFilters — Clear filters button in filter bar', () => {
  // -------------------------------------------------------------------------
  // The button must now live inside the filter bar (the .filters div), not
  // exclusively in the empty-result fallback branch.
  // We verify by asserting:
  //   (a) anyOff is computed before the chips string (not inside !list.length)
  //   (b) clearFiltersBtn is emitted inside chips (adjacent to .filters close tag)
  //   (c) the OLD conditional inside !list.length no longer exists
  // -------------------------------------------------------------------------

  it('anyOff is computed at the top of findingsPanel, before the chips string', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // anyOff declaration must appear before the 'let chips=' line
    const anyOffIdx = js.indexOf('const anyOff=snap.labels.some');
    const chipsIdx = js.indexOf("let chips='<div class=\"filters\">");
    expect(anyOffIdx).toBeGreaterThan(-1);
    expect(chipsIdx).toBeGreaterThan(-1);
    expect(anyOffIdx).toBeLessThan(chipsIdx);
  });

  it('clearFiltersBtn is rendered inside the filter bar (chips string), conditioned on anyOff', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The button must be part of the chips string expression, gated on anyOff
    expect(js).toContain("anyOff?'<button id=\"clearFiltersBtn\"");
  });

  it('button is NOT rendered when no filter is active (anyOff falsy path emits empty string)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The ternary else-branch must produce an empty string (no button)
    expect(js).toContain("anyOff?'<button id=\"clearFiltersBtn\"");
    // The else branch: :'')
    const btnIdx = js.indexOf("anyOff?'<button id=\"clearFiltersBtn\"");
    const afterBtn = js.slice(btnIdx);
    // After the button string the ternary must close with :'') before the outer </div>
    expect(afterBtn).toMatch(/:''\)/);
  });

  it('clearFiltersBtn does NOT appear inside the !list.length empty-result branch (old placement removed)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The old pattern: if(anyOff)body+='<button id="clearFiltersBtn" style="margin-top:6px">'
    // must be gone — the button is now unconditionally in the chips bar (gated by anyOff at top).
    expect(js).not.toContain("if(anyOff)body+='<button id=\"clearFiltersBtn\"");
    // Also verify the old in-branch anyOff declaration is gone
    // (the old code had 'const anyOff=snap.labels.some' inside if(!list.length))
    // New code has it before chips building. We verify there is exactly one anyOff declaration.
    const matches = [...js.matchAll(/const anyOff=/g)];
    expect(matches.length).toBe(1);
  });

  it('wire() still wires clearFiltersBtn via addEventListener (nonce-safe, no inline handler)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The wire() handler must use getElementById + null guard + addEventListener
    expect(js).toContain("var cf=document.getElementById('clearFiltersBtn')");
    expect(js).toContain('if(cf)cf.addEventListener');
    // Must NOT use inline onclick on the button element itself
    // (inline handlers are blocked by nonce-based CSP)
    expect(js).not.toContain('id="clearFiltersBtn" onclick');
    expect(js).not.toContain("id='clearFiltersBtn' onclick");
  });

  it('wire() clearFiltersBtn handler resets both fRev and fSev to 1 then re-renders', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Handler sets all fRev and fSev values to 1, saves, and re-renders
    expect(js).toContain('state.fRev[k]=1');
    expect(js).toContain('state.fSev[k]=1');
    // save() and render() are called after reset
    const cfIdx = js.indexOf("var cf=document.getElementById('clearFiltersBtn')");
    const afterCf = js.slice(cfIdx, cfIdx + 300);
    expect(afterCf).toContain('save()');
    expect(afterCf).toContain('render()');
  });

  it('single clearFiltersBtn id in JS — not one per dimension (one button, not two)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // There must be exactly one button id="clearFiltersBtn" rendered (not per-reviewer + per-severity)
    const emitMatches = [...js.matchAll(/'<button id="clearFiltersBtn"/g)];
    expect(emitMatches.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Round-3 fixes: static skeleton testid in HTML, full-panel 'run'->'live',
// verdictLabels, isPinned, sidebar empty-state snap.msg + Guide button,
// filter-sep CSS class, pass-heading class, .role CSS, .files CSS,
// .verdict-item CSS, Stalled tooltip.
// ---------------------------------------------------------------------------
describe('Round-3 fixes', () => {
  // -------------------------------------------------------------------------
  // Static skeleton button has data-testid in the HTML portion (not just JS)
  // -------------------------------------------------------------------------
  it('sidebar static skeleton button has data-testid="open-full-btn" in the HTML (before script tag)', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // Find the position of the script tag; the static skeleton must precede it.
    const scriptStart = html.indexOf(`<script nonce="${TEST_NONCE}">`);
    expect(scriptStart).toBeGreaterThan(-1);
    const staticHtml = html.slice(0, scriptStart);
    expect(staticHtml).toContain('data-testid="open-full-btn"');
  });

  it('sidebar static skeleton button does NOT have redundant title="Open full dashboard"', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    const scriptStart = html.indexOf(`<script nonce="${TEST_NONCE}">`);
    const staticHtml = html.slice(0, scriptStart);
    // The static skeleton button text IS "Open full dashboard" — its title attr is redundant.
    expect(staticHtml).not.toContain('id="sbInitOpen" title=');
  });

  it('sidebar JS snap-null render does NOT have redundant title= on sbInitOpen2', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The dynamic skeleton (before first snapshot) must match the static skeleton:
    // no title= attribute on the button so screen readers are consistent.
    expect(html).not.toContain('id="sbInitOpen2" title=');
  });

  // -------------------------------------------------------------------------
  // Full panel agentsPanel statusLabel maps 'run' -> 'live'
  // -------------------------------------------------------------------------
  it('full panel JS maps status run to display label "live" in agentsPanel', () => {
    const html = getHtml(TEST_NONCE);
    // The mapping must be present in the JS constant for the full panel
    expect(html).toContain("a.status==='run'?'live'");
  });

  // -------------------------------------------------------------------------
  // verdictsPanel uses verdictLabels for display
  // -------------------------------------------------------------------------
  it('verdictsPanel JS uses snap.verdictLabels for display label', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('snap.verdictLabels');
  });

  // -------------------------------------------------------------------------
  // isPinned: meta bar and sidebar runid show a pinned badge when snap.isPinned
  // (the [pinned] plain-text suffix was replaced with a styled badge in round-5)
  // -------------------------------------------------------------------------
  it('meta bar JS renders a pinned badge when snap.isPinned is true', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('snap.isPinned');
    // The badge uses a <span> with class "sev MEDIUM" and text "pinned"
    expect(html).toContain('>pinned</span>');
  });

  it('sidebar JS renders a pinned badge in runid when snap.isPinned is true', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('snap.isPinned');
    // The badge uses a <span> with class "st done" and text "pinned"
    expect(html).toContain('>pinned</span>');
  });

  // -------------------------------------------------------------------------
  // Sidebar empty-state includes snap.msg and Guide button
  // -------------------------------------------------------------------------
  it('sidebar JS empty-state branch renders snap.msg', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('esc(snap.msg)');
  });

  it('sidebar JS empty-state branch has a Guide button posting {type:"guide"}', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    // The guide button must exist and post the guide message
    const hasGuideBtn = html.includes("id='sbGuide'") || html.includes('id="sbGuide"');
    expect(hasGuideBtn).toBe(true);
    expect(html).toContain("{type:'guide'}");
  });

  // -------------------------------------------------------------------------
  // CSS: .filter-sep class exists (not inline style on severity chip group)
  // -------------------------------------------------------------------------
  it('CSS contains .filter-sep class definition', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.filter-sep{');
  });

  it('severity chip group div uses class="filter-sep" not inline style', () => {
    const html = getHtml(TEST_NONCE);
    // The inline style must be gone from the severity group
    expect(html).not.toContain('style="margin-left:10px;border-left:1px solid');
    // The CSS class must be used instead
    expect(html).toContain('class="filter-sep"');
  });

  // -------------------------------------------------------------------------
  // CSS: .pass-heading class exists and is used (not .dim on h4)
  // -------------------------------------------------------------------------
  it('CSS contains .pass-heading class definition', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.pass-heading{');
  });

  it('pass-group h4 uses class="pass-heading" not class="dim"', () => {
    const html = getHtml(TEST_NONCE);
    // The dim class must not be used on the h4 heading
    expect(html).not.toContain('<h4 class="dim"');
    expect(html).toContain('class="pass-heading"');
  });

  // -------------------------------------------------------------------------
  // CSS: .verdict-item class exists and is used (not inline style)
  // -------------------------------------------------------------------------
  it('CSS contains .verdict-item class definition', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.verdict-item{');
  });

  it('verdictsPanel uses class="verdict-item" not inline margin-bottom style', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('class="verdict-item"');
    expect(html).not.toContain("style='margin-bottom:6px'");
    expect(html).not.toContain('style="margin-bottom:6px"');
  });

  // -------------------------------------------------------------------------
  // CSS: .files ul has padding/margin reset
  // -------------------------------------------------------------------------
  it('CSS contains .files padding/margin reset', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.files{padding:0;margin:0;list-style:none}');
  });

  // -------------------------------------------------------------------------
  // CSS: .role in full panel has text-overflow controls
  // -------------------------------------------------------------------------
  it('full panel CSS .role has text-overflow:ellipsis for long labels', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('text-overflow:ellipsis');
  });

  // -------------------------------------------------------------------------
  // Stalled KPI has tooltip in overview and sidebar
  // -------------------------------------------------------------------------
  it('overview Stalled KPI has title tooltip derived from staleSecs (default 180 = 3 minutes)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('Agents with no transcript activity in the last 3 minutes');
  });

  it('sidebar Stalled KPI has title tooltip derived from staleSecs (default 180 = 3 minutes)', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('Agents with no transcript activity in the last 3 minutes');
  });

  it('panel Stalled KPI sub-label uses derived minutes label (>3m) for default staleSecs=180', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('>3m');
  });

  it('getHtml staleSecs<60 renders seconds tooltip and sub-label', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'panel', 45);
    expect(html).toContain('Agents with no transcript activity in the last 45 seconds');
    expect(html).toContain('>45s');
  });

  // -------------------------------------------------------------------------
  // Card expand instruction mentions keyboard interaction
  // -------------------------------------------------------------------------
  it('agentsPanel card expand instruction mentions keyboard (Enter) interaction', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('press Enter');
  });

  // -------------------------------------------------------------------------
  // .empty-msg uses overflow-wrap not word-break:break-all
  // -------------------------------------------------------------------------
  it('empty-msg CSS uses overflow-wrap:break-word instead of word-break:break-all', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('overflow-wrap:break-word');
    expect(html).not.toContain('word-break:break-all');
  });

  // -------------------------------------------------------------------------
  // Fix 2: main panel .sev rule includes display:inline-block;vertical-align:middle
  // -------------------------------------------------------------------------
  it('main panel CSS .sev rule includes display:inline-block and vertical-align:middle', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.sev{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px;display:inline-block;vertical-align:middle}');
  });

  // -------------------------------------------------------------------------
  // Fix 3: focus-restore calls use preventScroll:true
  // -------------------------------------------------------------------------
  it('editor render() focus-restore calls use preventScroll:true to avoid hijacking scroll', () => {
    const html = getHtml(TEST_NONCE);
    // All 4 r.focus() restore calls must pass preventScroll:true
    expect(html).toContain('r.focus({preventScroll:true})');
    // Must NOT contain a bare r.focus() without preventScroll
    // (the JS is minified so we check the specific pattern in context)
    const jsBlock = html.slice(html.indexOf('const CHANGED_MAX_MIN='));
    const bareMatches = (jsBlock.match(/r\.focus\(\)/g) || []).length;
    expect(bareMatches).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Fix 4: selectRun button exists in panel bar and sidebar header
  // -------------------------------------------------------------------------
  it('panel bar contains a selectRunBtn button', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('id="selectRunBtn"');
  });

  it('sidebar initial skeleton contains sbSelectRunInit button', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain('id="sbSelectRunInit"');
  });

  it('panel JS wires selectRunBtn via addEventListener posting type:selectRun', () => {
    const html = getHtml(TEST_NONCE);
    // Confirm both the button id and the message type appear in the JS block
    expect(html).toContain('selectRunBtn');
    expect(html).toContain("type:'selectRun'");
  });

  it('sidebar JS wires select-run buttons posting type:selectRun', () => {
    const html = getHtml(TEST_NONCE, 2, 200, 'sidebar');
    expect(html).toContain("type:'selectRun'");
  });
});

// ---------------------------------------------------------------------------
// M2-AgentPrompt: Prompt disclosure rendering and escaping in getHtml()
// ---------------------------------------------------------------------------
describe('M2-AgentPrompt — Prompt disclosure in agent cards', () => {
  // -------------------------------------------------------------------------
  // CSS: the .prompt-disc class must be defined so the disclosure is styled.
  // -------------------------------------------------------------------------
  it('CSS contains .prompt-disc rule', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.prompt-disc{');
  });

  it('CSS contains .prompt-pre rule with max-height and overflow:auto for scroll cap', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.prompt-pre{');
    expect(html).toContain('max-height:');
    expect(html).toContain('overflow:auto');
  });

  it('CSS .prompt-pre uses --vscode-* variables (theme-native)', () => {
    const html = getHtml(TEST_NONCE);
    const cssStart = html.indexOf('.prompt-pre{');
    const cssEnd = html.indexOf('}', cssStart);
    const rule = html.slice(cssStart, cssEnd);
    expect(rule).toContain('--vscode-');
  });

  // -------------------------------------------------------------------------
  // JS: agentsPanel() renders a .prompt-disc element when a.prompt is truthy.
  // -------------------------------------------------------------------------
  it('JS agentsPanel renders prompt-disc element keyed on a.prompt', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('a.prompt');
    expect(js).toContain('prompt-disc');
  });

  it('JS agentsPanel uses esc(a.prompt) before injecting prompt text (XSS prevention)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('esc(a.prompt)');
  });

  it('JS agentsPanel uses esc(a.id) for data-paid attribute on prompt-disc (XSS prevention)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // data-paid carries the agent id for Copy wiring — must be esc()'d.
    expect(js).toContain('data-paid="');
    expect(js).toContain('esc(a.id)');
  });

  it('JS agentsPanel renders a Copy button with data-pcopied attribute', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('prompt-copy-btn');
    expect(js).toContain('data-pcopied=');
  });

  // -------------------------------------------------------------------------
  // JS: wire() wires the Copy button to postMessage({type:'copyText', text}).
  // -------------------------------------------------------------------------
  it('JS wire() wires .prompt-copy-btn via addEventListener (nonce-safe)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('.prompt-copy-btn');
    expect(js).toContain("addEventListener('click'");
    // No inline onclick on the copy button — blocked by CSP
    expect(js).not.toContain('prompt-copy-btn" onclick');
  });

  it('JS wire() postMessage uses type:"copyText" for the Copy button', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("type:'copyText'");
  });

  // -------------------------------------------------------------------------
  // JS: openPrompt fold-state initialised and pruned alongside openAgents.
  // -------------------------------------------------------------------------
  it('JS state includes openPrompt object (keyed by agent id)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('openPrompt');
  });

  it('JS state prune block also prunes stale openPrompt keys', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The pruning must filter openPrompt by live agent ids — same pattern as openAgents.
    expect(js).toContain('state.openPrompt=Object.fromEntries');
  });

  // -------------------------------------------------------------------------
  // JS: prompt disclosure toggle persists open/closed state via save().
  // -------------------------------------------------------------------------
  it('JS wire() toggles open CSS class on .prompt-disc and persists via save()', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('prompt-disc');
    expect(js).toContain('state.openPrompt[id]');
    expect(js).toContain('save()');
  });

  it('JS wire() prompt disclosure toggle updates aria-expanded on header', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The toggle must set aria-expanded so screen readers announce open/closed state.
    expect(js).toContain("setAttribute('aria-expanded'");
  });

  // -------------------------------------------------------------------------
  // XSS: actually exercise esc() against a crafted prompt payload.
  // -------------------------------------------------------------------------
  it('esc() applied to a crafted prompt escapes angle brackets (HTML-injection prevention)', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    const malicious = '<script>alert("xss")</script>';
    const escaped = esc(malicious);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('esc() applied to a crafted prompt escapes double quotes (attribute breakout prevention)', () => {
    const esc = extractEscFn(getHtml(TEST_NONCE));
    const malicious = 'before"class="injected';
    expect(esc(malicious)).toContain('&quot;');
    expect(esc(malicious)).not.toContain('"class=');
  });

  // -------------------------------------------------------------------------
  // Structural: the disclosure chevron has aria-hidden="true" (decorative).
  // -------------------------------------------------------------------------
  it('JS prompt-disc-chevron span has aria-hidden="true"', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('aria-hidden="true"');
    expect(js).toContain('prompt-disc-chevron');
  });

  // -------------------------------------------------------------------------
  // Disclosure fold state keyed by id: the prompt-disc element carries data-paid.
  // wire() reads pd.dataset.paid to look up the agent id for state.openPrompt.
  // -------------------------------------------------------------------------
  it('JS wire() reads dataset.paid from .prompt-disc for state.openPrompt key', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('dataset.paid');
    expect(js).toContain('state.openPrompt[id]');
  });
});

// ---------------------------------------------------------------------------
// Sabine HIGH/MED accessibility fixes (WCAG 1.4.1, 4.1.2, plus UX fixes)
// ---------------------------------------------------------------------------
describe('Accessibility fixes — Sabine HIGH/MED findings', () => {
  // -------------------------------------------------------------------------
  // AC1: WCAG 1.4.1 — filter chips must NOT convey active/inactive by opacity alone.
  // Fix: active chips get border:2px solid (heavier border); inactive get border-style:dashed.
  // Both differences are perceivable without color (greyscale, forced-colors).
  // -------------------------------------------------------------------------
  it('AC1: active chip CSS uses border-width:2px (not 1px) as a non-color active indicator', () => {
    const html = getHtml(TEST_NONCE);
    // .chip:not(.off) must carry a 2px border — the non-color shape indicator.
    expect(html).toContain('.chip:not(.off){');
    const chipActiveIdx = html.indexOf('.chip:not(.off){');
    const chipActiveEnd = html.indexOf('}', chipActiveIdx);
    const chipActiveRule = html.slice(chipActiveIdx, chipActiveEnd);
    expect(chipActiveRule).toContain('border:2px');
  });

  it('AC1: inactive chip CSS uses border-style:dashed as a non-color indicator', () => {
    const html = getHtml(TEST_NONCE);
    // .chip.off must have dashed border — visible in greyscale & forced-colors.
    expect(html).toContain('.chip.off{');
    const chipOffIdx = html.indexOf('.chip.off{');
    const chipOffEnd = html.indexOf('}', chipOffIdx);
    const chipOffRule = html.slice(chipOffIdx, chipOffEnd);
    expect(chipOffRule).toContain('border-style:dashed');
  });

  it('AC1: active chip CSS includes font-weight:600 (additional non-color differentiator)', () => {
    const html = getHtml(TEST_NONCE);
    const chipActiveIdx = html.indexOf('.chip:not(.off){');
    const chipActiveEnd = html.indexOf('}', chipActiveIdx);
    const chipActiveRule = html.slice(chipActiveIdx, chipActiveEnd);
    expect(chipActiveRule).toContain('font-weight:600');
  });

  it('AC1: forced-colors block uses 2px solid border for active chip and 1px dashed for inactive', () => {
    const html = getHtml(TEST_NONCE);
    // The forced-colors block must use border:2px solid ButtonText for active chips.
    expect(html).toContain('border:2px solid ButtonText');
    // Inactive chips in forced-colors use 1px dashed GrayText.
    expect(html).toContain('border:1px dashed GrayText');
  });

  // -------------------------------------------------------------------------
  // AC2: WCAG 4.1.2 — Prompt disclosure header is a real <button class="prompt-disc-hdr">.
  // No role="button" is needed on the element itself — native <button> semantics are used.
  // Screen readers announce its interactive nature and expanded/collapsed state via
  // aria-expanded, which wire() keeps in sync with the open/closed class.
  // -------------------------------------------------------------------------
  it('AC2: prompt disclosure header is a real <button> element (WCAG 4.1.2)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The header must be rendered as a native <button> element, not a div+role=button
    expect(js).toContain('<button class="prompt-disc-hdr"');
  });

  it('AC2: prompt disclosure header has aria-expanded set to initial state', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // aria-expanded must be set on the .prompt-disc-hdr element.
    // The value is "true" when open, "false" when closed (values come from JS ternary).
    expect(js).toContain('aria-expanded=');
    // The ternary produces both 'true' and 'false' values.
    expect(js).toContain("?'true':'false'");
  });

  it('AC2: prompt disclosure toggle wire() updates aria-expanded after toggle', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // wire() must call setAttribute('aria-expanded', ...) on the header.
    expect(js).toContain("setAttribute('aria-expanded'");
  });

  it('AC2: prompt disclosure header has tabindex="0" for keyboard operability', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('prompt-disc-hdr');
    expect(js).toContain('tabindex="0"');
  });

  it('AC2: prompt disclosure wire() handles keydown Enter and Space (keyboard operability)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Keyboard handling in wire() must respond to Enter and Space on prompt-disc-hdr.
    expect(js).toContain("e.key==='Enter'");
    expect(js).toContain("e.key===' '");
    // Must call e.preventDefault() to stop Space from scrolling the page.
    expect(js).toContain('e.preventDefault()');
  });

  // -------------------------------------------------------------------------
  // AC3: Optional KPI labels must have title tooltips explaining jargon.
  // 'In tokens', 'Cache read', 'Cache write' are technical terms — descriptions
  // are surfaced via aria-describedby + sr-only spans (more AT-accessible than title=,
  // which is not announced by most screen readers on non-interactive elements and is
  // invisible on touch/keyboard-only navigation).
  // -------------------------------------------------------------------------
  it('AC3: In tokens KPI uses aria-describedby + sr-only description (not title= only)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('In tokens');
    // aria-describedby pattern: the KPI div references a sr-only span by id.
    expect(html).toContain('aria-describedby="kpi-in-tok-desc"');
    expect(html).toContain('id="kpi-in-tok-desc"');
    expect(html).toContain('Total input tokens read from context');
  });

  it('AC3: Cache read KPI uses aria-describedby + sr-only description (not title= only)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('Cache read');
    expect(html).toContain('aria-describedby="kpi-cache-read-desc"');
    expect(html).toContain('id="kpi-cache-read-desc"');
    expect(html).toContain('Input tokens served from the prompt cache');
  });

  it('AC3: Cache write KPI uses aria-describedby + sr-only description (not title= only)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('Cache write');
    expect(html).toContain('aria-describedby="kpi-cache-write-desc"');
    expect(html).toContain('id="kpi-cache-write-desc"');
    expect(html).toContain('Input tokens written to the prompt cache');
  });

  // -------------------------------------------------------------------------
  // AC4: PANELS array order must match render() order.
  // The toggle bar labels are spatially ordered: their checkbox position in the
  // toolbar must correspond to the panel's vertical position on the page.
  // -------------------------------------------------------------------------
  it('AC4: tabDefs() tab order is Agents | Findings | Verdicts | Changed | Charts | Results', () => {
    // M3-Layout: PANELS array replaced by tabDefs() returning ordered tab definitions.
    // The tab order in tabDefs() must be: agents, findings, verdicts, changed, charts, results.
    const js = getPanelJs(getHtml(TEST_NONCE));
    // tabDefs returns an array; verify the key order by finding the return-array content.
    const tabDefsIdx = js.indexOf('function tabDefs()');
    expect(tabDefsIdx).toBeGreaterThan(-1);
    const tabDefsSlice = js.slice(tabDefsIdx, tabDefsIdx + 1000);
    // Keys must appear in the documented order.
    const agentsPos = tabDefsSlice.indexOf("key:'agents'");
    const findingsPos = tabDefsSlice.indexOf("key:'findings'");
    const verdictsPos = tabDefsSlice.indexOf("key:'verdicts'");
    const changedPos = tabDefsSlice.indexOf("key:'changed'");
    const chartsPos = tabDefsSlice.indexOf("key:'charts'");
    const resultsPos = tabDefsSlice.indexOf("key:'results'");
    expect(agentsPos).toBeGreaterThan(-1);
    expect(findingsPos).toBeGreaterThan(agentsPos);
    expect(verdictsPos).toBeGreaterThan(findingsPos);
    expect(changedPos).toBeGreaterThan(verdictsPos);
    expect(chartsPos).toBeGreaterThan(changedPos);
    expect(resultsPos).toBeGreaterThan(chartsPos);
  });

  // -------------------------------------------------------------------------
  // AC5: 'Clear filters' recovery in empty filtered-findings must be a clearly
  // visible button, not buried inline. The button must use a CSS class giving it
  // proper padding and standalone appearance.
  // -------------------------------------------------------------------------
  it('AC5: empty-filtered-findings uses .findings-empty CSS class (not inline style)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The wrapper must use the .findings-empty class
    expect(js).toContain('class="findings-empty"');
    // Must NOT use the old inline style=display:flex on this div
    expect(js).not.toContain('style="display:flex;flex-direction:column');
  });

  it('AC5: empty-filtered-findings Clear filters button uses .findings-empty-btn class', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The button must use .findings-empty-btn (not bare .clear-btn) so it gets
    // standalone padding/size appropriate for a primary recovery action.
    expect(js).toContain('class="findings-empty-btn"');
    expect(js).toContain('id="emptyFiltersBtn"');
  });

  it('AC5: CSS .findings-empty class is defined with flex+column layout', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.findings-empty{');
    const idx = html.indexOf('.findings-empty{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('flex-direction:column');
  });

  it('AC5: CSS .findings-empty-btn class is defined with standalone padding', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.findings-empty-btn{');
    const idx = html.indexOf('.findings-empty-btn{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    // Must have padding larger than the chip (chip has padding:2px 8px)
    expect(rule).toContain('padding:');
  });

  it('AC5: wire() still wires emptyFiltersBtn via addEventListener (nonce-safe)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The old test still passes: addEventListener wiring remains
    expect(js).toContain("var ef=document.getElementById('emptyFiltersBtn')");
    expect(js).toContain('if(ef)ef.addEventListener');
  });
});

// ---------------------------------------------------------------------------
// M2-Layout: collapsible panel headers — removed post-M3 (dead code cleanup).
// panel() and wire() block removed; state.panelOpen removed from state init.
// CSS rules .panel, .panel-chevron, .panel.collapsed remain for forward compatibility.
// These tests assert ABSENCE — the removed code must not reappear in the bundle.
// ---------------------------------------------------------------------------
describe('M2-Layout — dead panel() code is absent from bundle [post-M3 cleanup]', () => {
  // These tests assert that panel() and state.panelOpen were fully removed per the
  // TODO(M3) contract. They are a safety net against re-introduction.

  it('JS bundle does NOT contain function panel() — dead code removed post-M3', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // panel() must be absent from the shipped bundle. If it reappears, it carries
    // dead state machinery and unused bytes that slow parse time.
    expect(js).not.toContain('function panel(');
  });

  it('JS state initializer does NOT include panelOpen key — removed with panel()', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('panelOpen:');
  });

  it('JS state does NOT restore _s.panelOpen — key removed from state init', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).not.toContain('_s.panelOpen');
  });

  it('JS wire() does NOT reference querySelectorAll for .panel>h3>button[data-pkey] — wire block gone', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).not.toContain("querySelectorAll('.panel>h3>button[data-pkey]')");
  });

  it('JS does NOT contain toggle_panel function — no panel toggle handler', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).not.toContain('toggle_panel');
  });

  // CSS panel rules remain for forward compatibility — not removed with panel().
  it('CSS panel>h3 must NOT have cursor:pointer — only the child button gets pointer cursor', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('cursor:pointer'); // present on the button / .row rule
    expect(html).toContain('.panel>h3{');
    expect(html).not.toMatch(/\.panel>h3\{[^}]*cursor:pointer/);
  });

  it('CSS defines .panel.collapsed>.body{display:none}', () => {
    expect(getHtml(TEST_NONCE)).toContain('.panel.collapsed>.body{display:none}');
  });

  // State initializer does NOT include in-tab panel collapse keys (pre-existing assertion).
  it('JS state initializer does NOT include in-tab panel collapse keys (M3 v3 binding removes all)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('verdicts:');
    expect(stateDecl).not.toContain('changed:');
    expect(stateDecl).not.toContain('results:');
    expect(stateDecl).not.toContain('charts:');
    expect(stateDecl).not.toContain('overview:');
    expect(stateDecl).not.toContain('agents:1');
    expect(stateDecl).not.toContain('findings:1');
  });
});

// ---------------------------------------------------------------------------
// M3-Layout: tabbed dashboard — WAI-ARIA tablist/tab/tabpanel structure
// ---------------------------------------------------------------------------
describe('M3-Layout — WAI-ARIA tablist/tab/tabpanel structure', () => {
  // -------------------------------------------------------------------------
  // HTML: tablist, tab, tabpanel roles must be present (spec §AC(c))
  // -------------------------------------------------------------------------
  it('panel HTML contains role="tablist" (WAI-ARIA tab pattern)', () => {
    expect(getHtml(TEST_NONCE)).toContain('role="tablist"');
  });

  it('panel HTML contains role="tab" (WAI-ARIA tab pattern)', () => {
    expect(getHtml(TEST_NONCE)).toContain('role="tab"');
  });

  it('panel HTML contains role="tabpanel" (WAI-ARIA tab pattern)', () => {
    // tabpanel is rendered by tabContent() inside render() — present in JS source.
    expect(getHtml(TEST_NONCE)).toContain('role="tabpanel"');
  });

  it('panel HTML does NOT contain id="toggles" (removed in redesign)', () => {
    expect(getHtml(TEST_NONCE)).not.toContain('id="toggles"');
  });

  it('panel HTML does NOT contain panels-label class (removed in redesign)', () => {
    expect(getHtml(TEST_NONCE)).not.toContain('panels-label');
  });

  it('tabBar() JS builds buttons with role="tab" and data-tabkey', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('role="tab"');
    expect(js).toContain('data-tabkey=');
  });

  it('tabBar() JS aria-label on the tablist is "Dashboard sections"', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('aria-label="Dashboard sections"');
  });

  it('tabBar() JS sets aria-selected="true" on active tab, aria-selected="false" on inactive', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('aria-selected="true"');
    expect(js).toContain('aria-selected="false"');
  });

  it('active tab gets tabindex="0", inactive enabled tabs get tabindex="-1"', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('tabindex="0"');
    expect(js).toContain('tabindex="-1"');
  });

  it('disabled tabs carry disabled attr and aria-disabled="true"', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('aria-disabled="true"');
    expect(js).toContain(' disabled ');
  });

  it('#overview-bar is always rendered (non-collapsible, no data-pkey="overview")', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // overview() returns a #overview-bar div — not a panel() wrapper.
    expect(js).toContain('id="overview-bar"');
    // No data-pkey="overview" — overview is not collapsible.
    expect(js).not.toContain('data-pkey="overview"');
  });

  it('overview() does not return a panel() wrapper (no collapse chevron)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The old overview wrapped in panel('overview','Overview',body).
    // After redesign, it returns a plain #overview-bar div.
    expect(js).not.toContain("panel('overview'");
  });

  it('tabContent() renders role="tabpanel" with aria-labelledby the active tab id', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('role="tabpanel"');
    expect(js).toContain('aria-labelledby="tab-');
  });

  // -------------------------------------------------------------------------
  // Keyboard model: wireTabBar() must wire ArrowLeft/Right + Home/End + Enter/Space
  // -------------------------------------------------------------------------
  it('wireTabBar() handles ArrowRight key to advance focus', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("'ArrowRight'");
  });

  it('wireTabBar() handles ArrowLeft key to go back', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("'ArrowLeft'");
  });

  it('wireTabBar() handles Home key to jump to first tab', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("'Home'");
  });

  it('wireTabBar() handles End key to jump to last tab', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("'End'");
  });

  it('wireTabBar() activates tab on Enter key', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const wireIdx = js.indexOf('function wireTabBar()');
    expect(wireIdx).toBeGreaterThan(-1);
    // wireTabBar() function body is ~1800 chars — use 2200 to include the Enter/Space handler.
    const section = js.slice(wireIdx, wireIdx + 2200);
    expect(section).toContain("'Enter'");
    expect(section).toContain("' '");
  });

  // -------------------------------------------------------------------------
  // State migration: state.activeTab present, state.on absent (spec §AC(g))
  // -------------------------------------------------------------------------
  it('JS state has activeTab (not state.on)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('activeTab:');
    expect(js).not.toContain('on:{');
  });

  it('JS state has tabScroll object', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('tabScroll:');
  });

  it('JS state has findPage (for pagination)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('findPage:');
  });

  // -------------------------------------------------------------------------
  // CSS: #root flex-column, #tab-content flex:1 overflow-y:auto
  // -------------------------------------------------------------------------
  it('CSS #root is flex-column that fills remaining body height', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('#root{display:flex;flex-direction:column');
    // #root uses flex:1 on the body flex column (body has height:100vh) — no calc needed.
    expect(html).toContain('#root{display:flex;flex-direction:column;flex:1;overflow:hidden}');
  });

  it('CSS #tab-content has flex:1 overflow-y:auto', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('#tab-content{flex:1;overflow-y:auto');
  });

  it('CSS #overview-bar is defined (always-visible KPI strip)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('#overview-bar{');
  });

  it('CSS #tab-bar has role="tablist" target rule', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('#tab-bar{');
  });

  it('CSS .tab-btn is defined with non-button styling', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.tab-btn{');
  });

  it('CSS .tab-btn.tab-active has 2px border-bottom (non-color indicator)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.tab-btn.tab-active{');
    const idx = html.indexOf('.tab-btn.tab-active{');
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('border-bottom:2px');
    expect(rule).toContain('font-weight:700');
  });

  it('CSS .tab-btn.tab-active uses --vscode-focusBorder for active indicator (not hardcoded color)', () => {
    const html = getHtml(TEST_NONCE);
    const idx = html.indexOf('.tab-btn.tab-active{');
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('--vscode-focusBorder');
  });

  it('CSS disabled tab is muted via opacity:.35', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.tab-btn[disabled]{');
    const idx = html.indexOf('.tab-btn[disabled]{');
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('opacity:.35');
  });

  it('CSS forced-colors block overrides tab-active indicator with Highlight system color', () => {
    const html = getHtml(TEST_NONCE);
    // Use '@media (forced-colors:active){' (with {) to skip any comment containing the string.
    const fcIdx = html.indexOf('@media (forced-colors:active){');
    expect(fcIdx).toBeGreaterThan(-1);
    // Find end of forced-colors block by scanning for matching closing brace.
    let depth = 0; let i = fcIdx; let bodyStarted = false;
    while (i < html.length) {
      if (html[i] === '{') { depth++; bodyStarted = true; }
      if (html[i] === '}') { depth--; }
      if (bodyStarted && depth === 0) break;
      i++;
    }
    const fcBlock = html.slice(fcIdx, i + 1);
    expect(fcBlock).toContain('Highlight');
    expect(fcBlock).toContain('tab-active');
  });

  // -------------------------------------------------------------------------
  // Findings pagination (spec §AC pagination)
  // -------------------------------------------------------------------------
  it('JS defines PAGE_SIZE=50 constant', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('PAGE_SIZE=50');
  });

  it('JS findingsPanel emits Prev/Next paginator buttons (id="findPrevBtn"/id="findNextBtn")', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('id="findPrevBtn"');
    expect(js).toContain('id="findNextBtn"');
  });

  it('JS wire() wires findPrevBtn and findNextBtn via addEventListener', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("getElementById('findPrevBtn')");
    expect(js).toContain("getElementById('findNextBtn')");
  });

  it('JS chip filter toggle resets findPage to 0 (pagination reset on filter change)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The rev chip act() function must reset findPage
    expect(js).toContain('state.findPage=0');
  });

  // -------------------------------------------------------------------------
  // Render at 1 and 50 agents (spec §AC — must render cleanly)
  // -------------------------------------------------------------------------
  it('render works at 1 agent (single-agent run produces valid HTML)', () => {
    const html = getHtml(TEST_NONCE, 2, 1);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    // Script is syntactically valid
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const s = html.indexOf(scriptOpen);
    const e = html.lastIndexOf(scriptClose);
    const scriptContent = html.slice(s + scriptOpen.length, e);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', scriptContent);
    }).not.toThrow();
  });

  it('render works at 50 agents (MAX_AGENTS=50 run produces valid HTML)', () => {
    const html = getHtml(TEST_NONCE, 2, 50);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tabpanel"');
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const s = html.indexOf(scriptOpen);
    const e = html.lastIndexOf(scriptClose);
    const scriptContent = html.slice(s + scriptOpen.length, e);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', scriptContent);
    }).not.toThrow();
  });

  it('.tab-badge is defined in CSS (count pill on Agents/Findings tabs)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.tab-badge{');
  });
});

// ---------------------------------------------------------------------------
// Findings pagination — behavioral tests (execute findingsPanel() with real JS)
//
// Strategy: extract the panel JS from the template, inject controlled globals
// (snap, state, PAGE_SIZE, etc.) and call findingsPanel() to get the output
// HTML string, then count .finding divs and inspect paginator presence/state.
//
// The harness stubs every global the JS uses so new Function() can execute:
//   acquireVsCodeApi – returns a fake api with getState/setState/postMessage
//   document         – not used by findingsPanel() itself; stub as {}
//   window           – not used; stub as {}
//   CSS              – not used; stub as {}
//   render()         – called at script end; stub to no-op
//   STALE_SECS/STALE_LABEL/STALE_TOOLTIP/CHANGED_MAX_MIN/MAX_AGENTS – injected
// ---------------------------------------------------------------------------
describe('Findings pagination — behavioral', () => {
  // Build a factory that, given snap + state overrides, executes findingsPanel()
  // and returns the output HTML string.
  function runFindingsPanel(
    snapOverrides: Record<string, unknown>,
    stateOverrides: Record<string, unknown> = {},
  ): string {
    const html = getHtml(TEST_NONCE, 2, 200);
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const s = html.indexOf(scriptOpen);
    const e = html.lastIndexOf(scriptClose);
    const rawJs = html.slice(s + scriptOpen.length, e);

    // Build a fake snap with defaults sufficient for findingsPanel().
    const defaultSnap = {
      ok: true,
      allFindings: [] as Array<Record<string, unknown>>,
      labels: [] as string[],
      loop: { passes: 1, findings: 0 },
    };
    const testSnap = { ...defaultSnap, ...snapOverrides };

    // Build a default state consistent with how the webview initialises it.
    const defaultState = {
      activeTab: 'findings',
      tabScroll: Object.create(null) as Record<string, unknown>,
      findPage: 0,
      panelOpen: { verdicts: 1, changed: 1, charts: 0, results: 1 },
      openAgents: Object.create(null) as Record<string, unknown>,
      openFind: Object.create(null) as Record<string, unknown>,
      fRev: Object.create(null) as Record<string, unknown>,
      fSev: Object.create(null) as Record<string, unknown>,
      openPrompt: Object.create(null) as Record<string, unknown>,
    };
    const testState = { ...defaultState, ...stateOverrides };

    // Strategy: extract only the pure utility functions and findingsPanel() from the
    // webview JS. findingsPanel() only depends on: snap, state, PAGE_SIZE, esc, escCls,
    // safeN — no DOM, no api, no document. We build a minimal harness with just these.
    function extractFunction(js: string, name: string): string {
      const marker = `function ${name}(`;
      const start = js.indexOf(marker);
      if (start === -1) throw new Error(`Function ${name} not found in webview JS`);
      let depth = 0;
      let inBody = false;
      let i = start;
      while (i < js.length) {
        if (js[i] === '{') { depth++; inBody = true; }
        if (js[i] === '}') {
          depth--;
          if (inBody && depth === 0) { return js.slice(start, i + 1); }
        }
        i++;
      }
      throw new Error(`Could not find closing brace for function ${name}`);
    }

    const harness = `
      const PAGE_SIZE = 50;
      let snap = testSnap;
      let state = testState;
      ${extractFunction(rawJs, 'esc')}
      ${extractFunction(rawJs, 'escCls')}
      ${extractFunction(rawJs, 'safeN')}
      ${extractFunction(rawJs, 'fmtTok')}
      ${extractFunction(rawJs, 'findingsPanel')}
      return findingsPanel();
    `;

    const fn = new Function('testSnap', 'testState', harness);
    return fn(testSnap, testState) as string;
  }

  // Helper: build N synthetic findings all from the same reviewer/severity/pass.
  function makeFindings(n: number, overrides: Record<string, unknown> = {}): Array<Record<string, unknown>> {
    return Array.from({ length: n }, (_, i) => ({
      reviewer: 'gerda',
      severity: 'HIGH',
      pass: '1',
      title: `Finding ${i + 1}`,
      location: `src/file.ts:${i + 1}`,
      why: 'why',
      fix: 'fix',
      ...overrides,
    }));
  }

  // Count occurrences of class="finding in the output (both open and closed variants).
  function countFindingDivs(html: string): number {
    return (html.match(/class="finding /g) ?? []).length;
  }

  // -------------------------------------------------------------------------
  // AC1: 131 findings, page 0 → 50 rows
  // -------------------------------------------------------------------------
  it('131 findings on page 0 renders exactly 50 finding rows', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    expect(countFindingDivs(output)).toBe(50);
  });

  // -------------------------------------------------------------------------
  // AC2: 131 findings, page 2 → 31 rows (items 101–131)
  // -------------------------------------------------------------------------
  it('131 findings on page 2 renders exactly 31 finding rows', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 2 },
    );
    expect(countFindingDivs(output)).toBe(31);
  });

  // -------------------------------------------------------------------------
  // AC3: paginator absent when filtered count <= 50
  // -------------------------------------------------------------------------
  it('paginator is absent when total filtered findings <= 50', () => {
    const findings = makeFindings(50);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    expect(output).not.toContain('find-paginator');
    expect(output).not.toContain('findPrevBtn');
    expect(output).not.toContain('findNextBtn');
  });

  it('paginator is absent when exactly 49 findings are shown', () => {
    const findings = makeFindings(49);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    expect(output).not.toContain('find-paginator');
  });

  // -------------------------------------------------------------------------
  // AC4: Prev disabled at page 0
  // -------------------------------------------------------------------------
  it('Prev button is disabled on page 0', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    // The disabled attribute appears on findPrevBtn at page 0.
    const prevMatch = output.match(/id="findPrevBtn"([^>]*>)/);
    expect(prevMatch).not.toBeNull();
    expect(prevMatch![0]).toContain('disabled');
  });

  it('Prev button is NOT disabled on page 1', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 1 },
    );
    const prevMatch = output.match(/id="findPrevBtn"([^>]*>)/);
    expect(prevMatch).not.toBeNull();
    expect(prevMatch![0]).not.toContain('disabled');
  });

  // -------------------------------------------------------------------------
  // AC5: Next disabled at last page
  // -------------------------------------------------------------------------
  it('Next button is disabled on the last page (page 2 of 3 for 131 findings)', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 2 },
    );
    const nextMatch = output.match(/id="findNextBtn"([^>]*>)/);
    expect(nextMatch).not.toBeNull();
    expect(nextMatch![0]).toContain('disabled');
  });

  it('Next button is NOT disabled on page 0 of 3', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    const nextMatch = output.match(/id="findNextBtn"([^>]*>)/);
    expect(nextMatch).not.toBeNull();
    expect(nextMatch![0]).not.toContain('disabled');
  });

  // -------------------------------------------------------------------------
  // AC6: Paginator info text format 'Page N of M · showing X–Y of Z'
  // -------------------------------------------------------------------------
  it('paginator shows correct info text format on page 0: "Page 1 of 3"', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    expect(output).toContain('Page 1 of 3');
    expect(output).toContain('showing 1');
    expect(output).toContain('50');
    expect(output).toContain('131');
  });

  it('paginator shows correct info text on page 2: "Page 3 of 3 · showing 101–131 of 131"', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 2 },
    );
    expect(output).toContain('Page 3 of 3');
    // pageStart+1 = 101, pageEnd = 131
    expect(output).toContain('101');
    expect(output).toContain('131');
  });

  // -------------------------------------------------------------------------
  // AC7: Paginator rendered BOTH above and below the rows
  // -------------------------------------------------------------------------
  it('paginator appears both above and below the findings rows', () => {
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    // Count occurrences of the paginator container
    const paginatorCount = (output.match(/find-paginator/g) ?? []).length;
    // Each paginator div contains two occurrences of "find-paginator" (class attr + closing tag context):
    // simpler: count the findPrevBtn occurrences (one per paginator instance).
    const prevCount = (output.match(/id="findPrevBtn"/g) ?? []).length;
    const nextCount = (output.match(/id="findNextBtn"/g) ?? []).length;
    expect(prevCount).toBe(2);
    expect(nextCount).toBe(2);
    expect(paginatorCount).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // AC8: pass-group headings preserved within each page
  // -------------------------------------------------------------------------
  it('pass-group headings are preserved within each page', () => {
    // 131 findings split across two passes (pass 1: 80, pass 2: 51)
    const pass1 = makeFindings(80, { pass: '1' });
    const pass2 = makeFindings(51, { pass: '2' });
    const findings = [...pass1, ...pass2];
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 0 },
    );
    // Page 0 has 50 items; both passes are represented (pass 1 has 80, first 50 are from pass 1)
    // Findings are grouped by pass so page 0 should have a pass heading.
    expect(output).toContain('pass-heading');
  });

  // -------------------------------------------------------------------------
  // AC9: Filter toggle resets findPage to 0 (static JS source check)
  // The behavioral test for this lives in js-wire.ts wiring tests above;
  // here we verify the rendered findingsPanel output for page 0 state is correct
  // when the caller provides findPage=0 (the post-filter-reset state).
  // -------------------------------------------------------------------------
  it('with findPage clamped from 5 to last valid page for 131 findings', () => {
    // If stale state has findPage=5 but only 3 pages exist, it must be clamped.
    const findings = makeFindings(131);
    const output = runFindingsPanel(
      { allFindings: findings, labels: ['gerda'] },
      { fRev: { gerda: 1 }, fSev: { HIGH: 1 }, findPage: 5 },
    );
    // Should clamp to page 2 (0-based), showing 31 rows.
    expect(countFindingDivs(output)).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// M3-Superseded — agentsPanel() and overview() rendering tests
//
// Verify that superseded agents get the correct CSS classes and badge text in
// agentsPanel(), and that overview() emits the kpi-superseded chip when
// loop.superseded > 0. These tests guard against re-introducing the regression
// where superseded agents were visually indistinguishable from stalled ones.
// ---------------------------------------------------------------------------

describe('M3-Superseded — agentsPanel and overview rendering', () => {
  // Build a harness that evaluates overview() with synthetic snap.
  // overview() dependencies: esc, safeN, fmtTok, STALE_LABEL, STALE_TOOLTIP.
  function buildOverviewHarness(js: string): (snap: object) => string {
    const escFn    = extractBalancedFn(js, 'esc');
    const safeNFn  = extractBalancedFn(js, 'safeN');
    const fmtTokFn = extractBalancedFn(js, 'fmtTok');
    const overviewFn = extractBalancedFn(js, 'overview');

    const factory = new Function(
      'snap',
      [
        escFn, safeNFn, fmtTokFn,
        'var STALE_SECS=180; var STALE_LABEL=">3m"; var STALE_TOOLTIP="Agents with no activity >3m";',
        overviewFn,
        'return overview();',
      ].join('\n'),
    ) as (snap: object) => string;

    return (snap: object) => factory(snap);
  }

  function makeOverviewSnap(supersededCount: number): object {
    return {
      loop: {
        phase: 'done', live: 0, done: 2, dead: 0, superseded: supersededCount,
        total: 2, outTok: 600, tools: 7, passes: 1, findings: 0, sevTotals: {},
        inTok: null, cacheRead: null, cacheCreate: null,
      },
    };
  }

  // -------------------------------------------------------------------------
  // overview() chip tests (functional — exercises the actual JS)
  // -------------------------------------------------------------------------

  it('overview() emits kpi-superseded chip when loop.superseded > 0', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const runOverview = buildOverviewHarness(js);
    const html = runOverview(makeOverviewSnap(2));
    expect(html).toContain('kpi-superseded');
    expect(html).toContain('Superseded');
  });

  it('overview() does NOT emit kpi-superseded chip when loop.superseded === 0', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const runOverview = buildOverviewHarness(js);
    const html = runOverview(makeOverviewSnap(0));
    expect(html).not.toContain('kpi-superseded');
    expect(html).not.toContain('>Superseded<');
  });

  // -------------------------------------------------------------------------
  // agentsPanel() source-level checks — verify the JS contains the correct
  // conditional logic for superseded-card and st.superseded badge.
  // The harness approach is impractical due to agentSub's deep dependency chain;
  // source checks are authoritative since the logic is straightforward branches.
  // -------------------------------------------------------------------------

  it('agentsPanel() JS contains superseded-card conditional on a.superseded', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'agentsPanel');
    // Card div must conditionally add 'superseded-card' when a.superseded is true.
    expect(fn).toContain('superseded-card');
    expect(fn).toContain('a.superseded');
  });

  it('agentsPanel() JS badge class uses "superseded" for superseded agents (not "dead")', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'agentsPanel');
    // The status badge class expression must evaluate to 'superseded' for superseded agents.
    // Pattern: a.superseded?'superseded':escCls(a.status)
    expect(fn).toMatch(/a\.superseded\?'superseded'/);
  });

  it('agentsPanel() JS statusLabel uses "superseded" label for superseded agents', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const fn = extractBalancedFn(js, 'agentsPanel');
    // statusLabel must be 'superseded' when a.superseded is true.
    expect(fn).toContain("a.superseded?'superseded'");
  });

  it('CSS .card.superseded-card is defined in shipped CSS (for agentsPanel cards)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.card.superseded-card{');
  });

  it('CSS .st.superseded is defined in shipped CSS (yellow badge for superseded agents)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.st.superseded{');
  });

  it('CSS .kpi-superseded is defined in shipped CSS (yellow KPI value)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.kpi-superseded{');
  });
});
