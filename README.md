# Claude Code Workflow Dashboard

A live, theme-native dashboard for **Claude Code workflow runs**. It reads the
on-disk run journal and per-agent transcripts that every workflow writes, and
renders a continuously-updating view of the loop, every agent, and any review
findings — right inside VS Code.

It is **workflow-agnostic**: the journal/transcript format is identical for all
Claude Code workflows, so the dashboard discovers and visualises whatever run is
active without any per-workflow setup.

## Features

- **One-click access** — a live **status-bar item** (bottom-left) shows the
  current phase and agent counts; click it to open the dashboard. There's also
  an **Activity Bar icon** and the keybinding **`Ctrl/Cmd+Alt+W`**.
- **Loop & agent overview** — phase, pass number, live/done/dead agent counts,
  total output tokens, tool-calls, and findings with a severity breakdown.
- **Agent sub-windows** — one card per agent (role, status, elapsed time, token
  & tool-call counts, current activity). Click a card to expand its output: a
  reviewer's findings, a structured result (pretty-printed JSON, e.g. a build
  result), or the live text / tool-call tail of a working agent.
- **Findings** — every `findings[]` result aggregated, with per-role and
  per-severity filter chips; click a finding to read its *Why* and *Fix*.
- **Structured results**, **Verdicts**, and **Changed files** panels.
- **Toggle any panel** on/off from the top bar; layout and expansion state are
  remembered.
- **Live updates** — refreshes instantly on workflow file changes (and on a
  configurable interval), preserving your scroll position.

## Getting started

Open the dashboard any of these ways:

| Method | How |
| --- | --- |
| Status bar | Click **“⚡ Workflow …”** at the bottom-left |
| Activity Bar | Click the **Claude Workflow** icon, then the **Dashboard** view |
| Keyboard | **`Ctrl+Alt+W`** (macOS: `Cmd+Alt+W`) |
| Command Palette | **“Claude Workflow: Show Dashboard”** or **“… Open Dashboard in Editor”** |

The dashboard auto-discovers the most recent workflow run under
`~/.claude/projects`. No configuration is required.

## Authoring workflows for this dashboard

To get the richest view (structured findings, verify results, clean role labels),
write your workflow scripts following **[WORKFLOW-AUTHORING.md](WORKFLOW-AUTHORING.md)**.
It's written so a Claude Code session can follow it directly.

Open it without leaving the editor:

- The **📖 Guide** button in the dashboard's top bar, or the **book icon** in the
  Dashboard view's title bar.
- Command Palette → **“Claude Workflow: Open Workflow Authoring Guide”**.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `claudeWorkflow.workflowsGlobBase` | `~/.claude/projects` | Base dir searched recursively for the newest `wf_*` run. |
| `claudeWorkflow.repoDir` | first workspace folder | Repo whose recently-changed files appear in the **Changed files** panel. |
| `claudeWorkflow.refreshMs` | `4000` | Fallback refresh interval (it also refreshes on file changes). |
| `claudeWorkflow.statusBar` | `true` | Show the live status-bar launcher. |
| `claudeWorkflow.roleRules` | `[]` | Optional `{re,label,key}[]` to label agents per workflow; otherwise labels are derived from each agent's prompt. |

## How it works

For each run the dashboard reads:

- `journal.jsonl` — one `started`/`result` record per `agent()` call. `result`
  payloads are interpreted by shape: an array under `findings` becomes the
  Findings panel; any other object becomes a Structured result; a string is the
  agent's text output.
- `agent-*.jsonl` — each agent's transcript, used for token counts, tool-call
  counts, the current-activity line, and the expandable output tail.

Agent status is derived as **done** (a result was recorded), **live** (its
transcript changed within the last 90 s), or **dead** (interrupted — no result
and no recent activity, e.g. after a stop/resume).

Nothing is written; the extension only reads these files.

## Build & install from source

```bash
npm install -g @vscode/vsce      # once
vsce package                     # -> claude-code-workflow-dashboard-<version>.vsix
code --install-extension claude-code-workflow-dashboard-*.vsix --force
```

Or press **F5** in this folder to launch an Extension Development Host.

## Publishing

This extension publishes under the `malte-langermann` Marketplace publisher via the
GitHub Actions **Release** workflow (push a `vX.Y.Z` tag). Nightly pre-releases
are published by the **Nightly** workflow. CI validates and packages every push.

## License

GPL-3.0-or-later — see [LICENSE](LICENSE).

Copyright (C) 2026 Malte Langermann.
