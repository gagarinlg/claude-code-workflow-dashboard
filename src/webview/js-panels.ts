// Panel webview JS for the Claude Code Workflow Dashboard — full editor-panel view.
//
// Extracted from html.ts (M2-polish round-5) to keep that module under the 400-line limit.
// html.ts imports this and concatenates it with JS_WIRE (from js-wire.ts) into the
// panel <script> tag via the nonce CSP.
//
// This script runs in the webview DOM — acquireVsCodeApi() is available, tsc does not
// type-check the content of this string. Do NOT add TypeScript annotations here.
// JS is an opaque template string — it runs in the webview DOM under
// acquireVsCodeApi() and is not typed by tsc. The severity-key XSS fix:
// esc() is applied to the severity key `s` before using it as a CSS class
// name and as inner text in the overview sev-span builder.
export const JS_PANELS = `
const api = acquireVsCodeApi();
// Panel order matches the render() function's panel-build order so toggle labels
// are spatially consistent with page position: overview→agents→findings→verdicts→changed→charts→results.
// Results is placed last (and starts hidden) per ROADMAP §M2-Layout.
const PANELS=[['overview','Overview'],['agents','Agents'],['findings','Findings'],['verdicts','Verdicts'],['changed','Changed files'],['charts','Charts'],['results','Results']];
// openAgents/openFind/fRev/fSev accept transcript-derived strings as keys (agent ids,
// severity labels, reviewer labels). Using Object.create(null) eliminates the prototype
// chain, preventing '__proto__' or 'constructor' key collisions regardless of engine version.
const _s=api.getState()||{};
// Charts default to hidden (charts:0) — for small runs (1-3 agents) the chart adds
// scroll distance with little value. Users who want the chart can toggle it on.
// Results also default to hidden (results:0) — only shown when relevant.
// panelOpen: per-panel section collapse state. 1=expanded (default), 0=collapsed.
// Charts section collapsed by default (panelOpen.charts:0) to cut scroll for small runs.
// All other sections expanded by default so users see their data immediately.
let state={on:_s.on||{overview:1,agents:1,findings:1,verdicts:1,changed:1,charts:0,results:0},panelOpen:Object.assign({overview:1,agents:1,findings:1,verdicts:1,changed:1,charts:0,results:1},_s.panelOpen||{}),openAgents:Object.assign(Object.create(null),_s.openAgents||{}),openFind:Object.assign(Object.create(null),_s.openFind||{}),fRev:Object.assign(Object.create(null),_s.fRev||{}),fSev:Object.assign(Object.create(null),_s.fSev||{}),openPrompt:Object.assign(Object.create(null),_s.openPrompt||{})};
let snap=null;
function save(){api.setState(state);}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// escCls applies esc() then replaces whitespace with underscores so the result
// is safe as a single CSS class token (spaces in a class attribute add extra tokens).
function escCls(s){return esc(s).replace(/[\\t\\n\\r ]+/g,'_');}
// fmtTHtml: format elapsed seconds for injection via innerHTML.
// Returns '&lt;1s' (HTML entity) for elapsed <= 0 so the literal '<' character does not
// appear raw in the DOM. Always inject via innerHTML — the entity decodes correctly there.
// Do NOT use fmtTHtml() with textContent or aria attributes — '&lt;1s' would be displayed
// verbatim (announced as "ampersand lt semicolon 1 s" by screen readers).
// Cross-reference: fmtElapsed() in src/export/markdown.ts is the plain-text counterpart.
// Intentional format divergence from fmtElapsed (space-separated "1m 30s" vs "1m30s" here).
// See markdown.ts fmtElapsed JSDoc for details. The divergence is documented in both files.
function fmtTHtml(s){var v=safeN(s);if(v===0)return '&lt;1s';if(v<60)return v+'s';if(v<3600)return Math.floor(v/60)+'m'+String(v%60).padStart(2,'0')+'s';return Math.floor(v/3600)+'h'+String(Math.floor(v%3600/60)).padStart(2,'0')+'m';}
// fmtT: plain-text elapsed formatter — safe for use in textContent and aria-label attributes.
// Returns '<1s' (literal less-than character) rather than the HTML entity '&lt;1s'.
// Use this wherever the output goes into non-HTML context (ARIA labels, live regions, etc.).
// For innerHTML injection, use fmtTHtml() instead.
function fmtT(s){var v=safeN(s);if(v===0)return '<1s';if(v<60)return v+'s';if(v<3600)return Math.floor(v/60)+'m'+String(v%60).padStart(2,'0')+'s';return Math.floor(v/3600)+'h'+String(Math.floor(v%3600/60)).padStart(2,'0')+'m';}
// safeN: coerce to number, return 0 if result is not finite (NaN/Infinity). Prevents
// showing 'NaN' or 'Infinity' in KPI cards when snapshot fields have unexpected types.
function safeN(n){var v=+n;return isFinite(v)?v:0;}
// fmtUpdated: converts an ISO 8601 timestamp (snap.updatedAt) to a locale time string
// (HH:MM:SS) for the meta bar. Falls back to the raw string on parse errors.
// Uses toLocaleTimeString for locale-aware formatting without hardcoding a timezone.
function fmtUpdated(iso){try{var d=new Date(iso);if(isNaN(d.getTime()))return iso;return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch(e){return iso;}}

const tg=document.getElementById('toggles');
// The #toggles div already has role="group" aria-label="Show panels" in the HTML skeleton,
// covering AT users. Add a visible 'Panels:' text label so sighted users can also identify
// the checkbox group without relying on positional inference.
if(tg){const panelsLbl=document.createElement('span');panelsLbl.textContent='Panels:';panelsLbl.className='panels-label';tg.appendChild(panelsLbl);PANELS.forEach(([k,lbl])=>{const l=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.id='toggle-'+k;l.setAttribute('for','toggle-'+k);cb.checked=state.on[k]!==0;cb.addEventListener('change',()=>{state.on[k]=cb.checked?1:0;save();render();
  // Announce the panel visibility change to screen readers via the sr-only live region.
  // This confirms to keyboard/AT users that the panel appeared or disappeared.
  const srSt=document.getElementById('sr-status');if(srSt)srSt.textContent=lbl+' panel '+(cb.checked?'shown':'hidden');
});l.appendChild(cb);l.appendChild(document.createTextNode(' '+lbl));tg.appendChild(l);});}
var rb=document.getElementById('refreshBtn');if(rb)rb.addEventListener('click',()=>api.postMessage({type:'refresh'}));
var gb=document.getElementById('guideBtn');if(gb)gb.addEventListener('click',()=>api.postMessage({type:'guide'}));
var srb=document.getElementById('selectRunBtn');if(srb)srb.addEventListener('click',()=>api.postMessage({type:'selectRun'}));
var eb=document.getElementById('exportBtn');if(eb)eb.addEventListener('click',()=>api.postMessage({type:'export'}));
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
  // Prune stale keys to prevent openAgents/openFind/openPrompt from growing unboundedly
  // across workflow runs. Each run has new agent ids; old entries are dead weight.
  if(snap.ok){
    const agentIds=new Set(snap.agents.map(a=>a.id));
    state.openAgents=Object.fromEntries(Object.entries(state.openAgents).filter(([k])=>agentIds.has(k)));
    state.openPrompt=Object.fromEntries(Object.entries(state.openPrompt).filter(([k])=>agentIds.has(k)));
    // encodeURIComponent prevents key collisions when reviewer labels contain the '|' separator.
    // JSON.stringify produces an unambiguous key regardless of what any component contains.
    const findingIds=new Set(snap.allFindings.map(f=>JSON.stringify([f.reviewer,f.pass,f.location||'',f.title||''])));
    state.openFind=Object.fromEntries(Object.entries(state.openFind).filter(([k])=>findingIds.has(k)));
  }
  if(!snap.ok){
    root.innerHTML='<div class="empty-state" data-testid="empty-state"><h3>No Workflow run found</h3><div class="empty-msg" data-testid="empty-msg">'+esc(snap.msg)+'</div><p class="empty-hint">Start a <b>Claude Code Workflow()</b> run and the dashboard will update automatically. To change the search path, open <b>Settings &rarr; Claude Code Workflow Dashboard &rarr; Workflows Glob Base</b>.</p><div class="empty-actions"><button id="emptyRefresh">Refresh</button><button id="emptyGuide">Open Authoring Guide</button></div></div>';
    var er=document.getElementById('emptyRefresh');if(er)er.addEventListener('click',function(){api.postMessage({type:'refresh'});});
    var eg=document.getElementById('emptyGuide');if(eg)eg.addEventListener('click',function(){api.postMessage({type:'guide'});});
    return;
  }
  var metaEl=document.getElementById('meta');if(metaEl)metaEl.innerHTML=esc(snap.runId)+(snap.isPinned?'<span class="st done pinned-badge">pinned</span>':'')+' · updated '+esc(fmtUpdated(snap.updatedAt));
  const sy=window.scrollY;
  // AC3: Capture inner scroll positions for all scrollable sub-regions before innerHTML replace.
  // subPos keys: '<aid>:sub', '<aid>:prompt', 'result:<rlabel>'.
  // This prevents snapshot re-renders from resetting prompt-pre and result-body scroll.
  const subPos=Object.create(null);
  document.querySelectorAll('.card.open').forEach(function(c){
    var aid=c.dataset.aid;if(!aid)return;
    var sub=c.querySelector('.sub');if(sub&&sub.scrollTop)subPos[aid+':sub']=sub.scrollTop;
    var pre=c.querySelector('.prompt-pre');if(pre&&pre.scrollTop)subPos[aid+':prompt']=pre.scrollTop;
  });
  document.querySelectorAll('.finding.result[data-rlabel]').forEach(function(r){
    var rb=r.querySelector('.result-body');if(rb&&rb.scrollTop)subPos['result:'+r.dataset.rlabel]=rb.scrollTop;
  });
  // Capture focused element's identity before innerHTML replace destroys it.
  // Re-focus the matching element after wire() so keyboard users don't lose position.
  const focusEl=document.activeElement;
  const focusAid=focusEl?.closest('[data-aid]')?.dataset?.aid||null;
  const focusFid=focusEl?.closest('[data-fid]')?.dataset?.fid||null;
  const focusRev=focusEl?.closest('[data-rev]')?.dataset?.rev||null;
  const focusSev=focusEl?.closest('[data-sev]')?.dataset?.sev||null;
  const focusPaid=focusEl?.closest('[data-paid]')?.dataset?.paid||null;
  let h='';
  if(state.on.overview!==0)h+=overview();
  if(state.on.agents!==0)h+=agentsPanel();
  if(state.on.findings!==0)h+=findingsPanel();
  if(state.on.verdicts!==0&&Object.keys(snap.verdicts).length)h+=verdictsPanel();
  if(state.on.changed!==0&&snap.changed)h+=changedPanel();
  if(state.on.charts!==0&&snap.agents&&snap.agents.length)h+=chartsPanel();
  if(state.on.results!==0&&snap.structuredResults.length)h+=resultsPanel();
  root.innerHTML=h;wire();
  // Update the sr-only live region with a concise status summary. Placing the update
  // AFTER wire() ensures the DOM is settled before the announcement fires.
  // textContent assignment is injection-safe without esc() — the browser does not
  // parse HTML in text nodes. Using esc() here would cause screen readers to announce
  // literal HTML entities (e.g. '&amp;' instead of '&') for any special chars in L2.phase.
  if(snap&&snap.ok){var srSt=document.getElementById('sr-status');if(srSt){var L2=snap.loop;srSt.textContent=L2.phase+' — '+safeN(L2.live)+' live, '+safeN(L2.done)+' done, '+safeN(L2.findings)+' findings';}}
  // AC3: Restore inner scroll positions captured before innerHTML replace.
  // Note: scrollTop is silently clamped to [0, scrollHeight-clientHeight] by the browser.
  // If the new .sub content is shorter than before (e.g. fewer tail entries after transcript
  // trim), the restored scrollTop is silently clamped to the new maximum — this is correct
  // browser behaviour, not a bug. No special handling is needed here.
  document.querySelectorAll('.card.open').forEach(function(c){
    var aid=c.dataset.aid;if(!aid)return;
    var sub=c.querySelector('.sub');if(sub&&subPos[aid+':sub']!=null)sub.scrollTop=subPos[aid+':sub'];
    var pre=c.querySelector('.prompt-pre');if(pre&&subPos[aid+':prompt']!=null)pre.scrollTop=subPos[aid+':prompt'];
  });
  document.querySelectorAll('.finding.result[data-rlabel]').forEach(function(r){
    var rb=r.querySelector('.result-body');if(rb&&subPos['result:'+r.dataset.rlabel]!=null)rb.scrollTop=subPos['result:'+r.dataset.rlabel];
  });
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
  else if(focusPaid){
    // Before restoring focus to the prompt-disc-hdr, check if its containing card is collapsed
    // (no 'open' class). If collapsed, the .sub is display:none and the hdr is visually hidden —
    // restoring focus inside a display:none subtree traps keyboard users invisibly. Redirect to
    // the card's .row instead so focus stays on a visible, interactive element.
    const hdrEl=document.querySelector('.prompt-disc'+sel('data-paid',focusPaid)+' .prompt-disc-hdr');
    if(hdrEl){const cardEl=hdrEl.closest('.card');const rowEl=cardEl&&!cardEl.classList.contains('open')?cardEl.querySelector('.row'):null;if(rowEl)rowEl.focus({preventScroll:true});else hdrEl.focus({preventScroll:true});}
  }
}
// panel(k, t, b): renders a collapsible panel section.
// k = panel key (must match a key in state.panelOpen); t = display title; b = body HTML.
// Collapsed state persisted per key in state.panelOpen via api.setState().
// The h3 is a heading landmark for AT navigation (H-key in screen readers).
// A real <button> nested inside the h3 carries the interactive collapse role:
//   tabindex, aria-expanded, and data-pkey are on the <button>, NOT on the h3.
// wire() targets '.panel>h3>button[data-pkey]' — the h3 itself has no data-pkey.
// The .panel-chevron rotates via CSS when the 'collapsed' class is absent on .panel.
function panel(k,t,b){var isOpen=state.panelOpen[k]!==0;var collCls=isOpen?'':'collapsed';return '<div class="panel '+collCls+'"><h3><button tabindex="0" aria-expanded="'+(isOpen?'true':'false')+'" data-pkey="'+esc(k)+'"><span class="panel-chevron" aria-hidden="true">&#9658;</span>'+esc(t)+'</button></h3><div class="body">'+b+'</div></div>';}

// Keep in sync with fmtTok in src/export/markdown.ts (TypeScript version).
// True deduplication is blocked: this version runs in the webview DOM context.
function fmtTok(n){var v=safeN(n);return v<1000?v+'':v<1000000?(v/1000).toFixed(1)+'k':(v/1000000).toFixed(2)+'M';}
function overview(){
  const L=snap.loop;
  // safeN() guards L.sevTotals[s] — it arrives via postMessage so a crafted or
  // corrupted snapshot message could carry a non-numeric value (null, undefined,
  // or a string). safeN() ensures only a finite number reaches innerHTML.
  let sev='';for(const s in L.sevTotals){const es=esc(s);const ec=escCls(s);sev+='<span class="sev '+ec+'">'+es+' '+safeN(L.sevTotals[s])+'</span>';}
  // Optional token KPIs — only rendered when the field is present and not undefined.
  // safeN() guards against NaN/Infinity for any unexpected type coercions.
  // Optional token KPIs: use aria-describedby + sr-only text instead of title-only
  // so keyboard and AT users can discover the description (title= is not announced
  // by most screen readers on non-interactive elements, and is invisible on touch).
  // This matches the pattern used for the Stalled KPI above.
  var optTok='';
  if(L.inTok!=null)optTok+='<div class="kpi" aria-describedby="kpi-in-tok-desc"><div class="dim">In tokens</div><b>'+fmtTok(L.inTok)+'</b><span id="kpi-in-tok-desc" class="sr-only">Total input tokens read from context by this workflow run</span></div>';
  if(L.cacheRead!=null)optTok+='<div class="kpi" aria-describedby="kpi-cache-read-desc"><div class="dim">Cache read</div><b>'+fmtTok(L.cacheRead)+'</b><span id="kpi-cache-read-desc" class="sr-only">Input tokens served from the prompt cache (faster than uncached reads)</span></div>';
  if(L.cacheCreate!=null)optTok+='<div class="kpi" aria-describedby="kpi-cache-write-desc"><div class="dim">Cache write</div><b>'+fmtTok(L.cacheCreate)+'</b><span id="kpi-cache-write-desc" class="sr-only">Input tokens written to the prompt cache for reuse by later requests</span></div>';
  const body='<div class="kpis">'
    +(L.passes?'<div class="kpi"><div class="dim">Passes</div><b>'+safeN(L.passes)+'</b></div>':'')
    +'<div class="kpi"><div class="dim">Phase</div><b>'+esc(L.phase)+'</b></div>'
    // WCAG 1.4.1: green color alone is not sufficient to convey "agents running" state.
    // The sr-only span supplements with a text state label visible only to AT.
    +'<div class="kpi"><div class="dim">Live</div><b'+(L.live?' class="ok"':'')+'>'+safeN(L.live)+(L.live?'<span class="sr-only"> agents running</span>':'')+'</b></div>'
    +'<div class="kpi"><div class="dim">Done</div><b>'+safeN(L.done)+'</b></div>'
    // role="tooltip" is wrong here — a tooltip is a popup widget that appears on
    // hover/focus. This sr-only span is always in the DOM as a static description target
    // referenced by aria-describedby. No role attribute is needed; the aria-describedby
    // relationship alone causes screen readers to read the span as a description.
    // This matches the sidebar pattern which correctly omits role="tooltip".
    // Non-color indicator for stalled > 0: bold count (weight change is a shape signal
    // independent of color, satisfying WCAG 1.4.1 for red-green color-blind users).
    // The sub-label 'no activity >Xm' is also shown at full opacity when stalled > 0.
    +'<div class="kpi" aria-describedby="stalled-panel-desc"><div class="dim">Stalled</div><b'+(L.dead?' class="kpi-stalled-active"':'')+'>'+safeN(L.dead)+'</b><div class="'+(L.dead?'':'dim ')+'kpi-sublabel">no activity '+STALE_LABEL+'</div><span id="stalled-panel-desc" class="sr-only">'+esc(STALE_TOOLTIP)+'</span></div>'
    +'<div class="kpi"><div class="dim">Agents</div><b>'+safeN(L.total)+'</b></div>'
    +'<div class="kpi"><div class="dim">Out tokens</div><b data-testid="loop-out-tok">'+fmtTok(L.outTok)+'</b></div>'
    +'<div class="kpi"><div class="dim">Tool-calls</div><b data-testid="loop-tools">'+safeN(L.tools)+'</b></div>'
    +optTok
    +'<div class="kpi"><div class="dim">Findings</div><b>'+safeN(L.findings)+'</b></div>'
    +'</div>'+(sev?('<div class="overview-sev-row">'+sev+'</div>'):'');
  return panel('overview','Overview',body);
}

// ---------------------------------------------------------------------------
// M2-TypedResults: typed result renderers for structured agent output.
// Each known agentType gets a tailored view; unknown types fall back to a
// generic key-value table. NEVER a bare JSON dump. All values pass through
// esc() before injection. Theme-native: only --vscode-* CSS vars.
// ---------------------------------------------------------------------------

// Generic fallback: render a result object as a key/value table.
// Skips keys whose values are objects/arrays (rendered recursively as lists).
// Arrays of primitives are rendered as bullet lists; objects become nested tables.
// Handles all unknown agentType shapes gracefully.
function renderGenericResult(obj){
  if(!obj||typeof obj!=='object')return '<div class="dim">no data</div>';
  var keys=Object.keys(obj);
  if(!keys.length)return '<div class="dim">empty result</div>';
  var rows='';
  keys.forEach(function(k){
    var v=obj[k];
    var vStr='';
    if(v==null){vStr='<span class="dim">—</span>';}
    else if(typeof v==='boolean'){vStr=v?'<span class="typed-verdict-ok">yes</span>':'<span class="typed-verdict-bad">no</span>';}
    else if(typeof v==='number'){vStr=esc(String(v));}
    else if(typeof v==='string'){vStr=esc(v)||'<span class="dim">—</span>';}
    else if(Array.isArray(v)){
      if(!v.length){vStr='<span class="dim">none</span>';}
      else{vStr='<ul class="typed-file-list">'+v.slice(0,50).map(function(x){return '<li class="typed-gap">'+esc(typeof x==='object'?JSON.stringify(x):String(x==null?'':x))+'</li>';}).join('')+(v.length>50?'<li class="dim">…+'+(v.length-50)+' more</li>':'')+'</ul>';}
    }else if(typeof v==='object'){vStr='<span class="dim">[object]</span>';}
    rows+='<div class="typed-kv-key">'+esc(k)+'</div><div class="typed-kv-val">'+vStr+'</div>';
  });
  return '<div class="typed-result"><div class="typed-kv">'+rows+'</div></div>';
}

// implementer: filesChanged list + summary + fixed/testsRun counts
function renderImplementerResult(r){
  var out='<div class="typed-result">';
  var verdict=r.verdict||r.status||'';
  if(verdict){
    var isOk=/pass|ok|success|done|complet/i.test(String(verdict));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(String(verdict))+'</div>';
  }
  if(r.summary){out+='<div class="typed-summary">'+esc(String(r.summary))+'</div>';}
  var kv='';
  if(r.fixed!=null)kv+='<div class="typed-kv-key">fixed</div><div class="typed-kv-val">'+safeN(r.fixed)+' issues</div>';
  if(r.testsRun!=null)kv+='<div class="typed-kv-key">tests run</div><div class="typed-kv-val">'+(r.testsRun?'<span class="typed-verdict-ok">yes</span>':'<span class="typed-verdict-bad">no</span>')+'</div>';
  if(r.testsFixed!=null)kv+='<div class="typed-kv-key">tests fixed</div><div class="typed-kv-val">'+safeN(r.testsFixed)+' tests fixed</div>';
  if(kv)out+='<div class="typed-kv">'+kv+'</div>';
  var files=Array.isArray(r.filesChanged)?r.filesChanged:[];
  if(files.length){
    out+='<div class="typed-section-label">Files changed ('+files.length+')</div>';
    out+='<ul class="typed-file-list">'+files.slice(0,40).map(function(f){return '<li class="typed-file">'+esc(typeof f==='string'?f:String(f))+'</li>';}).join('')+(files.length>40?'<li class="dim">…+'+(files.length-40)+' more</li>':'')+'</ul>';
  }
  out+='</div>';
  return out;
}

// test-verifier: pass/fail + summary + coverage gaps
function renderVerifierResult(r){
  var out='<div class="typed-result">';
  var passed=r.passed;
  if(passed!=null){
    out+='<div class="'+(passed?'typed-verdict-ok':'typed-verdict-bad')+'">'+(passed?'PASSED':'FAILED')+'</div>';
  }else if(r.verdict){
    var isOk=/pass|ok|success/i.test(String(r.verdict));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(String(r.verdict))+'</div>';
  }
  if(r.summary){out+='<div class="typed-summary">'+esc(String(r.summary))+'</div>';}
  if(r.testsRun!=null){var kv='<div class="typed-kv-key">tests run</div><div class="typed-kv-val">'+safeN(r.testsRun)+'</div>';if(r.testsPassed!=null)kv+='<div class="typed-kv-key">passed</div><div class="typed-kv-val">'+safeN(r.testsPassed)+'</div>';if(r.testsFailed!=null)kv+='<div class="typed-kv-key">failed</div><div class="typed-kv-val">'+safeN(r.testsFailed)+'</div>';out+='<div class="typed-kv">'+kv+'</div>';}
  var gaps=Array.isArray(r.coverageGaps)?r.coverageGaps:(Array.isArray(r.gaps)?r.gaps:[]);
  if(gaps.length){
    out+='<div class="typed-section-label">Coverage gaps ('+gaps.length+')</div>';
    out+=gaps.slice(0,20).map(function(g){return '<div class="typed-gap">'+esc(typeof g==='string'?g:String(g))+'</div>';}).join('')+(gaps.length>20?'<div class="dim">…+'+(gaps.length-20)+' more</div>':'');
  }
  out+='</div>';
  return out;
}

// judge: verdict + score + rationale
function renderJudgeResult(r){
  var out='<div class="typed-result">';
  var verdict=r.verdict||r.decision||'';
  if(verdict){
    var isOk=/pass|approve|ok|yes|accept|allow/i.test(String(verdict));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(String(verdict))+'</div>';
  }
  if(r.score!=null){out+='<span class="typed-score">'+esc(String(r.score))+'</span>'+(r.maxScore!=null?' / '+esc(String(r.maxScore)):'');}
  if(r.rationale){out+='<div class="typed-summary">'+esc(String(r.rationale))+'</div>';}
  else if(r.summary){out+='<div class="typed-summary">'+esc(String(r.summary))+'</div>';}
  if(r.notes){out+='<div class="typed-section-label">Notes</div><div class="typed-gap">'+esc(String(r.notes))+'</div>';}
  out+='</div>';
  return out;
}

// completeness-critic: verdict + gaps list + summary
function renderCompletenessResult(r){
  var out='<div class="typed-result">';
  var verdict=r.verdict||r.status||'';
  if(verdict){
    // 'incomplete' must not match the 'complete' pattern — check for negative prefix.
    var s=String(verdict);
    var isOk=/pass|ok|done/i.test(s)||(/complete/i.test(s)&&!/incomplete/i.test(s));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(s)+'</div>';
  }
  if(r.summary){out+='<div class="typed-summary">'+esc(String(r.summary))+'</div>';}
  var gaps=Array.isArray(r.gaps)?r.gaps:(Array.isArray(r.coverageGaps)?r.coverageGaps:[]);
  if(gaps.length){
    out+='<div class="typed-section-label">Gaps ('+gaps.length+')</div>';
    out+=gaps.slice(0,30).map(function(g){return '<div class="typed-gap">'+esc(typeof g==='string'?g:String(g))+'</div>';}).join('')+(gaps.length>30?'<div class="dim">…+'+(gaps.length-30)+' more</div>':'');
  }else if(!verdict&&!r.summary){out+='<div class="dim">no gaps reported</div>';}
  out+='</div>';
  return out;
}

// Dispatch: select the right renderer based on agentType, fall back to generic.
function renderTypedResult(agentType,result){
  if(!result||typeof result!=='object')return '<div class="dim">no structured result</div>';
  var t=agentType||'';
  if(t==='implementer')return renderImplementerResult(result);
  if(t==='test-verifier')return renderVerifierResult(result);
  if(t==='judge')return renderJudgeResult(result);
  if(t==='completeness-critic')return renderCompletenessResult(result);
  // All other known + unknown types fall through to the generic key-value table.
  return renderGenericResult(result);
}

function agentSub(a){
  if(a.findings)return a.findings.map(f=>{var es=esc(f.severity||'UNRATED');var ec=escCls(f.severity||'UNRATED');return '<div class="ev"><span class="sev '+ec+'">'+es+'</span>'+esc(f.title||f.location||'(untitled)')+'</div>';}).join('')||'<div class="ev dim">no findings</div>';
  if(a.result)return renderTypedResult(a.agentType,a.result);
  // AC4: Try implementer markdown parser first; fall back to capped <pre> block.
  if(a.resultText){var parsed=parseImplementerMarkdown(a.resultText);if(parsed)return parsed;return '<pre>'+esc(a.resultText.slice(0,4000))+'</pre>';}
  return (a.tail||[]).slice(-30).map(t=>'<div class="ev '+(t.kind==='tool'?'tool':'')+'">'+esc(t.text)+'</div>').join('')||'<div class="ev dim">no output yet</div>';
}
function agentsPanel(){
  if(!snap.agents.length)return panel('agents','Agents','<div class="dim pad">No agents started yet — workflow is initialising…</div>');
  // M2-AgentFold: apply default open state when no persisted state exists for this agent.
  // run agents default to expanded; done/dead default to collapsed.
  // Persisted state (state.openAgents[id] === true/false) takes precedence over the default.
  snap.agents.forEach(function(a){
    if(state.openAgents[a.id]===undefined){
      state.openAgents[a.id]=a.status==='run';
    }
  });
  const capWarn=snap.agentsCapped?'<div class="cap-warn">Showing '+MAX_AGENTS+' most-recently-active agents — run may be larger.</div>':'';
  // M2-AgentFold: Collapse-all / Expand-all button.
  // Rendered when there are 2+ agents (one agent has no need for bulk collapse).
  // Initial label reflects current open state: 'Collapse all' when any card is open; 'Expand all' when all collapsed.
  var anyOpen=snap.agents.some(function(a){return !!state.openAgents[a.id];});
  // AC2: Hint lives beside the fold button (panel header bar), not inside the .cards grid,
  // so it doesn't consume a card-sized empty cell on first load.
  // id="cards-hint-text" is referenced by aria-describedby on the Collapse-all button
  // so AT users hear the hint when they focus the button (WCAG 2.5.3 + 1.3.1).
  var hint='<span class="dim cards-hint" id="cards-hint-text">Click or press Enter on a card to expand its output or findings.</span>';
  // No static aria-label: the visible text IS the accessible name, and it changes
  // between "Collapse all" and "Expand all". A static aria-label diverges from the
  // visible text (WCAG 2.5.3 Label in Name + 4.1.2 Name/Role/Value violation).
  // wire() updates aria-label in sync with textContent after each toggle.
  var collapseAllBtn=snap.agents.length>1
    ?'<div class="agent-panel-hdr"><button id="agentCollapseAllBtn" class="agent-fold-btn" data-testid="collapse-all-btn" title="Collapse or expand all agent cards" aria-describedby="cards-hint-text">'+(anyOpen?'Collapse all':'Expand all')+'</button>'+hint+'</div>'
    :'<div class="agent-panel-hdr">'+hint+'</div>';
  const cards=snap.agents.map(a=>{
    const open=state.openAgents[a.id]?'open':'';
    // escCls: whitespace-safe CSS class token (a.status is typed as 'run'|'done'|'dead' but
    // received as unvalidated JSON from postMessage — escCls closes the theoretical whitespace
    // injection gap consistently with how severity keys are handled).
    const es=escCls(a.status);
    // 'dead' is the internal status key (CSS class, TS type); user-facing label is 'stalled'
    // so the UI communicates that the agent stopped responding, not that it errored out.
    const statusLabel=a.status==='dead'?'stalled':a.status==='run'?'live':es;
    // Build agent metrics line: always show tool-calls + output tokens; add
    // optional input/cache tokens only when the field is present on this agent.
    // safeN() prevents NaN from reaching the UI for any unexpected type.
    // aria-hidden on separator dots: the middle dot (·) is purely visual decoration.
    // Some screen readers announce it as "middle dot" which is verbal noise between metric values.
    var metrics='<span class="agent-metric">'+safeN(a.tools)+' tool-calls</span>'
      +'<span class="agent-metric-sep" aria-hidden="true">·</span>'
      +'<span class="agent-metric">'+fmtTok(a.tokens)+' out</span>';
    if(a.inTok!=null)metrics+='<span class="agent-metric-sep" aria-hidden="true">·</span><span class="agent-metric">'+fmtTok(a.inTok)+' in</span>';
    if(a.cacheRead!=null)metrics+='<span class="agent-metric-sep" aria-hidden="true">·</span><span class="agent-metric">'+fmtTok(a.cacheRead)+' cached</span>';
    if(a.cacheCreate!=null)metrics+='<span class="agent-metric-sep" aria-hidden="true">·</span><span class="agent-metric">'+fmtTok(a.cacheCreate)+' written</span>';
    if(a.findings)metrics+='<span class="agent-metric-sep" aria-hidden="true">·</span><span class="agent-metric">'+safeN(a.findings.length)+' findings</span>';
    var promptDisc='';
    if(a.prompt){
      var pOpen=state.openPrompt[a.id]?'open':'';
      // Use a real <button> for the disclosure toggle so Enter/Space activation and
      // focus management are handled natively by the browser — no manual keyboard wiring needed.
      // A <div role="button"> requires the author to reproduce all button semantics manually;
      // a real <button> gets them for free and is more reliably supported by AT.
      var promptBodyId='pb-'+esc(a.id);
      promptDisc='<div class="prompt-disc '+pOpen+'" data-paid="'+esc(a.id)+'">'
        // aria-label includes the agent label so AT users hear "Expand prompt for <agent>"
        // rather than bare "Prompt, button" when multiple cards are expanded. This is the
        // same pattern as the prompt-copy-btn below which already uses "Copy prompt for…".
        // aria-controls points to the .prompt-disc-body element for WCAG 4.1.2 compliance.
        // wire() updates aria-label in sync with aria-expanded on each toggle_prompt() call.
        +'<button class="prompt-disc-hdr" aria-expanded="'+(pOpen?'true':'false')+'" aria-controls="'+promptBodyId+'" aria-label="'+(pOpen?'Collapse':'Expand')+' prompt for '+esc(a.label)+'"><span class="prompt-disc-chevron" aria-hidden="true">&#9658;</span>Prompt</button>'
        +'<div class="prompt-disc-body" id="'+promptBodyId+'"><pre class="prompt-pre">'+esc(a.prompt)+'</pre>'
        // aria-label includes the agent label so AT users operating multiple expanded cards
        // hear "Copy prompt for <agent>" rather than bare "Copy, button" without context.
        // esc() in an attribute value is correct: browsers decode HTML entities when computing
        // the ARIA accessible name, so &amp; → & and &lt; → < are announced correctly by AT.
        // Do NOT remove esc() here — raw a.label in the attribute would allow XSS if a crafted
        // agent label contained quote characters that break out of the attribute value.
        +'<button class="prompt-copy-btn" data-pcopied="'+esc(a.id)+'" aria-label="Copy prompt for '+esc(a.label)+'">Copy</button>'
        +'</div></div>';
    }
    // M2-AgentFold: .row contains a visible chevron (card-chevron) at the left edge.
    // The chevron rotates via CSS when the card has the 'open' class.
    // aria-expanded on .row reflects the open/closed state for screen readers.
    // cursor:pointer is already set on .row via CSS.
    // sub-id is a stable CSS id derived from the agent id for aria-controls.
    // aria-controls on the .row button points to the .sub element so AT can locate
    // the controlled content (WCAG 4.1.2 Name/Role/Value for expand/collapse pattern).
    var subId='sub-'+esc(a.id);
    return '<div class="card '+es+' '+open+'" data-aid="'+esc(a.id)+'">'
      +'<div class="row" tabindex="0" role="button" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+subId+'"><span class="card-chevron" aria-hidden="true">&#9658;</span><span class="role">'+esc(a.label)+'</span><span class="st '+es+'">'+statusLabel+'</span><span class="grow"></span><span class="dim">'+fmtTHtml(a.elapsed)+'</span></div>'
      +'<div class="agent-metrics" role="group" aria-label="Agent metrics">'+metrics+'</div>'
      // aria-hidden on the ↳ arrow: it is decorative (indicates sub-item/continuation).
      // Some screen readers (JAWS, NVDA) announce it as "downwards arrow with tip rightwards"
      // which is noise before the actual activity text.
      +(a.status==='run'?'<div class="activity"><span aria-hidden="true">↳ </span>'+esc(a.lastActivity)+'</div>':'')
      +promptDisc
      +'<div class="sub" id="'+subId+'">'+agentSub(a)+'</div></div>';
  }).join('');
  return panel('agents','Agents',capWarn+collapseAllBtn+'<div class="cards">'+cards+'</div>');
}

function findingsPanel(){
  if(!snap.allFindings.length){
    // Context-aware empty state: distinguish "reviewers ran and found nothing" (clean pass)
    // from "no reviewers have run yet" (waiting) so users understand the significance.
    var emptyMsg=snap.loop.passes>0
      ?'No findings from reviewers in pass '+safeN(snap.loop.passes)+' — run is clean.'
      :'No findings recorded yet.';
    return panel('findings','Findings','<div class="dim pad">'+esc(emptyMsg)+'</div>');
  }
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
  // Visible group dimension labels ("Reviewer", "Severity") are prepended inside each
  // role="group" div so sighted users can identify what each chip group filters.
  // The aria-label on the group div conveys the same to AT users.
  let chips='<div class="filters"><div role="group" aria-label="Filter by reviewer"><span class="filter-group-label">Reviewer</span>';
  // data-rev and the visible text are both esc()'d to prevent attribute/HTML injection from a
  // transcript-derived label. The escaped value round-trips: the browser decodes entities on
  // parse, so el.dataset.rev returns the raw label — state-key lookups still match.
  snap.labels.forEach(l=>chips+='<span class="chip rev '+(state.fRev[l]?'':'off')+'" data-rev="'+esc(l)+'" tabindex="0" role="button" aria-pressed="'+(state.fRev[l]?'true':'false')+'">'+esc(l)+'</span>');
  chips+='</div><div role="group" aria-label="Filter by severity" class="filter-sep"><span class="filter-group-label">Severity</span>';
  // data-sev and the visible text are both esc()'d (XSS-safe). The escaped value round-trips:
  // the browser decodes entities on parse, so el.dataset.sev returns the raw key — state-key
  // lookups still match. For normal enum severities esc() is a no-op, so behaviour is unchanged.
  sevs.forEach(s=>{var es=esc(s);chips+='<span class="chip fsev '+(state.fSev[s]?'':'off')+'" data-sev="'+es+'" tabindex="0" role="button" aria-pressed="'+(state.fSev[s]?'true':'false')+'">'+es+'</span>';});
  // Clear filters button: rendered in the filter bar (not in the empty-result branch) so it is
  // visible whenever any filter is off, regardless of whether the result list is empty or not.
  // Wired via addEventListener in wire() — inline handlers are blocked by nonce-based CSP.
  chips+='</div>'+(anyOff?'<button id="clearFiltersBtn" class="clear-btn">Clear filters</button>':'')+'</div>';
  // f.reviewer||'' guards the rare case where a finding has an empty reviewer string.
  // snap.labels initialises state.fRev[''] = 1 when such findings exist, so the filter
  // passes correctly. The explicit fallback makes the intent visible and prevents future drift.
  const list=snap.allFindings.filter(f=>state.fRev[f.reviewer||'']&&state.fSev[f.severity||'UNRATED']);
  // Object.create(null): no prototype chain, so pass values equal to '__proto__' or
  // 'constructor' cannot pollute Object.prototype — consistent with openAgents/fRev/fSev.
  const byP=Object.create(null);list.forEach(f=>{(byP[f.pass]=byP[f.pass]||[]).push(f);});
  let body=chips;
  Object.keys(byP).sort((a,b)=>(Number(b)||0)-(Number(a)||0)).forEach(p=>{
    const fc=byP[p].length;body+='<h4 class="pass-heading">Pass '+esc(p)+' · '+fc+' finding'+(fc!==1?'s':'')+'</h4>';
    body+=byP[p].map(f=>{
      // JSON.stringify gives an unambiguous collapse-state key even when reviewer, pass,
      // or location contains the '|' separator character that the old concat key used.
      // Title is included to reduce collisions when two findings from the same reviewer/pass
      // share the same location (e.g. two distinct findings both at 'src/foo.ts:42').
      const id=JSON.stringify([f.reviewer,p,f.location||'',f.title||'']);
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
    body+='<div class="findings-empty"><div class="findings-empty-msg">No findings match the active filters.'+why+'</div><button class="findings-empty-btn" id="emptyFiltersBtn">Clear filters</button></div>';
  }
  return panel('findings','Findings',body);
}

// AC4: Render collapsed raw-JSON below the analyzed view so power users can inspect
// the full structure without it dominating the card. Uses native <details>/<summary>
// which are collapsible without JS and CSP-safe (no inline handlers needed).
// JSON.stringify is intentionally used here — this IS the raw JSON view.
// The pre content is passed through esc() to prevent injection from adversarial JSON values.
function rawJsonDetails(obj){
  if(!obj||typeof obj!=='object')return '';
  var json='';try{json=JSON.stringify(obj,null,2);}catch(e){json='[unserializable]';}
  return '<details class="raw-json-details"><summary class="raw-json-summary">Raw JSON</summary><div class="raw-json-body"><pre class="raw-json-pre">'+esc(json)+'</pre></div></details>';
}

// AC4: Parse an implementer markdown report (## Implementation…) into a structured view.
// Sections: Status, What Was Built, Files Changed (markdown table), Decisions, Test Results.
// NEVER throws — all errors caught; returns null for caller to fall back to <pre>.
// Regex notes: this function body lives inside a TypeScript template literal.
//   - RegExp literals need doubled backslashes (\\\\s → \\s in output → regex \s).
//   - Avoid end-of-string anchors in patterns (constraint: no special chars in shipped HTML).
//     Use string indexOf/slice to delimit sections instead.
function parseImplementerMarkdown(text){
  if(!text||typeof text!=='string')return null;
  try{
    // Quick check: require at least one implementation-related heading.
    if(text.indexOf('## Implementation')===-1&&text.indexOf('### What Was Built')===-1&&text.indexOf('### Status')===-1)return null;
    var out='<div class="impl-report">';
    // Helper: extract content between a heading line and the next ### or ## heading.
    function extractSection(heading){
      var idx=text.indexOf(heading);
      if(idx===-1)return '';
      var afterHeading=text.indexOf('\\n',idx);
      if(afterHeading===-1)return '';
      var rest=text.slice(afterHeading+1);
      // Find the next heading at the same or higher level.
      // Double-backslash escaping: this code lives inside a TypeScript template literal.
      // '\\n' in the TS source becomes '\\n' in the output JS string, which RegExp then
      // interprets as a literal newline character. Any future edit to this RegExp must
      // account for this double-escaping: one level for the TS template literal, one for
      // the JS RegExp constructor. A typo producing an invalid pattern throws at runtime.
      var nextH=rest.search(new RegExp('\\n##'));
      if(nextH===-1)return rest;
      return rest.slice(0,nextH);
    }
    // Status section
    var stBody=extractSection('### Status');
    if(stBody){
      var stLine=stBody.trim().split('\\n')[0].trim();
      if(stLine){
        var isOk=/COMPLETE|DONE|PASS|SUCCESS/i.test(stLine);
        var isBad=/BLOCKED|FAIL|ERROR/i.test(stLine);
        var cls=isOk?'typed-verdict-ok':isBad?'typed-verdict-bad':'';
        out+='<div class="impl-status'+(cls?' '+cls:'')+'">'+esc(stLine)+'</div>';
      }
    }
    // What Was Built section
    var builtBody=extractSection('### What Was Built');
    if(builtBody){
      var builtText=builtBody.trim();
      if(builtText){out+='<div class="typed-section-label">What was built</div><div class="typed-summary">'+esc(builtText.slice(0,600))+'</div>';}
    }
    // Files Changed section — parse markdown table rows.
    var filesBody=extractSection('### Files Changed');
    if(filesBody){
      var tableRows=filesBody.split('\\n').filter(function(l){
        var t=l.trim();
        // Keep rows that look like table data (start and end with |).
        // Reject separator rows that contain only pipes, dashes, spaces, colons.
        if(t.length<2||t.charAt(0)!=='|'||t.charAt(t.length-1)!=='|')return false;
        var inner=t.slice(1,t.length-1);
        return inner.replace(/[|\\s\\-:]/g,'').length>0;
      });
      // First matched row is the header row; remaining are data.
      var dataRows=tableRows.slice(1);
      if(dataRows.length){
        out+='<div class="typed-section-label">Files changed ('+dataRows.length+')</div>';
        out+='<ul class="typed-file-list">';
        dataRows.slice(0,40).forEach(function(row){
          var cols=row.split('|').filter(function(c){return c.trim().length>0;});
          if(cols.length>=1){out+='<li class="typed-file">'+esc(cols[0].trim())+(cols.length>=2?' <span class="dim">'+esc(cols[1].trim())+'</span>':'')+'</li>';}
        });
        if(dataRows.length>40)out+='<li class="dim">…+'+(dataRows.length-40)+' more</li>';
        out+='</ul>';
      }
    }
    // Decisions section
    var dBody=extractSection('### Decisions Made');
    if(!dBody)dBody=extractSection('### Decisions');
    if(dBody){
      var dText=dBody.trim();
      if(dText){out+='<div class="typed-section-label">Decisions</div><div class="typed-summary">'+esc(dText.slice(0,400))+'</div>';}
    }
    // Test Results section
    var tBody=extractSection('### Test Results');
    if(tBody){
      var tText=tBody.trim();
      if(tText){
        var tOk=/passed|green|ok/i.test(tText);
        var tBad=/fail|error|broken/i.test(tText);
        out+='<div class="typed-section-label">Test results</div><div class="typed-summary'+(tOk?' typed-verdict-ok':tBad?' typed-verdict-bad':'')+'">'+esc(tText.slice(0,300))+'</div>';
      }
    }
    out+='</div>';
    return out;
  }catch(e){return null;}
}

function resultsPanel(){
  // Results are not collapsible — no interactive ARIA. Each result uses the typed
  // renderer for its agentType; unknown types fall back to the generic key-value
  // table. NEVER a bare JSON dump. Scrollable container prevents page overflow.
  // data-rlabel carries a stable key for scroll-position preservation across re-renders (AC3).
  // AC4: raw JSON is collapsed below the analyzed view via <details> (no JS needed).
  const body=snap.structuredResults.map(r=>'<div class="finding result" data-rlabel="'+esc(r.label+':'+r.pass)+'"><div class="ttl"><b>'+esc(r.label)+'</b> <span class="dim">pass '+esc(r.pass)+'</span></div><div class="result-body">'+renderTypedResult(r.agentType,r.result)+rawJsonDetails(r.result)+'</div></div>').join('');
  return panel('results','Results',body);
}
function verdictsPanel(){
  // Preserve insertion order (journal order) — Object.keys() on modern JS maintains
  // insertion order for string keys, which matches the pass order reviewers appeared.
  const body=Object.keys(snap.verdicts).map(l=>{
    const displayLabel=snap.verdictLabels&&snap.verdictLabels[l]?snap.verdictLabels[l]:l;
    var vText=snap.verdicts[l]||'(pending)';
    // Apply semantic color to match the typed-verdict pattern in resultsPanel/agentSub.
    // APPROVED/PASS → .ok (green); NEEDS_WORK/FAIL/REJECT → .bad (red); else neutral .dim.
    var vCls=/APPROVED|PASS/i.test(vText)?'ok':/NEEDS_WORK|FAIL|REJECT/i.test(vText)?'bad':'dim';
    return '<div class="verdict-item"><b>'+esc(displayLabel)+'</b> <span class="'+vCls+'">'+esc(vText)+'</span></div>';
  }).join('');
  return panel('verdicts','Verdicts',body);
}
function changedPanel(){
  const f=snap.changed||[];
  return panel('changed','Changed files','<div class="dim changed-caption">Files modified in the last '+CHANGED_MAX_MIN+' min</div>'+(f.length?'<ul class="files">'+f.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'<div class="dim">No files changed in the last '+CHANGED_MAX_MIN+' min — changes appear here automatically</div>'));
}

// ---------------------------------------------------------------------------
// M2-Charts: two dependency-free inline-SVG charts.
// tokenBarChart: per-agent output-token horizontal bar chart (capped at 50 visible
//   bars; wide content scrolls inside its container — page body never overflows).
// tokenTrendChart: cumulative output-tokens-over-agent-order sparkline (proxy for
//   phases/time).
// Both charts: esc() all transcript-derived labels, safeN() all numeric values,
// --vscode-charts-* CSS variables with hex fallbacks, zero external refs.
// ---------------------------------------------------------------------------
function tokenBarChart(){
  // Cap at 50 agents for readability; rest are summarised in a note.
  var BAR_CAP=50;
  var agents=snap.agents.slice(0,BAR_CAP);
  var n=agents.length;
  if(!n)return '<div class="chart-empty">No agents</div>';
  var maxTok=0;
  for(var i=0;i<n;i++){var t=safeN(agents[i].tokens);if(t>maxTok)maxTok=t;}
  // Dimensions
  var BAR_H=16;var GAP=4;var LABEL_W=90;var BAR_AREA=160;var VAL_W=52;
  var svgW=LABEL_W+BAR_AREA+VAL_W;
  var svgH=n*(BAR_H+GAP)+GAP;
  var capped=snap.agents.length>BAR_CAP;
  var rows='';
  for(var j=0;j<n;j++){
    var a=agents[j];
    var tok=safeN(a.tokens);
    var barW=maxTok>0?Math.max(2,Math.round(tok/maxTok*BAR_AREA)):0;
    var y=GAP+j*(BAR_H+GAP);
    // Label: truncate the raw label BEFORE escaping so HTML entities are never
    // sliced mid-character (e.g. &quot; sliced to &quot becomes a dangling &).
    // The full escaped label is used in <title> for the tooltip.
    var rawLabel=a.label||'agent';
    var truncLabel=rawLabel.slice(0,14)+(rawLabel.length>14?'…':'');
    var lbl=esc(rawLabel);
    var lblTrunc=esc(truncLabel);
    // aria-hidden on <g>: the SVG root carries role="img" with aria-label that is the
    // sole AT description. JAWS in virtual-cursor mode enters SVG DOMs despite role="img"
    // and reads child text/title elements, creating a jumbled announcement. aria-hidden
    // on each <g> suppresses this. The inner <title> in <text> is also removed: it is
    // only effective as a tooltip on <rect>/<g> shapes, not <text> elements, and is dead
    // weight now that the group is aria-hidden.
    rows+='<g aria-hidden="true">'
      // Agent label — right-aligned in the label column, clipped.
      // CSS class .chart-bar-label handles fill via --vscode-* variable (no inline style).
      +'<text x="'+(LABEL_W-4)+'" y="'+(y+BAR_H-4)+'" text-anchor="end" font-size="10" class="chart-bar-label" font-family="var(--vscode-font-family,sans-serif)">'
      +lblTrunc
      +'</text>'
      // Bar rect — fill via CSS class .chart-bar (defined in forced-colors block + VS Code theming).
      +(barW>0?'<rect x="'+LABEL_W+'" y="'+y+'" width="'+barW+'" height="'+BAR_H+'" rx="2" class="chart-bar" data-testid="chart-bar"/>':'')
      // Value label — CSS class .chart-val-label handles fill + opacity.
      +'<text x="'+(LABEL_W+barW+4)+'" y="'+(y+BAR_H-4)+'" font-size="10" class="chart-val-label" font-family="var(--vscode-font-family,sans-serif)">'+fmtTok(tok)+'</text>'
      +'</g>';
  }
  var cappedNote=capped?'<div class="dim chart-cap-note">Showing '+BAR_CAP+' of '+safeN(snap.agents.length)+' agents</div>':'';
  return '<div class="chart-scroll" data-testid="bar-chart-scroll">'
    +'<svg xmlns="http://www.w3.org/2000/svg" width="'+svgW+'" height="'+svgH+'" overflow="visible" role="img" aria-label="Per-agent output tokens bar chart" data-testid="token-bar-chart">'
    +rows
    +'</svg></div>'+cappedNote;
}

function tokenTrendChart(){
  var agents=snap.agents;
  var n=agents.length;
  if(!n)return '<div class="chart-empty">No agents</div>';
  // Clamp to 200 points for performance (agent list is already capped at MAX_AGENTS=200)
  // Compute cumulative output tokens by agent start order.
  var W=Math.max(200,Math.min(n*14,480));
  var H=72;
  var PAD=6;
  var cumulative=[];
  var cum=0;
  for(var i=0;i<n;i++){cum+=safeN(agents[i].tokens);cumulative.push(cum);}
  var maxCum=cum;
  if(maxCum===0)return '<div class="chart-empty">No token data</div>';
  // Single-agent case: render a horizontal line at the token level rather than
  // a degenerate zero-width path (which renders as an invisible dot).
  if(n===1){
    var sy=H-PAD-Math.round((H-2*PAD));// y at full height
    var pts1='M'+PAD+' '+sy+' L'+(W-PAD)+' '+sy+' ';
    var areaPath1=pts1+'L'+(W-PAD)+' '+(H-PAD)+' L'+PAD+' '+(H-PAD)+' Z';
    return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" role="img" aria-label="Cumulative output tokens trend" data-testid="token-trend-chart">'
      // CSS classes replace inline style attrs so forced-colors @media overrides work correctly.
      +'<line x1="'+PAD+'" y1="'+(H-PAD)+'" x2="'+(W-PAD)+'" y2="'+(H-PAD)+'" class="chart-axis-line" stroke-width="1"/>'
      +'<path d="'+areaPath1+'" class="chart-trend-area" data-testid="trend-area"/>'
      +'<path d="'+pts1+'" class="chart-trend-line" fill="none" stroke-width="1.5" data-testid="trend-line"/>'
      +'<text x="'+(W-PAD)+'" y="'+(PAD+8)+'" text-anchor="end" font-size="9" class="chart-trend-label" font-family="var(--vscode-font-family,sans-serif)">'+fmtTok(maxCum)+'</text>'
      +'</svg>';
  }
  // Build polyline points
  var pts='';
  for(var j=0;j<n;j++){
    var x=PAD+Math.round(j/(n-1)*(W-2*PAD));
    var y=H-PAD-Math.round(cumulative[j]/maxCum*(H-2*PAD));
    pts+=(j?'L':'M')+x+' '+y+' ';
  }
  // Area fill path: close below the polyline for a subtle fill
  var x0=PAD;
  var xN=W-PAD;
  var areaPath=pts+'L'+xN+' '+(H-PAD)+' L'+x0+' '+(H-PAD)+' Z';
  // CSS classes replace all inline style attrs on SVG elements so the forced-colors
  // @media block can override them correctly (inline styles have higher specificity
  // in normal mode, but forced-colors UA stylesheet overrides them regardless).
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" role="img" aria-label="Cumulative output tokens trend" data-testid="token-trend-chart">'
    // X axis
    +'<line x1="'+PAD+'" y1="'+(H-PAD)+'" x2="'+(W-PAD)+'" y2="'+(H-PAD)+'" class="chart-axis-line" stroke-width="1"/>'
    // Area fill (transparent tint)
    +'<path d="'+areaPath+'" class="chart-trend-area" data-testid="trend-area"/>'
    // Line
    +'<path d="'+pts+'" class="chart-trend-line" fill="none" stroke-width="1.5" data-testid="trend-line"/>'
    // Max label
    +'<text x="'+(W-PAD)+'" y="'+(PAD+8)+'" text-anchor="end" font-size="9" class="chart-trend-label" font-family="var(--vscode-font-family,sans-serif)">'+fmtTok(maxCum)+'</text>'
    +'</svg>';
}

function chartsPanel(){
  var bar=tokenBarChart();
  var trend=tokenTrendChart();
  // Scroll-wrapper ownership is intentionally asymmetric:
  // tokenBarChart() returns its own <div class="chart-scroll"> (so the capped-note sits outside it),
  // while tokenTrendChart() returns a bare <svg> (wrapped here). Do not "fix" this asymmetry
  // without also moving the cappedNote construction inside tokenBarChart().
  var body='<div class="charts-row">'
    +'<div class="chart-block"><div class="chart-title">Output tokens per agent</div>'+bar+'</div>'
    +'<div class="chart-block"><div class="chart-title">Cumulative tokens</div><div class="chart-scroll" data-testid="trend-chart-scroll">'+trend+'</div></div>'
    +'</div>';
  return panel('charts','Charts',body);
}
`;
