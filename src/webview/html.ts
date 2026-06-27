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

export function getHtml(nonce: string, changedMaxMin = 2, maxAgents = 200): string {
  // changedMaxMin and maxAgents are passed through to the JS template so
  // changedPanel() and agentsPanel() can display correct thresholds without
  // hardcoded literals. Defaults match CHANGED_MAX_SECS=120 and MAX_AGENTS=200
  // in snapshot.ts.
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Claude Code Workflow Dashboard</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">${CSS}</style></head>
<body>
<div id="bar"><span id="title">Claude Code Workflow Dashboard</span><span id="meta" class="dim"></span><span class="grow"></span><div role="group" aria-label="Show panels" id="toggles"></div><button id="guideBtn" title="Open the workflow authoring guide" aria-label="Open workflow authoring guide"><span aria-hidden="true">📖</span> Guide</button><button id="refreshBtn" title="Refresh now" aria-label="Refresh">Refresh</button></div>
<div id="root" aria-live="polite"><div class="dim pad">Looking for an active workflow run…</div></div>
<script nonce="${nonce}">const CHANGED_MAX_MIN=${changedMaxMin};const MAX_AGENTS=${maxAgents};${JS}</script>
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
.role{font-weight:600}
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

.sev{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px}
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
function escCls(s){return esc(s).replace(/\s+/g,'_');}
function fmtT(s){s=s||0;if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m'+String(s%60).padStart(2,'0')+'s';return Math.floor(s/3600)+'h'+String(Math.floor(s%3600/60)).padStart(2,'0')+'m';}
// safeN: coerce to number, return 0 if result is not finite (NaN/Infinity). Prevents
// showing 'NaN' or 'Infinity' in KPI cards when snapshot fields have unexpected types.
function safeN(n){var v=+n;return isFinite(v)?v:0;}

const tg=document.getElementById('toggles');
if(tg){PANELS.forEach(([k,lbl])=>{const l=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.id='toggle-'+k;l.setAttribute('for','toggle-'+k);cb.checked=state.on[k]!==0;cb.onchange=()=>{state.on[k]=cb.checked?1:0;save();render();};l.appendChild(cb);l.appendChild(document.createTextNode(' '+lbl));tg.appendChild(l);});}
var rb=document.getElementById('refreshBtn');if(rb)rb.onclick=()=>api.postMessage({type:'refresh'});
var gb=document.getElementById('guideBtn');if(gb)gb.onclick=()=>api.postMessage({type:'guide'});
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
    root.innerHTML='<div class="pad"><div class="bad" style="margin-bottom:8px">'+esc(snap.msg)+'</div><div class="dim" style="margin-bottom:10px">Start a Claude Code Workflow() run to see it here, or configure the search path via <b>Settings → Claude Code Workflow Dashboard → Workflows Glob Base</b>.</div><div class="empty-actions"><button id="emptyRefresh">Refresh</button><button id="emptyGuide">Open Authoring Guide</button></div></div>';
    var er=document.getElementById('emptyRefresh');if(er)er.onclick=function(){api.postMessage({type:'refresh'});};
    var eg=document.getElementById('emptyGuide');if(eg)eg.onclick=function(){api.postMessage({type:'guide'});};
    return;
  }
  var metaEl=document.getElementById('meta');if(metaEl)metaEl.textContent=snap.runId+' · updated '+snap.updatedAt;
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
  if(state.on.findings!==0&&snap.allFindings.length)h+=findingsPanel();
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
  function sel(attr,val){return '['+attr+'=\''+CSS.escape(val)+'\']';}
  if(focusAid){const r=document.querySelector(sel('data-aid',focusAid)+' .row');if(r)r.focus();}
  else if(focusFid){const r=document.querySelector(sel('data-fid',focusFid)+' .ttl');if(r)r.focus();}
  else if(focusRev){const r=document.querySelector('.chip.rev'+sel('data-rev',focusRev));if(r)r.focus();}
  else if(focusSev){const r=document.querySelector('.chip.fsev'+sel('data-sev',focusSev));if(r)r.focus();}
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
    +'<div class="kpi"><div class="dim">Stalled</div><b>'+safeN(L.dead)+'</b></div>'
    +'<div class="kpi"><div class="dim">Agents</div><b>'+safeN(L.total)+'</b></div>'
    +'<div class="kpi"><div class="dim">Output</div><b>'+(safeN(L.outTok)<1000?safeN(L.outTok)+'':(safeN(L.outTok)/1000).toFixed(1)+'k')+'</b></div>'
    +'<div class="kpi"><div class="dim">Tool-calls</div><b>'+safeN(L.tools)+'</b></div>'
    +'<div class="kpi"><div class="dim">Findings</div><b>'+safeN(L.findings)+'</b></div>'
    +'</div>'+(sev?('<div style="margin-top:8px">'+sev+'</div>'):'');
  return panel('Overview',body);
}

function agentSub(a){
  if(a.findings)return a.findings.map(f=>{var es=esc(f.severity||'UNRATED');var ec=escCls(f.severity||'UNRATED');return '<div class="ev"><span class="sev '+ec+'">'+es+'</span>'+esc(f.title||f.location||'(untitled)')+'</div>';}).join('')||'<div class="ev dim">no findings</div>';
  if(a.result)return '<pre>'+esc(JSON.stringify(a.result,null,2))+'</pre>';
  if(a.resultText)return '<pre>'+esc(a.resultText.slice(0,4000))+'</pre>';
  return (a.tail||[]).slice(-30).map(t=>'<div class="ev '+(t.kind==='tool'?'tool':'')+'">'+esc(t.text)+'</div>').join('')||'<div class="ev dim">no output yet</div>';
}
function agentsPanel(){
  if(!snap.agents.length)return panel('Agents — click a card for its output / findings','<div class="dim pad">No agents started yet — workflow is initialising…</div>');
  const capWarn=snap.agentsCapped?'<div style="margin-bottom:6px;padding:4px 8px;border:1px solid var(--vscode-inputValidation-warningBorder,var(--vscode-panel-border));color:var(--vscode-inputValidation-warningForeground,var(--vscode-foreground));border-radius:4px">Showing '+MAX_AGENTS+' most-recently-active agents — run may be larger.</div>':'';
  const cards=snap.agents.map(a=>{
    const open=state.openAgents[a.id]?'open':'';
    const es=esc(a.status);
    // 'dead' is the internal status key (CSS class, TS type); user-facing label is 'stalled'
    // so the UI communicates that the agent stopped responding, not that it errored out.
    const statusLabel=a.status==='dead'?'stalled':es;
    return '<div class="card '+es+' '+open+'" data-aid="'+esc(a.id)+'">'
      +'<div class="row" tabindex="0" role="button" aria-expanded="'+(open?'true':'false')+'"><span class="role">'+esc(a.label)+'</span><span class="st '+es+'">'+statusLabel+'</span><span class="grow"></span><span class="dim">'+fmtT(a.elapsed)+'</span></div>'
      +'<div class="dim" style="font-size:11px">'+(+a.tools)+' tool-calls · '+(+a.tokens<1000?+a.tokens+' tok':(+a.tokens/1000).toFixed(1)+'k tok')+(a.findings?(' · '+a.findings.length+' findings'):'')+'</div>'
      +(a.status==='run'?'<div class="activity">↳ '+esc(a.lastActivity)+'</div>':'')
      +'<div class="sub">'+agentSub(a)+'</div></div>';
  }).join('');
  return panel('Agents — click a card for its output / findings',capWarn+'<div class="cards">'+cards+'</div>');
}

function findingsPanel(){
  snap.labels.forEach(l=>{if(state.fRev[l]===undefined)state.fRev[l]=1;});
  const sevs=[...new Set(snap.allFindings.map(f=>f.severity||'UNRATED'))];
  sevs.forEach(s=>{if(state.fSev[s]===undefined)state.fSev[s]=1;});
  // Wrap each chip group in role="group" with an aria-label so screen readers
  // announce which dimension each group filters. The visual separator between
  // groups is provided by a CSS border/gap on .filters rather than a bare '|'.
  let chips='<div class="filters"><div role="group" aria-label="Filter by reviewer">';
  // data-rev and the visible text are both esc()'d to prevent attribute/HTML injection from a
  // transcript-derived label. The escaped value round-trips: the browser decodes entities on
  // parse, so el.dataset.rev returns the raw label — state-key lookups still match.
  snap.labels.forEach(l=>chips+='<span class="chip rev '+(state.fRev[l]?'':'off')+'" data-rev="'+esc(l)+'" tabindex="0" role="button" aria-pressed="'+(state.fRev[l]?'true':'false')+'">'+esc(l)+'</span>');
  chips+='</div><div role="group" aria-label="Filter by severity" style="margin-left:10px;border-left:1px solid var(--vscode-panel-border);padding-left:10px">';
  // data-sev and the visible text are both esc()'d (XSS-safe). The escaped value round-trips:
  // the browser decodes entities on parse, so el.dataset.sev returns the raw key — state-key
  // lookups still match. For normal enum severities esc() is a no-op, so behaviour is unchanged.
  sevs.forEach(s=>{var es=esc(s);chips+='<span class="chip fsev '+(state.fSev[s]?'':'off')+'" data-sev="'+es+'" tabindex="0" role="button" aria-pressed="'+(state.fSev[s]?'true':'false')+'">'+es+'</span>';});
  chips+='</div></div>';
  const list=snap.allFindings.filter(f=>state.fRev[f.reviewer]&&state.fSev[f.severity||'UNRATED']);
  // Object.create(null): no prototype chain, so pass values equal to '__proto__' or
  // 'constructor' cannot pollute Object.prototype — consistent with openAgents/fRev/fSev.
  const byP=Object.create(null);list.forEach(f=>{(byP[f.pass]=byP[f.pass]||[]).push(f);});
  let body=chips;
  Object.keys(byP).sort((a,b)=>b-a).forEach(p=>{
    const fc=byP[p].length;body+='<h4 class="dim" style="margin:6px 0;font-size:12px;font-weight:600">Pass '+esc(p)+' · '+fc+' finding'+(fc!==1?'s':'')+'</h4>';
    body+=byP[p].map(f=>{
      const id=f.reviewer+p+'|'+(f.location||f.title||'');
      const open=state.openFind[id]?'open':'';
      var esev=esc(f.severity||'UNRATED');var ecevCls=escCls(f.severity||'UNRATED');
      return '<div class="finding '+open+'" data-fid="'+esc(id)+'"><div class="ttl" tabindex="0" role="button" aria-expanded="'+(open?'true':'false')+'"><span class="sev '+ecevCls+'">'+esev+'</span><b>'+esc(f.title||'(untitled)')+'</b> <span class="dim">['+esc(f.reviewer)+']</span></div>'
        +(f.location?'<div class="loc">'+esc(f.location)+'</div>':'')
        +'<div class="detail">'+(f.why?'<div><b>Why:</b> '+esc(f.why)+'</div>':'')+(f.fix?'<div style="margin-top:4px"><b>Fix:</b> '+esc(f.fix)+'</div>':'')+'</div></div>';
    }).join('');
  });
  if(!list.length){
    const anyOff=snap.labels.some(l=>!state.fRev[l])||sevs.some(s=>!state.fSev[s]);
    body+='<div class="dim">No findings match the filters.</div>';
    if(anyOff)body+='<button id="clearFiltersBtn" style="margin-top:6px">Clear filters</button>';
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
  const body=Object.keys(snap.verdicts).map(l=>'<div style="margin-bottom:6px"><b>'+esc(l)+'</b> <span class="dim">'+esc(snap.verdicts[l]||'(pending)')+'</span></div>').join('');
  return panel('Verdicts',body);
}
function changedPanel(){
  const f=snap.changed||[];
  return panel('Changed files','<div class="dim" style="font-size:11px;margin-bottom:6px">Files modified in the last '+CHANGED_MAX_MIN+' min</div>'+(f.length?'<ul class="files">'+f.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<div class="dim">nothing recent</div>'));
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
}
render();
`;
