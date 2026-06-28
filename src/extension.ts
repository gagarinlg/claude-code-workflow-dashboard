import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildSnapshot, CHANGED_MAX_SECS, MAX_AGENTS } from './data/snapshot';
import { getHtml } from './webview/html';
import type { Cfg, Snapshot, SnapshotOk } from './data/snapshot';
import type { RoleRule } from './data/parse';
import { DEFAULT_ROLE_RULES, STALE_SECS } from './data/parse';
import { listRecentRuns, formatRelativeTime } from './data/discovery';
import type { RecentRun } from './data/discovery';

// --- Module-level state ---
// All state declarations are hoisted above every function that closes over them
// so there is never a TDZ (Temporal Dead Zone) risk — getCfg() references
// pinnedDir, so pinnedDir must be declared before getCfg is defined.
// TODO(M2): move into an activation-context object to support clean reload
// across multiple activate() calls. Deferred from M1: the activate() reset
// block (lines ~239-262) already handles the re-activation hazard correctly;
// the structural refactor is a code-quality improvement, not a correctness fix.
let latest: Snapshot | null = null;
const webviews = new Set<vscode.Webview>();
let statusItem: vscode.StatusBarItem | null = null;
let watcher: fs.FSWatcher | null = null;
let watchedDir: string | null = null;
let editorPanel: vscode.WebviewPanel | null = null;

// Pinned run: when non-null, buildSnapshot uses this wf_* dir instead of
// the auto-discovered newest. Persisted per-workspace via workspaceState.
let pinnedDir: string | null = null;
const PINNED_RUN_KEY = 'claudeWorkflow.pinnedRun';

export function getCfg(): Cfg {
  const c = vscode.workspace.getConfiguration('claudeWorkflow');
  let base = c.get<string>('workflowsGlobBase');
  if (!base) base = path.join(os.homedir(), '.claude', 'projects');
  let repo = c.get<string>('repoDir');
  if (!repo) {
    const ws = vscode.workspace.workspaceFolders;
    repo = ws && ws.length ? (ws[0]?.uri.fsPath ?? '') : '';
  }
  const rules = c.get<RoleRule[]>('roleRules');
  return {
    base,
    repo: repo ?? '',
    refreshMs: Math.max(1000, c.get<number>('refreshMs') || 4000),
    statusBar: c.get<boolean>('statusBar') !== false,
    roleRules: rules && rules.length ? rules : DEFAULT_ROLE_RULES,
    pinnedDir: pinnedDir ?? undefined,
  };
}

// Strip workflowDir (absolute filesystem path) from any SnapshotOk before
// sending it to a webview. The webview JS never reads workflowDir, and
// omitting it reduces the information-disclosure surface if an XSS payload
// is ever injected into the webview. Used by both pushToAll() and the
// initial send in attachWebview() so both paths stay consistent.
function safeSnap(s: Snapshot | null): Snapshot | null {
  if (!s || !s.ok) return s;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { workflowDir: _wd, ...safe } = s as SnapshotOk;
  return safe as Snapshot;
}

function pushToAll(): void {
  for (const w of webviews) {
    try {
      w.postMessage({ type: 'snapshot', snap: safeSnap(latest) });
    } catch {} // webview may be disposed; postMessage on a disposed view throws
  }
}

function manageWatch(): void {
  if (!latest || !latest.ok) return;
  const ok = latest as SnapshotOk;
  const dir = ok.workflowDir;
  if (dir === watchedDir) return;
  if (watcher) {
    try { watcher.close(); } catch {} // watcher may already be closed; ignore
    watcher = null;
  }
  try {
    // Capture the specific instance before attaching the error handler so the
    // closure refers to 'w' (the exact watcher created here), not the module-level
    // 'watcher' variable. This prevents a stale-closure race where a delayed error
    // event on a previously-replaced watcher nulls the current active watcher.
    const w = fs.watch(dir, () => refresh());
    // Handle errors (e.g. EPERM when the watched dir is deleted on Windows) so
    // the unhandled-error event doesn't crash the Extension Host process.
    // close() is called on the specific instance to release the OS handle.
    // The module-level ref is only cleared when it still points to this watcher.
    // The polling timer continues to cover re-discovery after the watcher stops.
    w.on('error', () => {
      try { w.close(); } catch {}
      if (watcher === w) { watcher = null; watchedDir = null; }
    });
    watcher = w;
    watchedDir = dir;
  } catch {} // dir may not exist yet or may not be watchable; polling covers it
}

function updateStatusBar(): void {
  if (!statusItem) return;
  const cfg = getCfg();
  if (!cfg.statusBar) { statusItem.hide(); return; }
  if (latest && latest.ok) {
    const L = latest.loop;
    const icon = L.live > 0 ? '$(pulse)' : '$(circuit-board)';
    // Sanitize L.phase: it is derived from transcript-extracted agent role labels
    // and could contain newlines/tabs that would inject fake tooltip lines.
    const safePhase = L.phase.replace(/[\r\n\t]/g, ' ');
    statusItem.text = `${icon} Workflow${L.passes ? ' · pass ' + L.passes : ''} · ${L.live}▶ ${L.done}✓${L.findings ? ' · ' + L.findings + ' findings' : ''}`;
    const tokStr = L.outTok < 1000 ? L.outTok + ' output tokens' : (L.outTok / 1000).toFixed(1) + 'k output tokens';
    statusItem.tooltip = `Claude Code Workflow Dashboard — ${safePhase}\n${L.total} agents · ${L.live} live · ${L.dead} stalled\n${L.findings} findings · ${tokStr}\nClick to open the dashboard`;
  } else {
    statusItem.text = '$(circuit-board) Workflow Dashboard';
    statusItem.tooltip = 'No active workflow run found. Click to open the dashboard.';
  }
  statusItem.show();
}

function refresh(cfg?: Cfg): void {
  const c = cfg ?? getCfg();
  latest = buildSnapshot(c);
  pushToAll();
  manageWatch();
  updateStatusBar();
}

function attachWebview(webview: vscode.Webview, disposables: vscode.Disposable[], mode: 'panel' | 'sidebar' = 'panel'): void {
  // localResourceRoots: [] prevents the webview from loading local files via
  // vscode-resource: URIs — all resources are inlined, so no access is needed.
  webview.options = { enableScripts: true, localResourceRoots: [] };
  const nonce = crypto.randomBytes(16).toString('base64');
  webview.html = getHtml(nonce, CHANGED_MAX_SECS / 60, MAX_AGENTS, mode, STALE_SECS);
  webviews.add(webview);
  // Track the message-listener disposable so it is cancelled when the view is
  // disposed (or when the extension deactivates via context.subscriptions).
  const msgDisposable = webview.onDidReceiveMessage((m: unknown) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as Record<string, unknown>;
    if (msg['type'] === 'refresh') refresh();
    else if (msg['type'] === 'guide') vscode.commands.executeCommand('claudeWorkflow.openGuide');
    else if (msg['type'] === 'openFull') vscode.commands.executeCommand('claudeWorkflow.open');
    else if (msg['type'] === 'selectRun') vscode.commands.executeCommand('claudeWorkflow.selectRun');
  });
  disposables.push(msgDisposable);
  if (latest) {
    try { webview.postMessage({ type: 'snapshot', snap: safeSnap(latest) }); } catch {} // webview may be disposed
  }
}

class DashboardViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    // The sidebar pane is narrow; pass mode:'sidebar' so getHtml renders the
    // compact summary instead of the full six-panel layout.
    attachWebview(view.webview, this.ctx.subscriptions, 'sidebar');
    view.onDidDispose(() => webviews.delete(view.webview));
    if (!latest) refresh();
  }
}

async function runSelectRun(ctx: vscode.ExtensionContext): Promise<void> {
  const cfg = getCfg();
  const runs = listRecentRuns(cfg.base);

  if (!runs.length) {
    vscode.window.showInformationMessage(
      'No workflow runs (wf_*) found under the configured Workflows Glob Base.',
    );
    return;
  }

  // Build QuickPick items: "Follow newest" first, then all runs newest-first.
  const followItem: vscode.QuickPickItem = {
    label: '$(arrow-up) Follow newest',
    description: pinnedDir ? 'Pinned run active — click to unpin' : 'Following newest run automatically',
    alwaysShow: true,
  };

  const runItems: (vscode.QuickPickItem & { run: RecentRun })[] = runs.map((r) => {
    const agents = r.agentCount === 1 ? '1 agent' : `${r.agentCount} agents`;
    const pinned = pinnedDir === r.dir;
    return {
      label: `$(circuit-board) ${r.runId}`,
      description: `${formatRelativeTime(r.mtimeMs)} · ${agents}${pinned ? '  $(pin)' : ''}`,
      run: r,
    };
  });

  const picked = await vscode.window.showQuickPick(
    [followItem, ...runItems],
    {
      title: 'Select Workflow Run',
      placeHolder: 'Choose a run to pin, or "Follow newest" to track automatically',
      matchOnDescription: true,
    },
  );

  if (!picked) return; // user dismissed

  if (picked === followItem) {
    // Reset pin — follow newest
    pinnedDir = null;
    await ctx.workspaceState.update(PINNED_RUN_KEY, undefined);
  } else {
    // Pin the selected run
    const item = picked as typeof runItems[number];
    pinnedDir = item.run.dir;
    await ctx.workspaceState.update(PINNED_RUN_KEY, pinnedDir);
  }

  refresh();
}

function openEditorPanel(): void {
  if (editorPanel) { editorPanel.reveal(); return; }
  const panelDisposables: vscode.Disposable[] = [];
  editorPanel = vscode.window.createWebviewPanel(
    'claudeWorkflowPanel',
    'Claude Code Workflow Dashboard',
    vscode.ViewColumn.Active,
    // localResourceRoots: [] — all resources are inlined; no local file access needed.
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );
  attachWebview(editorPanel.webview, panelDisposables);
  editorPanel.onDidDispose(() => {
    if (editorPanel) webviews.delete(editorPanel.webview);
    editorPanel = null;
    panelDisposables.forEach((d) => d.dispose());
  });
}

export function activate(context: vscode.ExtensionContext): void {
  // Reset module-level state on each activate() call. VS Code can deactivate
  // and reactivate an extension without unloading the module (e.g. F5 in the
  // Extension Development Host). Without a reset, stale Webview and StatusBarItem
  // references from the prior session leak, causing ghost status-bar items and
  // postMessage() calls to disposed webviews. TODO(M2): move into an activation-context object.
  latest = null;
  webviews.clear();

  // Restore the pinned run from workspaceState so the pin survives window reloads.
  pinnedDir = context.workspaceState.get<string>(PINNED_RUN_KEY) ?? null;
  // Close the fs.FSWatcher before resetting watchedDir. If VS Code re-activates
  // without a prior deactivate() (e.g. F5 in the Extension Development Host),
  // the old watcher would keep firing refresh() callbacks against the new state,
  // and if the new run lands in the same directory manageWatch() would never
  // replace it — accumulating one watcher per reload cycle.
  if (watcher) {
    try { watcher.close(); } catch {} // watcher may already be closed; ignore
    watcher = null;
  }
  watchedDir = null;
  if (editorPanel) {
    try { editorPanel.dispose(); } catch {} // dispose before null to avoid zombie panel on F5 reload
    editorPanel = null;
  }
  if (statusItem) {
    statusItem.dispose();
    statusItem = null;
  }

  statusItem = vscode.window.createStatusBarItem('claudeWorkflow.status', vscode.StatusBarAlignment.Left, 100);
  statusItem.command = 'claudeWorkflow.focus';
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeWorkflow.dashboard', new DashboardViewProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('claudeWorkflow.open', () => openEditorPanel()),
    vscode.commands.registerCommand('claudeWorkflow.focus', () =>
      vscode.commands.executeCommand('claudeWorkflow.dashboard.focus')),
    vscode.commands.registerCommand('claudeWorkflow.refresh', () => refresh()),
    vscode.commands.registerCommand('claudeWorkflow.openGuide', () => {
      const uri = vscode.Uri.file(path.join(context.extensionPath, 'WORKFLOW-AUTHORING.md'));
      vscode.commands.executeCommand('markdown.showPreview', uri).then(undefined, () =>
        vscode.commands.executeCommand('vscode.open', uri));
    }),
    vscode.commands.registerCommand('claudeWorkflow.selectRun', () => runSelectRun(context)),
  );

  // Self-rescheduling setTimeout so refreshMs is re-read from settings on every
  // tick. setInterval captures the period once at activation and ignores later
  // claudeWorkflow.refreshMs changes; setTimeout re-reads getCfg().refreshMs
  // after each callback, so a user who changes the setting sees the new interval
  // on the next tick without needing to reload the window.
  let timer: ReturnType<typeof setTimeout> | null = null;
  function scheduleRefresh(): void {
    timer = setTimeout(() => { refresh(); scheduleRefresh(); }, getCfg().refreshMs);
  }
  context.subscriptions.push({ dispose: () => { if (timer !== null) clearTimeout(timer); } });
  scheduleRefresh();
  refresh();
}

export function deactivate(): void {
  if (watcher) {
    try { watcher.close(); } catch {} // watcher may already be closed; deactivation must not throw
    watcher = null;
    watchedDir = null;
  }
}
