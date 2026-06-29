// Webview HTML template for the Claude Code Workflow Dashboard.
//
// This module is a thin assembler: CSS and JS constants live in sub-modules
// (see below) to keep each file under the ~400-line limit. The embedded webview
// client JS runs in the webview DOM (not under tsc) and is intentionally untyped.
// Do NOT attempt to type the JS constant strings.
//
// Security fixes applied during M0-T2 migration and round-1/round-2 review:
// 1. overview() sev-span: severity key is HTML-escaped via esc().
// 2. agentSub(): f.severity escaped in both CSS class and text node.
// 3. findingsPanel() chips: severity key s escaped in data-sev attr and text.
// 4. findingsPanel() finding row: f.severity escaped in CSS class and text node.
// 5. agentsPanel(): a.id escaped in data-aid attribute.
// 6. wire(): null-checked querySelector('.row') before assigning onclick.
// 7. CSP: script-src uses a per-load nonce instead of 'unsafe-inline', limiting
//    injected event-handler execution even if an XSS injection succeeds.
// 8. agentsPanel(): a.status escaped via esc() for CSS class and text node.
// 9. Severity badge colors use --vscode-* chart vars (theme-aware, no hardcoded hex).
//
// Sub-module layout (all under src/webview/):
//   css.ts         — CSS + CSS_SIDEBAR constants (~320 lines)
//   js-sidebar.ts  — JS_SIDEBAR constant (~105 lines, sidebar render loop)
//   js-panels.ts   — JS_PANELS constant (~1510 lines, panel functions + render)
//   js-wire.ts     — JS_WIRE constant (~90 lines, wire() + render() call)

import { CSS, CSS_SIDEBAR } from './css';
import { JS_SIDEBAR } from './js-sidebar';
import { JS_PANELS } from './js-panels';
import { JS_WIRE } from './js-wire';

// The full-panel JS is the concatenation of JS_PANELS and JS_WIRE.
// They are split only for file-length hygiene; at runtime they form one script.
const JS = JS_PANELS + JS_WIRE;

// mode:'panel' is the full editor-panel view (default, unchanged).
// mode:'sidebar' renders a compact at-a-glance summary suited for the
// narrow sidebar pane — no six-panel layout, no horizontal overflow.
export function getHtml(nonce: string, changedMaxMin = 15, maxAgents = 200, mode: 'panel' | 'sidebar' = 'panel', staleSecs = 180): string {
  // changedMaxMin, maxAgents, and staleSecs are passed through to the JS template so
  // changedPanel(), agentsPanel(), and the Stalled KPI can display correct thresholds
  // without hardcoded literals. Defaults match CHANGED_MAX_SECS=900/MAX_AGENTS=200 in
  // snapshot.ts and STALE_SECS=180 in parse.ts.
  // staleSecs is rendered in minutes when >= 60 so the UI sub-label stays compact.
  const staleLabel = staleSecs >= 60
    ? `>${Math.floor(staleSecs / 60)}m`
    : `>${staleSecs}s`;
  const staleTooltip = staleSecs >= 60
    ? `Agents with no transcript activity in the last ${Math.floor(staleSecs / 60)} minutes`
    : `Agents with no transcript activity in the last ${staleSecs} seconds`;
  if (mode === 'sidebar') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Claude Code Workflow Dashboard</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${CSS_SIDEBAR}</style></head>
<body>
<span id="sr-status-sb" class="sr-only" aria-live="polite" aria-atomic="true"></span><div id="root" data-mode="sidebar"><div class="sb-header"><span class="sb-title">Workflow</span><button class="sb-open-btn" id="sbInitOpen" aria-label="Open full dashboard in editor" data-testid="open-full-btn"><span aria-hidden="true">&#10562;</span><span class="sb-btn-lbl"> Open</span></button><button class="sb-open-btn" id="sbSelectRunInit" title="Select or pin a workflow run" aria-label="Select workflow run"><span aria-hidden="true">&#9776;</span><span class="sb-btn-lbl"> Runs</span></button><button class="sb-open-btn" id="sbExportInit" title="Export run as Markdown" aria-label="Export run as Markdown" data-testid="export-btn"><span aria-hidden="true">&#8595;</span><span class="sb-btn-lbl"> Export</span></button></div><div class="dim pad">Looking for an active workflow run…</div></div>
<script nonce="${nonce}">const STALE_TOOLTIP=${JSON.stringify(staleTooltip)};${JS_SIDEBAR}</script>
</body></html>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Claude Code Workflow Dashboard</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${CSS}</style></head>
<body>
<div id="bar" role="toolbar" aria-label="Dashboard actions"><span id="title">Claude Code Workflow Dashboard</span><span id="meta" class="dim"></span><span class="grow"></span><button id="selectRunBtn" title="Select or pin a workflow run" aria-label="Select workflow run"><span aria-hidden="true">&#9776;</span> Runs</button><button id="exportBtn" title="Export run as Markdown" aria-label="Export run as Markdown" data-testid="export-btn"><span aria-hidden="true">&#8595;</span> Export</button><button id="guideBtn" title="Open the workflow authoring guide" aria-label="Open workflow authoring guide"><span aria-hidden="true">&#128214;</span> Guide</button><button id="refreshBtn" title="Refresh now" aria-label="Refresh">Refresh</button></div>
<span id="sr-status" class="sr-only" aria-live="polite" aria-atomic="true"></span><div id="root"><div class="dim pad">Looking for an active workflow run…</div></div>
<script nonce="${nonce}">const CHANGED_MAX_MIN=${changedMaxMin};const MAX_AGENTS=${maxAgents};const STALE_SECS=${staleSecs};const STALE_LABEL=${JSON.stringify(staleLabel)};const STALE_TOOLTIP=${JSON.stringify(staleTooltip)};${JS}</script>
</body></html>`;
}
