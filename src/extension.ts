import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildSnapshot } from './data/snapshot';
import { getHtml } from './webview/html';
import type { Cfg, Snapshot } from './data/snapshot';
import type { RoleRule } from './data/parse';
import { DEFAULT_ROLE_RULES } from './data/parse';

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
    refreshMs: c.get<number>('refreshMs') || 4000,
    statusBar: c.get<boolean>('statusBar') !== false,
    roleRules: rules && rules.length ? rules : DEFAULT_ROLE_RULES,
  };
}

// --- Module-level state ---
let latest: Snapshot | null = null;
const webviews = new Set<vscode.Webview>();
let statusItem: vscode.StatusBarItem | null = null;
let watcher: fs.FSWatcher | null = null;
let watchedDir: string | null = null;
let editorPanel: vscode.WebviewPanel | null = null;

function pushToAll(): void {
  for (const w of webviews) {
    try {
      w.postMessage({ type: 'snapshot', snap: latest });
    } catch {}
  }
}

function manageWatch(cfg: Cfg): void {
  if (!latest || !latest.ok) return;
  const dir = (latest as { ok: true; workflowDir: string }).workflowDir;
  if (dir === watchedDir) return;
  if (watcher) {
    try { watcher.close(); } catch {}
    watcher = null;
  }
  try {
    watcher = fs.watch(dir, () => refresh(cfg));
    watchedDir = dir;
  } catch {}
}

function updateStatusBar(): void {
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

function refresh(cfg?: Cfg): void {
  const c = cfg ?? getCfg();
  latest = buildSnapshot(c);
  pushToAll();
  manageWatch(c);
  updateStatusBar();
}

function attachWebview(webview: vscode.Webview): void {
  webview.options = { enableScripts: true };
  webview.html = getHtml();
  webviews.add(webview);
  webview.onDidReceiveMessage((m: unknown) => {
    if (!m || typeof m !== 'object') return;
    const msg = m as Record<string, unknown>;
    if (msg['type'] === 'refresh') refresh();
    else if (msg['type'] === 'guide') vscode.commands.executeCommand('claudeWorkflow.openGuide');
  });
  if (latest) {
    try { webview.postMessage({ type: 'snapshot', snap: latest }); } catch {}
  }
}

class DashboardViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(view: vscode.WebviewView): void {
    attachWebview(view.webview);
    view.onDidDispose(() => webviews.delete(view.webview));
    if (!latest) refresh();
  }
}

function openEditorPanel(): void {
  if (editorPanel) { editorPanel.reveal(); return; }
  editorPanel = vscode.window.createWebviewPanel(
    'claudeWorkflowPanel',
    'Claude Code Workflow Dashboard',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );
  attachWebview(editorPanel.webview);
  editorPanel.onDidDispose(() => {
    if (editorPanel) webviews.delete(editorPanel.webview);
    editorPanel = null;
  });
}

export function activate(context: vscode.ExtensionContext): void {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.command = 'claudeWorkflow.focus';
  context.subscriptions.push(statusItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeWorkflow.dashboard', new DashboardViewProvider(), {
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
  );

  const timer = setInterval(() => refresh(), getCfg().refreshMs);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  refresh();
}

export function deactivate(): void {
  if (watcher) {
    try { watcher.close(); } catch {}
  }
}
