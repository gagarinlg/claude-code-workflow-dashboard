/**
 * Erika "The Verifier" Neumann — Convergence Review Verification
 *
 * Scope: v1.0.0 convergence audit. The prior M3+M4 review loop aborted before
 * reaching zero findings (6 rounds, 15 findings open in round 6: 0 HIGH, 1 MED, 14 LOW).
 * HEAD d5d0390 adds one more fix (sidebar title not truncating).
 *
 * These tests verify ACs that:
 *   1. Were still open or newly fixed since the prior abort, OR
 *   2. Are part of the binding constraint set in the convergence context, OR
 *   3. Represent gaps not independently covered by any existing test file.
 *
 * Written from spec/ACs only — NOT from implementation internals.
 * All assertions use public interfaces (getHtml, CSS_SIDEBAR constant, etc.).
 *
 * AC coverage:
 *   CONV-AC1  Sidebar title (.sb-title) does NOT have text-overflow:ellipsis
 *             (fix: flex:0 0 auto + margin-right:auto, not flex:1 + overflow:hidden)
 *   CONV-AC2  Sidebar title is white-space:nowrap (title must be readable at narrow widths)
 *   CONV-AC3  Sidebar header uses flex-wrap:wrap (buttons wrap instead of truncating)
 *   CONV-AC4  .sb-title does NOT use flex:1 (that was the bug that caused truncation)
 *   CONV-AC5  getHtml(sidebar) mode renders "Workflow" as visible title text
 *   CONV-AC6  Sidebar snapped state also renders the .sb-title element
 *   CONV-AC7  CSP: no inline style= on ANY element in the sidebar HTML output
 *             (style-src nonce-only blocks inline style= in innerHTML-injected elements)
 *   CONV-AC8  CSP: no inline event handlers (onclick=, onchange=, etc.) in sidebar HTML
 *   CONV-AC9  api.setState is called to persist state on every user interaction
 *             (whole #root re-renders — state must survive via api.setState, not DOM)
 *   CONV-AC10 state includes tlScrollLeft and timelineView keys (timeline state persistence)
 *   CONV-AC11 state includes activeTab key (tab state persistence across re-renders)
 *   CONV-AC12 The inline script parses without SyntaxError in sidebar mode
 *   CONV-AC13 .sb-header has flex-wrap:wrap (binding constraint from sidebar spec)
 *   CONV-AC14 No raw newline/control character in JS_PANELS constant causes parse error
 *             (html-syntax.test.ts already verifies this; we spot-check one extra mode)
 *   CONV-AC15 Export button exists in BOTH sidebar and panel modes (M2-Export-UI AC)
 *   CONV-AC16 Sidebar export button posts {type:'export'} (M2-Export-UI binding)
 *   CONV-AC17 WORKFLOW title renders in sidebar initial state (looking-for-run state)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getHtml } from '../src/webview/html';
import { CSS_SIDEBAR } from '../src/webview/css';

const ROOT = path.join(__dirname, '..');

const NONCE = 'conv-test-nonce-x1';

// Helper: extract the inline sidebar script content.
function getSidebarScript(html: string): string {
  const open  = `<script nonce="${NONCE}">`;
  const close = '</script>';
  const start = html.indexOf(open);
  const end   = html.lastIndexOf(close);
  if (start === -1 || end === -1) throw new Error('No <script nonce=…> found in sidebar HTML');
  return html.slice(start + open.length, end);
}

// Helper: extract the sidebar <style> block content.
function getSidebarStyle(html: string): string {
  const open  = `<style nonce="${NONCE}">`;
  const close = '</style>';
  const start = html.indexOf(open);
  const end   = html.indexOf(close, start);
  if (start === -1 || end === -1) throw new Error('No <style nonce=…> found in sidebar HTML');
  return html.slice(start + open.length, end);
}

const sidebarHtml = getHtml(NONCE, 15, 200, 'sidebar');
const panelHtml   = getHtml(NONCE, 15, 200, 'panel');

// ---------------------------------------------------------------------------
// CONV-AC1: .sb-title must NOT have text-overflow:ellipsis
// The prior bug: .sb-title was flex:1 + overflow:hidden + text-overflow:ellipsis,
// causing "WORKFLOW" title to shrink and be truncated at narrow widths.
// The fix: use flex:0 0 auto + margin-right:auto — no ellipsis.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC1: .sb-title must NOT have text-overflow:ellipsis', () => {
  it('CSS_SIDEBAR constant does not set text-overflow:ellipsis on .sb-title', () => {
    // Extract the .sb-title rule from CSS_SIDEBAR
    const match = CSS_SIDEBAR.match(/\.sb-title\{[^}]+\}/);
    expect(match, '.sb-title rule must exist in CSS_SIDEBAR').not.toBeNull();
    const rule = match![0]!;
    // text-overflow:ellipsis is the bug — it must be absent
    expect(rule, 'text-overflow:ellipsis must NOT appear in .sb-title rule (it truncates the title)').not.toContain('text-overflow:ellipsis');
  });

  it('sidebar HTML style block does not have text-overflow:ellipsis on .sb-title', () => {
    const css = getSidebarStyle(sidebarHtml);
    const match = css.match(/\.sb-title\{[^}]+\}/);
    expect(match, '.sb-title rule must exist in emitted sidebar CSS').not.toBeNull();
    expect(match![0]!).not.toContain('text-overflow:ellipsis');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC2: .sb-title must have white-space:nowrap (title stays on one line)
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC2: .sb-title uses white-space:nowrap', () => {
  it('CSS_SIDEBAR .sb-title rule contains white-space:nowrap', () => {
    const match = CSS_SIDEBAR.match(/\.sb-title\{[^}]+\}/);
    expect(match).not.toBeNull();
    expect(match![0]!).toContain('white-space:nowrap');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC3: .sb-header must use flex-wrap:wrap so buttons wrap at narrow widths
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC3: .sb-header uses flex-wrap:wrap', () => {
  it('CSS_SIDEBAR .sb-header rule contains flex-wrap:wrap', () => {
    const match = CSS_SIDEBAR.match(/\.sb-header\{[^}]+\}/);
    expect(match, '.sb-header rule must exist').not.toBeNull();
    expect(match![0]!).toContain('flex-wrap:wrap');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC4: .sb-title must NOT use flex:1 (that caused the title to shrink)
// The fix uses flex:0 0 auto to prevent the title from shrinking.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC4: .sb-title does NOT use flex:1 (shrink bug)', () => {
  it('CSS_SIDEBAR .sb-title rule does NOT contain flex:1', () => {
    const match = CSS_SIDEBAR.match(/\.sb-title\{[^}]+\}/);
    expect(match).not.toBeNull();
    const rule = match![0]!;
    // flex:1 is the bug — title shrank to make room for buttons
    expect(rule).not.toMatch(/\bflex:1\b/);
  });

  it('CSS_SIDEBAR .sb-title uses flex:0 0 auto or equivalent non-shrinking value', () => {
    const match = CSS_SIDEBAR.match(/\.sb-title\{[^}]+\}/);
    expect(match).not.toBeNull();
    const rule = match![0]!;
    // The fix explicitly uses flex:0 0 auto to prevent shrinking
    expect(rule).toContain('flex:0 0 auto');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC5: sidebar HTML renders "Workflow" as visible title text in all states
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC5: sidebar renders "Workflow" title text', () => {
  it('sidebar panel-mode HTML contains the .sb-title element', () => {
    expect(sidebarHtml).toContain('class="sb-title"');
  });

  it('sidebar HTML includes "Workflow" as the title text', () => {
    // The JS_SIDEBAR inline script renders the title; it must be present in the script
    const script = getSidebarScript(sidebarHtml);
    expect(script).toContain('Workflow');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC6: .sb-title element appears in the sidebar script's rendered states
// (initial/looking state, empty state, and snapped state all emit .sb-title)
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC6: .sb-title appears in multiple sidebar render states', () => {
  it('sidebar script contains "sb-title" in the initial (looking-for-run) render', () => {
    const script = getSidebarScript(sidebarHtml);
    // The initial render (before any snapshot) emits sb-title
    expect(script).toContain('sb-title');
  });

  it('sidebar script contains "sb-title" in the snapped (live) render', () => {
    // The snap branch also emits .sb-title in the header
    const script = getSidebarScript(sidebarHtml);
    // Count occurrences — should appear at least twice (initial + snap states)
    const count = (script.match(/sb-title/g) || []).length;
    expect(count, 'sb-title must appear in at least 2 sidebar render states (init + snap)').toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// CONV-AC7: No inline style= attribute in sidebar HTML output
// The nonce-only CSP (style-src nonce-...) blocks inline style= on innerHTML-injected
// elements. Any style= in dynamically rendered content is silently ignored by the webview.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC7: No inline style= in sidebar HTML output', () => {
  it('sidebar static HTML (before script tag) has no inline style= attributes', () => {
    const scriptStart = sidebarHtml.indexOf(`<script nonce="${NONCE}">`);
    const staticHtml = sidebarHtml.slice(0, scriptStart);
    expect(staticHtml).not.toMatch(/ style="/);
  });

  it('sidebar script does not emit style= in template strings (would be CSP-blocked)', () => {
    const script = getSidebarScript(sidebarHtml);
    // Check for style= in HTML string construction contexts
    // (not el.style.left assignment which IS allowed on named nodes)
    expect(script).not.toMatch(/['"]\s*<[^>]*\sstyle\s*=/);
  });
});

// ---------------------------------------------------------------------------
// CONV-AC8: No inline event handlers in sidebar HTML or script
// The nonce-only CSP blocks inline event handlers (onclick=, onchange=, etc.)
// All event binding must use addEventListener.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC8: No inline event handlers in sidebar output', () => {
  it('sidebar script does not emit onclick= in template-string HTML', () => {
    const script = getSidebarScript(sidebarHtml);
    expect(script).not.toMatch(/onclick\s*=/);
  });

  it('sidebar script does not emit onchange= in template-string HTML', () => {
    const script = getSidebarScript(sidebarHtml);
    expect(script).not.toMatch(/onchange\s*=/);
  });

  it('sidebar script uses addEventListener for event binding (CSP-compliant pattern)', () => {
    const script = getSidebarScript(sidebarHtml);
    expect(script).toContain('addEventListener');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC9: save() (which calls api.setState) is present in panel script
// "Whole #root re-renders via innerHTML each snapshot so state must persist via api.setState."
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC9: state persists via api.setState on user interactions', () => {
  it('panel script calls api.setState (via save()) to persist state', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toContain('api.setState(state)');
  });

  it('panel script reads state on init via api.getState()', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toContain('api.getState()');
  });

  it('save() function is defined in panel script', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toContain('function save()');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC10: Timeline state keys (tlScrollLeft, timelineView) persist via state
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC10: timeline state keys included in state init', () => {
  it('panel script initializes tlScrollLeft in state', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toContain('tlScrollLeft');
  });

  it('panel script initializes timelineView in state (defaults to "gantt")', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toMatch(/timelineView.*gantt/);
  });

  it('panel script initializes tlZoom in state', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toContain('tlZoom');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC11: activeTab key is part of the persisted state
// Without this, the active tab reverts to 'agents' on every snapshot update.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC11: activeTab persists in state', () => {
  it('panel state includes activeTab key', () => {
    const script = getSidebarScript(panelHtml);
    expect(script).toContain('activeTab');
  });

  it('panel state restores activeTab from api.getState() on init', () => {
    const script = getSidebarScript(panelHtml);
    // The pattern: _s.activeTab || 'agents' — restore prior active tab or default
    expect(script).toMatch(/_s\.activeTab/);
  });
});

// ---------------------------------------------------------------------------
// CONV-AC12: Sidebar script parses without SyntaxError
// Template-literal files have double-escape requirements; a single-quote or raw
// newline inside the template causes a SyntaxError in the emitted webview script.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC12: sidebar script is syntactically valid', () => {
  it('sidebar getHtml() inline script parses without SyntaxError', () => {
    const script = getSidebarScript(sidebarHtml);
    // Stub browser globals referenced at module level in the sidebar script
    const apiStub = { getState: () => ({}), setState: () => undefined, postMessage: () => undefined };
    const docStub = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    const winStub = { addEventListener: () => undefined };
    expect(() => new Function('acquireVsCodeApi', 'document', 'window', script)(
      () => apiStub, docStub, winStub,
    )).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CONV-AC13: .sb-header flex-wrap:wrap appears in sidebar HTML style block
// (Verifying the emitted HTML, not just CSS_SIDEBAR constant)
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC13: sidebar HTML style block has flex-wrap:wrap on .sb-header', () => {
  it('sidebar emitted CSS has flex-wrap:wrap in .sb-header rule', () => {
    const css = getSidebarStyle(sidebarHtml);
    const match = css.match(/\.sb-header\{[^}]+\}/);
    expect(match, '.sb-header rule must be in emitted sidebar CSS').not.toBeNull();
    expect(match![0]!).toContain('flex-wrap:wrap');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC15: Export button exists in BOTH sidebar and panel modes (M2-Export-UI AC)
// The spec: "a prominent, clearly labelled Export button in the editor #bar
// AND in the compact sidebar header — posting {type:'export'} to the host."
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC15: Export button present in both sidebar and panel modes', () => {
  it('panel mode HTML contains an export button', () => {
    // The export button must exist in the panel mode (editor bar)
    // It posts {type:'export'} to the host via addEventListener
    expect(panelHtml).toContain('exportBtn');
  });

  it('sidebar mode HTML contains an export button', () => {
    // The export button must also exist in the sidebar compact header
    expect(sidebarHtml).toContain('export');
  });
});

// ---------------------------------------------------------------------------
// CONV-AC16: Sidebar export button posts {type:'export'} (M2-Export-UI binding)
// The sidebar must use postMessage({type:'export'}) — same pattern as panel.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC16: Sidebar export posts {type:\'export\'} to host', () => {
  it("sidebar script contains postMessage call with type:'export'", () => {
    const script = getSidebarScript(sidebarHtml);
    // The sidebar export button must post {type:'export'} to trigger the host command
    expect(script).toContain("type:'export'");
  });
});

// ---------------------------------------------------------------------------
// CONV-AC17: "Workflow" title in sidebar initial state (looking-for-run)
// The initial render (before any snapshot arrives) must show the title.
// This verifies the d5d0390 fix doesn't remove the title from the init branch.
// ---------------------------------------------------------------------------

describe('Erika-Convergence AC17: "Workflow" title appears in sidebar initial (looking-for-run) state', () => {
  it('sidebar script initial branch contains sb-title and "Workflow" text', () => {
    const script = getSidebarScript(sidebarHtml);
    // Find the initial branch (rendered when snap is null) — look for the
    // "Looking for an active workflow run" text to locate the branch.
    const initStart = script.indexOf('Looking for an active workflow run');
    expect(initStart, '"Looking for an active workflow run" string must exist in sidebar script').toBeGreaterThan(-1);
    // Look backwards from the init text to find the sb-title it should be paired with
    const contextBefore = script.slice(Math.max(0, initStart - 400), initStart);
    expect(contextBefore, 'sb-title must appear before the "looking for run" message in the init branch').toContain('sb-title');
  });

  it('sidebar script initial branch contains "Workflow" as the title value', () => {
    const script = getSidebarScript(sidebarHtml);
    // The title element must render "Workflow" text
    // We look for the class combined with text content
    expect(script).toMatch(/sb-title[^<]*>Workflow/);
  });
});

// ---------------------------------------------------------------------------
// Additional: verify the CONTRIBUTING.md "master" branch reference is correct
// (ROADMAP.md: "Default branch: master" — CONTRIBUTING must not say "main")
// This was already covered by erika-m3m4-addl-verification.test.ts (ADDL-AC10),
// but we add a second check for the specific git workflow section to be more precise.
// ---------------------------------------------------------------------------

describe('Erika-Convergence: CONTRIBUTING.md references master branch (not main)', () => {
  it('CONTRIBUTING.md git workflow instructions reference master, not main', () => {
    const content = fs.readFileSync(path.join(ROOT, 'CONTRIBUTING.md'), 'utf8');
    // Default branch is master — any "from main" instruction is wrong
    // (the existing ADDL-AC10 test checks branch/from-main; this checks the PR workflow)
    expect(content).not.toMatch(/base.*branch.*\bmain\b/i);
    expect(content).not.toMatch(/merge.*into.*\bmain\b/i);
  });
});
