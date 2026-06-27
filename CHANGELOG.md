# Change Log

## 0.4.0

- Renamed to **Claude Code Workflow Dashboard** (extension id
  `claude-code-workflow-dashboard`, publisher `gagarinlg`) and pointed
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
