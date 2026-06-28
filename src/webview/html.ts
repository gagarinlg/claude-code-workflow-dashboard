// Webview HTML template for the Claude Code Workflow Dashboard.
//
// CSS and JS are kept as opaque template string constants — the embedded
// webview client JS runs in the webview DOM (not under tsc) and is intentionally
// untyped. Do NOT attempt to type the JS constant.
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

// mode:'panel' is the full editor-panel view (default, unchanged).
// mode:'sidebar' renders a compact at-a-glance summary suited for the
// narrow sidebar pane — no six-panel layout, no horizontal overflow.
export function getHtml(nonce: string, changedMaxMin = 2, maxAgents = 200, mode: 'panel' | 'sidebar' = 'panel', staleSecs = 180): string {
  // changedMaxMin, maxAgents, and staleSecs are passed through to the JS template so
  // changedPanel(), agentsPanel(), and the Stalled KPI can display correct thresholds
  // without hardcoded literals. Defaults match CHANGED_MAX_SECS=120/MAX_AGENTS=200 in
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
<div id="root" aria-live="polite" data-mode="sidebar"><div class="sb-header"><span class="sb-title">Workflow</span><button class="sb-open-btn" id="sbInitOpen" data-testid="open-full-btn"><span aria-hidden="true">&#10562;</span> Open full dashboard</button><button class="sb-open-btn" id="sbSelectRunInit" title="Select or pin a workflow run" aria-label="Select workflow run">&#9904; Runs</button></div><div class="dim pad">Looking for an active workflow run…</div></div>
<script nonce="${nonce}">const STALE_TOOLTIP=${JSON.stringify(staleTooltip)};${JS_SIDEBAR}</script>
</body></html>`;
  }
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Claude Code Workflow Dashboard</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${CSS}</style></head>
<body>
<div id="bar"><span id="title">Claude Code Workflow Dashboard</span><span id="meta" class="dim"></span><span class="grow"></span><div role="group" aria-label="Show panels" id="toggles"></div><button id="selectRunBtn" title="Select or pin a workflow run" aria-label="Select workflow run">&#9904; Runs</button><button id="guideBtn" title="Open the workflow authoring guide" aria-label="Open workflow authoring guide"><span aria-hidden="true">📖</span> Guide</button><button id="refreshBtn" title="Refresh now" aria-label="Refresh">Refresh</button></div>
<div id="root" aria-live="polite"><div class="dim pad">Looking for an active workflow run…</div></div>
<script nonce="${nonce}">const CHANGED_MAX_MIN=${changedMaxMin};const MAX_AGENTS=${maxAgents};const STALE_SECS=${staleSecs};const STALE_LABEL=${JSON.stringify(staleLabel)};const STALE_TOOLTIP=${JSON.stringify(staleTooltip)};${JS}</script>
</body></html>`;
}

// CSS is an opaque template string — theme-native via --vscode-* vars.
const CSS = `
*{box-sizing:border-box}
body{margin:0;font:13px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background)}
.dim{opacity:.6}.pad{padding:14px}.grow{flex:1}
#bar{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);z-index:5}
#title{font-weight:600}
#toggles label{margin-right:8px;cursor:pointer;user-select:none;font-size:12px}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:3px 9px;cursor:pointer}
button:hover{background:var(--vscode-button-hoverBackground)}
button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
input[type=checkbox]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.chip:focus-visible,[tabindex="0"]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.panel{margin:12px;border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:visible}
.panel>h3{margin:0;padding:8px 12px;background:var(--vscode-sideBarSectionHeader-background);font-size:12px;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--vscode-panel-border)}
.panel>.body{padding:10px 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}
.card{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 10px;background:var(--vscode-editorWidget-background)}
.card.run{border-color:var(--vscode-charts-green,#3fb950)}
.card.dead{opacity:.65}
.row{display:flex;align-items:center;gap:8px;cursor:pointer}
.role{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{font-size:11px;padding:1px 6px;border-radius:10px}
.st.run{background:rgba(63,185,80,.2);color:var(--vscode-charts-green,#3fb950)}
.st.done{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.st.dead{background:rgba(248,81,73,.18);color:var(--vscode-charts-red,#f85149)}
.kpis{display:flex;gap:16px;flex-wrap:wrap;font-size:12px}
.kpi b{font-size:18px;font-variant-numeric:tabular-nums}
.activity{margin-top:6px;font-size:11px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{margin-top:8px;border-top:1px dashed var(--vscode-panel-border);padding-top:8px;display:none;max-height:340px;overflow:auto;scrollbar-gutter:stable}
.card.open .sub{display:block}
.ev{font-family:var(--vscode-editor-font-family);font-size:11px;padding:3px 0;border-bottom:1px solid var(--vscode-panel-border);white-space:pre-wrap;word-break:break-word}
.ev.tool{opacity:.7}

.sev{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px;display:inline-block;vertical-align:middle}
/* Severity badge colors use VS Code chart variables so they adapt to light/dark/high-contrast
   themes. The rgba() background tint + border pattern matches VS Code's own severity chips.
   Per CLAUDE.md convention, hardcoded colors are forbidden; the rgba() tints here are
   semi-transparent overlays (15-20% alpha) that pair with --vscode-* foreground/border vars
   and are overridden by the forced-colors media query below for high-contrast themes. */
.CRITICAL{background:rgba(248,81,73,.15);color:var(--vscode-charts-red,#f85149);border:1px solid var(--vscode-charts-red,#f85149)}
.HIGH{background:rgba(210,100,50,.15);color:var(--vscode-charts-orange,#d26432);border:1px solid var(--vscode-charts-orange,#d26432)}
.MEDIUM{background:rgba(220,170,0,.15);color:var(--vscode-charts-yellow,#dcaa00);border:1px solid var(--vscode-charts-yellow,#dcaa00)}
.LOW{background:rgba(63,135,185,.15);color:var(--vscode-charts-blue,#3f87b9);border:1px solid var(--vscode-charts-blue,#3f87b9)}
.NITPICK{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.UNRATED{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.ok{color:var(--vscode-charts-green,#3fb950)}.bad{color:var(--vscode-charts-red,#f85149)}
.finding{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 9px;margin-bottom:6px}
.finding .ttl[tabindex]{cursor:pointer}
.finding .detail{display:none;margin-top:6px;font-size:12px}
.finding.open .detail{display:block}
.finding .loc{font-family:var(--vscode-editor-font-family);opacity:.7;font-size:11px}
.filters{margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:11px;padding:2px 8px;border:1px solid var(--vscode-panel-border);border-radius:12px;cursor:pointer}
.chip.off{opacity:.5}
.files{padding:0;margin:0;list-style:none}
.files li{font-family:var(--vscode-editor-font-family);font-size:11px;list-style:none}
pre{margin:0;font-family:var(--vscode-editor-font-family);font-size:11px;white-space:pre-wrap;word-break:break-word}
/* Non-collapsible result items: override the pointer cursor set by .finding .ttl[tabindex]
   so users are not misled into thinking the row is interactive. */
.finding.result .ttl{cursor:default}
/* Explicit focus rule for collapsible finding/result titles — documents intent and
   survives future refactors that might remove the generic [tabindex="0"] selector. */
.finding .ttl:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
/* Empty-state action button row — gap-based layout prevents inline margin fragility. */
.empty-actions{display:flex;gap:6px;margin-top:10px}
/* Agents-cap warning banner — themed border/color; extracted from inline style. */
.cap-warn{margin-bottom:6px;padding:4px 8px;border:1px solid var(--vscode-inputValidation-warningBorder,var(--vscode-panel-border));color:var(--vscode-inputValidation-warningForeground,var(--vscode-foreground));border-radius:4px}
/* Clear-filters button pushed to the right of the filter bar via flex. */
.filters .clear-btn{margin-left:auto}
/* Visual separator between reviewer and severity chip groups in the filter bar.
   Using a CSS class instead of inline style allows theme overrides. */
.filter-sep{margin-left:10px;border-left:1px solid var(--vscode-panel-border);padding-left:10px}
/* Pass-group heading: structural, not dimmed metadata. Distinct from .dim. */
.pass-heading{margin:6px 0;font-size:12px;font-weight:600}
/* Verdict item row spacing — extracted from inline style for theme compatibility. */
.verdict-item{margin-bottom:6px}
/* Overview severity badge row spacing — extracted from inline style. */
.overview-sev-row{margin-top:8px}
/* Cards instructional hint text — extracted from inline style. */
.cards-hint{font-size:11px;margin-bottom:6px}
/* Finding fix detail top margin — extracted from inline style. */
.finding-fix{margin-top:4px}
/* Changed-files panel caption — extracted from inline style. */
.changed-caption{font-size:11px;margin-bottom:6px}
/* KPI sub-label (e.g. 'no activity >3m' under Stalled) — extracted from inline style. */
.kpi-sublabel{font-size:10px}
/* Empty-state container: a quiet, informative card — theme-native colors only. */
.empty-state{margin:24px 16px;padding:16px 18px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editorWidget-background)}
.empty-state h2{margin:0 0 8px;font-size:14px;font-weight:600;color:var(--vscode-foreground)}
.empty-state .empty-msg{font-family:var(--vscode-editor-font-family);font-size:12px;padding:6px 8px;margin:8px 0;border-radius:4px;background:var(--vscode-textBlockQuote-background,var(--vscode-editor-background));border-left:3px solid var(--vscode-panel-border);overflow-wrap:break-word;word-break:break-word}
.empty-state .empty-hint{font-size:12px;opacity:.75;margin-bottom:4px}
.empty-state .empty-hint b{font-weight:600;opacity:1}
/* High-contrast / forced-colors mode: replace semi-transparent rgba() tints with
   solid system-color pairs so severity badges remain visible regardless of theme. */
@media (forced-colors:active){
  .CRITICAL,.HIGH,.MEDIUM,.LOW{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  .st.run,.st.dead{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
}
/* Soft fade on full-panel re-renders to reduce perceived flash. Opt-in only for users
   who have not set prefers-reduced-motion — reduced-motion users get instant updates. */
@media (prefers-reduced-motion:no-preference){
  #root{transition:opacity 60ms ease}
}
`;

// ---------------------------------------------------------------------------
// Sidebar CSS — compact, no horizontal scroll at default sidebar width (~250px).
// Uses only --vscode-* variables (CLAUDE.md: no hardcoded colors).
// ---------------------------------------------------------------------------
const CSS_SIDEBAR = `
*{box-sizing:border-box}
body{margin:0;font:12px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow-x:hidden}
.dim{opacity:.6}.pad{padding:10px}
.sb-header{display:flex;align-items:center;gap:6px;padding:8px 10px 4px;border-bottom:1px solid var(--vscode-panel-border)}
.sb-title{font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sb-open-btn{display:flex;align-items:center;gap:4px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:2px 7px;cursor:pointer;font-size:11px;white-space:nowrap}
.sb-open-btn:hover{background:var(--vscode-button-hoverBackground)}
.sb-open-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.sb-section{padding:8px 10px;border-bottom:1px solid var(--vscode-panel-border)}
.sb-section:last-child{border-bottom:none}
.sb-section-title{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin-bottom:5px}
.sb-kpis{display:flex;flex-wrap:wrap;gap:6px 14px}
.sb-kpi{display:flex;flex-direction:column}
.sb-kpi .label{font-size:10px;opacity:.6}
.sb-kpi .val{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.sb-kpi .val.ok{color:var(--vscode-charts-green,#3fb950)}
.sb-kpi .val.bad{color:var(--vscode-charts-red,#f85149)}
.sev{font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:3px;margin-bottom:3px;display:inline-block}
.CRITICAL{background:rgba(248,81,73,.15);color:var(--vscode-charts-red,#f85149);border:1px solid var(--vscode-charts-red,#f85149)}
.HIGH{background:rgba(210,100,50,.15);color:var(--vscode-charts-orange,#d26432);border:1px solid var(--vscode-charts-orange,#d26432)}
.MEDIUM{background:rgba(220,170,0,.15);color:var(--vscode-charts-yellow,#dcaa00);border:1px solid var(--vscode-charts-yellow,#dcaa00)}
.LOW{background:rgba(63,135,185,.15);color:var(--vscode-charts-blue,#3f87b9);border:1px solid var(--vscode-charts-blue,#3f87b9)}
.NITPICK{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.UNRATED{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.sb-agent{display:flex;align-items:baseline;gap:5px;padding:3px 0;border-bottom:1px solid var(--vscode-panel-border);min-width:0}
.sb-agent:last-child{border-bottom:none}
.sb-agent .role{font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.sb-agent .st{font-size:10px;padding:1px 5px;border-radius:8px;flex-shrink:0}
.st.run{background:rgba(63,185,80,.2);color:var(--vscode-charts-green,#3fb950)}
.st.done{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.st.dead{background:rgba(248,81,73,.18);color:var(--vscode-charts-red,#f85149)}
.sb-phase{font-size:12px;font-weight:600}
.sb-runid{font-size:10px;opacity:.6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty-state{margin:12px 10px;padding:12px 14px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editorWidget-background)}
.empty-state h2{margin:0 0 6px;font-size:12px;font-weight:600}
.empty-state .empty-hint{font-size:11px;opacity:.75}
.empty-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
/* Sidebar empty-state snap.msg paragraph — mirrors full-panel .empty-msg pattern. */
.empty-msg{font-family:var(--vscode-editor-font-family);font-size:10px;overflow-wrap:break-word;word-break:break-word;margin-bottom:4px}
/* Agent list placeholder when no agents are live — extracted from inline style. */
.sb-agent-placeholder{font-size:10px;padding:2px 0}
/* Overflow indicator when more than 5 agents are active — extracted from inline style. */
.sb-agent-overflow{font-size:10px;padding-top:3px}
@media (forced-colors:active){
  .CRITICAL,.HIGH,.MEDIUM,.LOW{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  .st.run,.st.dead{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
}
`;

// ---------------------------------------------------------------------------
// Sidebar JS — compact render. Posts {type:'openFull'} when the user clicks
// the "Open full dashboard" button. acquireVsCodeApi() messages use the same
// IPC bridge as the panel webview (no origin check needed — CSP protects injection).
// ---------------------------------------------------------------------------
const JS_SIDEBAR = `
const api = acquireVsCodeApi();
let snap = null;
function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// escCls: like esc() but also replaces whitespace with underscores so the result
// is safe as a single CSS class token (a space in a class attribute adds extra tokens).
function escCls(s){return esc(s).replace(/[\\t\\n\\r ]+/g,'_');}
function safeN(n){var v=+n;return isFinite(v)?v:0;}

function openFull(){api.postMessage({type:'openFull'});}

// Wire the static-skeleton open button that is present before any snapshot arrives.
var initOpen=document.getElementById('sbInitOpen');if(initOpen)initOpen.addEventListener('click',openFull);
var initSelectRun=document.getElementById('sbSelectRunInit');if(initSelectRun)initSelectRun.addEventListener('click',function(){api.postMessage({type:'selectRun'});});

window.addEventListener('message',function(e){if(e.data&&e.data.type==='snapshot'){snap=e.data.snap;render();}});

function render(){
  var root=document.getElementById('root');
  if(!root)return;
  if(!snap){root.innerHTML='<div class="sb-header"><span class="sb-title">Workflow</span><button class="sb-open-btn" id="sbInitOpen2"><span aria-hidden="true">&#10562;</span> Open full dashboard</button></div><div class="dim pad">Looking for an active workflow run…</div>';var si2=document.getElementById('sbInitOpen2');if(si2)si2.addEventListener('click',openFull);return;}
  if(!snap.ok){
    root.innerHTML='<div class="empty-state" data-testid="empty-state-sidebar"><h2>No Workflow run found</h2><p class="empty-msg">'+esc(snap.msg)+'</p><p class="empty-hint">Start a <b>Claude Code Workflow()</b> run to see the dashboard. To configure the search path, open <b>Settings &rarr; Claude Code Workflow Dashboard &rarr; Workflows Glob Base</b>.</p><div class="empty-actions"><button id="sbOpen" class="sb-open-btn"><span aria-hidden="true">&#10562;</span> Open full dashboard</button><button id="sbRefresh">Refresh</button><button id="sbGuide">Guide</button></div></div>';
    var so=document.getElementById('sbOpen');if(so)so.addEventListener('click',openFull);
    var sr=document.getElementById('sbRefresh');if(sr)sr.addEventListener('click',function(){api.postMessage({type:'refresh'});});
    var sg=document.getElementById('sbGuide');if(sg)sg.addEventListener('click',function(){api.postMessage({type:'guide'});});
    return;
  }
  var L=snap.loop;
  var header='<div class="sb-header" data-testid="sidebar-header">'
    +'<span class="sb-title">Workflow</span>'
    +'<button class="sb-open-btn" id="sbRefreshLive" title="Refresh" aria-label="Refresh">&#8635; Refresh</button>'
    +'<button class="sb-open-btn" id="sbSelectRunLive" title="Select or pin a workflow run" aria-label="Select workflow run">&#9904; Runs</button>'
    +'<button class="sb-open-btn" id="openFullBtn" title="Open full dashboard in editor" aria-label="Open full dashboard" data-testid="open-full-btn"><span aria-hidden="true">&#10562;</span> Open full dashboard</button>'
    +'</div>';
  var phaseSection='<div class="sb-section">'
    +'<div class="sb-phase" data-testid="sidebar-phase">'+esc(L.phase)+'</div>'
    +'<div class="sb-runid">'+esc(snap.runId)+(snap.isPinned?'<span class="st done" style="margin-left:4px;font-size:9px">pinned</span>':'')+'</div>'
    +'</div>';
  var kpiSection='<div class="sb-section">'
    +'<div class="sb-section-title">Agents</div>'
    +'<div class="sb-kpis">'
    +'<div class="sb-kpi"><span class="label">Live</span><span class="val'+(L.live?' ok':'')+'">'+safeN(L.live)+'</span></div>'
    +'<div class="sb-kpi"><span class="label">Done</span><span class="val">'+safeN(L.done)+'</span></div>'
    +'<div class="sb-kpi"><span class="label" tabindex="0" title="'+STALE_TOOLTIP+'">Stalled</span><span class="val'+(L.dead?' bad':'')+'">'+safeN(L.dead)+'</span></div>'
    +'</div></div>';
  var sevSection='';
  if(snap.allFindings&&snap.allFindings.length){
    var sevTotals=Object.create(null);
    snap.allFindings.forEach(function(f){var s=f.severity||'UNRATED';sevTotals[s]=(sevTotals[s]||0)+1;});
    var badges='';for(var s in sevTotals){var es=esc(s);var ec=escCls(s);badges+='<span class="sev '+ec+'">'+es+' '+sevTotals[s]+'</span>';}
    sevSection='<div class="sb-section" data-testid="sidebar-findings"><div class="sb-section-title">Findings <span class="val" style="font-variant-numeric:tabular-nums">'+safeN(L.findings)+'</span></div><div>'+badges+'</div></div>';
  }
  // Always render the Active agents section — show a placeholder when no agents are live
  // so users understand why the section is empty rather than wondering if it is missing.
  var allLive=snap.agents?snap.agents.filter(function(a){return a.status==='run';}):[],
    live=allLive.slice(0,5);
  var rows=live.map(function(a){
    var es=escCls(a.status);
    var lbl=a.status==='dead'?'stalled':a.status==='run'?'live':es;
    return '<div class="sb-agent"><span class="role">'+esc(a.label)+'</span><span class="st '+es+'">'+lbl+'</span></div>';
  }).join('');
  if(!rows)rows='<div class="dim sb-agent-placeholder">No agents currently running</div>';
  var more=allLive.length>5?'<div class="dim sb-agent-overflow">+'+(allLive.length-5)+' more active</div>':'';
  var agentSection='<div class="sb-section" data-testid="sidebar-agents"><div class="sb-section-title">Active agents</div>'+rows+more+'</div>';
  var sy=window.scrollY;
  root.innerHTML=header+phaseSection+kpiSection+sevSection+agentSection;
  window.scrollTo(0,sy);
  var btn=document.getElementById('openFullBtn');if(btn)btn.addEventListener('click',openFull);
  var sr2=document.getElementById('sbRefreshLive');if(sr2)sr2.addEventListener('click',function(){api.postMessage({type:'refresh'});});
  var srLive=document.getElementById('sbSelectRunLive');if(srLive)srLive.addEventListener('click',function(){api.postMessage({type:'selectRun'});});
}
render();
`;

// JS is an opaque template string — it runs in the webview DOM under
// acquireVsCodeApi() and is not typed by tsc. The severity-key XSS fix:
// esc() is applied to the severity key `s` before using it as a CSS class
// name and as inner text in the overview sev-span builder.
const JS = `
const api = acquireVsCodeApi();
const PANELS=[['overview','Overview'],['agents','Agents'],['findings','Findings'],['results','Results'],['verdicts','Verdicts'],['changed','Changed files']];
// openAgents/openFind/fRev/fSev accept transcript-derived strings as keys (agent ids,
// severity labels, reviewer labels). Using Object.create(null) eliminates the prototype
// chain, preventing '__proto__' or 'constructor' key collisions regardless of engine version.
const _s=api.getState()||{};
let state={on:_s.on||{overview:1,agents:1,findings:1,results:1,verdicts:1,changed:1},openAgents:Object.assign(Object.create(null),_s.openAgents||{}),openFind:Object.assign(Object.create(null),_s.openFind||{}),fRev:Object.assign(Object.create(null),_s.fRev||{}),fSev:Object.assign(Object.create(null),_s.fSev||{})};
let snap=null;
function save(){api.setState(state);}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// escCls applies esc() then replaces whitespace with underscores so the result
// is safe as a single CSS class token (spaces in a class attribute add extra tokens).
function escCls(s){return esc(s).replace(/[\\t\\n\\r ]+/g,'_');}
function fmtT(s){s=s||0;if(s===0)return '<1s';if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m'+String(s%60).padStart(2,'0')+'s';return Math.floor(s/3600)+'h'+String(Math.floor(s%3600/60)).padStart(2,'0')+'m';}
// safeN: coerce to number, return 0 if result is not finite (NaN/Infinity). Prevents
// showing 'NaN' or 'Infinity' in KPI cards when snapshot fields have unexpected types.
function safeN(n){var v=+n;return isFinite(v)?v:0;}

const tg=document.getElementById('toggles');
if(tg){PANELS.forEach(([k,lbl])=>{const l=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.id='toggle-'+k;l.setAttribute('for','toggle-'+k);cb.checked=state.on[k]!==0;cb.onchange=()=>{state.on[k]=cb.checked?1:0;save();render();};l.appendChild(cb);l.appendChild(document.createTextNode(' '+lbl));tg.appendChild(l);});}
var rb=document.getElementById('refreshBtn');if(rb)rb.addEventListener('click',()=>api.postMessage({type:'refresh'}));
var gb=document.getElementById('guideBtn');if(gb)gb.addEventListener('click',()=>api.postMessage({type:'guide'}));
var srb=document.getElementById('selectRunBtn');if(srb)srb.addEventListener('click',()=>api.postMessage({type:'selectRun'}));
// VS Code delivers webview.postMessage() via an internal IPC bridge, not standard
// cross-origin postMessage. The bridge may set e.source=null (not window) on some
// VS Code versions, so checking e.source===window would silently drop every snapshot.
// The CSP nonce already prevents external script injection, so no origin check is
// needed here. The VS Code-idiomatic pattern checks only e.data.type.
window.addEventListener('message',e=>{if(e.data&&e.data.type==='snapshot'){snap=e.data.snap;render();}});

function render(){
  const root=document.getElementById('root');
  if(!root)return;
  if(!snap){root.innerHTML='<div class="dim pad">Looking for an active workflow run…</div>';return;}
  // Prune stale keys to prevent openAgents/openFind from growing unboundedly
  // across workflow runs. Each run has new agent ids; old entries are dead weight.
  if(snap.ok){
    const agentIds=new Set(snap.agents.map(a=>a.id));
    state.openAgents=Object.fromEntries(Object.entries(state.openAgents).filter(([k])=>agentIds.has(k)));
    const findingIds=new Set(snap.allFindings.map(f=>f.reviewer+(f.pass||0)+'|'+(f.location||f.title||'')));
    state.openFind=Object.fromEntries(Object.entries(state.openFind).filter(([k])=>findingIds.has(k)));
  }
  if(!snap.ok){
    root.innerHTML='<div class="empty-state" data-testid="empty-state"><h2>No Workflow run found</h2><div class="empty-msg" data-testid="empty-msg">'+esc(snap.msg)+'</div><p class="empty-hint">Start a <b>Claude Code Workflow()</b> run and the dashboard will update automatically. To change the search path, open <b>Settings &rarr; Claude Code Workflow Dashboard &rarr; Workflows Glob Base</b>.</p><div class="empty-actions"><button id="emptyRefresh">Refresh</button><button id="emptyGuide">Open Authoring Guide</button></div></div>';
    var er=document.getElementById('emptyRefresh');if(er)er.onclick=function(){api.postMessage({type:'refresh'});};
    var eg=document.getElementById('emptyGuide');if(eg)eg.onclick=function(){api.postMessage({type:'guide'});};
    return;
  }
  var metaEl=document.getElementById('meta');if(metaEl)metaEl.innerHTML=esc(snap.runId)+(snap.isPinned?'<span class="sev MEDIUM" style="margin-left:6px;font-size:10px;vertical-align:middle">pinned</span>':'')+' · updated '+esc(snap.updatedAt);
  const sy=window.scrollY;
  const subPos=Object.create(null);
  document.querySelectorAll('.card.open').forEach(c=>{const s=c.querySelector('.sub');if(s)subPos[c.dataset.aid]=s.scrollTop;});
  // Capture focused element's identity before innerHTML replace destroys it.
  // Re-focus the matching element after wire() so keyboard users don't lose position.
  const focusEl=document.activeElement;
  const focusAid=focusEl?.closest('[data-aid]')?.dataset?.aid||null;
  const focusFid=focusEl?.closest('[data-fid]')?.dataset?.fid||null;
  const focusRev=focusEl?.closest('[data-rev]')?.dataset?.rev||null;
  const focusSev=focusEl?.closest('[data-sev]')?.dataset?.sev||null;
  let h='';
  if(state.on.overview!==0)h+=overview();
  if(state.on.agents!==0)h+=agentsPanel();
  if(state.on.findings!==0)h+=findingsPanel();
  if(state.on.results!==0&&snap.structuredResults.length)h+=resultsPanel();
  if(state.on.verdicts!==0&&Object.keys(snap.verdicts).length)h+=verdictsPanel();
  if(state.on.changed!==0&&snap.changed)h+=changedPanel();
  root.innerHTML=h;wire();
  document.querySelectorAll('.card.open').forEach(c=>{const s=c.querySelector('.sub');if(s&&subPos[c.dataset.aid]!=null)s.scrollTop=subPos[c.dataset.aid];});
  window.scrollTo(0,sy);
  // Restore keyboard focus after innerHTML replace. CSS.escape() is used in
  // attribute selectors — esc() would HTML-encode the value which is wrong in CSS.
  // sel() builds an attribute selector using single-quote delimiters so these lines
  // do not contain the literal data-xxx=DQ...DQ pattern used by the chip-builder lines
  // (DQ = double-quote; the html.test.ts chip-builder test discriminates on that pattern).
  function sel(attr,val){return '['+attr+'=\\''+CSS.escape(val)+'\\']';}
  if(focusAid){const r=document.querySelector(sel('data-aid',focusAid)+' .row');if(r)r.focus({preventScroll:true});}
  else if(focusFid){const r=document.querySelector(sel('data-fid',focusFid)+' .ttl');if(r)r.focus({preventScroll:true});}
  else if(focusRev){const r=document.querySelector('.chip.rev'+sel('data-rev',focusRev));if(r)r.focus({preventScroll:true});}
  else if(focusSev){const r=document.querySelector('.chip.fsev'+sel('data-sev',focusSev));if(r)r.focus({preventScroll:true});}
}
function panel(t,b){return '<div class="panel"><h3>'+esc(t)+'</h3><div class="body">'+b+'</div></div>';}

function overview(){
  const L=snap.loop;
  let sev='';for(const s in L.sevTotals){const es=esc(s);const ec=escCls(s);sev+='<span class="sev '+ec+'">'+es+' '+L.sevTotals[s]+'</span>';}
  const body='<div class="kpis">'
    +(L.passes?'<div class="kpi"><div class="dim">Passes</div><b>'+safeN(L.passes)+'</b></div>':'')
    +'<div class="kpi"><div class="dim">Phase</div><b>'+esc(L.phase)+'</b></div>'
    +'<div class="kpi"><div class="dim">Live</div><b'+(L.live?' class="ok"':'')+'>'+safeN(L.live)+'</b></div>'
    +'<div class="kpi"><div class="dim">Done</div><b>'+safeN(L.done)+'</b></div>'
    +'<div class="kpi" title="'+STALE_TOOLTIP+'"><div class="dim">Stalled</div><b>'+safeN(L.dead)+'</b><div class="dim kpi-sublabel">no activity '+STALE_LABEL+'</div></div>'
    +'<div class="kpi"><div class="dim">Agents</div><b>'+safeN(L.total)+'</b></div>'
    +'<div class="kpi"><div class="dim">Output</div><b>'+(safeN(L.outTok)<1000?safeN(L.outTok)+'':(safeN(L.outTok)/1000).toFixed(1)+'k')+'</b></div>'
    +'<div class="kpi"><div class="dim">Tool-calls</div><b>'+safeN(L.tools)+'</b></div>'
    +'<div class="kpi"><div class="dim">Findings</div><b>'+safeN(L.findings)+'</b></div>'
    +'</div>'+(sev?('<div class="overview-sev-row">'+sev+'</div>'):'');
  return panel('Overview',body);
}

function agentSub(a){
  if(a.findings)return a.findings.map(f=>{var es=esc(f.severity||'UNRATED');var ec=escCls(f.severity||'UNRATED');return '<div class="ev"><span class="sev '+ec+'">'+es+'</span>'+esc(f.title||f.location||'(untitled)')+'</div>';}).join('')||'<div class="ev dim">no findings</div>';
  if(a.result)return '<pre>'+esc(JSON.stringify(a.result,null,2))+'</pre>';
  if(a.resultText)return '<pre>'+esc(a.resultText.slice(0,4000))+'</pre>';
  return (a.tail||[]).slice(-30).map(t=>'<div class="ev '+(t.kind==='tool'?'tool':'')+'">'+esc(t.text)+'</div>').join('')||'<div class="ev dim">no output yet</div>';
}
function agentsPanel(){
  if(!snap.agents.length)return panel('Agents','<div class="dim pad">No agents started yet — workflow is initialising…</div>');
  const capWarn=snap.agentsCapped?'<div class="cap-warn">Showing '+MAX_AGENTS+' most-recently-active agents — run may be larger.</div>':'';
  const cards=snap.agents.map(a=>{
    const open=state.openAgents[a.id]?'open':'';
    // escCls: whitespace-safe CSS class token (a.status is typed as 'run'|'done'|'dead' but
    // received as unvalidated JSON from postMessage — escCls closes the theoretical whitespace
    // injection gap consistently with how severity keys are handled).
    const es=escCls(a.status);
    // 'dead' is the internal status key (CSS class, TS type); user-facing label is 'stalled'
    // so the UI communicates that the agent stopped responding, not that it errored out.
    const statusLabel=a.status==='dead'?'stalled':a.status==='run'?'live':es;
    return '<div class="card '+es+' '+open+'" data-aid="'+esc(a.id)+'">'
      +'<div class="row" tabindex="0" role="button" aria-expanded="'+(open?'true':'false')+'"><span class="role">'+esc(a.label)+'</span><span class="st '+es+'">'+statusLabel+'</span><span class="grow"></span><span class="dim">'+fmtT(a.elapsed)+'</span></div>'
      +'<div class="dim" style="font-size:11px">'+(+a.tools)+' tool-calls · '+(+a.tokens<1000?+a.tokens+' tok':(+a.tokens/1000).toFixed(1)+'k tok')+(a.findings?(' · '+a.findings.length+' findings'):'')+'</div>'
      +(a.status==='run'?'<div class="activity">↳ '+esc(a.lastActivity)+'</div>':'')
      +'<div class="sub">'+agentSub(a)+'</div></div>';
  }).join('');
  return panel('Agents',capWarn+'<div class="cards"><div class="dim cards-hint">Click or press Enter on a card to expand its output or findings.</div>'+cards+'</div>');
}

function findingsPanel(){
  if(!snap.allFindings.length)return panel('Findings','<div class="dim pad">No findings recorded yet.</div>');
  snap.labels.forEach(l=>{if(state.fRev[l]===undefined)state.fRev[l]=1;});
  const sevs=[...new Set(snap.allFindings.map(f=>f.severity||'UNRATED'))];
  sevs.forEach(s=>{if(state.fSev[s]===undefined)state.fSev[s]=1;});
  // Compute anyOff before building chips so the Clear filters button can be
  // rendered in the filter bar (visible whenever any filter is inactive, not
  // only when the filtered list is empty).
  const anyOff=snap.labels.some(l=>!state.fRev[l])||sevs.some(s=>!state.fSev[s]);
  // Wrap each chip group in role="group" with an aria-label so screen readers
  // announce which dimension each group filters. The visual separator between
  // groups is provided by a CSS border/gap on .filters rather than a bare '|'.
  let chips='<div class="filters"><div role="group" aria-label="Filter by reviewer">';
  // data-rev and the visible text are both esc()'d to prevent attribute/HTML injection from a
  // transcript-derived label. The escaped value round-trips: the browser decodes entities on
  // parse, so el.dataset.rev returns the raw label — state-key lookups still match.
  snap.labels.forEach(l=>chips+='<span class="chip rev '+(state.fRev[l]?'':'off')+'" data-rev="'+esc(l)+'" tabindex="0" role="button" aria-pressed="'+(state.fRev[l]?'true':'false')+'">'+esc(l)+'</span>');
  chips+='</div><div role="group" aria-label="Filter by severity" class="filter-sep">';
  // data-sev and the visible text are both esc()'d (XSS-safe). The escaped value round-trips:
  // the browser decodes entities on parse, so el.dataset.sev returns the raw key — state-key
  // lookups still match. For normal enum severities esc() is a no-op, so behaviour is unchanged.
  sevs.forEach(s=>{var es=esc(s);chips+='<span class="chip fsev '+(state.fSev[s]?'':'off')+'" data-sev="'+es+'" tabindex="0" role="button" aria-pressed="'+(state.fSev[s]?'true':'false')+'">'+es+'</span>';});
  // Clear filters button: rendered in the filter bar (not in the empty-result branch) so it is
  // visible whenever any filter is off, regardless of whether the result list is empty or not.
  // Wired via addEventListener in wire() — inline handlers are blocked by nonce-based CSP.
  chips+='</div>'+(anyOff?'<button id="clearFiltersBtn" class="clear-btn">Clear filters</button>':'')+'</div>';
  const list=snap.allFindings.filter(f=>state.fRev[f.reviewer]&&state.fSev[f.severity||'UNRATED']);
  // Object.create(null): no prototype chain, so pass values equal to '__proto__' or
  // 'constructor' cannot pollute Object.prototype — consistent with openAgents/fRev/fSev.
  const byP=Object.create(null);list.forEach(f=>{(byP[f.pass]=byP[f.pass]||[]).push(f);});
  let body=chips;
  Object.keys(byP).sort((a,b)=>b-a).forEach(p=>{
    const fc=byP[p].length;body+='<h4 class="pass-heading">Pass '+esc(p)+' · '+fc+' finding'+(fc!==1?'s':'')+'</h4>';
    body+=byP[p].map(f=>{
      const id=f.reviewer+p+'|'+(f.location||f.title||'');
      const open=state.openFind[id]?'open':'';
      var esev=esc(f.severity||'UNRATED');var ecevCls=escCls(f.severity||'UNRATED');
      return '<div class="finding '+open+'" data-fid="'+esc(id)+'"><div class="ttl" tabindex="0" role="button" aria-expanded="'+(open?'true':'false')+'"><span class="sev '+ecevCls+'">'+esev+'</span><b>'+esc(f.title||'(untitled)')+'</b> <span class="dim">['+esc(f.reviewer)+']</span></div>'
        +(f.location?'<div class="loc">'+esc(f.location)+'</div>':'')
        +'<div class="detail">'+(f.why?'<div><b>Why:</b> '+esc(f.why)+'</div>':'')+(f.fix?'<div class="finding-fix"><b>Fix:</b> '+esc(f.fix)+'</div>':'')+'</div></div>';
    }).join('');
  });
  if(!list.length){
    // Build a context-aware message naming the active filters so the user does not
    // have to scan the chip bar to understand why the list is empty.
    // state.fRev/fSev keys are already esc()'d when placed in data-rev/data-sev,
    // so they are safe to include in an esc() call here without double-encoding.
    var offRevs=snap.labels.filter(function(l){return !state.fRev[l];}).map(function(l){return esc(l);});
    var offSevs=sevs.filter(function(s){return !state.fSev[s];}).map(function(s){return esc(s);});
    var parts=[];
    if(offRevs.length)parts.push('reviewer: '+offRevs.join(', '));
    if(offSevs.length)parts.push('severity: '+offSevs.join(', '));
    var why=parts.length?(' Filters hiding: '+parts.join('; ')+'.'):'';
    body+='<div class="dim">No findings match the active filters.'+why+' <button class="clear-btn" id="emptyFiltersBtn">Clear filters</button></div>';
  }
  return panel('Findings',body);
}

function resultsPanel(){
  // Results are not collapsible — no interactive ARIA. The <pre> is wrapped in a
  // scrollable container so large results do not force the page to scroll past them.
  const body=snap.structuredResults.map(r=>'<div class="finding result"><div class="ttl"><b>'+esc(r.label)+'</b> <span class="dim">pass '+esc(r.pass)+'</span></div><div style="max-height:340px;overflow:auto"><pre>'+esc(JSON.stringify(r.result,null,2))+'</pre></div></div>').join('');
  return panel('Results',body);
}
function verdictsPanel(){
  const body=Object.keys(snap.verdicts).sort((a,b)=>a.localeCompare(b)).map(l=>{
    const displayLabel=snap.verdictLabels&&snap.verdictLabels[l]?snap.verdictLabels[l]:l;
    return '<div class="verdict-item"><b>'+esc(displayLabel)+'</b> <span class="dim">'+esc(snap.verdicts[l]||'(pending)')+'</span></div>';
  }).join('');
  return panel('Verdicts',body);
}
function changedPanel(){
  const f=snap.changed||[];
  return panel('Changed files','<div class="dim changed-caption">Files modified in the last '+CHANGED_MAX_MIN+' min</div>'+(f.length?'<ul class="files">'+f.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<div class="dim">nothing recent</div>'));
}

function wire(){
  function toggle_agent(c){const id=c.dataset.aid;state.openAgents[id]=!state.openAgents[id];save();c.classList.toggle('open');const row=c.querySelector('.row');if(row)row.setAttribute('aria-expanded',c.classList.contains('open')?'true':'false');}
  function toggle_find(t){const fd=t.closest('.finding');if(!fd)return;const id=fd.dataset.fid;if(!id)return;state.openFind[id]=!state.openFind[id];save();fd.classList.toggle('open');t.setAttribute('aria-expanded',fd.classList.contains('open')?'true':'false');}
  document.querySelectorAll('.card').forEach(c=>{const row=c.querySelector('.row');if(row){row.addEventListener('click',()=>toggle_agent(c));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle_agent(c);}});}});
  document.querySelectorAll('.finding .ttl').forEach(t=>{t.onclick=()=>toggle_find(t);t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle_find(t);}});});
  // After a chip toggle re-renders the panel, restore keyboard focus to the chip
  // that was activated so keyboard users don't lose their position in the filter row.
  // CSS.escape() is used in querySelector attribute selectors — esc() performs HTML
  // encoding which is wrong for CSS selectors (e.g. '"' → '&quot;' is a 6-char literal
  // in CSS, not a quote). CSS.escape() is available in all browsers and webview runtimes.
  // esc() is still correct for the attribute VALUE in the HTML (data-rev="…").
  document.querySelectorAll('.chip.rev').forEach(ch=>{function act(){const k=ch.dataset.rev;state.fRev[k]=state.fRev[k]?0:1;save();render();const next=document.querySelector('.chip.rev[data-rev="'+CSS.escape(k)+'"]');if(next)next.focus();}ch.onclick=act;ch.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}});});
  // ch.dataset.sev is browser-decoded (HTML entities resolved) → equals the raw key used in state.fSev.
  // data-sev is set via esc() in findingsPanel(); the browser reverses the encoding on .dataset access.
  document.querySelectorAll('.chip.fsev').forEach(ch=>{function act(){const k=ch.dataset.sev;state.fSev[k]=state.fSev[k]?0:1;save();render();const next=document.querySelector('.chip.fsev[data-sev="'+CSS.escape(k)+'"]');if(next)next.focus();}ch.onclick=act;ch.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}});});
  // Clear filters button — wired here (not via inline onclick) so the nonce CSP is satisfied.
  // Inline event handlers on innerHTML-injected elements are always blocked by nonce-based CSP
  // regardless of whether a nonce attribute is present; addEventListener is the correct pattern.
  var cf=document.getElementById('clearFiltersBtn');if(cf)cf.addEventListener('click',function(){Object.keys(state.fRev).forEach(function(k){state.fRev[k]=1;});Object.keys(state.fSev).forEach(function(k){state.fSev[k]=1;});save();render();});
  // The empty-result branch may also render a clear-filters button (emptyFiltersBtn).
  var ef=document.getElementById('emptyFiltersBtn');if(ef)ef.addEventListener('click',function(){Object.keys(state.fRev).forEach(function(k){state.fRev[k]=1;});Object.keys(state.fSev).forEach(function(k){state.fSev[k]=1;});save();render();});
}
render();
`;
