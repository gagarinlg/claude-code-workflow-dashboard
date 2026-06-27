'use strict';
const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const STALE_SECS = 90;

// Default role-labelling rules (workflow-specific niceties; the viewer works
// without them via deriveLabel()). Each: { re: <regex source>, label, key }.
const DEFAULT_ROLE_RULES = [
  { re: 'SENIOR FULL-STACK DEVELOPER fixing', label: 'Fix', key: 'fix' },
  { re: 'build/test verifier', label: 'Verify', key: 'verify' },
  { re: 'GRUMPY, SENIOR FULL-STACK/BACKEND DEVELOPER reviewing', label: 'Dev review', key: 'dev' },
  { re: 'NITPICKY, GRUMPY, SENIOR UX DESIGNER', label: 'UX review', key: 'ux' },
  { re: 'NEXTCLOUD APP-STORE REVIEWER', label: 'Compliance', key: 'comp' },
];

function getCfg() {
  const c = vscode.workspace.getConfiguration('claudeWorkflow');
  let base = c.get('workflowsGlobBase');
  if (!base) base = path.join(os.homedir(), '.claude', 'projects');
  let repo = c.get('repoDir');
  if (!repo) {
    const ws = vscode.workspace.workspaceFolders;
    repo = ws && ws.length ? ws[0].uri.fsPath : '';
  }
  const rules = c.get('roleRules');
  return {
    base,
    repo,
    refreshMs: c.get('refreshMs') || 4000,
    statusBar: c.get('statusBar') !== false,
    roleRules: rules && rules.length ? rules : DEFAULT_ROLE_RULES,
  };
}

function jload(p) {
  const out = [];
  let data;
  try { data = fs.readFileSync(p, 'utf8'); } catch { return out; }
  for (const line of data.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* partial trailing line */ }
  }
  return out;
}

function firstUserText(events) {
  for (const o of events) {
    if (o.type === 'user') {
      const m = o.message;
      const c = m && m.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) for (const b of c) if (b && b.type === 'text') return b.text || '';
    }
  }
  return '';
}

function deriveLabel(text) {
  if (!text) return 'agent';
  const m = text.match(/You are (?:an?|the)\s+([^.,;:\n]{3,48})/i);
  if (m) return m[1].trim().replace(/\s+/g, ' ');
  return text.replace(/\s+/g, ' ').slice(0, 40).trim() || 'agent';
}

function classify(text, roleRules) {
  for (const r of roleRules) {
    try { if (new RegExp(r.re, 'i').test(text)) return { label: r.label, key: r.key || r.label.toLowerCase() }; }
    catch { if (text.includes(r.re)) return { label: r.label, key: r.key || r.label.toLowerCase() }; }
  }
  const lbl = deriveLabel(text);
  return { label: lbl, key: lbl.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24) };
}

function agentStats(events) {
  let outTok = 0, tools = 0;
  const tail = [];
  for (const o of events) {
    if (o.type !== 'assistant') continue;
    const m = o.message;
    if (!m || typeof m !== 'object') continue;
    if (m.usage && typeof m.usage.output_tokens === 'number') outTok += m.usage.output_tokens;
    for (const b of (m.content || [])) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'tool_use') {
        tools++;
        let inp = '';
        try { inp = JSON.stringify(b.input).slice(0, 180); } catch {}
        tail.push({ kind: 'tool', text: `[${b.name}] ${inp}` });
      } else if (b.type === 'text' && (b.text || '').trim()) {
        tail.push({ kind: 'text', text: b.text.trim() });
      }
    }
  }
  return { outTok, tools, tail: tail.slice(-30) };
}

// Recursively find the newest .../subagents/workflows/wf_* directory under base.
function findWorkflowDir(base, depth = 5) {
  let best = null, bestM = 0;
  const visit = (dir, d) => {
    if (d < 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith('wf_') && path.basename(dir) === 'workflows') {
        let m; try { m = fs.statSync(p).mtimeMs; } catch { continue; }
        if (m > bestM) { bestM = m; best = p; }
      } else if (e.name === 'node_modules' || e.name === 'vendor') {
        continue;
      } else {
        visit(p, d - 1);
      }
    }
  };
  visit(base, depth);
  return best;
}

function sevCounts(findings) {
  const c = {};
  for (const f of findings || []) {
    const s = (f && f.severity) ? f.severity : 'UNRATED';
    c[s] = (c[s] || 0) + 1;
  }
  return c;
}

function walkChanged(repo, maxAgeSec) {
  if (!repo || !fs.existsSync(repo)) return null;
  const now = Date.now() / 1000;
  const out = [];
  const walk = (dir) => {
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue; walk(p); }
      else { try { if (now - fs.statSync(p).mtimeMs / 1000 < maxAgeSec) out.push(path.relative(repo, p)); } catch {} }
    }
  };
  walk(repo);
  return out.sort().slice(0, 30);
}

function buildSnapshot(cfg) {
  const wfDir = findWorkflowDir(cfg.base);
  if (!wfDir) return { ok: false, msg: `No workflow run (wf_*) found under ${cfg.base}` };
  const now = Date.now() / 1000;
  const journal = jload(path.join(wfDir, 'journal.jsonl'));
  const doneIds = new Set(journal.filter((o) => o.type === 'result').map((o) => o.agentId));
  const resultByAgent = {};
  for (const o of journal) if (o.type === 'result') resultByAgent[o.agentId] = o.result;

  let files = [];
  try { files = fs.readdirSync(wfDir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl')); } catch {}
  const agents = [];
  for (const fn of files) {
    const aid = fn.slice('agent-'.length, -'.jsonl'.length);
    const fp = path.join(wfDir, fn);
    const events = jload(fp);
    if (!events.length) continue;
    const { label, key } = classify(firstUserText(events), cfg.roleRules);
    let start;
    const metaP = path.join(wfDir, `agent-${aid}.meta.json`);
    try { start = fs.statSync(metaP).mtimeMs / 1000; } catch { start = fs.statSync(fp).mtimeMs / 1000; }
    const mtime = fs.statSync(fp).mtimeMs / 1000;
    const status = doneIds.has(aid) ? 'done' : (now - mtime < STALE_SECS ? 'run' : 'dead');
    const { outTok, tools, tail } = agentStats(events);
    const res = resultByAgent[aid];
    const a = {
      id: aid, label, key, status,
      elapsed: status === 'run' ? Math.round(now - start) : Math.round(mtime - start),
      tokens: outTok, tools, tail,
      lastActivity: tail.length ? tail[tail.length - 1].text : '(starting…)',
      start, mtime,
    };
    if (res && typeof res === 'object' && Array.isArray(res.findings)) { a.findings = res.findings; a.verdict = res.verdict || ''; }
    else if (res && typeof res === 'object') a.result = res;
    else if (typeof res === 'string') a.resultText = res;
    agents.push(a);
  }
  agents.sort((x, y) => x.start - y.start);
  agents.forEach((a, i) => { a.idx = i + 1; });

  const seen = {};
  const allFindings = [];
  const verdicts = {};
  const structuredResults = [];
  for (const o of journal) {
    if (o.type !== 'result') continue;
    const res = o.result;
    const a = agents.find((x) => x.id === o.agentId);
    const label = a ? a.label : 'agent';
    const key = a ? a.key : '?';
    if (res && typeof res === 'object' && Array.isArray(res.findings)) {
      seen[key] = (seen[key] || 0) + 1;
      const pass = seen[key];
      verdicts[label] = (res.verdict || '').replace(/\n/g, ' ');
      for (const f of res.findings) allFindings.push({ pass, reviewer: label, key, ...f });
    } else if (res && typeof res === 'object') {
      seen[key] = (seen[key] || 0) + 1;
      structuredResults.push({ pass: seen[key], label, key, result: res });
    }
  }

  const live = agents.filter((a) => a.status === 'run');
  let phase = live.length ? 'Working' : 'idle / between passes';
  if (live.length) phase = live.reduce((p, c) => (c.mtime > p.mtime ? c : p)).label;

  return {
    ok: true,
    runId: path.basename(wfDir),
    workflowDir: wfDir,
    updatedAt: new Date().toLocaleTimeString(),
    loop: {
      phase,
      live: live.length,
      done: agents.filter((a) => a.status === 'done').length,
      dead: agents.filter((a) => a.status === 'dead').length,
      total: agents.length,
      outTok: agents.reduce((s, a) => s + a.tokens, 0),
      tools: agents.reduce((s, a) => s + a.tools, 0),
      passes: Math.max(0, ...Object.values(seen)),
      findings: allFindings.length,
      sevTotals: sevCounts(allFindings),
    },
    labels: [...new Set(allFindings.map((f) => f.reviewer))],
    agents,
    allFindings,
    structuredResults,
    verdicts,
    changed: cfg.repo ? walkChanged(cfg.repo, 120) : null,
  };
}

// ----------------------------------------------------------------------------
// Activation: one shared snapshot pushed to a sidebar view, an optional editor
// panel, and a live status-bar item.
// ----------------------------------------------------------------------------
let latest = null;
const webviews = new Set();
let statusItem = null;
let watcher = null;
let watchedDir = null;

function pushToAll() {
  for (const w of webviews) { try { w.postMessage({ type: 'snapshot', snap: latest }); } catch {} }
}

function manageWatch(cfg) {
  if (!latest || !latest.ok) return;
  if (latest.workflowDir === watchedDir) return;
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  try { watcher = fs.watch(latest.workflowDir, () => refresh(cfg)); watchedDir = latest.workflowDir; } catch {}
}

function updateStatusBar() {
  if (!statusItem) return;
  const cfg = getCfg();
  if (!cfg.statusBar) { statusItem.hide(); return; }
  if (latest && latest.ok) {
    const L = latest.loop;
    const icon = L.live > 0 ? '$(pulse)' : '$(circuit-board)';
    statusItem.text = `${icon} Workflow${L.passes ? ' · P' + L.passes : ''} · ${L.live}▶ ${L.done}✓${L.findings ? ' · ' + L.findings + ' find' : ''}`;
    statusItem.tooltip = `Claude Workflow — ${L.phase}\n${L.total} agents · ${L.live} live · ${L.dead} dead\n${L.findings} findings · ${(L.outTok / 1000).toFixed(0)}k output tokens\nClick to open the dashboard`;
  } else {
    statusItem.text = '$(circuit-board) Claude Workflow';
    statusItem.tooltip = 'No active workflow run found. Click to open the dashboard.';
  }
  statusItem.show();
}

function refresh(cfg) {
  cfg = cfg || getCfg();
  latest = buildSnapshot(cfg);
  pushToAll();
  manageWatch(cfg);
  updateStatusBar();
}

function attachWebview(webview) {
  webview.options = { enableScripts: true };
  webview.html = getHtml();
  webviews.add(webview);
  webview.onDidReceiveMessage((m) => {
    if (!m) return;
    if (m.type === 'refresh') refresh();
    else if (m.type === 'guide') vscode.commands.executeCommand('claudeWorkflow.openGuide');
  });
  if (latest) { try { webview.postMessage({ type: 'snapshot', snap: latest }); } catch {} }
}

class DashboardViewProvider {
  resolveWebviewView(view) {
    attachWebview(view.webview);
    view.onDidDispose(() => webviews.delete(view.webview));
    if (!latest) refresh();
  }
}

let editorPanel = null;
function openEditorPanel() {
  if (editorPanel) { editorPanel.reveal(); return; }
  editorPanel = vscode.window.createWebviewPanel('claudeWorkflowPanel', 'Claude Code Workflow Dashboard', vscode.ViewColumn.Active, {
    enableScripts: true, retainContextWhenHidden: true,
  });
  attachWebview(editorPanel.webview);
  editorPanel.onDidDispose(() => { webviews.delete(editorPanel.webview); editorPanel = null; });
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = 'claudeWorkflow.focus';
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeWorkflow.dashboard', new DashboardViewProvider(), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('claudeWorkflow.open', () => openEditorPanel()),
    vscode.commands.registerCommand('claudeWorkflow.focus', () => vscode.commands.executeCommand('claudeWorkflow.dashboard.focus')),
    vscode.commands.registerCommand('claudeWorkflow.refresh', () => refresh()),
    vscode.commands.registerCommand('claudeWorkflow.openGuide', () => {
      const uri = vscode.Uri.file(path.join(context.extensionPath, 'WORKFLOW-AUTHORING.md'));
      vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, () =>
        vscode.commands.executeCommand('vscode.open', uri));
    }),
  );

  const timer = setInterval(() => refresh(), getCfg().refreshMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  refresh();
}

function deactivate() { if (watcher) { try { watcher.close(); } catch {} } }

function getHtml() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>${CSS}</style></head>
<body>
<div id="bar"><span id="title">Claude Workflow</span><span id="meta" class="dim"></span><span class="grow"></span><span id="toggles"></span><button id="guideBtn" title="Open the workflow authoring guide">📖 Guide</button><button id="refreshBtn" title="Refresh now">⟳</button></div>
<div id="root"><div class="dim pad">Looking for an active workflow run…</div></div>
<script>${JS}</script>
</body></html>`;
}

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

const JS = `
const api = acquireVsCodeApi();
const PANELS=[['overview','Overview'],['agents','Agents'],['findings','Findings'],['results','Results'],['verdicts','Verdicts'],['changed','Changed files']];
let state = api.getState() || { on:{overview:1,agents:1,findings:1,results:1,verdicts:1,changed:1}, openAgents:{}, openFind:{}, fRev:{}, fSev:{} };
let snap=null;
function save(){api.setState(state);}
function esc(s){return (s==null?'':String(s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
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
  let sev='';for(const s in L.sevTotals)sev+='<span class="sev '+s+'">'+s+' '+L.sevTotals[s]+'</span>';
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

module.exports = { activate, deactivate };
