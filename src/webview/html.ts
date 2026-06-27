// Webview HTML template for the Claude Code Workflow Dashboard.
//
// CSS and JS are kept as opaque template string constants — the embedded
// webview client JS runs in the webview DOM (not under tsc) and is intentionally
// untyped. Do NOT attempt to type the JS constant.
//
// Security fix applied during M0-T2 migration: the severity key used in
// overview() sev-span building is now HTML-escaped before injection, closing
// a stored-XSS path where a crafted severity string in a transcript could
// inject arbitrary HTML attributes.

export function getHtml(): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${CSS}</style></head>
<body>
<div id="bar"><span id="title">Claude Workflow</span><span id="meta" class="dim"></span><span class="grow"></span><span id="toggles"></span><button id="guideBtn" title="Open the workflow authoring guide">📖 Guide</button><button id="refreshBtn" title="Refresh now">⟳</button></div>
<div id="root"><div class="dim pad">Looking for an active workflow run…</div></div>
<script>${JS}</script>
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
.panel{margin:12px;border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:hidden}
.panel>h3{margin:0;padding:8px 12px;background:var(--vscode-sideBarSectionHeader-background);font-size:12px;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--vscode-panel-border)}
.panel>.body{padding:10px 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}
.card{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 10px;background:var(--vscode-editorWidget-background)}
.card.run{border-color:var(--vscode-charts-green,#3fb950)}
.card.dead{opacity:.45}
.row{display:flex;align-items:center;gap:8px;cursor:pointer}
.role{font-weight:600}
.st{font-size:11px;padding:1px 6px;border-radius:10px}
.st.run{background:rgba(63,185,80,.2);color:var(--vscode-charts-green,#3fb950)}
.st.done{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.st.dead{background:rgba(248,81,73,.18);color:var(--vscode-charts-red,#f85149)}
.kpis{display:flex;gap:16px;flex-wrap:wrap;font-size:12px}
.kpi b{font-size:18px}
.activity{margin-top:6px;font-size:11px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{margin-top:8px;border-top:1px dashed var(--vscode-panel-border);padding-top:8px;display:none;max-height:340px;overflow:auto}
.card.open .sub{display:block}
.ev{font-family:var(--vscode-editor-font-family);font-size:11px;padding:3px 0;border-bottom:1px solid var(--vscode-panel-border);white-space:pre-wrap;word-break:break-word}
.ev.tool{opacity:.7}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{text-align:left;padding:4px 8px;border-bottom:1px solid var(--vscode-panel-border);vertical-align:top}
.sev{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px}
.CRITICAL{background:#7d1a1a;color:#fff}.HIGH{background:#a5460f;color:#fff}.MEDIUM{background:#8a6d00;color:#fff}.LOW{background:#1f5a8a;color:#fff}.NITPICK{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}.UNRATED{background:#444;color:#fff}
.ok{color:var(--vscode-charts-green,#3fb950)}.bad{color:var(--vscode-charts-red,#f85149)}
.finding{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 9px;margin-bottom:6px}
.finding .ttl{cursor:pointer}
.finding .detail{display:none;margin-top:6px;font-size:12px}
.finding.open .detail{display:block}
.finding .loc{font-family:var(--vscode-editor-font-family);opacity:.7;font-size:11px}
.filters{margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap}
.chip{font-size:11px;padding:2px 8px;border:1px solid var(--vscode-panel-border);border-radius:12px;cursor:pointer}
.chip.off{opacity:.4}
.files li{font-family:var(--vscode-editor-font-family);font-size:11px;list-style:none}
pre{margin:0;font-family:var(--vscode-editor-font-family);font-size:11px;white-space:pre-wrap;word-break:break-word}
`;

// JS is an opaque template string — it runs in the webview DOM under
// acquireVsCodeApi() and is not typed by tsc. The severity-key XSS fix:
// esc() is applied to the severity key `s` before using it as a CSS class
// name and as inner text in the overview sev-span builder.
const JS = `
const api = acquireVsCodeApi();
const PANELS=[['overview','Overview'],['agents','Agents'],['findings','Findings'],['results','Results'],['verdicts','Verdicts'],['changed','Changed files']];
let state = api.getState() || { on:{overview:1,agents:1,findings:1,results:1,verdicts:1,changed:1}, openAgents:{}, openFind:{}, fRev:{}, fSev:{} };
let snap=null;
function save(){api.setState(state);}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtT(s){s=s||0;if(s<60)return s+'s';if(s<3600)return Math.floor(s/60)+'m'+String(s%60).padStart(2,'0')+'s';return Math.floor(s/3600)+'h'+String(Math.floor(s%3600/60)).padStart(2,'0')+'m';}

const tg=document.getElementById('toggles');
PANELS.forEach(([k,lbl])=>{const l=document.createElement('label');const cb=document.createElement('input');cb.type='checkbox';cb.checked=state.on[k]!==0;cb.onchange=()=>{state.on[k]=cb.checked?1:0;save();render();};l.appendChild(cb);l.appendChild(document.createTextNode(' '+lbl));tg.appendChild(l);});
document.getElementById('refreshBtn').onclick=()=>api.postMessage({type:'refresh'});
document.getElementById('guideBtn').onclick=()=>api.postMessage({type:'guide'});
window.addEventListener('message',e=>{if(e.data&&e.data.type==='snapshot'){snap=e.data.snap;render();}});

function render(){
  const root=document.getElementById('root');
  if(!snap){root.innerHTML='<div class="dim pad">Looking for an active workflow run…</div>';return;}
  if(!snap.ok){root.innerHTML='<div class="pad bad">'+esc(snap.msg)+'</div>';return;}
  document.getElementById('meta').textContent=snap.runId+' · updated '+snap.updatedAt;
  const sy=window.scrollY;
  const subPos={};
  document.querySelectorAll('.card.open').forEach(c=>{const s=c.querySelector('.sub');if(s)subPos[c.dataset.aid]=s.scrollTop;});
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
}
function panel(t,b){return '<div class="panel"><h3>'+t+'</h3><div class="body">'+b+'</div></div>';}

function overview(){
  const L=snap.loop;
  let sev='';for(const s in L.sevTotals){const es=esc(s);sev+='<span class="sev '+es+'">'+es+' '+L.sevTotals[s]+'</span>';}
  const body='<div class="kpis">'
    +(L.passes?'<div class="kpi"><div class="dim">Passes</div><b>'+L.passes+'</b></div>':'')
    +'<div class="kpi"><div class="dim">Phase</div><b>'+esc(L.phase)+'</b></div>'
    +'<div class="kpi"><div class="dim">Live</div><b class="ok">'+L.live+'</b></div>'
    +'<div class="kpi"><div class="dim">Done</div><b>'+L.done+'</b></div>'
    +'<div class="kpi"><div class="dim">Dead</div><b>'+L.dead+'</b></div>'
    +'<div class="kpi"><div class="dim">Agents</div><b>'+L.total+'</b></div>'
    +'<div class="kpi"><div class="dim">Output</div><b>'+(L.outTok/1000).toFixed(0)+'k</b></div>'
    +'<div class="kpi"><div class="dim">Tool-calls</div><b>'+L.tools+'</b></div>'
    +'<div class="kpi"><div class="dim">Findings</div><b>'+L.findings+'</b></div>'
    +'</div>'+(sev?('<div style="margin-top:8px">'+sev+'</div>'):'');
  return panel('Loop &amp; agent overview',body);
}

function agentSub(a){
  if(a.findings)return a.findings.map(f=>'<div class="ev"><span class="sev '+(f.severity||'UNRATED')+'">'+(f.severity||'?')+'</span>'+esc(f.title||JSON.stringify(f).slice(0,120))+'</div>').join('')||'<div class="ev dim">no findings</div>';
  if(a.result)return '<pre>'+esc(JSON.stringify(a.result,null,2))+'</pre>';
  if(a.resultText)return '<pre>'+esc(a.resultText.slice(0,4000))+'</pre>';
  return (a.tail||[]).slice(-20).map(t=>'<div class="ev '+(t.kind==='tool'?'tool':'')+'">'+esc(t.text)+'</div>').join('')||'<div class="ev dim">no output yet</div>';
}
function agentsPanel(){
  const cards=snap.agents.map(a=>{
    const open=state.openAgents[a.id]?'open':'';
    return '<div class="card '+a.status+' '+open+'" data-aid="'+a.id+'">'
      +'<div class="row"><span class="role">'+esc(a.label)+'</span><span class="st '+a.status+'">'+a.status+'</span><span class="grow"></span><span class="dim">'+fmtT(a.elapsed)+'</span></div>'
      +'<div class="dim" style="font-size:11px">'+a.tools+' tool-calls · '+(a.tokens/1000).toFixed(1)+'k out'+(a.findings?(' · '+a.findings.length+' findings'):'')+'</div>'
      +(a.status==='run'?'<div class="activity">↳ '+esc(a.lastActivity)+'</div>':'')
      +'<div class="sub">'+agentSub(a)+'</div></div>';
  }).join('');
  return panel('Agents — click a card for its output / findings','<div class="cards">'+cards+'</div>');
}

function findingsPanel(){
  snap.labels.forEach(l=>{if(state.fRev[l]===undefined)state.fRev[l]=1;});
  const sevs=[...new Set(snap.allFindings.map(f=>f.severity||'UNRATED'))];
  sevs.forEach(s=>{if(state.fSev[s]===undefined)state.fSev[s]=1;});
  let chips='<div class="filters">';
  snap.labels.forEach(l=>chips+='<span class="chip rev '+(state.fRev[l]?'':'off')+'" data-rev="'+esc(l)+'">'+esc(l)+'</span>');
  chips+='<span class="dim">|</span>';
  sevs.forEach(s=>chips+='<span class="chip fsev '+(state.fSev[s]?'':'off')+'" data-sev="'+s+'">'+s+'</span>');
  chips+='</div>';
  const list=snap.allFindings.filter(f=>state.fRev[f.reviewer]&&state.fSev[f.severity||'UNRATED']);
  const byP={};list.forEach(f=>{(byP[f.pass]=byP[f.pass]||[]).push(f);});
  let body=chips;
  Object.keys(byP).sort((a,b)=>b-a).forEach(p=>{
    body+='<div class="dim" style="margin:6px 0">Pass '+p+' — '+byP[p].length+'</div>';
    body+=byP[p].map(f=>{
      const id=f.reviewer+p+'|'+(f.location||f.title||'');
      const open=state.openFind[id]?'open':'';
      return '<div class="finding '+open+'" data-fid="'+esc(id)+'"><div class="ttl"><span class="sev '+(f.severity||'UNRATED')+'">'+(f.severity||'?')+'</span><b>'+esc(f.title||'(untitled)')+'</b> <span class="dim">['+esc(f.reviewer)+']</span></div>'
        +(f.location?'<div class="loc">'+esc(f.location)+'</div>':'')
        +'<div class="detail">'+(f.why?'<div><b>Why:</b> '+esc(f.why)+'</div>':'')+(f.fix?'<div style="margin-top:4px"><b>Fix:</b> '+esc(f.fix)+'</div>':'')+'</div></div>';
    }).join('');
  });
  if(!list.length)body+='<div class="dim">No findings match the filters.</div>';
  return panel('Findings',body);
}

function resultsPanel(){
  const body=snap.structuredResults.map(r=>'<div class="finding"><div class="ttl"><b>'+esc(r.label)+'</b> <span class="dim">pass '+r.pass+'</span></div><pre>'+esc(JSON.stringify(r.result,null,2))+'</pre></div>').join('');
  return panel('Structured results',body);
}
function verdictsPanel(){
  const body=Object.keys(snap.verdicts).map(l=>'<div style="margin-bottom:6px"><b>'+esc(l)+'</b> <span class="dim">'+esc(snap.verdicts[l]||'(pending)')+'</span></div>').join('');
  return panel('Latest verdicts',body);
}
function changedPanel(){
  const f=snap.changed||[];
  return panel('Repo files changed &lt; 2 min',f.length?'<ul class="files">'+f.map(x=>'<li>~ '+esc(x)+'</li>').join('')+'</ul>':'<div class="dim">nothing recent</div>');
}

function wire(){
  document.querySelectorAll('.card').forEach(c=>{c.querySelector('.row').onclick=()=>{const id=c.dataset.aid;state.openAgents[id]=!state.openAgents[id];save();c.classList.toggle('open');};});
  document.querySelectorAll('.finding .ttl').forEach(t=>t.onclick=()=>{const fd=t.closest('.finding');const id=fd.dataset.fid;if(!id)return;state.openFind[id]=!state.openFind[id];save();fd.classList.toggle('open');});
  document.querySelectorAll('.chip.rev').forEach(ch=>ch.onclick=()=>{const k=ch.dataset.rev;state.fRev[k]=state.fRev[k]?0:1;save();render();});
  document.querySelectorAll('.chip.fsev').forEach(ch=>ch.onclick=()=>{const k=ch.dataset.sev;state.fSev[k]=state.fSev[k]?0:1;save();render();});
}
render();
`;
