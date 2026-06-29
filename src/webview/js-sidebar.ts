// Sidebar webview JS for the Claude Code Workflow Dashboard.
//
// Extracted from html.ts (M2-polish round-5) to keep that module under the 400-line limit.
// html.ts imports this and injects it into the sidebar <script> tag via the nonce CSP.
//
// This script runs in the webview DOM — acquireVsCodeApi() is available, tsc does not
// type-check the content of this string. Do NOT add TypeScript annotations here.
// ---------------------------------------------------------------------------
// Sidebar JS — compact render. Posts {type:'openFull'} when the user clicks
// the "Open full dashboard" button. acquireVsCodeApi() messages use the same
// IPC bridge as the panel webview (no origin check needed — CSP protects injection).
// ---------------------------------------------------------------------------
export const JS_SIDEBAR = `
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
var initExport=document.getElementById('sbExportInit');if(initExport)initExport.addEventListener('click',function(){api.postMessage({type:'export'});});

window.addEventListener('message',function(e){if(e.data&&e.data.type==='snapshot'){snap=e.data.snap;render();}});

function render(){
  var root=document.getElementById('root');
  if(!root)return;
  if(!snap){root.innerHTML='<div class="sb-header"><span class="sb-title">Workflow</span><button class="sb-open-btn" id="sbInitOpen2" aria-label="Open full dashboard"><span aria-hidden="true">&#10562;</span><span class="sb-btn-lbl"> Open</span></button></div><div class="dim pad">Looking for an active workflow run…</div>';var si2=document.getElementById('sbInitOpen2');if(si2)si2.addEventListener('click',openFull);return;}
  if(!snap.ok){
    root.innerHTML='<div class="empty-state" data-testid="empty-state-sidebar"><h3>No Workflow run found</h3><p class="empty-msg">'+esc(snap.msg)+'</p><p class="empty-hint">Start a <b>Claude Code Workflow()</b> run to see the dashboard. To configure the search path, open <b>Settings &rarr; Claude Code Workflow Dashboard &rarr; Workflows Glob Base</b>.</p><div class="empty-actions"><button id="sbOpen" class="sb-open-btn"><span aria-hidden="true">&#10562;</span> Open full dashboard</button><button id="sbRefresh">Refresh</button><button id="sbGuide">Guide</button></div></div>';
    var so=document.getElementById('sbOpen');if(so)so.addEventListener('click',openFull);
    var sr=document.getElementById('sbRefresh');if(sr)sr.addEventListener('click',function(){api.postMessage({type:'refresh'});});
    var sg=document.getElementById('sbGuide');if(sg)sg.addEventListener('click',function(){api.postMessage({type:'guide'});});
    return;
  }
  var L=snap.loop;
  var header='<div class="sb-header" data-testid="sidebar-header">'
    +'<span class="sb-title">Workflow</span>'
    +'<button class="sb-open-btn" id="sbRefreshLive" title="Refresh" aria-label="Refresh"><span aria-hidden="true">&#8635;</span><span class="sb-btn-lbl"> Refresh</span></button>'
    +'<button class="sb-open-btn" id="sbSelectRunLive" title="Select or pin a workflow run" aria-label="Select workflow run"><span aria-hidden="true">&#9776;</span><span class="sb-btn-lbl"> Runs</span></button>'
    +'<button class="sb-open-btn" id="sbExportLive" title="Export run as Markdown" aria-label="Export run as Markdown" data-testid="export-btn"><span aria-hidden="true">&#8595;</span><span class="sb-btn-lbl"> Export</span></button>'
    +'<button class="sb-open-btn" id="openFullBtn" title="Open full dashboard in editor" aria-label="Open full dashboard in editor" data-testid="open-full-btn"><span aria-hidden="true">&#10562;</span><span class="sb-btn-lbl"> Open</span></button>'
    +'</div>';
  var phaseSection='<div class="sb-section">'
    +'<div class="sb-phase" data-testid="sidebar-phase">'+esc(L.phase)+'</div>'
    +'<div class="sb-runid">'+esc(snap.runId)+(snap.isPinned?'<span class="st done sb-pinned-badge">pinned</span>':'')+'</div>'
    +'</div>';
  var kpiSection='<div class="sb-section">'
    +'<div class="sb-section-title">Status</div>'
    +'<div class="sb-kpis">'
    // WCAG 1.4.1: match the panel overview() pattern — supplement the green-color Live KPI
    // with a sr-only text annotation so AT users hear "agents running", not just a number.
    +'<div class="sb-kpi"><span class="label">Live</span><span class="val'+(L.live?' ok':'')+'">'+safeN(L.live)+(L.live?'<span class="sr-only"> agents running</span>':'')+'</span></div>'
    +'<div class="sb-kpi"><span class="label">Done</span><span class="val">'+safeN(L.done)+'</span></div>'
    +'<div class="sb-kpi"><span class="label" aria-describedby="stalled-desc">Stalled</span><span class="val'+(L.dead?' bad':'')+'">'+safeN(L.dead)+'</span><span id="stalled-desc" class="sr-only">'+esc(STALE_TOOLTIP)+'</span></div>'
    +'</div></div>';
  var sevSection='';
  if(snap.allFindings&&snap.allFindings.length){
    var sevTotals=Object.create(null);
    snap.allFindings.forEach(function(f){var s=f.severity||'UNRATED';sevTotals[s]=(sevTotals[s]||0)+1;});
    var badges='';for(var s in sevTotals){var es=esc(s);var ec=escCls(s);badges+='<span class="sev '+ec+'">'+es+' '+safeN(sevTotals[s])+'</span>';}
    sevSection='<div class="sb-section" data-testid="sidebar-findings"><div class="sb-section-title">Findings <span class="sb-num">'+safeN(L.findings)+'</span></div><div>'+badges+'</div></div>';
  }
  // Agents section: show running agents first, then stalled agents, capped at 5 combined.
  // Including stalled agents lets the user correlate the KPI stalled count with specific
  // agents without opening the full panel. Section retitled "Agents" from "Active agents"
  // to reflect that stalled agents are also shown.
  var allAgents=snap.agents?snap.agents:[],
    running=allAgents.filter(function(a){return a.status==='run';}),
    stalled=allAgents.filter(function(a){return a.status==='dead';}),
    combined=running.concat(stalled).slice(0,5);
  var rows=combined.map(function(a){
    var es=escCls(a.status);
    var lbl=a.status==='dead'?'stalled':a.status==='run'?'live':es;
    return '<div class="sb-agent"><span class="role">'+esc(a.label)+'</span><span class="st '+es+'">'+lbl+'</span></div>';
  }).join('');
  if(!rows)rows='<div class="dim sb-agent-placeholder">No agents currently running</div>';
  var totalShown=combined.length,totalAll=running.length+stalled.length;
  var more=totalAll>5?'<div class="dim sb-agent-overflow">+'+safeN(totalAll-5)+' more</div>':'';
  var agentSection='<div class="sb-section" data-testid="sidebar-agents"><div class="sb-section-title">Agents</div>'+rows+more+'</div>';
  // Changed files section: use changedByAgents (agent-reported union) as the primary
  // source — this is populated for any run where agents reported filesChanged[], making
  // it reliable for completed runs when the mtime scan (snap.changed) returns nothing.
  // Fall back to snap.changed (mtime-based) when changedByAgents is empty.
  var changedSection='';
  var byAgentsSb=snap.changedByAgents&&snap.changedByAgents.length?snap.changedByAgents:null;
  var mtimeSb=snap.changed&&snap.changed.length?snap.changed:null;
  var chSourceSb=byAgentsSb||mtimeSb;
  if(chSourceSb){
    var chTitleSb=byAgentsSb?'Changed files':'Recently touched';
    var chFiles=chSourceSb.slice(0,5);
    var chRows=chFiles.map(function(f){return '<div class="dim sb-changed-file">'+esc(f)+'</div>';}).join('');
    var chMore=chSourceSb.length>5?'<div class="dim sb-changed-more">+'+safeN(chSourceSb.length-5)+' more</div>':'';
    changedSection='<div class="sb-section"><div class="sb-section-title">'+chTitleSb+'</div>'+chRows+chMore+'</div>';
  }
  var sy=window.scrollY;
  root.innerHTML=header+phaseSection+kpiSection+sevSection+agentSection+changedSection;
  window.scrollTo(0,sy);
  // Update the sr-only live region with a concise status summary so screen readers
  // hear only meaningful state changes, not the full re-rendered DOM.
  // textContent is a text-node setter — it does not interpret HTML, so esc() is not
  // only redundant but actively harmful: esc() would HTML-encode '&', '<', '>' etc.,
  // and those literal entity strings would be announced verbatim by screen readers.
  // Raw string assignment is XSS-safe here because textContent never executes HTML.
  var srSb=document.getElementById('sr-status-sb');if(srSb)srSb.textContent=L.phase+' — '+safeN(L.live)+' live, '+safeN(L.done)+' done, '+safeN(L.findings)+' findings';
  wireSidebar();
}

// wireSidebar: attaches event listeners after every root.innerHTML assignment.
// Must be called after every full render to re-wire listeners (old DOM nodes are GC'd).
// Parallel to the panel's wire() function — making this pattern explicit reduces the
// risk of stale-listener bugs when new interactive elements are added in the future.
function wireSidebar(){
  var btn=document.getElementById('openFullBtn');if(btn)btn.addEventListener('click',openFull);
  var sr2=document.getElementById('sbRefreshLive');if(sr2)sr2.addEventListener('click',function(){api.postMessage({type:'refresh'});});
  var srLive=document.getElementById('sbSelectRunLive');if(srLive)srLive.addEventListener('click',function(){api.postMessage({type:'selectRun'});});
  var seLive=document.getElementById('sbExportLive');if(seLive)seLive.addEventListener('click',function(){api.postMessage({type:'export'});});
}
render();
`;
