import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
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
    // Null-guarded addEventListener wiring (CSP-safe convention; .onclick is banned):
    //   var er=...; if(er)er.addEventListener('click',...) and similarly for eg.
    expect(html).toContain('if(er)er.addEventListener');
    expect(html).toContain('if(eg)eg.addEventListener');
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
  it('panel mode (default) still contains the six-panel toggles bar', () => {
    expect(getHtml(TEST_NONCE)).toContain('id="toggles"');
    expect(getHtml(TEST_NONCE, 2, 200, 'panel')).toContain('id="toggles"');
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
});

// ---------------------------------------------------------------------------
// M1-ClearFilters: 'Clear filters' button placement and wiring
// ---------------------------------------------------------------------------
describe('M1-ClearFilters — Clear filters button in filter bar', () => {
  // Helper: extract the JS source constant from the panel-mode HTML.
  function getPanelJs(html: string): string {
    const TEST_NONCE_LOCAL = 'dGVzdG5vbmNlMTIz';
    const scriptOpen = `<script nonce="${TEST_NONCE_LOCAL}">`;
    const scriptClose = '</script>';
    const scriptStart = html.indexOf(scriptOpen);
    const scriptEnd = html.lastIndexOf(scriptClose);
    return html.slice(scriptStart + scriptOpen.length, scriptEnd);
  }

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
  function getPanelJs(html: string): string {
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const s = html.indexOf(scriptOpen);
    const e = html.lastIndexOf(scriptClose);
    return html.slice(s + scriptOpen.length, e);
  }

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
  function getPanelJs(html: string): string {
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const s = html.indexOf(scriptOpen);
    const e = html.lastIndexOf(scriptClose);
    return html.slice(s + scriptOpen.length, e);
  }

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
  // AC2: WCAG 4.1.2 — Prompt disclosure header must have role="button" and aria-expanded.
  // The header is a <div> acting as a button; without role="button" screen readers
  // cannot announce its interactive nature or announce its expanded/collapsed state.
  // -------------------------------------------------------------------------
  it('AC2: prompt disclosure header has role="button" (WCAG 4.1.2)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The header element must carry role="button"
    expect(js).toContain('prompt-disc-hdr');
    expect(js).toContain('role="button"');
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
  it('AC4: PANELS array order matches render() build order', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Extract the PANELS constant line
    const panelsLine = js.split('\n').find((l) => l.startsWith('const PANELS='));
    expect(panelsLine).toBeDefined();
    // Extract ordered keys from the PANELS array
    const keys: string[] = [];
    const re = /\['([^']+)','[^']+'\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(panelsLine!)) !== null) {
      keys.push(m[1]!);
    }
    // Extract render order from the render() function body
    // The render function uses: if(state.on.X!==0)h+=XPanel()
    const renderOrder: string[] = [];
    const renderRe = /state\.on\.(\w+)!==0/g;
    let rm: RegExpExecArray | null;
    while ((rm = renderRe.exec(js)) !== null) {
      renderOrder.push(rm[1]!);
    }
    // PANELS keys and render order must be identical sequences
    expect(keys).toEqual(renderOrder);
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
// M2-Layout: collapsible panel headers (click h3 to fold/unfold, persist via setState)
// ---------------------------------------------------------------------------
describe('M2-Layout — collapsible panel section headers', () => {
  function getPanelJs(html: string): string {
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const s = html.indexOf(scriptOpen);
    const e = html.lastIndexOf(scriptClose);
    return html.slice(s + scriptOpen.length, e);
  }

  // -------------------------------------------------------------------------
  // CSS: panel h3 must NOT have cursor:pointer — only the child button gets it.
  // The h3 is a non-interactive heading landmark; cursor:pointer on it would be
  // a visual lie (clicks on the h3 outside the button area are not handled).
  // The global 'button' rule gives .panel>h3>button its pointer cursor.
  // -------------------------------------------------------------------------
  it('CSS panel>h3 must NOT have cursor:pointer — only the child button gets pointer cursor', () => {
    const html = getHtml(TEST_NONCE);
    // cursor:pointer must be present somewhere in the CSS (on the button rule), but
    // must NOT appear inside the .panel>h3{...} rule itself.
    expect(html).toContain('cursor:pointer'); // present on the button / .row rule
    expect(html).toContain('.panel>h3{');
    // Extract the .panel>h3 rule body and assert it does NOT contain cursor:pointer.
    // A future contributor adding cursor:pointer to h3 would regress keyboard focus
    // behavior and create a false pointer affordance on a non-interactive element.
    expect(html).not.toMatch(/\.panel>h3\{[^}]*cursor:pointer/);
  });

  it('CSS panel>h3 has focus-visible outline for keyboard operability', () => {
    const html = getHtml(TEST_NONCE);
    // The focus rule must be present for the panel header
    expect(html).toContain('.panel>h3:focus-visible{');
    const idx = html.indexOf('.panel>h3:focus-visible{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('outline');
    expect(rule).toContain('--vscode-focusBorder');
  });

  it('CSS defines .panel-chevron rule with transition (caret indicator)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.panel-chevron{');
    const idx = html.indexOf('.panel-chevron{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('transition:');
  });

  it('CSS defines .panel.collapsed>.body{display:none} to hide body when collapsed', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.panel.collapsed>.body{display:none}');
  });

  it('CSS defines .panel.collapsed>h3{border-bottom:none} (no orphan border when collapsed)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.panel.collapsed>h3{border-bottom:none}');
  });

  // -------------------------------------------------------------------------
  // JS: panel() helper produces h3 containing a real <button> child.
  // The <button> carries tabindex, aria-expanded, and data-pkey — NOT the h3.
  // The h3 is an implicit heading landmark only; role="button" must NOT appear
  // on the h3 itself (that would conflict with the native heading semantics).
  // -------------------------------------------------------------------------
  it('JS panel() helper produces h3 containing a real button element (not role=button on h3)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The panel function must produce an h3 that directly contains a <button> with data-pkey.
    // This verifies the correct WCAG 4.1.2 structure: native button (not a role attribute hack).
    expect(js).toMatch(/<h3[^>]*><button[^>]*data-pkey/);
    // The h3 element itself must NOT carry role="button" — that would override heading semantics
    // and mislead future contributors into thinking the h3 needs to be interactive.
    expect(js).not.toMatch(/<h3[^>]*role="button"/);
  });

  it('JS panel() helper produces h3 with tabindex="0" for keyboard operability', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('tabindex="0"');
  });

  it('JS panel() helper sets aria-expanded on the h3 header', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // aria-expanded reflects open/closed state for screen readers.
    expect(js).toContain('aria-expanded=');
  });

  it('JS panel() helper sets data-pkey attribute on the h3 (for wire() lookup)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // wire() queries .panel>h3[data-pkey] to attach click/keydown handlers.
    expect(js).toContain('data-pkey=');
  });

  it('JS panel() helper injects .panel-chevron span with aria-hidden="true" (decorative)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('panel-chevron');
    expect(js).toContain('aria-hidden="true"');
  });

  it('JS panel() helper applies "collapsed" CSS class when panelOpen[k] is 0', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The panel helper must apply 'collapsed' when the section is closed.
    expect(js).toContain("'collapsed'");
    // The class must reference state.panelOpen
    expect(js).toContain('state.panelOpen');
  });

  // -------------------------------------------------------------------------
  // JS state: panelOpen key is in state initializer, defaulting charts to 0.
  // -------------------------------------------------------------------------
  it('JS state initializer includes panelOpen key', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('panelOpen:');
  });

  it('JS state panelOpen defaults charts to 0 (collapsed) to cut default scroll distance', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // panelOpen default must have charts:0 so Charts starts collapsed even when toggled on.
    // This is the M2-Layout requirement: "Charts panel collapsed by default".
    // The state line uses Object.assign({key:val,...}, _s.panelOpen||{}).
    // Search for the Object.assign literal to skip any comment lines containing 'panelOpen:'.
    const panelOpenIdx = js.indexOf('panelOpen:Object.assign(');
    expect(panelOpenIdx).toBeGreaterThan(-1);
    const panelOpenSlice = js.slice(panelOpenIdx, panelOpenIdx + 200);
    expect(panelOpenSlice).toContain('charts:0');
  });

  it('JS state panelOpen defaults all non-charts panels to 1 (expanded)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // All panels other than charts should default to 1 (visible/expanded).
    const panelOpenIdx = js.indexOf('panelOpen:Object.assign(');
    expect(panelOpenIdx).toBeGreaterThan(-1);
    const panelOpenSlice = js.slice(panelOpenIdx, panelOpenIdx + 200);
    expect(panelOpenSlice).toContain('overview:1');
    expect(panelOpenSlice).toContain('agents:1');
    expect(panelOpenSlice).toContain('findings:1');
    expect(panelOpenSlice).toContain('verdicts:1');
    expect(panelOpenSlice).toContain('changed:1');
  });

  it('JS state panelOpen is persisted from _s (restored from api.getState)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The state initializer must merge _s.panelOpen so persisted collapse state
    // survives a snapshot re-render.
    expect(js).toContain('_s.panelOpen');
  });

  // -------------------------------------------------------------------------
  // JS wire(): panel header click and keyboard handlers (nonce-safe).
  // -------------------------------------------------------------------------
  it('JS wire() wires .panel>h3>button[data-pkey] elements via querySelectorAll', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // wire() targets the <button> inside the h3 directly — data-pkey is on the button,
    // not the h3. Using the button as the selector anchor avoids the dead-selector bug
    // where '.panel>h3[data-pkey]' never matched (h3 never had data-pkey).
    expect(js).toContain("querySelectorAll('.panel>h3>button[data-pkey]')");
  });

  it('JS wire() panel toggle uses addEventListener not inline onclick (nonce-safe)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Inline onclick handlers are blocked by nonce-based CSP; addEventListener is required.
    expect(js).toContain("addEventListener('click',toggle_panel)");
    // Must NOT use onclick=
    expect(js).not.toContain('.panel>h3" onclick');
    expect(js).not.toContain("h3.onclick");
  });

  it('JS wire() panel toggle responds to Enter and Space keydown (keyboard operability)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The keydown handler must support both Enter and Space.
    // These test patterns are constrained to the section after querySelectorAll(.panel>h3).
    const idx = js.indexOf("querySelectorAll('.panel>h3>button[data-pkey]')");
    expect(idx).toBeGreaterThan(-1);
    // Use 1000 chars — the keydown handler follows the click handler in the same forEach block.
    const section = js.slice(idx, idx + 1000);
    expect(section).toContain("'Enter'");
    expect(section).toContain("' '");
    expect(section).toContain('e.preventDefault()');
  });

  it('JS wire() panel toggle calls classList.toggle("collapsed") on the parent panel', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The toggle function must toggle the "collapsed" CSS class on the .panel element.
    expect(js).toContain("classList.toggle('collapsed')");
  });

  it('JS wire() panel toggle updates aria-expanded on the button after toggle', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // After toggling, aria-expanded must be updated on the <button> (which carries aria-expanded)
    // so screen readers announce the new open/closed state. The button is now the toggle target
    // (data-pkey is on the button, not the h3).
    const idx = js.indexOf("querySelectorAll('.panel>h3>button[data-pkey]')");
    const section = js.slice(idx, idx + 600);
    expect(section).toContain("setAttribute('aria-expanded'");
  });

  it('JS wire() panel toggle persists state via state.panelOpen[k] and save()', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The toggle must update state.panelOpen[k] and call save() to persist.
    const idx = js.indexOf("querySelectorAll('.panel>h3>button[data-pkey]')");
    const section = js.slice(idx, idx + 600);
    expect(section).toContain('state.panelOpen[k]');
    expect(section).toContain('save()');
  });

  // -------------------------------------------------------------------------
  // Scroll position preservation: panel collapse must not disrupt M1 scroll pattern.
  // The panel collapse toggles only the CSS class (no innerHTML replace), so
  // window.scrollY is preserved automatically — no explicit save/restore needed.
  // -------------------------------------------------------------------------
  it('JS wire() panel toggle does NOT call render() (avoids scroll position reset)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Toggling a panel section must not re-render the whole page — that would
    // reset window.scrollY and lose the M1 scroll position preservation.
    // The toggle only mutates the DOM in place (classList.toggle).
    const idx = js.indexOf("querySelectorAll('.panel>h3>button[data-pkey]')");
    expect(idx).toBeGreaterThan(-1);
    // The toggle_panel function should not contain a call to render()
    // Extract only the toggle_panel function body to avoid false positives
    const section = js.slice(idx, idx + 600);
    // render() must not appear inside the panel toggle handler
    expect(section).not.toMatch(/toggle_panel[^}]*render\(\)/);
  });
});
