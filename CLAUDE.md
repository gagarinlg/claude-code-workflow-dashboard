# CLAUDE.md

Guidance for working in this repository. **Read [ROADMAP.md](ROADMAP.md) before
starting feature work** — it contains the agreed, sequenced plan and the full
decision log. This file is the orientation; ROADMAP.md is the marching orders.

## What this is

**Claude Code Workflow Dashboard** — a VS Code extension that renders a live,
read-only dashboard for a single **Claude Code `Workflow()` run**. It tails the
on-disk run journal and per-agent transcripts that every workflow writes and
shows the loop, every agent, findings, verdicts, structured results, and recently
changed files — updating in real time. It writes nothing.

It is **workflow-agnostic**: the journal/transcript format is identical across all
Claude Code workflows, so it discovers and visualises whatever run is active with
no per-workflow setup.

- Marketplace publisher: **`malte-langermann`** → extension id
  `malte-langermann.claude-code-workflow-dashboard`.
- Repo owner / git remote: **`gagarinlg`** →
  `github.com/gagarinlg/claude-code-workflow-dashboard`. (Publisher ≠ repo owner —
  this is deliberate; don't "fix" it.)
- Default branch: **`master`**.
- License: **GPL-3.0-or-later** (this project only).

## Positioning (decided — see ROADMAP §Decision log)

A genuinely maintained **community tool** for **broad Claude Code power users**.
Strategy is **hybrid**: stay the best-in-class lens on a *single Workflow() run*
(depth: findings/verdicts/review loops), while selectively adopting popular
features from the broader ecosystem (notably the `koh0001/claude-dashboard-extension`
"Claude Flow Monitor", which is a 7-tab teams monitor — we do NOT chase its
breadth). We differentiate on focus and signal, not surface area.

## Current tech stack (pre-M0)

- **Single plain-JS file** `extension.js` (CommonJS, `require('vscode')`), no build
  step, no dependencies. The webview HTML/CSS/JS is a template string returned by
  `getHtml()`; the host posts `{type:'snapshot', snap}` messages to it.
- `@nextcloud`-free; only the `vscode` API + Node `fs/os/path`.
- Engines: `vscode ^1.84.0`.

> **M0 migrates this to TypeScript + a bundler (esbuild/tsup) with unit tests.**
> After M0, the layout and commands below change — keep this section in sync.

## Layout (current)

```
extension.js          Everything: config, parsing, snapshot build, host wiring, webview HTML.
package.json          Manifest: views container, dashboard webview, commands, keybinding, settings.
media/                icon.png (tile), icon.svg (source, ignored), activity.svg (activity-bar icon).
WORKFLOW-AUTHORING.md Guide shipped in the VSIX; opened via the "Open Workflow Authoring Guide" command.
README.md             Marketplace listing source.
CHANGELOG.md          Keep an entry per release (see "Keep docs in sync").
LICENSE               Full GPL-3.0 text.
docs/DATA-FORMAT.md   Reverse-engineered spec of the journal/transcript format we consume.
ROADMAP.md            The plan. Start here for feature work.
.github/workflows/    ci.yml (validate+package), release.yml (tag→publish), nightly.yml (daily pre-release).
PUBLISHING.md         LOCAL-ONLY release runbook — gitignored, never committed or shipped.
```

## Key internals (in `extension.js`, until M0 splits them)

- `getCfg()` — reads `claudeWorkflow.*` settings; defaults base to
  `~/.claude/projects`, repo to the first workspace folder.
- `findWorkflowDir(base)` — recursively finds the newest dir named `wf_*` whose
  parent dir is named `workflows`. **Only returns the single newest run today.**
- `jload(p)` — tolerant JSONL parse (skips blank/partial trailing lines).
- `classify()` / `deriveLabel()` — turn an agent's first user prompt into a role
  label. `DEFAULT_ROLE_RULES` are currently **hardcoded to the author's crm-notes
  review loop** and must be replaced with a neutral generic set (M1).
- `agentStats()` — sums `output_tokens`, counts `tool_use`, builds the activity tail.
- `buildSnapshot(cfg)` — the heart: returns `{ok, runId, loop, agents, allFindings,
  structuredResults, verdicts, changed}` or `{ok:false, msg}`.
- Host wiring: `activate()` registers the sidebar `WebviewView`, the editor panel,
  commands, the status-bar item, an `fs.watch` on the run dir, and a polling timer.

See **docs/DATA-FORMAT.md** for the exact on-disk shapes these rely on.

## Conventions & gotchas

- **Read-only, always.** The extension must never write to `~/.claude` or the repo.
- **Undocumented input format.** We consume an internal Claude Code on-disk format
  that can change between CLI versions. Parse **defensively**: tolerate missing
  files/fields, never throw into the UI, and degrade to a friendly empty state.
  Pure parsing functions must be unit-tested (they are the drift safety net).
- **Don't hardcode author-specific data** (role rules, paths). Anything personal
  belongs in user settings, not in shipped defaults.
- **Theme-native UI:** use VS Code CSS variables (`--vscode-*`); no hardcoded
  colors. Sanitize anything derived from transcripts before injecting into the
  webview (no raw `innerHTML` of untrusted text).
- **Internal command/setting ids stay `claudeWorkflow.*`** (renaming them breaks
  user keybindings/settings); only user-facing titles use the full product name.
- **Unofficial:** this is a community project, **not affiliated with Anthropic** —
  keep that disclaimer in the README and Marketplace listing.

## Common commands

```bash
# Package a VSIX locally (validates the manifest):
npx @vscode/vsce package

# Install the built VSIX:
code --install-extension claude-code-workflow-dashboard-*.vsix --force

# Run the Extension Development Host: press F5 (see .vscode/launch.json).
```

After M0 there will also be `npm run build` / `npm test` / `npm run lint` — add
them here when they exist.

## Releasing

CI validates & packages every push/PR. A pushed `vX.Y.Z` tag triggers
`release.yml` (publish to Marketplace + Open VSX, GitHub Release). A daily cron
publishes a pre-release via `nightly.yml`. The full one-time setup and release
steps live in **PUBLISHING.md** (local-only, gitignored).

## Keep documentation in sync with changes

Treat docs as part of the change:

- **CLAUDE.md** — update when structure, stack, conventions, or commands change
  (especially after M0).
- **ROADMAP.md** — tick off tasks and move milestones to "done" as you ship.
- **docs/DATA-FORMAT.md** — update if you discover more of the input schema.
- **README.md** — user-facing changes, and the screenshot gallery (M4).
- **CHANGELOG.md** — an entry under the new version for every release.
- The app version is the source of truth in `package.json` `"version"`.
