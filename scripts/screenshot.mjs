// Headless render harness — screenshots the real getHtml() webview against a live
// snapshot in Chromium, so UI can be reviewed as PIXELS (catches the render-vs-string
// gaps that string tests miss). Usage: node scripts/screenshot.mjs [outDir]
import { build } from 'esbuild';
import { chromium } from 'playwright';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

const outDir = process.argv[2] || '.review-tmp/shots';
fs.mkdirSync(outDir, { recursive: true });

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, platform: 'node' });
  return import('data:text/javascript,' + encodeURIComponent(r.outputFiles[0].text));
}
const { getHtml } = await load('src/webview/html.ts');
const { buildSnapshot } = await load('src/data/snapshot.ts');

// Real snapshot from the newest run under this project's transcript dir.
// Claude Code sanitizes the cwd to its projects-dir name by replacing '/' with '-'.
// Override with CCWD_BASE=/path/to/.claude/projects/<sanitized> if needed.
const base = process.env.CCWD_BASE
  || path.join(os.homedir(), '.claude/projects', process.cwd().replace(/\//g, '-'));
const snap = buildSnapshot({ base, repo: process.cwd(), roleRules: [] });
console.log('snapshot ok=%s runId=%s agents=%s findings=%s',
  snap.ok, snap.runId, snap.agents?.length, snap.allFindings?.length);

// Minimal dark VS Code theme palette (set as CSS custom props — CSP-safe, no inline style attr).
const DARK = {
  '--vscode-foreground': '#cccccc', '--vscode-editor-background': '#1e1e1e',
  '--vscode-font-family': '-apple-system,system-ui,sans-serif', '--vscode-editor-font-family': 'monospace',
  '--vscode-sideBar-background': '#252526', '--vscode-sideBarSectionHeader-background': '#2d2d2d',
  '--vscode-panel-border': '#3c3c3c', '--vscode-editorWidget-background': '#252526',
  '--vscode-badge-background': '#4d4d4d', '--vscode-badge-foreground': '#ffffff',
  '--vscode-button-background': '#0e639c', '--vscode-button-foreground': '#ffffff',
  '--vscode-button-hoverBackground': '#1177bb', '--vscode-focusBorder': '#007fd4',
  '--vscode-charts-blue': '#3794ff', '--vscode-charts-green': '#89d185', '--vscode-charts-red': '#f48771',
  '--vscode-charts-orange': '#d18616', '--vscode-charts-yellow': '#cca700',
  '--vscode-inputValidation-warningBorder': '#c4a000', '--vscode-inputValidation-warningForeground': '#cccccc',
};
const LIGHT = {
  ...DARK, '--vscode-foreground': '#333333', '--vscode-editor-background': '#ffffff',
  '--vscode-sideBar-background': '#f3f3f3', '--vscode-sideBarSectionHeader-background': '#e7e7e7',
  '--vscode-panel-border': '#d4d4d4', '--vscode-editorWidget-background': '#f3f3f3',
  '--vscode-badge-background': '#c4c4c4', '--vscode-badge-foreground': '#333333',
};

// Use the already-cached Chromium build (avoids a fresh ~130MB download); override via PW_CHROME.
const execPath = process.env.PW_CHROME || '/home/gagarin/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch(fs.existsSync(execPath) ? { executablePath: execPath } : {});
for (const [theme, vars, bg] of [['dark', DARK, '#1e1e1e'], ['light', LIGHT, '#ffffff']]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('  PAGEERR:', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  CONSOLE.ERR:', m.text()); });
  // Inject a nonce'd acquireVsCodeApi stub BEFORE the webview's inline script (CSP-safe).
  const nonce = 'shotnonce';
  const stub = `<script nonce="${nonce}">window.acquireVsCodeApi=function(){return{postMessage:function(){},setState:function(){},getState:function(){return null;}};};</script>`;
  await page.setContent(getHtml(nonce).replace('<body>', '<body>' + stub), { waitUntil: 'load' });
  await page.evaluate(({ vars, bg }) => {
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    document.body.style.background = bg;
  }, { vars, bg });
  await page.evaluate((snap) => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'snapshot', snap } }));
  }, snap);
  await page.waitForTimeout(400);
  const rootLen = await page.evaluate(() => document.getElementById('root')?.innerHTML.length || 0);
  console.log('  [%s] root innerHTML length after snapshot:', theme, rootLen);
  const file = path.join(outDir, `dashboard-${theme}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const top = path.join(outDir, `dashboard-${theme}-top.png`);
  await page.screenshot({ path: top, fullPage: false }); // above-the-fold, legible detail
  console.log('wrote', file, '+', top);
  await page.close();
}
await browser.close();
