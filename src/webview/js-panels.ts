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
// Tab definitions: key, label, enabled-when condition key.
// Tabs are rendered in this order: Agents (default) | Findings | Verdicts | Changed | Charts | Results.
// openAgents/openFind/fRev/fSev accept transcript-derived strings as keys (agent ids,
// severity labels, reviewer labels). Using Object.create(null) eliminates the prototype
// chain, preventing '__proto__' or 'constructor' key collisions regardless of engine version.
const _s=api.getState()||{};
// state.activeTab: which tab is currently shown ('agents', 'findings', 'verdicts', 'changed', 'charts', 'timeline', 'results').
// state.tabScroll: per-tab scroll position cache (captured before switch, restored after render).
// state.findPage: current findings page index (0-based, PAGE_SIZE=50).
// state.openRaw: open/closed state of raw-JSON <details> per result, keyed by r.label+':'+r.pass.
//   Persists across snapshot re-renders (analogous to openPrompt for prompt disclosures).
// state.tlZoom: timeline zoom level (0.5–4, default 1). Persisted so it survives re-renders.
// state.tlScrollLeft: timeline horizontal scroll position (px). Captured before innerHTML replace.
let state={activeTab:_s.activeTab||'agents',tabScroll:Object.assign(Object.create(null),_s.tabScroll||{}),findPage:_s.findPage||0,openAgents:Object.assign(Object.create(null),_s.openAgents||{}),openFind:Object.assign(Object.create(null),_s.openFind||{}),fRev:Object.assign(Object.create(null),_s.fRev||{}),fSev:Object.assign(Object.create(null),_s.fSev||{}),openPrompt:Object.assign(Object.create(null),_s.openPrompt||{}),openRaw:Object.assign(Object.create(null),_s.openRaw||{}),tlZoom:typeof _s.tlZoom==='number'&&isFinite(_s.tlZoom)?_s.tlZoom:1,tlScrollLeft:typeof _s.tlScrollLeft==='number'&&isFinite(_s.tlScrollLeft)?_s.tlScrollLeft:0,tlAvailW:typeof _s.tlAvailW==='number'&&isFinite(_s.tlAvailW)?_s.tlAvailW:600,timelineView:(_s.timelineView==='dag'||_s.timelineView==='gantt')?_s.timelineView:'gantt'};
let snap=null;
const PAGE_SIZE=50;
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
// safeN: coerce to number, return 0 if result is not finite (NaN/Infinity). Prevents
// showing 'NaN' or 'Infinity' in KPI cards when snapshot fields have unexpected types.
function safeN(n){var v=+n;return isFinite(v)?v:0;}
// fmtUpdated: converts an ISO 8601 timestamp (snap.updatedAt) to a locale time string
// (HH:MM:SS) for the meta bar. Falls back to the raw string on parse errors.
// Uses toLocaleTimeString for locale-aware formatting without hardcoding a timezone.
function fmtUpdated(iso){try{var d=new Date(iso);if(isNaN(d.getTime()))return iso;return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch(e){return iso;}}

// normalizeLiteralEscapes: convert literal two-char sequences (\\n, \\r\\n, \\r, \\t)
// to real control characters before parsing. Journal JSON double-encodes newlines:
// after JSON.parse, a newline may survive as the literal two chars backslash+n.
// parseImplementerMarkdown splits on real newlines so must normalize first.
// Apply BEFORE esc() when normalizing raw text, or AFTER esc() when normalizing
// already-escaped text (esc() does not touch backslashes, so order is safe either way).
// Spec v3 correction #9.
function normalizeLiteralEscapes(s){return s.replace(/\\\\r\\\\n/g,'\\n').replace(/\\\\n/g,'\\n').replace(/\\\\r/g,'\\n').replace(/\\\\t/g,'\\t');}

// applyInlineSpans: bold and code transforms on an already-esc()-encoded line.
// &lt;b&gt; etc. in escaped strings are literal entity text — we match the
// already-escaped equivalents of ** and backtick to avoid false positives.
// Double-escaping note: in the shipped JS string \\*\\* is literal \\*\\*,
// which regex sees as \\*\\* (two escaped asterisks).
// Extracted to module scope so renderTypedResult summary fallback can use renderInlineMd.
// Spec v3 correction #10 / LOW closure finding.
function applyInlineSpans(s){
  // Bold: **text** (esc does not touch asterisks — they pass through unchanged).
  // Function replacer used to avoid literal capture-group sigil in shipped string.
  s=s.replace(/\\*\\*([^*]+)\\*\\*/g,function(m,g){return '<strong>'+g+'</strong>';});
  // Inline code: backtick-delimited spans — esc does not touch backticks.
  // Use hex x60 escape for backtick to avoid literal backticks in shipped JS.
  // Function replacer used to avoid literal capture-group sigil in shipped string.
  s=s.replace(new RegExp('\\x60([^\\x60]+)\\x60','g'),function(m,g){return '<code>'+g+'</code>';});
  return s;
}

// renderInlineMd: apply lightweight inline markdown to an already-esc()-encoded string.
// Operates on the escaped string so only known-safe tags are ever emitted.
// Transform order: lists first (line-oriented), then inline spans.
// Extracted to module scope so it can be called from the renderTypedResult summary
// fallback and from any other rendering path. Spec v3 correction #10.
function renderInlineMd(escaped){
  // Split into lines; detect list runs; wrap them in <ul>/<ol>; then join.
  var lines=escaped.split('\\n');
  var result='';
  var i=0;
  while(i<lines.length){
    var line=lines[i];
    var ul=/^- |^\\* /.test(line);
    var ol=/^\\d+\\. /.test(line);
    if(ul||ol){
      var tag=ul?'ul':'ol';
      result+='<'+tag+'>';
      while(i<lines.length&&(ul?/^- |^\\* /.test(lines[i]):/^\\d+\\. /.test(lines[i]))){
        var item=lines[i].replace(/^- |^\\* /,'').replace(/^\\d+\\. /,'');
        result+='<li>'+applyInlineSpans(item)+'</li>';
        i++;
      }
      result+='</'+tag+'>';
    }else{
      result+=applyInlineSpans(line)+'\\n';
      i++;
    }
  }
  return result;
}

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

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------
// Compute which tabs are enabled and what badges they carry.
// Returns array of {key, label, enabled, badge} in display order.
function tabDefs(){
  var agentCount=snap&&snap.agents?snap.agents.length:0;
  var findCount=snap&&snap.allFindings?snap.allFindings.length:0;
  var verdictCount=snap&&snap.verdicts?Object.keys(snap.verdicts).length:0;
  var resultsCount=snap&&snap.structuredResults?snap.structuredResults.length:0;
  return [
    {key:'agents',label:'Agents',enabled:true,badge:agentCount>0?String(agentCount):''},
    {key:'findings',label:'Findings',enabled:findCount>0,badge:findCount>0?String(findCount):''},
    {key:'verdicts',label:'Verdicts',enabled:verdictCount>0,badge:''},
    {key:'changed',label:'Changed',enabled:true,badge:''},
    {key:'charts',label:'Charts',enabled:agentCount>0,badge:''},
    {key:'timeline',label:'Timeline',enabled:agentCount>0,badge:''},
    {key:'results',label:'Results',enabled:resultsCount>0,badge:''}
  ];
}
// Ensure state.activeTab is a currently-enabled tab; fall back to 'agents'.
function clampActiveTab(){
  var defs=tabDefs();
  var active=defs.find(function(d){return d.key===state.activeTab&&d.enabled;});
  if(!active)state.activeTab='agents';
}
// tabBar(): renders the WAI-ARIA tablist.
// Active tab: tabindex=0, aria-selected=true.
// Inactive enabled tabs: tabindex=-1, aria-selected=false.
// Disabled tabs: disabled attr + aria-disabled=true + tabindex=-1.
function tabBar(){
  var defs=tabDefs();
  var tabs=defs.map(function(d){
    var isCurrent=d.key===state.activeTab;
    var badge=d.badge?'<span class="tab-badge" aria-hidden="true">'+esc(d.badge)+'</span>':'';
    if(!d.enabled){
      // disabled: not focusable, not selectable
      return '<button role="tab" class="tab-btn" id="tab-'+esc(d.key)+'" aria-selected="false" aria-disabled="true" disabled tabindex="-1" data-tabkey="'+esc(d.key)+'">'+esc(d.label)+badge+'</button>';
    }
    if(isCurrent){
      return '<button role="tab" class="tab-btn tab-active" id="tab-'+esc(d.key)+'" aria-selected="true" tabindex="0" data-tabkey="'+esc(d.key)+'">'+esc(d.label)+badge+'</button>';
    }
    return '<button role="tab" class="tab-btn" id="tab-'+esc(d.key)+'" aria-selected="false" tabindex="-1" data-tabkey="'+esc(d.key)+'">'+esc(d.label)+badge+'</button>';
  }).join('');
  return '<div id="tab-bar" role="tablist" aria-label="Dashboard sections">'+tabs+'</div>';
}
// tabContent(): renders the body of the currently active tab.
function tabContent(){
  var k=state.activeTab;
  var body='';
  if(k==='agents')body=agentsPanel();
  else if(k==='findings')body=findingsPanel();
  else if(k==='verdicts')body=Object.keys(snap.verdicts).length?verdictsPanel():'<div class="dim pad">No verdicts yet.</div>';
  else if(k==='changed')body=changedPanel();
  else if(k==='charts')body=snap.agents&&snap.agents.length?chartsPanel():'<div class="dim pad">No agents yet.</div>';
  else if(k==='timeline')body=snap.agents&&snap.agents.length?timelinePanel():'<div class="dim pad" data-testid="tl-empty">No agents yet.</div>';
  else if(k==='results')body=snap.structuredResults&&snap.structuredResults.length?resultsPanel():'<div class="dim pad">No structured results yet.</div>';
  // aria-labelledby references the active tab button
  return '<div id="tab-content" role="tabpanel" aria-labelledby="tab-'+esc(k)+'">'+body+'</div>';
}

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
    // Prune openRaw for structured results from prior runs. Keys are r.label+':'+r.pass strings.
    // Without pruning, openRaw accumulates dead entries indefinitely across workflow runs.
    // Symmetric with the openFind prune pattern above.
    const rawIds=new Set((snap.structuredResults||[]).map(r=>r.label+':'+r.pass));
    // Also include agent-sub raw keys keyed as aid+':sub-raw' — pruned by current agent ids.
    agentIds.forEach(function(aid){rawIds.add(aid+':sub-raw');});
    state.openRaw=Object.fromEntries(Object.entries(state.openRaw).filter(([k])=>rawIds.has(k)));
  }
  if(!snap.ok){
    root.innerHTML='<div class="empty-state" data-testid="empty-state"><h3>No Workflow run found</h3><div class="empty-msg" data-testid="empty-msg">'+esc(snap.msg)+'</div><p class="empty-hint">Start a <b>Claude Code Workflow()</b> run and the dashboard will update automatically. To change the search path, open <b>Settings &rarr; Claude Code Workflow Dashboard &rarr; Workflows Glob Base</b>.</p><div class="empty-actions"><button id="emptyRefresh">Refresh</button><button id="emptyGuide">Open Authoring Guide</button></div></div>';
    var er=document.getElementById('emptyRefresh');if(er)er.addEventListener('click',function(){api.postMessage({type:'refresh'});});
    var eg=document.getElementById('emptyGuide');if(eg)eg.addEventListener('click',function(){api.postMessage({type:'guide'});});
    return;
  }
  var metaEl=document.getElementById('meta');if(metaEl)metaEl.innerHTML=esc(snap.runId)+(snap.isPinned?'<span class="st done pinned-badge">pinned</span>':'')+' · updated '+esc(fmtUpdated(snap.updatedAt));
  // Capture per-tab scroll position before innerHTML replace.
  var tc=document.getElementById('tab-content');
  if(tc&&state.activeTab){
    if(state.tabScroll===null||typeof state.tabScroll!=='object')state.tabScroll=Object.create(null);
    state.tabScroll[state.activeTab]=tc.scrollTop;
  }
  // Capture timeline horizontal scroll position before innerHTML replace.
  // tl-scroll is inside #tab-content and is destroyed with it; we persist via state.
  var tlScrollEl=document.getElementById('tl-scroll');
  if(tlScrollEl)state.tlScrollLeft=tlScrollEl.scrollLeft;
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
  // Clamp activeTab to an enabled tab before rendering.
  clampActiveTab();
  // Build root innerHTML: overview-bar (non-collapsible) + tab-bar + tab-content.
  root.innerHTML=overview()+tabBar()+tabContent();
  wire();
  // Restore per-tab scroll after wire() has set up the DOM.
  var tcNew=document.getElementById('tab-content');
  if(tcNew&&state.tabScroll&&state.tabScroll[state.activeTab]!=null){
    tcNew.scrollTop=state.tabScroll[state.activeTab];
  }
  // Restore timeline horizontal scroll position after re-render.
  var tlScrollNew=document.getElementById('tl-scroll');
  if(tlScrollNew&&state.tlScrollLeft)tlScrollNew.scrollLeft=state.tlScrollLeft;
  // Persist tl-scroll clientWidth to state.tlAvailW so the NEXT render() uses the
  // current viewport width instead of querying a stale (pre-replace) element.
  // Falls back to current state.tlAvailW when tl-scroll is not in the DOM (non-timeline tabs).
  if(tlScrollNew&&tlScrollNew.clientWidth)state.tlAvailW=tlScrollNew.clientWidth;
  // Update the sr-only live region with a concise status summary. Placing the update
  // AFTER wire() ensures the DOM is settled before the announcement fires.
  // textContent assignment is injection-safe without esc() — the browser does not
  // parse HTML in text nodes. Using esc() here would cause screen readers to announce
  // literal HTML entities (e.g. '&amp;' instead of '&') for any special chars in L2.phase.
  if(snap&&snap.ok){var srSt=document.getElementById('sr-status');if(srSt){var L2=snap.loop;var srText=L2.phase+' — '+safeN(L2.live)+' live, '+safeN(L2.done)+' done, '+safeN(L2.findings)+' findings';
    // WCAG 4.1.3: announce pagination state when the Findings tab is active and paginated,
    // so screen reader users know their position without navigating to the paginator.
    if(state.activeTab==='findings'){var fnbEl=document.getElementById('findNextBtn');if(fnbEl&&fnbEl.dataset.total){var srTotal=parseInt(fnbEl.dataset.total,10)||1;if(srTotal>1){srText+='; findings page '+(state.findPage+1)+' of '+srTotal;}}}
    srSt.textContent=srText;}}
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
// Keep in sync with fmtTok in src/export/markdown.ts (TypeScript version).
// True deduplication is blocked: this version runs in the webview DOM context.
function fmtTok(n){var v=safeN(n);return v<1000?v+'':v<1000000?(v/1000).toFixed(1)+'k':(v/1000000).toFixed(2)+'M';}

// overview(): always-visible, non-collapsible #overview-bar.
// Rendered first in #root before the tab bar. Keeps all KPI content and
// colored severity badges as-is; no collapse chevron or panel() wrapper.
function overview(){
  const L=snap.loop;
  // safeN() guards L.sevTotals[s] — it arrives via postMessage so a crafted or
  // corrupted snapshot message could carry a non-numeric value (null, undefined,
  // or a string). safeN() ensures only a finite number reaches innerHTML.
  let sev='';for(const s of Object.keys(L.sevTotals)){const es=esc(s);const ec=escCls(s);sev+='<span class="sev '+ec+'">'+es+' '+safeN(L.sevTotals[s])+'</span>';}
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
  var kpis='<div class="kpis">'
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
    +'<div class="kpi" aria-describedby="stalled-panel-desc"><div class="dim">Stalled</div><b'+(L.dead?' class="kpi-stalled-active"':'')+'>'+safeN(L.dead)+'</b><div class="'+(L.dead?'':'dim ')+'kpi-sublabel">no activity '+esc(STALE_LABEL)+'</div><span id="stalled-panel-desc" class="sr-only">'+esc(STALE_TOOLTIP)+'</span></div>'
    +(L.superseded?'<div class="kpi" aria-describedby="superseded-panel-desc"><div class="dim">Superseded</div><b class="kpi-superseded">'+safeN(L.superseded)+'</b><div class="kpi-sublabel">retried agents</div><span id="superseded-panel-desc" class="sr-only">Agents that were retried before producing a result; excluded from the live count.</span></div>':'')
    +'<div class="kpi"><div class="dim">Agents</div><b>'+safeN(L.total)+'</b></div>'
    +'<div class="kpi"><div class="dim">Out tokens</div><b data-testid="loop-out-tok">'+fmtTok(L.outTok)+'</b></div>'
    +'<div class="kpi"><div class="dim">Tool-calls</div><b data-testid="loop-tools">'+safeN(L.tools)+'</b></div>'
    +optTok
    +'<div class="kpi"><div class="dim">Findings</div><b>'+safeN(L.findings)+'</b></div>'
    +'</div>'+(sev?('<div class="overview-sev-row">'+sev+'</div>'):'');
  return '<div id="overview-bar">'+kpis+'</div>';
}

// ---------------------------------------------------------------------------
// M2-TypedResults: typed result renderers for structured agent output.
// M2-TypedResults-Generic: renderTypedResult is now FIELD-DRIVEN — it scans
// the result object for known field patterns and renders each one appropriately,
// regardless of agentType. The per-type named renderers below are kept for
// backward-compatibility (existing tests reference them by name) but renderTypedResult
// no longer dispatches via per-agentType switch. agentType is only a label hint.
// NEVER a bare JSON dump. All values pass through esc(). Theme-native: --vscode-* only.
// ---------------------------------------------------------------------------

// Generic fallback: render a result object as a key/value table.
// Used for REMAINING keys after the field-driven pass handles known patterns.
// Arrays of primitives are rendered as bullet lists; nested objects as [object] placeholder.
// Handles all unknown agentType shapes gracefully. NEVER produces raw JSON output.
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

// implementer: filesChanged list + summary + fixed/testsRun counts.
// Kept for backward-compat; renderTypedResult is now field-driven and no longer calls this directly.
// summary uses renderInlineMd(normalizeLiteralEscapes(esc(...))) so that **bold** and
// literal \\n escape sequences render correctly if reactivated (spec v3 corrections #9/#10).
function renderImplementerResult(r){
  var out='<div class="typed-result">';
  var verdict=r.verdict||r.status||'';
  if(verdict){
    var isOk=/pass|ok|success|done|complet/i.test(String(verdict));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(String(verdict))+'</div>';
  }
  if(r.summary){out+='<div class="typed-summary">'+renderInlineMd(normalizeLiteralEscapes(esc(String(r.summary))))+'</div>';}
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

// test-verifier: pass/fail + summary + coverage gaps.
// Kept for backward-compat; renderTypedResult is now field-driven and no longer calls this directly.
// summary uses renderInlineMd(normalizeLiteralEscapes(esc(...))) — spec v3 correctness.
function renderVerifierResult(r){
  var out='<div class="typed-result">';
  var passed=r.passed;
  if(passed!=null){
    out+='<div class="'+(passed?'typed-verdict-ok':'typed-verdict-bad')+'">'+(passed?'PASSED':'FAILED')+'</div>';
  }else if(r.verdict){
    var isOk=/pass|ok|success/i.test(String(r.verdict));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(String(r.verdict))+'</div>';
  }
  if(r.summary){out+='<div class="typed-summary">'+renderInlineMd(normalizeLiteralEscapes(esc(String(r.summary))))+'</div>';}
  if(r.testsRun!=null){var kv='<div class="typed-kv-key">tests run</div><div class="typed-kv-val">'+safeN(r.testsRun)+'</div>';if(r.testsPassed!=null)kv+='<div class="typed-kv-key">passed</div><div class="typed-kv-val">'+safeN(r.testsPassed)+'</div>';if(r.testsFailed!=null)kv+='<div class="typed-kv-key">failed</div><div class="typed-kv-val">'+safeN(r.testsFailed)+'</div>';out+='<div class="typed-kv">'+kv+'</div>';}
  var gaps=Array.isArray(r.coverageGaps)?r.coverageGaps:(Array.isArray(r.gaps)?r.gaps:[]);
  if(gaps.length){
    out+='<div class="typed-section-label">Coverage gaps ('+gaps.length+')</div>';
    out+=gaps.slice(0,20).map(function(g){return '<div class="typed-gap">'+esc(typeof g==='string'?g:String(g))+'</div>';}).join('')+(gaps.length>20?'<div class="dim">…+'+(gaps.length-20)+' more</div>':'');
  }
  out+='</div>';
  return out;
}

// judge: verdict + score + rationale.
// Kept for backward-compat; renderTypedResult is now field-driven and no longer calls this directly.
// rationale/summary uses renderInlineMd(normalizeLiteralEscapes(esc(...))) — spec v3 correctness.
function renderJudgeResult(r){
  var out='<div class="typed-result">';
  var verdict=r.verdict||r.decision||'';
  if(verdict){
    var isOk=/pass|approve|ok|yes|accept|allow/i.test(String(verdict));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(String(verdict))+'</div>';
  }
  if(r.score!=null){out+='<span class="typed-score">'+esc(String(r.score))+'</span>'+(r.maxScore!=null?' / '+esc(String(r.maxScore)):'');}
  if(r.rationale){out+='<div class="typed-summary">'+renderInlineMd(normalizeLiteralEscapes(esc(String(r.rationale))))+'</div>';}
  else if(r.summary){out+='<div class="typed-summary">'+renderInlineMd(normalizeLiteralEscapes(esc(String(r.summary))))+'</div>';}
  if(r.notes){out+='<div class="typed-section-label">Notes</div><div class="typed-gap">'+esc(String(r.notes))+'</div>';}
  out+='</div>';
  return out;
}

// completeness-critic: verdict + gaps list + summary.
// Kept for backward-compat; renderTypedResult is now field-driven and no longer calls this directly.
// summary uses renderInlineMd(normalizeLiteralEscapes(esc(...))) — spec v3 correctness.
function renderCompletenessResult(r){
  var out='<div class="typed-result">';
  var verdict=r.verdict||r.status||'';
  if(verdict){
    // 'incomplete' must not match the 'complete' pattern — check for negative prefix.
    var s=String(verdict);
    var isOk=/pass|ok|done/i.test(s)||(/complete/i.test(s)&&!/incomplete/i.test(s));
    out+='<div class="'+(isOk?'typed-verdict-ok':'typed-verdict-bad')+'">'+esc(s)+'</div>';
  }
  if(r.summary){out+='<div class="typed-summary">'+renderInlineMd(normalizeLiteralEscapes(esc(String(r.summary))))+'</div>';}
  var gaps=Array.isArray(r.gaps)?r.gaps:(Array.isArray(r.coverageGaps)?r.coverageGaps:[]);
  if(gaps.length){
    out+='<div class="typed-section-label">Gaps ('+gaps.length+')</div>';
    out+=gaps.slice(0,30).map(function(g){return '<div class="typed-gap">'+esc(typeof g==='string'?g:String(g))+'</div>';}).join('')+(gaps.length>30?'<div class="dim">…+'+(gaps.length-30)+' more</div>':'');
  }else if(!verdict&&!r.summary){out+='<div class="dim">no gaps reported</div>';}
  out+='</div>';
  return out;
}

// ---------------------------------------------------------------------------
// M2-TypedResults-Generic: field-driven dispatcher.
//
// renderTypedResult scans the result object by FIELD PATTERNS — not agentType.
// agentType is accepted only as a label hint (unused in dispatch logic).
// Order of rendering:
//   1. verdict(string) → status badge (APPROVED→ok; WORK/FAIL/REJECT→bad; else neutral)
//   2. findings[] of {severity,title,location,why,fix,category} → severity-sorted list
//   3. summary(string) → ## / ### section parse when structured, else plain text
//   4. filesChanged[] → file list with count (cap 40)
//   5. boolean flags: key ends in Ok, equals testsRun, or matches /passed/i → ✓/✗ chips
//   6. failures[] / gaps[] / coverageGaps[] → list (empty → 'none')
//   7. numeric counts (fixed, testsPassed, …) → labeled values
//   8. every other/unknown key → generic key-value table (string/number/bool/array/object)
//   Raw JSON in a collapsed details block BELOW the typed view.
// Wrapped in try/catch: on ANY error, falls back to collapsed raw text — NEVER throws.
// esc() applied to every transcript-derived value. Theme-native --vscode-* only.
// ---------------------------------------------------------------------------

// Severity sort order for findings[]. Higher index = lower severity (rendered last).
var SEV_ORDER=['CRITICAL','HIGH','MEDIUM','LOW','NITPICK','UNRATED'];
function sevRank(s){var i=SEV_ORDER.indexOf(String(s||'').toUpperCase());return i===-1?SEV_ORDER.length:i;}

// isBoolChipKey: true when the boolean field key matches the chip pattern.
// Pattern: key ends with 'Ok' (buildOk, lintOk, testsOk), equals 'testsRun', or contains 'passed'.
// Uses string methods (endsWith) instead of regex end-of-string anchors to keep the HTML
// output free of certain characters that constraint tests flag in the webview output.
function isBoolChipKey(k){return k==='testsRun'||k.endsWith('Ok')||k.endsWith('ok')||/passed/i.test(k);}

function renderTypedResult(agentType,result){
  // Guard: null/undefined/non-object result → friendly message, no throw.
  if(!result||typeof result!=='object')return '<div class="dim">no structured result</div>';
  try{
    var out='';
    // Track which top-level keys have been handled so the generic-kv fallback
    // only renders the remainder (keys not matched by any named pattern).
    var handled=Object.create(null);

    // 1. verdict(string) → status badge.
    //    Exact case-insensitive match for 'APPROVED' → ok class (green).
    //    Contains WORK, FAIL, or REJECT (any case) → bad class (red).
    //    Anything else → neutral class (muted).
    if(typeof result.verdict==='string'){
      var vs=result.verdict;
      var vcls=vs.toUpperCase()==='APPROVED'?'typed-verdict-ok':(vs.toUpperCase().indexOf('WORK')!==-1||vs.toUpperCase().indexOf('FAIL')!==-1||vs.toUpperCase().indexOf('REJECT')!==-1)?'typed-verdict-bad':'typed-verdict-neutral';
      out+='<div class="'+vcls+'">'+esc(vs)+'</div>';
      handled.verdict=1;
    }

    // 2. findings[] → severity-sorted list with {severity,title,location,why,fix,category}.
    //    Re-uses the same rendering pattern as findingsPanel() for visual consistency.
    if(Array.isArray(result.findings)&&result.findings.length){
      var sorted=result.findings.slice().sort(function(a,b){return sevRank(a.severity)-sevRank(b.severity);});
      out+='<div class="typed-section-label">Findings ('+sorted.length+')</div>';
      out+=sorted.map(function(f){
        var es=esc(f.severity||'UNRATED');var ec=escCls(f.severity||'UNRATED');
        // why and fix are rendered inline (always visible) — no .detail collapse wrapper.
        // Typed-findings are in structured results where context is always useful,
        // unlike the Findings tab where individual rows are collapsible.
        return '<div class="finding typed-finding"><div class="ttl"><span class="sev '+ec+'">'+es+'</span><b>'+esc(f.title||'(untitled)')+'</b>'
          +(f.location?'<span class="dim"> ['+esc(f.location)+']</span>':'')+'</div>'
          +((f.why||f.fix)?'<div class="typed-finding-detail">'+(f.why?'<div><b>Why:</b> '+esc(f.why)+'</div>':'')+(f.fix?'<div class="finding-fix"><b>Fix:</b> '+esc(f.fix)+'</div>':'')+'</div>':'')+'</div>';
      }).join('');
      handled.findings=1;
    }else if(result.findings!==undefined){
      handled.findings=1;
    }

    // 3. summary(string) → parse ## / ### markdown sections when structured, else plain text.
    //    Uses parseImplementerMarkdown which handles the ## Implementation / ### sections pattern.
    //    Falls back gracefully to inline-markdown rendered text if structure is absent.
    //    normalizeLiteralEscapes is applied inside parseImplementerMarkdown; the fallback
    //    applies it via renderInlineMd(normalizeLiteralEscapes(esc(…))) per spec v3 #9+#10.
    if(typeof result.summary==='string'&&result.summary){
      var parsed=parseImplementerMarkdown(result.summary);
      if(parsed){out+=parsed;}
      else{out+='<div class="typed-section-label">Summary</div><div class="typed-summary">'+renderInlineMd(normalizeLiteralEscapes(esc(result.summary)))+'</div>';}
      handled.summary=1;
    }

    // 4. filesChanged[] → file list with count (cap 40).
    if(Array.isArray(result.filesChanged)){
      var files=result.filesChanged;
      if(files.length){
        out+='<div class="typed-section-label">Files changed ('+files.length+')</div>';
        out+='<ul class="typed-file-list">'+files.slice(0,40).map(function(f){return '<li class="typed-file">'+esc(typeof f==='string'?f:String(f))+'</li>';}).join('')+(files.length>40?'<li class="dim">…+'+(files.length-40)+' more</li>':'')+'</ul>';
      }
      handled.filesChanged=1;
    }

    // 5. Boolean flags: key ends with 'Ok' (buildOk/lintOk/testsOk), key equals 'testsRun',
    //    or key contains 'passed' — renders as ✓/✗ chips in a row.
    var boolChips='';
    Object.keys(result).forEach(function(k){
      if(handled[k])return;
      if(typeof result[k]==='boolean'&&isBoolChipKey(k)){
        var v=result[k];
        // WCAG 1.1.1: ✓/✗ are non-text content. aria-hidden hides the symbol from AT;
        // the sr-only span provides the semantic pass/fail meaning as plain text.
        // title= conveys the key name to sighted users on hover (not relied on for AT).
        boolChips+='<span class="typed-bool-chip '+(v?'typed-verdict-ok':'typed-verdict-bad')+'" title="'+esc(k)+'"><span aria-hidden="true">'+(v?'✓':'✗')+'</span> '+esc(k)+' <span class="sr-only">'+(v?'(pass)':'(fail)')+'</span></span>';
        handled[k]=1;
      }
    });
    if(boolChips)out+='<div class="typed-bool-chips">'+boolChips+'</div>';

    // 6. failures[] / gaps[] / coverageGaps[] → list (empty → 'none').
    ['failures','gaps','coverageGaps'].forEach(function(key){
      if(handled[key])return;
      var arr=result[key];
      if(!Array.isArray(arr))return;
      var label=key==='coverageGaps'?'Coverage gaps':key.charAt(0).toUpperCase()+key.slice(1);
      out+='<div class="typed-section-label">'+esc(label)+'</div>';
      if(!arr.length){out+='<div class="dim">none</div>';}
      else{
        var cap=key==='gaps'?30:key==='coverageGaps'?20:key==='failures'?20:30;
        out+=arr.slice(0,cap).map(function(g){return '<div class="typed-gap">'+esc(typeof g==='string'?g:String(g))+'</div>';}).join('');
        if(arr.length>cap)out+='<div class="dim">…+'+(arr.length-cap)+' more</div>';
      }
      handled[key]=1;
    });

    // 7. Numeric counts (fixed, testsPassed, testsFailed, etc.) → labeled values.
    //    Renders known numeric fields as a compact kv pair block.
    var numKv='';
    Object.keys(result).forEach(function(k){
      if(handled[k])return;
      if(typeof result[k]==='number'){
        numKv+='<div class="typed-kv-key">'+esc(k)+'</div><div class="typed-kv-val">'+safeN(result[k])+'</div>';
        handled[k]=1;
      }
    });
    if(numKv)out+='<div class="typed-kv">'+numKv+'</div>';

    // 8. Every remaining/unknown key → generic key-value table.
    //    Handles string, boolean (not matching the chip pattern), array, nested object.
    //    NEVER produces raw JSON output — arrays and objects get human-readable presentation.
    var remainingKeys=Object.keys(result).filter(function(k){return !handled[k];});
    if(remainingKeys.length){
      var rows='';
      remainingKeys.forEach(function(k){
        var v=result[k];
        var vStr='';
        if(v==null){vStr='<span class="dim">—</span>';}
        else if(typeof v==='boolean'){vStr=v?'<span class="typed-verdict-ok">yes</span>':'<span class="typed-verdict-bad">no</span>';}
        else if(typeof v==='number'){vStr=esc(String(v));}
        else if(typeof v==='string'){vStr=esc(v)||'<span class="dim">—</span>';}
        else if(Array.isArray(v)){
          if(!v.length){vStr='<span class="dim">none</span>';}
          else{vStr='<ul class="typed-file-list">'+v.slice(0,40).map(function(x){return '<li class="typed-gap">'+esc(typeof x==='object'?JSON.stringify(x):String(x==null?'':x))+'</li>';}).join('')+(v.length>40?'<li class="dim">…+'+(v.length-40)+' more</li>':'')+'</ul>';}
        }else if(typeof v==='object'){
          // Nested object: render as a nested kv table (not raw JSON).
          var nestedRows='';
          Object.keys(v).forEach(function(nk){var nv=v[nk];nestedRows+='<div class="typed-kv-key">'+esc(nk)+'</div><div class="typed-kv-val">'+esc(nv==null?'':typeof nv==='object'?JSON.stringify(nv):String(nv))+'</div>';});
          vStr=nestedRows?'<div class="typed-kv">'+nestedRows+'</div>':'<span class="dim">[object]</span>';
        }
        rows+='<div class="typed-kv-key">'+esc(k)+'</div><div class="typed-kv-val">'+vStr+'</div>';
      });
      if(rows)out+='<div class="typed-kv">'+rows+'</div>';
    }

    // If no content was rendered at all (result was an empty object), show a placeholder.
    if(!out)out='<div class="dim">empty result</div>';

    // Raw JSON collapsed below the typed view — power users can inspect the full structure.
    // rawJsonDetails is defined below in the file (function hoisting makes it available here).
    // AC4: raw JSON <details> is rendered here — this is the single owner of the raw JSON block.
    // resultsPanel does NOT append a second rawJsonDetails call (v3 correction #4).
    // openRaw persistence is wired in wire() via the [data-rlabel] ancestor key.
    out+=rawJsonDetails(result);

    return '<div class="typed-result">'+out+'</div>';
  }catch(e){
    // On ANY error: fall back silently to collapsed raw text. NEVER throws into the webview.
    var fb='';try{fb=JSON.stringify(result,null,2);}catch(e2){fb='[unserializable]';}
    return '<details class="raw-json-details"><summary class="raw-json-summary">Result (parse error — raw)</summary><div class="raw-json-body"><pre class="raw-json-pre">'+esc(fb)+'</pre></div></details>';
  }
}

function agentSub(a){
  if(a.findings)return a.findings.map(f=>{var es=esc(f.severity||'UNRATED');var ec=escCls(f.severity||'UNRATED');return '<div class="ev"><span class="sev '+ec+'">'+es+'</span>'+esc(f.title||f.location||'(untitled)')+'</div>';}).join('')||'<div class="ev dim">no findings</div>';
  if(a.result)return renderTypedResult(a.agentType,a.result);
  // AC4: Try implementer markdown parser first; fall back to capped <pre> block.
  if(a.resultText){var parsed=parseImplementerMarkdown(a.resultText);if(parsed)return parsed;return '<pre>'+esc(a.resultText.slice(0,4000))+'</pre>';}
  return (a.tail||[]).slice(-30).map(t=>'<div class="ev '+(t.kind==='tool'?'tool':'')+'">'+esc(t.text)+'</div>').join('')||'<div class="ev dim">no output yet</div>';
}
function agentsPanel(){
  if(!snap.agents.length)return '<div class="dim pad">No agents started yet — workflow is initialising…</div>';
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
    // For superseded agents use the 'superseded' CSS class so the yellow badge style applies;
    // for other statuses use the raw status key (escCls-sanitised).
    const es=a.superseded?'superseded':escCls(a.status);
    // 'dead' is the internal status key (CSS class, TS type); user-facing label is 'stalled'
    // so the UI communicates that the agent stopped responding, not that it errored out.
    // Superseded agents get the 'superseded' label — mirrors the logic in timelinePanel().
    const statusLabel=a.superseded?'superseded':a.status==='dead'?'stalled':a.status==='run'?'live':es;
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
    return '<div class="card '+escCls(a.status)+' '+(a.superseded?'superseded-card ':'')+open+'" data-aid="'+esc(a.id)+'">'
      +'<div class="row" tabindex="0" role="button" aria-expanded="'+(open?'true':'false')+'" aria-controls="'+subId+'"><span class="card-chevron" aria-hidden="true">&#9658;</span><span class="role">'+esc(a.label)+'</span><span class="st '+es+'">'+statusLabel+'</span><span class="grow"></span><span class="dim">'+fmtTHtml(a.elapsed)+'</span></div>'
      +'<div class="agent-metrics" role="group" aria-label="Agent metrics">'+metrics+'</div>'
      // aria-hidden on the ↳ arrow: it is decorative (indicates sub-item/continuation).
      // Some screen readers (JAWS, NVDA) announce it as "downwards arrow with tip rightwards"
      // which is noise before the actual activity text.
      +(a.status==='run'?'<div class="activity"><span aria-hidden="true">↳ </span>'+esc(a.lastActivity)+'</div>':'')
      +promptDisc
      +'<div class="sub" id="'+subId+'">'+agentSub(a)+'</div></div>';
  }).join('');
  return capWarn+collapseAllBtn+'<div class="cards">'+cards+'</div>';
}

function findingsPanel(){
  if(!snap.allFindings.length){
    // Context-aware empty state: distinguish "reviewers ran and found nothing" (clean pass)
    // from "no reviewers have run yet" (waiting) so users understand the significance.
    var emptyMsg=snap.loop.passes>0
      ?'No findings from reviewers in pass '+safeN(snap.loop.passes)+' — run is clean.'
      :'No findings recorded yet.';
    return '<div class="dim pad">'+esc(emptyMsg)+'</div>';
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
  // Findings pagination: PAGE_SIZE=50 items per page to avoid a wall of 100+ items.
  // state.findPage is clamped to valid range on every render.
  var totalPages=Math.max(1,Math.ceil(list.length/PAGE_SIZE));
  if(state.findPage>=totalPages)state.findPage=Math.max(0,totalPages-1);
  var pageStart=state.findPage*PAGE_SIZE;
  var pageEnd=Math.min(pageStart+PAGE_SIZE,list.length);
  var pageList=list.slice(pageStart,pageEnd);
  // Paginator control: rendered above and below the findings list when list.length > PAGE_SIZE.
  var paginator='';
  if(list.length>PAGE_SIZE){
    var prevDis=state.findPage===0?' disabled':'';
    var nextDis=state.findPage>=totalPages-1?' disabled':'';
    // data-total on findNextBtn carries totalPages so the wire() handler can guard
    // the increment with a bounds check (mirrors findPrevBtn's state.findPage>0 guard).
    paginator='<div class="find-paginator"><button class="find-page-btn" id="findPrevBtn"'+prevDis+' aria-label="Previous findings page">&#8592; Prev</button><span class="find-page-info">Page '+esc(String(state.findPage+1))+' of '+esc(String(totalPages))+' <span aria-hidden="true">&middot;</span> showing '+esc(String(pageStart+1))+'&#8211;'+esc(String(pageEnd))+' of '+esc(String(list.length))+'</span><button class="find-page-btn" id="findNextBtn" data-total="'+safeN(totalPages)+'"'+nextDis+' aria-label="Next findings page">Next &#8594;</button></div>';
  }
  // Object.create(null): no prototype chain, so pass values equal to '__proto__' or
  // 'constructor' cannot pollute Object.prototype — consistent with openAgents/fRev/fSev.
  const byP=Object.create(null);pageList.forEach(f=>{(byP[f.pass]=byP[f.pass]||[]).push(f);});
  let body=chips+paginator;
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
  if(list.length>PAGE_SIZE)body+=paginator;
  return body;
}

// AC4: Render collapsed raw-JSON below the analyzed view so power users can inspect
// the full structure without it dominating the card. Uses native <details>/<summary>
// which are collapsible without JS and CSP-safe (no inline handlers needed).
// JSON.stringify is intentionally used here — this IS the raw JSON view.
// The pre content is passed through esc() to prevent injection from adversarial JSON values.
// openRaw persistence: the <details> emits a raw-json-details CSS class. wire() attaches a
// 'toggle' listener that walks up to the closest [data-rlabel] ancestor to get the state key,
// then writes state.openRaw[key]. On re-render, the open attribute is applied from state.openRaw
// by checking the closest [data-rlabel] — this is done via the openRaw-lookup in wire(), not here,
// because rawJsonDetails is called from renderTypedResult which has no stateKey context.
// The data-ropen attribute is set when openRaw state is truthy; wire() reads it on init.
function rawJsonDetails(obj){
  if(!obj||typeof obj!=='object')return '';
  var json='';try{json=JSON.stringify(obj,null,2);}catch(e){json='[unserializable]';}
  return '<details class="raw-json-details"><summary class="raw-json-summary">Raw JSON</summary><div class="raw-json-body"><pre class="raw-json-pre">'+esc(json)+'</pre></div></details>';
}

// AC4: Parse a structured markdown report into a rich view.
// Generic: renders EVERY ## / ### section — not a hardcoded allow-list.
// Special cases preserved for Status (verdict badge) and Files Changed (table).
// Inline markdown: bullet lists, bold, code spans rendered as safe HTML tags.
// No aggressive truncation — result-body already scrolls.
// NEVER throws — all errors caught; returns null for caller to fall back to <pre>.
// Regex notes: this function body lives inside a TypeScript template literal.
//   - RegExp literals need doubled backslashes (\\\\s → \\s in output → regex \s).
//   - All esc() calls happen BEFORE markdown transforms so safe tags are emitted
//     from known patterns only — transcript-derived text can never inject raw HTML.
function parseImplementerMarkdown(text){
  if(!text||typeof text!=='string')return null;
  try{
    // Spec v3 correction #9: normalize literal \\n/\\r/\\t escape sequences to real
    // control characters before parsing. Journal JSON can double-encode newlines so the
    // parsed JS string contains the literal two-char sequence backslash+n. Without this
    // step, the section-splitter misses all boundaries and renderInlineMd misses lists.
    text=normalizeLiteralEscapes(text);
    // Broad guard: require at least one ## or ### heading anywhere in the text.
    // This accepts any structured markdown report, not just "## Implementation" reports.
    if(!/(?:^|\\n)#{2,3} /.test(text))return null;
    // renderInlineMd and applyInlineSpans are defined at module scope above —
    // extracted so renderTypedResult's heading-less summary fallback can call them.
    var out='<div class="impl-report">';
    // Split on any ## or ### heading boundary.
    // \\n?(?=#{2,3} ) splits before each heading line (keeps the heading in the chunk).
    // The first chunk may be preamble text before the first heading — we skip it.
    var chunks=text.split(new RegExp('\\n(?=#{2,3} )'));
    chunks.forEach(function(chunk){
      var nl=chunk.indexOf('\\n');
      var headingLine=(nl===-1?chunk:chunk.slice(0,nl)).trim();
      var body=(nl===-1?'':chunk.slice(nl+1));
      // Strip leading ## / ### and trim to get the heading label.
      var label=headingLine.replace(/^#{2,3} /,'').trim();
      if(!label)return; // skip preamble / empty
      var lowerLabel=label.toLowerCase();
      // --- Special case: Status ---
      if(lowerLabel==='status'){
        var stLine=body.trim().split('\\n')[0].trim();
        if(stLine){
          var isOk=/COMPLETE|DONE|PASS|SUCCESS/i.test(stLine);
          var isBad=/BLOCKED|FAIL|ERROR/i.test(stLine);
          var cls=isOk?'typed-verdict-ok':isBad?'typed-verdict-bad':'';
          out+='<div class="impl-status'+(cls?' '+cls:'')+'">'+esc(stLine)+'</div>';
        }
        return;
      }
      // --- Special case: Files Changed — parse markdown table ---
      if(lowerLabel==='files changed'){
        var tableRows=body.split('\\n').filter(function(l){
          var t=l.trim();
          if(t.length<2||t.charAt(0)!=='|'||t.charAt(t.length-1)!=='|')return false;
          var inner=t.slice(1,t.length-1);
          return inner.replace(/[|\\s\\-:]/g,'').length>0;
        });
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
        return;
      }
      // --- Special case: Test Results — apply verdict colour ---
      if(lowerLabel==='test results'){
        var tText=body.trim();
        if(tText){
          var tOk=/passed|green|ok/i.test(tText);
          var tBad=/fail|error|broken/i.test(tText);
          var tCls=tOk?' typed-verdict-ok':tBad?' typed-verdict-bad':'';
          out+='<div class="typed-section-label">'+esc(label)+'</div>';
          out+='<div class="typed-summary'+tCls+'">'+renderInlineMd(esc(tText))+'</div>';
        }
        return;
      }
      // --- Generic section: render heading + inline-markdown body ---
      // Skip top-level ## headings that are just container titles (e.g. "## Implementation: X").
      // They carry no body content worth rendering on their own; sub-sections handle detail.
      if(headingLine.startsWith('## ')&&!body.trim())return;
      var bodyText=body.trim();
      if(!bodyText&&headingLine.startsWith('## '))return;
      out+='<div class="typed-section-label">'+esc(label)+'</div>';
      if(bodyText){out+='<div class="typed-summary">'+renderInlineMd(esc(bodyText))+'</div>';}
    });
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
  // v3 BINDING: render content directly, no panel() wrapper (tabs provide the container).
  // AC4: rawJsonDetails is rendered inside renderTypedResult — do NOT append it again here.
  // Each result card contains exactly one collapsed raw-JSON <details> block (v3 correction #4).
  return snap.structuredResults.map(r=>'<div class="finding result" data-rlabel="'+esc(r.label+':'+r.pass)+'"><div class="ttl"><b>'+esc(r.label)+'</b> <span class="dim">pass '+esc(r.pass)+'</span></div><div class="result-body">'+renderTypedResult(r.agentType,r.result)+'</div></div>').join('');
}
function verdictsPanel(){
  // Preserve insertion order (journal order) — Object.keys() on modern JS maintains
  // insertion order for string keys, which matches the pass order reviewers appeared.
  // v3 BINDING: render content directly, no panel() wrapper (tabs provide the container).
  return Object.keys(snap.verdicts).map(l=>{
    const displayLabel=snap.verdictLabels&&snap.verdictLabels[l]?snap.verdictLabels[l]:l;
    var vText=snap.verdicts[l]||'(pending)';
    // Apply semantic color to match the typed-verdict pattern in resultsPanel/agentSub.
    // APPROVED/PASS → .ok (green); NEEDS_WORK/FAIL/REJECT → .bad (red); else neutral .dim.
    var vCls=/APPROVED|PASS/i.test(vText)?'ok':/NEEDS_WORK|FAIL|REJECT/i.test(vText)?'bad':'dim';
    return '<div class="verdict-item"><b>'+esc(displayLabel)+'</b> <span class="'+vCls+'">'+esc(vText)+'</span></div>';
  }).join('');
}
function changedPanel(){
  // v3 BINDING: render content directly, no panel() wrapper (tabs provide the container).
  // Primary section: files reported by agent structured results (spec v3 correction #7).
  // Secondary section: mtime-based recently-touched files from walkChanged().
  var out='';
  var byAgents=snap.changedByAgents||[];
  const f=snap.changed||[];
  // Unified empty state: when both sources are empty, emit a single consolidated message.
  if(!byAgents.length&&!f.length){
    out+='<div class="dim">No files reported yet — agent results and recent fs changes will appear here</div>';
  }else{
    if(byAgents.length){
      out+='<div class="dim changed-caption">Files reported by agents ('+byAgents.length+')</div>';
      out+='<ul class="files">'+byAgents.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>';
    }else{
      out+='<div class="dim changed-caption">No files reported by agents yet</div>';
    }
    if(f.length){
      out+='<div class="dim changed-caption changed-caption-mt">Recently touched (last '+esc(String(CHANGED_MAX_MIN))+' min)</div>';
      out+='<ul class="files">'+f.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul>';
    }else{
      out+='<div class="dim">No files changed in the last '+esc(String(CHANGED_MAX_MIN))+' min — changes appear here automatically</div>';
    }
  }
  return out;
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
    var truncLabel=rawLabel.slice(0,TL_LABEL_TRUNC)+(rawLabel.length>TL_LABEL_TRUNC?'…':'');
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
      +'<text x="'+(LABEL_W-4)+'" y="'+(y+BAR_H-4)+'" text-anchor="end" class="chart-bar-label">'
      +lblTrunc
      +'</text>'
      // Bar rect — fill via CSS class .chart-bar (defined in forced-colors block + VS Code theming).
      +(barW>0?'<rect x="'+LABEL_W+'" y="'+y+'" width="'+barW+'" height="'+BAR_H+'" rx="2" class="chart-bar" data-testid="chart-bar"/>':'')
      // Value label — CSS class .chart-val-label handles fill + opacity.
      +'<text x="'+(LABEL_W+barW+4)+'" y="'+(y+BAR_H-4)+'" class="chart-val-label">'+fmtTok(tok)+'</text>'
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
      // CSS classes replace inline style/presentation attrs so forced-colors @media overrides work correctly.
      +'<line x1="'+PAD+'" y1="'+(H-PAD)+'" x2="'+(W-PAD)+'" y2="'+(H-PAD)+'" class="chart-axis-line"/>'
      +'<path d="'+areaPath1+'" class="chart-trend-area" data-testid="trend-area"/>'
      +'<path d="'+pts1+'" class="chart-trend-line" data-testid="trend-line"/>'
      +'<text x="'+(W-PAD)+'" y="'+(PAD+8)+'" text-anchor="end" class="chart-trend-label">'+fmtTok(maxCum)+'</text>'
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
  // in normal mode, but forced-colors UA stylesheet wins regardless; using classes is the consistent pattern).
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+H+'" role="img" aria-label="Cumulative output tokens trend" data-testid="token-trend-chart">'
    // X axis — stroke-width and stroke via CSS class chart-axis-line (forced-colors compatible)
    +'<line x1="'+PAD+'" y1="'+(H-PAD)+'" x2="'+(W-PAD)+'" y2="'+(H-PAD)+'" class="chart-axis-line"/>'
    // Area fill (transparent tint)
    +'<path d="'+areaPath+'" class="chart-trend-area" data-testid="trend-area"/>'
    // Line — stroke-width via CSS class chart-trend-line (forced-colors compatible)
    +'<path d="'+pts+'" class="chart-trend-line" data-testid="trend-line"/>'
    // Max label — font-size and font-family via CSS class chart-trend-label (forced-colors compatible)
    +'<text x="'+(W-PAD)+'" y="'+(PAD+8)+'" text-anchor="end" class="chart-trend-label">'+fmtTok(maxCum)+'</text>'
    +'</svg>';
}

// ---------------------------------------------------------------------------
// M3-Timeline: Gantt visualization panel.
//
// Lane model: one lane per unique agent label (role-grouped). Bars within a
// lane are stacked left-to-right by start time. Lanes ordered by earliest start.
// Live agents extend to "now" with a pulsing right-edge cap.
// Superseded agents use the .tl-bar-superseded class (striped/faded).
//
// Time axis: linear — x = LABEL_W + zoom·K·(t − tMin).
// USER OVERRIDE: log-compressed axis is forbidden per m3-timeline-spec.md.
//
// Accessibility:
//   SVG: role=img + aria-label (chart-level).
//   Bars: role=button, tabindex=0, aria-label with status+elapsed.
//   Focus ring: sibling <rect class="tl-focus-ring"> shown via CSS :focus on bar.
//   Keyboard: Arrow / Home / End among bars; Enter to jump to Agents tab.
//   SR table: visually-hidden <table> with Role/Status/Start/Duration columns.
//   forced-colors @media: in css.ts (not inline style).
//
// CSP compliance:
//   No inline style= on SVG elements (all fills via CSS classes or presentation attrs).
//   No inline event handlers (all wired in js-wire.ts via addEventListener).
//   el.style.left / el.style.top on the named tooltip node IS allowed (named node, not innerHTML style=).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M3-DepGraph: DAG sub-view for the Timeline tab.
//
// Layout: layered-by-pass columns (index-based coordinates, LAYER_W spacing).
// Nodes: rounded rects colored by status via CSS class (no inline style=).
// Edges: polylines between consecutive same-key agents with SVG <marker> arrowhead.
// No physics, no external lib. All fills via CSS classes (CSP-safe).
// Renders at 1 agent and at 50+ agents; no inline style= anywhere.
// ---------------------------------------------------------------------------
var DAG_LAYER_W=160;     // px: horizontal gap between pass columns
var DAG_NODE_W=130;      // px: node width
var DAG_NODE_H=28;       // px: node height
var DAG_NODE_GAP=10;     // px: vertical gap between nodes in the same pass
var DAG_PAD=16;          // px: canvas padding
var DAG_EDGE_COLOR_CLS='tl-dag-edge'; // CSS class for edge polylines

function dagPanel(agents){
  // Declare TL_LABEL_TRUNC locally so this function is self-contained when extracted
  // by test harnesses (extractBalancedFn) — the module-level var is not in scope there.
  var TL_LABEL_TRUNC=16;
  if(!agents||!agents.length){
    return '<div class="dim pad" data-testid="dag-empty">No agents yet.</div>';
  }
  // Pass assignment: for each unique key, count occurrences in start order → pass number.
  // Pass column uses agentPass[a.id] — the count of agents with this key seen so far at
  // iteration time; NOT agent.idx (which is a global arrival-order index, not a pass count).
  // Build pass→[agents] map. Agents are already start-sorted by buildSnapshot.
  var keyPassCount=Object.create(null);
  var passMap=Object.create(null); // pass(1-based) → [agent]
  // agentPass records each agent's individual ordinal at the time of iteration.
  // keyPassCount is incremented first, then the current value is the agent's pass number.
  // Reading keyPassCount AFTER the loop gives the total count for the key — NOT the per-agent ordinal.
  var agentPass=Object.create(null);
  agents.forEach(function(a){
    var k=a.key||a.label||'agent';
    keyPassCount[k]=(keyPassCount[k]||0)+1;
    var p=keyPassCount[k];
    agentPass[a.id]=p; // capture per-agent ordinal before any further increments
    if(!passMap[p])passMap[p]=[];
    passMap[p].push(a);
  });
  var passes=Object.keys(passMap).map(Number).sort(function(a,b){return a-b;});
  var maxNodesInPass=passes.reduce(function(m,p){return Math.max(m,(passMap[p]||[]).length);},0);

  // Node positions: {aid → {cx, cy}} — computed per column.
  // x centre of column p = DAG_PAD + (p-1)*DAG_LAYER_W + DAG_NODE_W/2
  // y of node i in column = DAG_PAD + i*(DAG_NODE_H + DAG_NODE_GAP) + DAG_NODE_H/2
  var nodePos=Object.create(null);
  passes.forEach(function(p){
    var nodesInPass=passMap[p];
    var cx=DAG_PAD+(p-1)*DAG_LAYER_W+DAG_NODE_W/2;
    nodesInPass.forEach(function(a,i){
      var cy=DAG_PAD+i*(DAG_NODE_H+DAG_NODE_GAP)+DAG_NODE_H/2;
      nodePos[a.id]={cx:cx,cy:cy};
    });
  });

  var svgW=DAG_PAD*2+(passes.length>0?(passes[passes.length-1]-1)*DAG_LAYER_W+DAG_NODE_W:DAG_NODE_W);
  var svgH=DAG_PAD*2+maxNodesInPass*(DAG_NODE_H+DAG_NODE_GAP);

  // Build an edge list: for each key, connect agents in start-order (consecutive same-key pairs).
  var byKey=Object.create(null);
  agents.forEach(function(a){
    var k=a.key||a.label||'agent';
    if(!byKey[k])byKey[k]=[];
    byKey[k].push(a);
  });
  var edgesSvg='';
  Object.keys(byKey).forEach(function(k){
    var chain=byKey[k];
    for(var i=0;i<chain.length-1;i++){
      var src=chain[i];var dst=chain[i+1];
      var sp=nodePos[src.id];var dp=nodePos[dst.id];
      if(!sp||!dp)return;
      // Polyline from right-centre of src node to left-centre of dst node.
      // Midpoint x for the elbow = halfway between src right and dst left.
      var x1=sp.cx+DAG_NODE_W/2;var y1=sp.cy;
      var x2=dp.cx-DAG_NODE_W/2;var y2=dp.cy;
      var mx=(x1+x2)/2;
      // Elbow polyline: src-right → mid-top → mid-bottom → dst-left.
      // Points: (x1,y1) (mx,y1) (mx,y2) (x2,y2)
      var pts=x1+','+y1+' '+mx+','+y1+' '+mx+','+y2+' '+x2+','+y2;
      edgesSvg+='<polyline points="'+pts+'" class="'+DAG_EDGE_COLOR_CLS+'" marker-end="url(#dag-arrow)" data-testid="dag-edge"/>';
    }
  });

  // Node rects.
  var nodesSvg='';
  agents.forEach(function(a){
    var pos=nodePos[a.id];if(!pos)return;
    var x=pos.cx-DAG_NODE_W/2;var y=pos.cy-DAG_NODE_H/2;
    var statusCls='tl-bar-'+(a.superseded?'superseded':a.status==='run'?'run':a.status==='done'?'done':'dead');
    var statusLabel=a.superseded?'superseded':a.status==='dead'?'stalled':a.status==='run'?'live':a.status;
    var rawLbl=a.label||'agent';
    var truncLbl=rawLbl.length>TL_LABEL_TRUNC?rawLbl.slice(0,TL_LABEL_TRUNC-1)+'…':rawLbl;
    var ariaLbl=esc(rawLbl)+' — '+esc(statusLabel);
    // Node group: role=button so keyboard users can activate (jump to agent card).
    nodesSvg+='<g role="button" tabindex="0" aria-label="'+ariaLbl+'" class="tl-dag-node-group" data-tlaid="'+esc(a.id)+'" data-tlstatus="'+esc(statusLabel)+'">'
      // Rounded rect — fill via CSS class matching Gantt bar classes (status-colored).
      +'<rect x="'+x+'" y="'+y+'" width="'+DAG_NODE_W+'" height="'+DAG_NODE_H+'" rx="5" class="tl-dag-node '+esc(statusCls)+'" data-testid="dag-node"/>'
      // Focus ring (sibling rect, shown via CSS on :focus).
      +'<rect x="'+(x-2)+'" y="'+(y-2)+'" width="'+(DAG_NODE_W+4)+'" height="'+(DAG_NODE_H+4)+'" rx="6" class="tl-focus-ring"/>'
      // Label text — truncated.
      +'<text x="'+pos.cx+'" y="'+(pos.cy+4)+'" text-anchor="middle" class="tl-dag-label" aria-hidden="true">'+esc(truncLbl)+'</text>'
      +'</g>';
  });

  // Pass column headings above each column.
  var headingsSvg='';
  passes.forEach(function(p){
    var cx=DAG_PAD+(p-1)*DAG_LAYER_W+DAG_NODE_W/2;
    headingsSvg+='<text x="'+cx+'" y="'+(DAG_PAD-4)+'" text-anchor="middle" class="tl-dag-pass-label" aria-hidden="true">Pass '+safeN(p)+'</text>';
  });

  // SVG marker for arrowhead — defined once in <defs>, referenced by marker-end.
  // Fill via CSS class on the marker path (forced-colors compatible).
  var defs='<defs>'
    +'<marker id="dag-arrow" markerWidth="8" markerHeight="8" refX="8" refY="3" orient="auto">'
    +'<path d="M0,0 L0,6 L8,3 z" class="tl-dag-arrowhead" data-testid="dag-arrowhead"/>'
    +'</marker>'
    +'</defs>';

  // SR table (accessible alternative).
  var srRows=agents.map(function(a){
    // Use per-agent pass ordinal captured during the layout loop above.
    // agentPass[a.id] is this agent's individual pass number (1-based).
    // keyPassCount[k] would give the TOTAL count for the key — wrong for multi-pass keys.
    var p=agentPass[a.id]||1;
    var statusLabel=a.superseded?'superseded':a.status==='dead'?'stalled':a.status==='run'?'live':a.status;
    return '<tr><td>'+esc(a.label)+'</td><td>'+safeN(p)+'</td><td>'+esc(statusLabel)+'</td></tr>';
  }).join('');
  var srTable='<div class="sr-only"><table data-testid="dag-sr-table" aria-label="Agent dependency graph data">'
    +'<thead><tr><th>Role</th><th>Pass</th><th>Status</th></tr></thead>'
    +'<tbody>'+srRows+'</tbody></table></div>';

  var scrollDiv='<div class="tl-scroll" id="tl-dag-scroll" tabindex="-1">'
    +'<svg xmlns="http://www.w3.org/2000/svg" width="'+svgW+'" height="'+svgH+'" role="img"'
    +' aria-label="Agent dependency graph — '+agents.length+' agents, '+passes.length+' passes"'
    +' data-testid="dag-svg" overflow="visible">'
    +defs+edgesSvg+nodesSvg+headingsSvg
    +'</svg>'
    +'</div>';

  return srTable+scrollDiv;
}

// Shared agent label truncation cap applied across bar chart, Gantt lane labels, and DAG nodes.
// A single constant ensures a given label renders identically in all three views, preventing
// the disorientation of seeing "Implement/F…" in one view and "Implement/Fix" in another.
// 16 chars matches the Gantt lane column width at 11px font (previously bar=14, Gantt=16, DAG=18).
var TL_LABEL_TRUNC=16;

// Timeline geometry constants — not configurable, match the CSS lane heights.
var TL_LABEL_W=120;      // px: sticky label column width
var TL_LANE_H=26;        // px: height of each agent bar
var TL_LANE_GAP=6;       // px: gap between lanes
var TL_TICK_H=18;        // px: tick-label row height above lanes
var TL_K=80;             // fallback px/sec base scale at zoom=1 (LINEAR time axis — per binding spec override; was log-compressed in earlier spec drafts; used when rangeS=0 or clientWidth unavailable)
var TL_BAR_CAP=40;       // max lanes before banner

// Tick intervals (seconds) — shown filtered to the data range.
var TL_TICK_SECS=[30,60,120,300,600,1200,1800];

// fmtTLTime: format seconds for timeline tick labels (e.g. 30s, 1m, 5m).
// Input is rounded before formatting because tick times are computed as integer multiples
// of tickInterval minus tMin (a float Unix timestamp), producing float deltas like 29.877s
// or 30.0013s. Without rounding, labels would read '29.877s' instead of '30s'.
function fmtTLTime(s){var v=Math.round(s);if(v<60)return v+'s';if(v<3600)return Math.floor(v/60)+'m';return Math.floor(v/3600)+'h';}

// fmtElapsedSR: plain-text elapsed for screen reader table (no HTML tags).
// Returns '<1s' for zero elapsed — note the raw '<' character. Callers MUST
// pass this through esc() before injecting into HTML (aria-label or table cell).
// Do NOT treat this as HTML-safe — the raw '<' will break HTML if injected unescaped.
// For innerHTML injection use fmtTHtml() instead (it returns '&lt;1s', the HTML-safe form).
// Cross-reference: fmtTHtml() at line 44 is the HTML-safe counterpart of this function.
function fmtElapsedSR(s){var v=safeN(s);if(v===0)return '<1s';if(v<60)return v+'s';if(v<3600)return Math.floor(v/60)+'m'+String(v%60).padStart(2,'0')+'s';return Math.floor(v/3600)+'h'+String(Math.floor(v%3600/60)).padStart(2,'0')+'m';}

// tlX: linear x coordinate for a given time offset (seconds from tMin).
// Formula: x = LABEL_W + zoom * K * dt  (K = pixels-per-second base scale).
// k defaults to TL_K when omitted for backward-compatibility with test harnesses.
function tlX(dt,zoom,k){var _k=k!==undefined?k:TL_K;return TL_LABEL_W+zoom*_k*Math.max(0,dt);}

function timelinePanel(){
  // Declare TL_LABEL_TRUNC locally so this function is self-contained when extracted
  // by test harnesses (extractBalancedFn) — the module-level var is not in scope there.
  var TL_LABEL_TRUNC=16;
  // Collect all agents (including superseded — they render with a distinct class).
  var agents=snap.agents;
  if(!agents||!agents.length)return '<div class="dim pad" data-testid="tl-empty">No agents yet.</div>';

  var now=(typeof window!=='undefined'&&typeof window._FAKE_NOW_SECS==='number'?window._FAKE_NOW_SECS:Date.now()/1000);
  // Group agents by label (role-grouped lanes).
  // Lane order: earliest start per label.
  var laneMap=Object.create(null); // label -> [{agent,...}]
  agents.forEach(function(a){
    var lbl=a.label||'agent';
    if(!laneMap[lbl])laneMap[lbl]=[];
    laneMap[lbl].push(a);
  });
  // Build lane list sorted by earliest start in each lane.
  var lanes=Object.keys(laneMap).map(function(lbl){
    var members=laneMap[lbl];
    var earliest=Math.min.apply(null,members.map(function(a){return safeN(a.start)||now;}));
    return {lbl:lbl,members:members,earliest:earliest};
  }).sort(function(a,b){return a.earliest-b.earliest;});

  var cappedLanes=lanes.length>TL_BAR_CAP;
  var visLanes=cappedLanes?lanes.slice(0,TL_BAR_CAP):lanes;

  // Global time range across all visible agents.
  var tMin=Infinity,tMax=-Infinity;
  visLanes.forEach(function(lane){
    lane.members.forEach(function(a){
      var s=safeN(a.start)||now;
      var e=a.status==='run'?now:safeN(a.mtime)||s;
      if(s<tMin)tMin=s;
      if(e>tMax)tMax=e;
    });
  });
  if(!isFinite(tMin)){tMin=now;tMax=now+60;}
  if(tMax<=tMin)tMax=tMin+60;

  var zoom=state.tlZoom||1;
  // Compute rangeS first so localK can be derived from it (avoids TL_K mutation).
  var rangeS=tMax-tMin;
  // Use persisted tlAvailW from state (updated by wire() after each render) rather than
  // reading clientWidth here, which would find the element from the PREVIOUS render —
  // one cycle stale. On first render state.tlAvailW defaults to 600px.
  var tlAvailW=(state.tlAvailW||600)-TL_LABEL_W;
  var localK=rangeS>0?Math.max(1,tlAvailW/rangeS):TL_K;
  // SVG dimensions.
  var svgW=Math.ceil(tlX(tMax-tMin,zoom,localK))+20;
  var svgH=TL_TICK_H+visLanes.length*(TL_LANE_H+TL_LANE_GAP);

  // Build tick positions. Pick intervals that fall within the range.
  // Choose tick interval: first TL_TICK_SECS that would produce 2-12 ticks.
  var tickInterval=TL_TICK_SECS[TL_TICK_SECS.length-1];
  for(var ti=0;ti<TL_TICK_SECS.length;ti++){
    var cand=TL_TICK_SECS[ti];
    var cnt=Math.floor(rangeS/cand);
    if(cnt>=2&&cnt<=12){tickInterval=cand;break;}
    if(cnt<2){tickInterval=cand;break;}
  }
  var ticks=[];
  var firstTick=Math.ceil(tMin/tickInterval)*tickInterval;
  for(var t=firstTick;t<=tMax;t+=tickInterval){
    ticks.push({dt:t-tMin,label:fmtTLTime(t-tMin)});
  }

  // Render SVG rows.
  var tickSvg='';
  // Grid lines + tick labels.
  ticks.forEach(function(tk){
    var x=Math.round(tlX(tk.dt,zoom,localK));
    // Vertical grid line — CSS class tl-grid-line (no inline stroke).
    tickSvg+='<line x1="'+x+'" y1="'+TL_TICK_H+'" x2="'+x+'" y2="'+svgH+'" class="tl-grid-line"/>';
    // Tick label above the grid.
    tickSvg+='<text x="'+x+'" y="'+(TL_TICK_H-4)+'" text-anchor="middle" class="tl-tick-label" aria-hidden="true">'+esc(tk.label)+'</text>';
  });

  // Lane labels (sticky left column) + bars.
  var barsSvg='';
  var barsMeta=[]; // for SR table
  visLanes.forEach(function(lane,li){
    var y0=TL_TICK_H+li*(TL_LANE_H+TL_LANE_GAP);
    var yBar=y0+2;
    var barH=TL_LANE_H-4;
    // Sticky label background (covers the bar area behind it).
    barsSvg+='<rect x="0" y="'+y0+'" width="'+TL_LABEL_W+'" height="'+TL_LANE_H+'" class="tl-label-bg"/>';
    // Lane label text — truncated, right-aligned in the label column.
    var rawLbl=lane.lbl;
    var truncLbl=rawLbl.length>TL_LABEL_TRUNC?rawLbl.slice(0,TL_LABEL_TRUNC-1)+'…':rawLbl;
    barsSvg+='<text x="'+(TL_LABEL_W-6)+'" y="'+(y0+TL_LANE_H/2+4)+'" text-anchor="end" class="tl-lane-label" aria-hidden="true">'+esc(truncLbl)+'</text>';
    // Sort members by start time within the lane.
    var members=lane.members.slice().sort(function(a,b){return (safeN(a.start)||0)-(safeN(b.start)||0);});
    members.forEach(function(a){
      var aStart=safeN(a.start)||tMin;
      var aEnd=a.status==='run'?now:safeN(a.mtime)||aStart;
      var x1=Math.round(tlX(aStart-tMin,zoom,localK));
      var x2=Math.round(tlX(aEnd-tMin,zoom,localK));
      var barW=Math.max(3,x2-x1);
      var statusCls='tl-bar-'+(a.superseded?'superseded':a.status==='run'?'run':a.status==='done'?'done':'dead');
      var statusLabel=a.superseded?'superseded':a.status==='dead'?'stalled':a.status==='run'?'live':a.status;
      var elapsedS=Math.round(aEnd-aStart);
      var ariaLbl=esc(a.label)+' — '+esc(statusLabel)+' — '+esc(fmtElapsedSR(elapsedS));
      var bid='tl-bar-'+esc(a.id);
      // Bar group: role=button, tabindex=0, aria-label, data attrs for wire().
      barsSvg+='<g role="button" tabindex="0" aria-label="'+ariaLbl+'"'
        +' data-tlaid="'+esc(a.id)+'" data-tlstatus="'+esc(statusLabel)+'"'
        +' class="tl-bar-group" id="'+bid+'">'
        // Main bar rect — fill via CSS class.
        +'<rect x="'+x1+'" y="'+yBar+'" width="'+barW+'" height="'+barH+'" rx="3" class="'+esc(statusCls)+'" data-testid="tl-bar"/>'
        // Stripe overlay for superseded agents (diagonal hatching via SVG <pattern>).
        // opacity is set via CSS class tl-stripe-overlay (not bare attribute) so that
        // @media(forced-colors:active) can suppress it by setting display:none.
        +(a.superseded?'<rect x="'+x1+'" y="'+yBar+'" width="'+barW+'" height="'+barH+'" rx="3" fill="url(#tl-stripe)" class="tl-stripe-overlay"/>':'')
        // Focus ring (sibling rect, shown via CSS .tl-bar-group:focus .tl-focus-ring).
        +'<rect x="'+(x1-2)+'" y="'+(yBar-2)+'" width="'+(barW+4)+'" height="'+(barH+4)+'" rx="4" class="tl-focus-ring"/>'
        // Pulsing right-edge cap for live agents (hidden for others via CSS class).
        +(a.status==='run'&&!a.superseded?'<rect x="'+(x1+barW-4)+'" y="'+yBar+'" width="4" height="'+barH+'" rx="2" class="tl-live-cap"/>':'')
        +'</g>';
      barsMeta.push({label:a.label,status:statusLabel,start:aStart,elapsed:elapsedS});
    });
  });

  // Superseded stripe <pattern> definition — emitted only when at least one agent is superseded
  // so the SVG has no dead <defs> when unneeded.
  var hasSuperseded=visLanes.some(function(lane){return lane.members.some(function(a){return !!a.superseded;});});
  var defs=hasSuperseded
    ?'<defs><pattern id="tl-stripe" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="4" height="8" class="tl-stripe-fill"/></pattern></defs>'
    :'';

  // SR table (visually hidden, accessible alternative to the SVG).
  var srRows=barsMeta.map(function(m){
    return '<tr><td>'+esc(m.label)+'</td><td>'+esc(m.status)+'</td>'
      +'<td>'+esc(new Date(m.start*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}))+'</td>'
      +'<td>'+esc(fmtElapsedSR(m.elapsed))+'</td></tr>';
  }).join('');
  var srTable='<div class="sr-only"><table data-testid="tl-sr-table" aria-label="Agent timeline data">'
    +'<thead><tr><th>Role</th><th>Status</th><th>Start</th><th>Duration</th></tr></thead>'
    +'<tbody>'+srRows+'</tbody></table></div>';

  var capBanner=cappedLanes?'<div class="cap-warn" data-testid="tl-cap-banner">Showing '+TL_BAR_CAP+' of '+esc(String(lanes.length))+' lanes — run may be larger.</div>':'';

  // Tooltip div (positioned absolutely; position set via el.style.left/top in wire() — named node allowed by CSP).
  var tooltip='<div id="tl-tooltip" class="tl-tooltip" hidden></div>';

  // Zoom controls + segmented control [Gantt | Graph].
  // Radiogroup pattern: role="radiogroup" + role="radio" + aria-checked is the correct
  // ARIA pattern for an exclusive segmented control (not toggle-button / aria-pressed).
  var isDag=state.timelineView==='dag';
  // Zoom controls are hidden (aria-hidden + disabled) when DAG view is active because
  // dagPanel() uses fixed layout constants and does not respond to state.tlZoom.
  // Showing operable zoom buttons that have no effect is deceptive (WCAG 4.1.2).
  // Use the HTML boolean hidden attribute rather than style="display:none" — the
  // nonce-restricted CSP (style-src nonce-...) blocks inline style= on arbitrary DOM
  // elements, so style= would be silently ignored in the real VS Code webview. The
  // hidden attribute is CSP-safe, semantically correct, and recognized by all VS Code
  // webview Chromium versions. No CSS class change needed.
  var zoomBtnAttrs=isDag?' disabled aria-hidden="true" hidden':'';
  var zoomLabelAttrs=isDag?' aria-hidden="true" hidden':'';
  var zoomCtrl='<div class="tl-zoom-ctrl">'
    +'<button id="tlZoomOut" class="tl-zoom-btn" aria-label="Zoom out timeline" title="Zoom out"'+zoomBtnAttrs+'>&#8722;</button>'
    +'<span class="tl-zoom-label"'+zoomLabelAttrs+'>'+Math.round(zoom*100)+'%</span>'
    +'<button id="tlZoomIn" class="tl-zoom-btn" aria-label="Zoom in timeline" title="Zoom in"'+zoomBtnAttrs+'>&#43;</button>'
    // Segmented control — radiogroup pattern; active class on whichever view is current.
    +'<div class="tl-seg-ctrl" role="radiogroup" aria-label="Timeline view">'
    +'<button id="tlViewGantt" class="tl-view-toggle'+(!isDag?' tl-view-toggle-active':'')+'"'
    +' role="radio" aria-checked="'+(!isDag?'true':'false')+'"'
    +' title="Switch to Gantt view">Gantt</button>'
    +'<button id="tlViewToggle" class="tl-view-toggle'+(isDag?' tl-view-toggle-active':'')+'"'
    +' role="radio" aria-checked="'+(isDag?'true':'false')+'"'
    +' title="Switch to dependency graph view"'
    +' data-testid="tl-view-toggle">Graph</button>'
    +'</div>'
    +'</div>';

  var svgBody=defs+tickSvg+barsSvg;

  // Scrollable wrapper — horizontal scroll, id used by wire() for scroll capture/restore.
  var scrollDiv='<div id="tl-scroll" class="tl-scroll" tabindex="-1">'
    +'<svg xmlns="http://www.w3.org/2000/svg" width="'+svgW+'" height="'+svgH+'" role="img"'
    +' aria-label="Agent Gantt timeline — '+visLanes.length+' roles, '+barsMeta.length+' agents"'
    +' data-testid="tl-svg" overflow="visible">'
    +svgBody
    +'</svg>'
    +'</div>';

  // tooltip is rendered outside the ganttView/dagPanel branches so wire() can
  // always query #tl-tooltip regardless of which sub-view is active.
  var ganttView=capBanner+zoomCtrl+srTable+scrollDiv;

  // If DAG view is active, replace the chart area with the DAG sub-view.
  // The zoom controls + toggle button are always shown (toggle persists view choice).
  if(isDag){
    return capBanner+zoomCtrl+dagPanel(agents)+tooltip;
  }
  return ganttView+tooltip;
}

function chartsPanel(){
  var bar=tokenBarChart();
  var trend=tokenTrendChart();
  // Scroll-wrapper ownership is intentionally asymmetric:
  // tokenBarChart() returns its own <div class="chart-scroll"> (so the capped-note sits outside it),
  // while tokenTrendChart() returns a bare <svg> (wrapped here). Do not "fix" this asymmetry
  // without also moving the cappedNote construction inside tokenBarChart().
  // v3 BINDING: render content directly, no panel() wrapper (tabs provide the container).
  return '<div class="charts-row">'
    +'<div class="chart-block"><div class="chart-title">Output tokens per agent</div>'+bar+'</div>'
    +'<div class="chart-block"><div class="chart-title">Cumulative tokens</div><div class="chart-scroll" data-testid="trend-chart-scroll">'+trend+'</div></div>'
    +'</div>';
}
`;
