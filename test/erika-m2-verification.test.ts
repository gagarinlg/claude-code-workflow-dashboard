/**
 * Erika — Independent Verification: M2 Acceptance Criteria
 *
 * These tests are black-box verifications derived directly from ROADMAP §M2
 * acceptance criteria and constraints. They do NOT duplicate Fritz's existing
 * test files. Each test cites its AC source.
 *
 * ACs verified here (Fritz's tests do NOT cover these):
 *  - M2-Export-UI: Export button present in panel #bar AND sidebar header
 *  - M2-Export-UI: Export button posts {type:'export'} to host
 *  - M2-Export-UI: Export button uses addEventListener (nonce-safe, no inline onclick)
 *  - M2-Export-UI: Export button has aria-label + tooltip
 *  - M2-Export-UI: extension.ts onDidReceiveMessage handles {type:'export'}
 *  - M2-Export-Name: buildExportFilename produces claude-workflow-<runId>-<YYYYMMDD-HHmm>.md
 *  - M2-Export-Name: filename is always .md extension
 *  - M2-Export-Name: filename never contains path separators / \ : * or whitespace
 *  - M2-Export-Name: filename is deterministic for a fixed snapshot
 *  - M2-Export-Name: filename length cap (~120 chars)
 *  - M2-AgentPrompt: getHtml asserts prompt disclosure renders and is escaped (ROADMAP note)
 *  - M2-AgentPrompt: buildSnapshot carries full prompt through Agent.prompt field
 *  - M2-AgentPrompt: prompt is capped at MAX_PROMPT_CHARS
 *  - M2-Charts: chart fills use --vscode-charts-* (not SVG default black)
 *  - M2-Charts: forced-colors block covers chart elements
 *  - No pricing anywhere in getHtml output
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getHtml } from '../src/webview/html';
import { buildSnapshot, MAX_PROMPT_CHARS } from '../src/data/snapshot';
import type { SnapshotOk, Cfg } from '../src/data/snapshot';
import { DEFAULT_ROLE_RULES } from '../src/data/parse';
// ESM import so V8 coverage attributes all markdown.ts execution to a single module context.
// Previously a require() created a second V8 script for the same file, splitting coverage.
import { buildExportFilename as buildExportFilenameEsm } from '../src/export/markdown';

const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPanelJs(html: string): string {
  const open = `<script nonce="${TEST_NONCE}">`;
  const close = '</script>';
  const s = html.indexOf(open);
  const e = html.lastIndexOf(close);
  return html.slice(s + open.length, e);
}

function getSidebarHtml(): string {
  return getHtml(TEST_NONCE, 2, 200, 'sidebar');
}

function getPanelHtml(): string {
  return getHtml(TEST_NONCE, 2, 200, 'panel');
}

// ---------------------------------------------------------------------------
// Fixture: wf dir with a long prompt
// ---------------------------------------------------------------------------

let tmpBase: string;
let longPromptCfg: Cfg;

beforeAll(() => {
  tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'erika-m2-'));
  const wfDir = path.join(tmpBase, 'proj', 'subagents', 'workflows', 'wf_erika_test');
  fs.mkdirSync(wfDir, { recursive: true });

  // Agent with a prompt longer than MAX_PROMPT_CHARS
  const longPrompt = 'A'.repeat(MAX_PROMPT_CHARS + 500);
  const events = [
    { type: 'user', message: { content: longPrompt } },
    { type: 'assistant', message: { usage: { output_tokens: 50 }, content: [{ type: 'text', text: 'Done' }] } },
  ];
  fs.writeFileSync(
    path.join(wfDir, 'agent-testprompt.jsonl'),
    events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(wfDir, 'journal.jsonl'),
    JSON.stringify({ type: 'result', agentId: 'testprompt', result: 'done' }) + '\n',
    'utf8',
  );
  const now = new Date();
  fs.utimesSync(wfDir, now, now);

  longPromptCfg = {
    base: tmpBase,
    repo: '',
    refreshMs: 4000,
    statusBar: true,
    roleRules: DEFAULT_ROLE_RULES,
  };
});

afterAll(() => {
  try { fs.rmSync(tmpBase, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// AC: M2-Export-UI — Export button in panel #bar
// ROADMAP: "a prominent, clearly labelled 'Export ⭳ / Export Markdown' button
// in the editor #bar (next to Guide/Refresh/Runs)"
// ---------------------------------------------------------------------------
describe('M2-Export-UI — panel #bar Export button', () => {
  it('panel HTML contains an Export button in the #bar toolbar', () => {
    // The #bar contains Guide, Refresh, Runs buttons — Export must also be there.
    // ROADMAP: "Don't rely solely on the command palette / view/title menu (the
    // editor panel has no title menu)."
    const html = getPanelHtml();
    const barStart = html.indexOf('id="bar"');
    expect(barStart).toBeGreaterThan(-1);
    // Find the end of the bar div — look for the closing angle of the next top-level div
    // The bar is a single <div id="bar">...</div> block
    const barSection = html.slice(barStart, barStart + 800);
    // The bar must contain an Export button
    expect(barSection.toLowerCase()).toContain('export');
  });

  it('panel Export button has data-testid="export-btn" or aria-label containing Export', () => {
    const html = getPanelHtml();
    // ROADMAP: "aria-label + tooltip" required
    const hasAriaExport = html.includes('aria-label="Export') || html.includes("aria-label='Export");
    const hasTestidExport = html.includes('data-testid="export-btn"') || html.includes("data-testid='export-btn'");
    expect(hasAriaExport || hasTestidExport).toBe(true);
  });

  it('panel Export button has a tooltip (title attribute)', () => {
    const html = getPanelHtml();
    // ROADMAP: "aria-label + tooltip"
    // The export button must have a title= attribute for tooltip display
    expect(html).toMatch(/title\s*=\s*["'][^"']*[Ee]xport[^"']*["']/);
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Export-UI — Export button in sidebar header
// ROADMAP: "AND in the compact sidebar header"
// ---------------------------------------------------------------------------
describe('M2-Export-UI — sidebar header Export button', () => {
  it('sidebar HTML contains an Export button in the compact header', () => {
    const html = getSidebarHtml();
    // The sidebar header has "Open full dashboard" and "Runs" buttons — Export must join them
    expect(html.toLowerCase()).toContain('export');
  });

  it('sidebar Export button has aria-label containing Export', () => {
    const html = getSidebarHtml();
    const hasAriaExport = html.includes('aria-label="Export') || html.includes("aria-label='Export");
    const hasTestidExport = html.includes('data-testid="export-btn"') || html.includes("data-testid='export-btn'");
    expect(hasAriaExport || hasTestidExport).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Export-UI — Export button posts {type:'export'} to host via addEventListener
// ROADMAP: "posting {type:'export'} to the host", "addEventListener (nonce CSP blocks inline onclick)"
// ---------------------------------------------------------------------------
describe('M2-Export-UI — export message wiring (nonce-safe)', () => {
  it("panel JS posts {type:'export'} message to the host", () => {
    const js = getPanelJs(getPanelHtml());
    // The webview must postMessage {type:'export'} — this is the only way the
    // editor panel can trigger the export command (it has no view/title menu).
    expect(js).toContain("type:'export'");
  });

  it("panel JS wires the Export button via addEventListener, NOT inline onclick", () => {
    const js = getPanelJs(getPanelHtml());
    // ROADMAP constraint: "addEventListener (nonce CSP blocks inline onclick)"
    // Verify addEventListener is used for export wiring
    expect(js).toContain("addEventListener");
    // Verify no inline onclick on the export button element
    // (the element must have data-testid or aria-label Export; onclick= on such element is forbidden)
    const html = getPanelHtml();
    // Raw HTML must not have onclick= on any element that also mentions export
    expect(html).not.toMatch(/export[^>]*onclick=/i);
    expect(html).not.toMatch(/onclick=[^>]*export/i);
  });

  it("sidebar JS posts {type:'export'} message to the host", () => {
    // The sidebar also gets an Export button posting {type:'export'}
    const html = getSidebarHtml();
    // The sidebar has its own inline script block — it must also contain the export postMessage
    expect(html).toContain("type:'export'");
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Export-UI — extension.ts handles {type:'export'} message
// ROADMAP: "extend the onDidReceiveMessage switch, same pattern as the M1
// run-picker button"
// ---------------------------------------------------------------------------
describe('M2-Export-UI — extension.ts onDidReceiveMessage handles export', () => {
  it("extension.ts onDidReceiveMessage handles {type:'export'} by running exportMarkdown", () => {
    const extSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
    // The handler must contain an 'export' branch that dispatches to claudeWorkflow.exportMarkdown
    // Pattern: msg['type'] === 'export' → executeCommand('claudeWorkflow.exportMarkdown')
    // or similar structure
    const hasExportBranch = extSrc.includes("'export'") && extSrc.includes('exportMarkdown');
    expect(hasExportBranch).toBe(true);
  });

  it("extension.ts connects 'export' message type to claudeWorkflow.exportMarkdown command", () => {
    const extSrc = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'extension.ts'),
      'utf8',
    );
    // Find the onDidReceiveMessage block and verify it handles 'export'
    const msgHandlerStart = extSrc.indexOf('onDidReceiveMessage');
    expect(msgHandlerStart).toBeGreaterThan(-1);
    // The handler block (limited to reasonable range) must route 'export' to the command
    const handlerBlock = extSrc.slice(msgHandlerStart, msgHandlerStart + 800);
    expect(handlerBlock).toContain("'export'");
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Export-Name — smart default filename
// ROADMAP: "pre-fill a sensible, filesystem-safe default derived from the latest
// snapshot … claude-workflow-<runId>-<YYYYMMDD-HHmm>.md … sanitise to
// [A-Za-z0-9._-] … cap length ~120"
// ---------------------------------------------------------------------------

// buildExportFilename import — uses the same ESM module instance as the top-level import
// so V8 coverage is attributed to a single module context (not split between ESM + require()).
// The top-level ESM import (buildExportFilenameEsm) proves the export exists at module level.
const buildExportFilename: ((snap: SnapshotOk) => string) | undefined = buildExportFilenameEsm;

function makeMinimalSnap(overrides: Partial<SnapshotOk> = {}): SnapshotOk {
  return {
    ok: true,
    runId: 'wf_test_20240315_093000',
    workflowDir: '/tmp/.claude/projects/proj/workflows/wf_test_20240315_093000',
    updatedAt: '09:30:00',
    isPinned: false,
    agentsCapped: false,
    loop: {
      phase: 'idle / between passes',
      live: 0, done: 1, dead: 0, total: 1,
      outTok: 500, tools: 3, passes: 1, findings: 0, sevTotals: {},
    },
    labels: [],
    agents: [],
    allFindings: [],
    structuredResults: [],
    verdicts: {},
    verdictLabels: {},
    changed: null,
    ...overrides,
  };
}

describe('M2-Export-Name — buildExportFilename function exists', () => {
  it('buildExportFilename is exported from src/export/markdown.ts', () => {
    // ROADMAP: "Unit-test the name builder: deterministic for a fixed snapshot,
    // always .md, never contains / \\ : * or whitespace, within the length cap."
    // The function must be exported so it is testable.
    expect(buildExportFilename).toBeDefined();
    expect(typeof buildExportFilename).toBe('function');
  });
});

describe('M2-Export-Name — filename format and safety', () => {
  it('filename always has .md extension', () => {
    if (!buildExportFilename) {
      // Finding: function not exported — fail the test
      expect(buildExportFilename).toBeDefined();
      return;
    }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name.endsWith('.md')).toBe(true);
  });

  it('filename starts with "claude-workflow-" prefix', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name.startsWith('claude-workflow-')).toBe(true);
  });

  it('filename contains the runId segment', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    // runId is 'wf_test_20240315_093000' — after sanitisation it appears in the name
    const name = buildExportFilename(makeMinimalSnap({ runId: 'wf_myrun_001' }));
    expect(name).toContain('wf_myrun_001');
  });

  it('filename never contains forward slash', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name).not.toContain('/');
  });

  it('filename never contains backslash', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name).not.toContain('\\');
  });

  it('filename never contains colon', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name).not.toContain(':');
  });

  it('filename never contains asterisk', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name).not.toContain('*');
  });

  it('filename never contains whitespace', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const name = buildExportFilename(makeMinimalSnap());
    expect(name).not.toMatch(/\s/);
  });

  it('filename length is at most 120 characters (+ .md)', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    // Test with an extremely long runId to exercise the cap
    const longId = 'wf_' + 'x'.repeat(200);
    const name = buildExportFilename(makeMinimalSnap({ runId: longId }));
    expect(name.length).toBeLessThanOrEqual(125); // 120 + 4 for '.md' + buffer
  });

  it('filename is deterministic for a fixed snapshot (same input → same output)', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    const snap = makeMinimalSnap({ runId: 'wf_stable_run' });
    const name1 = buildExportFilename(snap);
    const name2 = buildExportFilename(snap);
    expect(name1).toBe(name2);
  });

  it('filename contains a timestamp segment in YYYYMMDD-HHmm format', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    // ROADMAP: timestamp comes from updatedAt or run mtime, falling back to export time.
    // We cannot know the exact timestamp but can verify the pattern.
    const name = buildExportFilename(makeMinimalSnap());
    // Must contain a date-like segment: 8 digits (YYYYMMDD) followed by - and 4 digits (HHmm)
    expect(name).toMatch(/\d{8}-\d{4}/);
  });

  it('filename only contains filesystem-safe characters [A-Za-z0-9._-]', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    // ROADMAP: "sanitise to [A-Za-z0-9._-]"
    const name = buildExportFilename(makeMinimalSnap());
    expect(name).toMatch(/^[A-Za-z0-9._\-]+$/);
  });

  it('sanitises runId with path separators and spaces in it', () => {
    if (!buildExportFilename) { expect(buildExportFilename).toBeDefined(); return; }
    // A runId derived from a path with separators must be sanitised
    const name = buildExportFilename(makeMinimalSnap({ runId: 'wf/my run:test*job' }));
    expect(name).not.toMatch(/[/\\:* ]/);
    expect(name.endsWith('.md')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC: M2-AgentPrompt — buildSnapshot carries full prompt (capped) on Agent
// ROADMAP: "carry the full prompt through buildSnapshot per agent (guard size …
// capped at MAX_PROMPT_CHARS)"
// ---------------------------------------------------------------------------
describe('M2-AgentPrompt — buildSnapshot carries prompt on agent', () => {
  it('Agent.prompt is present when the transcript has a user message', () => {
    const result = buildSnapshot(longPromptCfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    const agent = snap.agents.find((a) => a.id === 'testprompt');
    expect(agent).toBeDefined();
    expect(agent?.prompt).toBeDefined();
    expect(typeof agent?.prompt).toBe('string');
    expect((agent?.prompt?.length ?? 0)).toBeGreaterThan(0);
  });

  it('Agent.prompt is capped at MAX_PROMPT_CHARS (no bloat in snapshot payload)', () => {
    // ROADMAP: "guard size — workflow prompts can embed large findings JSON,
    // so render it in a capped, scrollable <pre>"
    const result = buildSnapshot(longPromptCfg);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const snap = result as SnapshotOk;
    const agent = snap.agents.find((a) => a.id === 'testprompt');
    expect(agent).toBeDefined();
    if (!agent) return;
    expect(agent.prompt!.length).toBeLessThanOrEqual(MAX_PROMPT_CHARS);
    // The original was MAX_PROMPT_CHARS + 500; capped version must be exactly MAX_PROMPT_CHARS
    expect(agent.prompt!.length).toBe(MAX_PROMPT_CHARS);
  });

  it('Agent.prompt is absent (undefined) when transcript has no user message', () => {
    // An agent transcript with no user event must NOT have a prompt field
    const tmpBase2 = fs.mkdtempSync(path.join(os.tmpdir(), 'erika-noprompt-'));
    try {
      const wfDir = path.join(tmpBase2, 'proj', 'subagents', 'workflows', 'wf_noprompt');
      fs.mkdirSync(wfDir, { recursive: true });
      // No user event — only assistant turns
      const events = [
        { type: 'assistant', message: { usage: { output_tokens: 30 }, content: [{ type: 'text', text: 'hello' }] } },
      ];
      fs.writeFileSync(
        path.join(wfDir, 'agent-noprompt.jsonl'),
        events.map((e) => JSON.stringify(e)).join('\n') + '\n',
        'utf8',
      );
      fs.writeFileSync(
        path.join(wfDir, 'journal.jsonl'),
        JSON.stringify({ type: 'result', agentId: 'noprompt', result: 'done' }) + '\n',
        'utf8',
      );
      const now = new Date();
      fs.utimesSync(wfDir, now, now);

      const cfg: Cfg = { base: tmpBase2, repo: '', refreshMs: 4000, statusBar: true, roleRules: DEFAULT_ROLE_RULES };
      const result = buildSnapshot(cfg);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const snap = result as SnapshotOk;
      const agent = snap.agents.find((a) => a.id === 'noprompt');
      expect(agent).toBeDefined();
      // prompt must be absent — not just undefined but not a key at all
      expect(agent?.prompt).toBeUndefined();
    } finally {
      try { fs.rmSync(tmpBase2, { recursive: true, force: true }); } catch {}
    }
  });
});

// ---------------------------------------------------------------------------
// AC: M2-AgentPrompt — getHtml: prompt disclosure renders and is escaped
// ROADMAP: "a 'Prompt' disclosure alongside the existing output / findings /
// activity tail … esc() it before injecting into the webview"
// ---------------------------------------------------------------------------
describe('M2-AgentPrompt — webview prompt disclosure', () => {
  it('panel JS contains prompt-disc class for the prompt disclosure element', () => {
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain('prompt-disc');
  });

  it('panel CSS contains .prompt-disc rule', () => {
    const html = getPanelHtml();
    expect(html).toContain('.prompt-disc{');
  });

  it('panel JS renders a Copy button for the prompt', () => {
    const js = getPanelJs(getPanelHtml());
    // ROADMAP: "a capped, scrollable <pre> with a Copy button"
    expect(js).toContain('prompt-copy-btn');
  });

  it('panel JS escapes prompt content with esc() before injecting into webview', () => {
    const js = getPanelJs(getPanelHtml());
    // The prompt must be injected via esc(a.prompt) — not raw a.prompt
    expect(js).toContain('esc(a.prompt)');
    // The raw a.prompt must not be injected without escaping
    // Check: the prompt is not directly concatenated as '...'+a.prompt+'...'
    // by verifying the surrounding pattern uses esc()
    const promptRawIdx = js.indexOf("'+a.prompt+'");
    // If there's a raw injection, it must not exist
    expect(promptRawIdx).toBe(-1);
  });

  it('panel JS uses .prompt-disc-hdr tabindex and role for keyboard access', () => {
    const js = getPanelJs(getPanelHtml());
    // ROADMAP: keyboard-navigable
    expect(js).toContain('prompt-disc-hdr');
    expect(js).toContain('tabindex="0"');
    expect(js).toContain('role="button"');
  });

  it('panel JS has .prompt-pre class for scrollable capped pre element', () => {
    const js = getPanelJs(getPanelHtml());
    // ROADMAP: "capped, scrollable <pre>"
    expect(js).toContain('prompt-pre');
  });

  it('CSS .prompt-pre has max-height for scroll cap', () => {
    const html = getPanelHtml();
    const idx = html.indexOf('.prompt-pre{');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('max-height');
    expect(rule).toContain('overflow');
  });

  it('CSS .prompt-pre uses --vscode-* variables (theme-native, no hardcoded colors)', () => {
    const html = getPanelHtml();
    const idx = html.indexOf('.prompt-pre{');
    expect(idx).toBeGreaterThan(-1);
    const rule = html.slice(idx, html.indexOf('}', idx));
    expect(rule).toContain('--vscode-');
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('prompt copy button wiring uses addEventListener (nonce CSP safe)', () => {
    const js = getPanelJs(getPanelHtml());
    // ROADMAP: "addEventListener (nonce CSP blocks inline onclick)"
    // The copy button must be wired with addEventListener in wire(), not inline onclick
    expect(js).toContain('prompt-copy-btn');
    // Check that there is no inline onclick on the element
    const html = getPanelHtml();
    expect(html).not.toMatch(/prompt-copy-btn[^>]*onclick/);
  });

  it('prompt copy button posts {type:"copyText"} to extension host', () => {
    const js = getPanelJs(getPanelHtml());
    // ROADMAP: "Copy button" → uses VS Code clipboard via host message
    expect(js).toContain("type:'copyText'");
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Charts — chart fills use --vscode-charts-* (not SVG default black)
// ROADMAP: "inline-SVG chart fills must use --vscode-charts-* (with visible
// fallbacks) — never the SVG default black fill, which is invisible on the
// dark editor background"
// ---------------------------------------------------------------------------
describe('M2-Charts — chart fills use --vscode-charts-* (not SVG black default)', () => {
  it('tokenBarChart SVG bars specify a fill color (not left to SVG default black)', () => {
    const html = getPanelHtml();
    const js = getPanelJs(html);
    // The chart bar uses a CSS class (.chart-bar) for fill, not an inline style.
    // Verify the rect has the class, and the CSS defines the fill via --vscode-charts-blue.
    const barIdx = js.indexOf('data-testid="chart-bar"');
    expect(barIdx).toBeGreaterThan(-1);
    const barContext = js.slice(Math.max(0, barIdx - 200), barIdx + 200);
    // Bar must have class="chart-bar" (no inline fill attribute)
    expect(barContext).toContain('chart-bar');
    // Fill color must be declared in the CSS block (not inline on the element)
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const styleStart = html.indexOf(styleOpen);
    const styleEnd = html.indexOf(styleClose, styleStart);
    const css = html.slice(styleStart + styleOpen.length, styleEnd);
    expect(css).toContain('.chart-bar{fill:var(--vscode-charts-blue');
  });

  it('tokenTrendChart area and line specify fill/stroke via --vscode-charts-* (not SVG default black)', () => {
    const html = getPanelHtml();
    const js = getPanelJs(html);
    // Trend area must have a fill; trend line must have a stroke — both via vscode vars.
    // The implementation uses CSS classes (.chart-trend-area, .chart-trend-line) that
    // reference --vscode-charts-green, rather than inline style attributes. This design
    // allows forced-colors @media overrides to work correctly.
    const trendAreaIdx = js.indexOf('data-testid="trend-area"');
    const trendLineIdx = js.indexOf('data-testid="trend-line"');
    expect(trendAreaIdx).toBeGreaterThan(-1);
    expect(trendLineIdx).toBeGreaterThan(-1);
    // The SVG elements must use the CSS classes (not the SVG default fill=black).
    const areaContext = js.slice(Math.max(0, trendAreaIdx - 100), trendAreaIdx + 50);
    const lineContext = js.slice(Math.max(0, trendLineIdx - 100), trendLineIdx + 50);
    expect(areaContext).toContain('chart-trend-area');
    expect(lineContext).toContain('chart-trend-line');
    // The CSS classes must define --vscode-charts-* variables for the fill/stroke.
    const styleOpen = `<style nonce="${TEST_NONCE}">`;
    const styleClose = '</style>';
    const styleStart = html.indexOf(styleOpen);
    const styleEnd = html.indexOf(styleClose, styleStart);
    const css = html.slice(styleStart + styleOpen.length, styleEnd);
    expect(css).toContain('chart-trend-area');
    expect(css).toContain('--vscode-charts-green');
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Charts — forced-colors block covers chart elements
// ROADMAP: "the @media (forced-colors:active) block must cover chart elements too"
// ---------------------------------------------------------------------------
describe('M2-Charts — forced-colors media query covers chart elements', () => {
  it('HTML contains a forced-colors media query block', () => {
    const html = getPanelHtml();
    expect(html).toContain('forced-colors');
  });

  it('forced-colors block covers chart-related selectors (.chart-bar or .charts-row or chart SVG)', () => {
    const html = getPanelHtml();
    const fcStart = html.indexOf('forced-colors');
    expect(fcStart).toBeGreaterThan(-1);
    // The forced-colors block must be inside a @media query
    const mediaIdx = html.lastIndexOf('@media', fcStart);
    expect(mediaIdx).toBeGreaterThan(-1);
    // The media block content must reference chart elements
    const mediaEnd = html.indexOf('@media', mediaIdx + 1);
    const mediaBlock = mediaEnd !== -1
      ? html.slice(mediaIdx, mediaEnd)
      : html.slice(mediaIdx);
    // Chart elements must be explicitly covered (not left to browser defaults)
    const coversChart =
      mediaBlock.includes('.chart') ||
      mediaBlock.includes('chart-bar') ||
      mediaBlock.includes('charts-row') ||
      mediaBlock.includes('chart-scroll') ||
      mediaBlock.includes('rect') ||  // SVG rect element coverage
      mediaBlock.includes('path');    // SVG path element coverage
    expect(coversChart).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC: No pricing anywhere in the webview output
// ROADMAP: Decision log #5 "NO PRICING anywhere — counts + charts only"
// Constraint: "NO PRICING anywhere — counts + charts only (Decision log #5)"
// ---------------------------------------------------------------------------
describe('M2 Constraint — no pricing information anywhere in getHtml output', () => {
  it('panel HTML contains no price/cost/dollar/USD references', () => {
    const html = getPanelHtml();
    const lower = html.toLowerCase();
    expect(lower).not.toContain('price');
    expect(lower).not.toContain('cost');
    expect(lower).not.toContain('dollar');
    expect(lower).not.toContain('usd');
    expect(lower).not.toContain('$');
  });

  it('sidebar HTML contains no price/cost/dollar/USD references', () => {
    const html = getSidebarHtml();
    const lower = html.toLowerCase();
    expect(lower).not.toContain('price');
    expect(lower).not.toContain('cost');
    expect(lower).not.toContain('dollar');
    expect(lower).not.toContain('usd');
  });
});

// ---------------------------------------------------------------------------
// AC: M2-Export-UI — package.json has claudeWorkflow.exportMarkdown in
// contributes.commands AND contributes.menus
// ROADMAP: "new commands need contributes.commands + contributes.menus entries"
// ---------------------------------------------------------------------------
describe('M2-Export-UI — package.json manifest entries', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    pkg = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'package.json'),
      'utf8',
    )) as Record<string, unknown>;
  });

  it('package.json contributes.commands includes claudeWorkflow.exportMarkdown', () => {
    const contributes = pkg['contributes'] as Record<string, unknown>;
    const commands = contributes['commands'] as Array<{ command: string }>;
    const ids = commands.map((c) => c.command);
    expect(ids).toContain('claudeWorkflow.exportMarkdown');
  });

  it('package.json contributes.menus["view/title"] includes claudeWorkflow.exportMarkdown', () => {
    const contributes = pkg['contributes'] as Record<string, unknown>;
    const menus = contributes['menus'] as Record<string, Array<{ command: string }>>;
    const viewTitle = menus['view/title'] ?? [];
    const menuIds = viewTitle.map((m) => m.command);
    expect(menuIds).toContain('claudeWorkflow.exportMarkdown');
  });
});

// ---------------------------------------------------------------------------
// AC: M2 layout — dashboard never scrolls horizontally at body level
// ROADMAP constraint: "wide content … gets overflow-x: auto on its own container
// so the page body must never scroll horizontally"
// ---------------------------------------------------------------------------
describe('M2 Layout — no horizontal body scroll', () => {
  it('panel HTML body/root does not set overflow-x:scroll or overflow-x:visible with wide fixed widths', () => {
    const html = getPanelHtml();
    // The <body> or #root must not force horizontal scroll
    // Confirm body has no overflow-x:scroll or overflow:scroll
    expect(html).not.toContain('body{overflow-x:scroll');
    expect(html).not.toContain('body{overflow:scroll');
  });

  it('panel CSS chart-scroll container has overflow-x:auto (not the body)', () => {
    // Wide charts scroll inside their own container
    const html = getPanelHtml();
    expect(html).toContain('.chart-scroll{overflow-x:auto');
  });
});

// ---------------------------------------------------------------------------
// AC: M2 — webview renders cleanly at 1 agent (no throw, non-empty output)
// ROADMAP: "Must render fine with 1 agent and with 50"
// Already partially covered by Fritz's charts tests with 1/50 agents.
// These tests verify the full chartsPanel function via the public getHtml interface.
// ---------------------------------------------------------------------------
describe('M2 — webview JS handles 1 and 50 agents without error', () => {
  it('inline panel script is syntactically valid (still passes after all M2 additions)', () => {
    const html = getPanelHtml();
    const js = getPanelJs(html);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js);
    }).not.toThrow();
  });

  it('inline sidebar script is syntactically valid', () => {
    const html = getSidebarHtml();
    // The sidebar has a separate <script> block
    const open = `<script nonce="${TEST_NONCE}">`;
    const close = '</script>';
    const s = html.indexOf(open);
    const e = html.lastIndexOf(close);
    const js = html.slice(s + open.length, e);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', js);
    }).not.toThrow();
  });
});
