# Change Log

## 0.5.0

- **TypeScript migration:** converted `extension.js` to TypeScript (`strict` mode)
  and split it into focused modules: `src/extension.ts` (host wiring),
  `src/data/discovery.ts`, `src/data/parse.ts`, `src/data/snapshot.ts`,
  `src/data/changed.ts`, and `src/webview/html.ts`.
- **Build pipeline:** added `esbuild` via `build.mjs`; `npm run build` produces
  `dist/extension.js` (CommonJS, minified, `vscode` external). `npm run watch`
  rebuilds with inline source maps on every change.
- **Unit tests:** added **vitest** with a 90 % line/branch/function/statement
  coverage gate on `src/data/**`. Test fixtures cover a basic run, a partial/
  malformed JSONL run, and the baseline empty state.
- **Linting:** ESLint flat config (`eslint.config.mjs`) using `typescript-eslint`.
- **Type-checking:** `npm run typecheck` (tsc `--noEmit` wrapper in
  `scripts/typecheck.mjs`).
- **CI update:** `npm ci`, `npm run lint`, `npm run coverage` (90 % gate on
  `src/data/**` and `src/webview/**`), then `vsce package` in all three workflows
  (ci / release / nightly).
- **Security fixes (applied during html.ts migration):** upgraded webview CSP from
  `unsafe-inline` to a per-load nonce; fixed HTML injection in severity-key rendering
  (`agentSub`, `findingsPanel` chips and rows); extended `esc()` to escape double- and
  single-quotes; escaped `a.id` in `data-aid` attribute. No changes to parsing logic
  or data model — host-to-webview snapshot contract is unchanged.

## 0.4.0

- Renamed to **Claude Code Workflow Dashboard** (extension id
  `claude-code-workflow-dashboard`, publisher `malte-langermann`) and pointed
  repository/bugs/homepage at `github.com/gagarinlg/claude-code-workflow-dashboard`.
- Relicensed from MIT to **GPL-3.0-or-later**.
- Added GitHub Actions CI (lint/package on every push & PR), a tag-driven
  release workflow that publishes to the VS Code Marketplace and Open VSX, and a
  nightly pre-release workflow.

## 0.3.1

- Removed a broken relative image from the README that rendered as a broken icon
  on the extension detail page (the tile icon already represents the extension).

## 0.3.0

- Added the **Workflow Authoring Guide**, openable in-editor via the **📖 Guide**
  button, the Dashboard view-title **book icon**, or the command *Open Workflow
  Authoring Guide*. Linked from the README (extension detail page).

## 0.2.0

- Renamed to **Claude Workflow Dashboard**; full publishable manifest (icon,
  categories, keywords, gallery banner, repository/bugs/homepage).
- Added a **status-bar launcher** with live phase/agent counts (click to open).
- Added an **Activity Bar view container** with a docked **Dashboard** webview.
- Added commands *Open Dashboard in Editor*, *Show Dashboard*, *Refresh*, a
  view-title menu, and the **`Ctrl/Cmd+Alt+W`** keybinding.
- Activates on startup so the status bar appears automatically.
- Settings now default sensibly (`~/.claude/projects`, first workspace folder).

## 0.1.1

- Preserve scroll position (page and each expanded agent sub-window) across
  refreshes so live output no longer jumps to the top.

## 0.1.0

- Initial dashboard: loop & agent overview, per-agent output sub-windows,
  findings, verify/structured results, verdicts, changed files. Generic across
  workflows; auto-discovers the newest run.
