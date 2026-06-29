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

## Current tech stack (post-M4 / v1.0)

- **TypeScript** (`strict`) compiled via **esbuild** (`build.mjs`): `src/extension.ts`
  → `dist/extension.js` (CommonJS, external `vscode`).
- Pure data functions live under `src/data/`; the webview is assembled by
  `src/webview/html.ts` from five sub-modules (`css`, `js-panels`, `js-sidebar`,
  `js-wire`). The host posts `{type:'snapshot', snap}` messages to the webview.
  The full-panel webview uses a **tabbed layout** (Agents / Findings / Verdicts /
  Changed / Charts / Timeline / Results) with an always-visible Overview strip above
  the tab bar, client-side findings pagination (50/page), WAI-ARIA tabs keyboard
  navigation, and a Gantt/DAG toggle on the Timeline tab.
- Pure export functions (Markdown report generation) live under `src/export/`.
- **vitest** unit tests under `test/`, with a 90 % coverage gate on `src/data/**`, `src/webview/**`, and `src/export/**`.
- **ESLint** flat config (`eslint.config.mjs`, `typescript-eslint`).
- No third-party runtime dependencies; only the `vscode` API + Node `fs/os/path`.
- Engines: `vscode ^1.84.0`, `node >=18.0.0`.

## Layout (post-M4 / v1.0)

```
src/extension.ts          Activation / host wiring: commands, views, status bar, watcher, timer.
src/data/discovery.ts     findWorkflowDir, listRecentRuns, formatRelativeTime.
src/data/parse.ts         jload, firstUserText, deriveLabel, classify, agentStats, sevCounts.
src/data/snapshot.ts      buildSnapshot + Snapshot types (mirrors docs/DATA-FORMAT.md).
                          Includes superseded-agent detection: agents with same agentType+pass,
                          no result, and a newer same-key successor are flagged superseded=true
                          and excluded from the live count.
src/data/changed.ts       walkChanged.
src/webview/html.ts       getHtml() assembler; imports and concatenates the four sub-modules below.
src/webview/css.ts        CSS + CSS_SIDEBAR constants (full-panel styles incl. tab bar / tab content;
                          sidebar styles; timeline lane styles).
src/webview/js-panels.ts  JS_PANELS: tab content renderers — overview strip, agents grid, findings
                          list (paginated, 50/page), verdicts, changed, charts, timeline (Gantt +
                          DAG toggle), results; typed result renderers (implementer / test-verifier /
                          judge / completeness-critic / generic field-driven fallback).
src/webview/js-sidebar.ts JS_SIDEBAR: compact sidebar render loop.
src/webview/js-wire.ts    JS_WIRE: wire() — tab bar click + keyboard (WAI-ARIA roving tabindex),
                          findings filter chips, pagination Prev/Next, fold toggles, timeline zoom
                          controls + Gantt/DAG toggle, event binding.
src/export/markdown.ts    generateMarkdown() + buildExportFilename(): Markdown report generator. Pure, no disk I/O.
dist/extension.js         Bundled output (esbuild, CommonJS). Shipped in VSIX; not in source control.
build.mjs                 esbuild build script (production + --watch mode).
vitest.config.ts          Vitest config; 90 % coverage gate on src/data/**, src/webview/**, and src/export/**.
eslint.config.mjs         ESLint flat config (typescript-eslint).
tsconfig.json             TypeScript strict config.
scripts/typecheck.mjs     tsc --noEmit wrapper (TS18003 suppression is a now-dormant safety net; src/ always exists post-M0).
test/                     Vitest unit tests (*.test.ts) + fixtures/ (wf_basic, wf_partial, base).
                          Files: changed, defensive, discovery, dogfooding-polish, erika-m2-polish-verification,
                          erika-m2-verification, erika-m3-layout-verification, erika-m3m4-addl-verification,
                          erika-m3m4-verification, extension-invariants, html, html-syntax, m0-acceptance,
                          m1-pinned-run, m2-agent-fold, m2-charts, m2-export, m2-metrics, m2-typed-results,
                          m2-typed-results-generic, m3-depgraph, m3-timeline, m4-community, m4-readme,
                          m4-screenshots, parse, snapshot, snapshot-toctou.
                          **Review scope note**: all 28 test files must be included in every review round.
                          extension-invariants.test.ts in particular covers FSWatcher cleanup on re-activation,
                          safeSnap workflowDir stripping, GPL-3.0-or-later license, command-id constraints,
                          and coverage gates — do not omit it from review scope.
scripts/make-sample-run.mjs  Deterministic wf_* fixture generator (M4). Writes wf_screenshot_fixture/
                          with 10 agents covering multi-pass review, verify, live, dead, and superseded
                          zombie + retry. Named export: makeSampleRun(outDir, nowSecs?). Historical
                          timestamps fixed at BASE_TIME_SECS; live agents use Date.now().
scripts/screenshot.mjs    Headless screenshot harness (M4): bundles getHtml() + buildSnapshot() via
                          esbuild, generates the fixture via make-sample-run.mjs, renders in
                          Playwright/Chromium (dark + light), captures full-page + Agents/Findings/
                          Timeline tabs at 2× DPI, writes to media/screenshots/ (committed). Use
                          `npm run screenshots` to regenerate. `npm run make-fixture` runs only the
                          fixture step.
package.json              Manifest: views container, dashboard webview, commands, keybinding, settings.
media/                    icon.png (tile), icon.svg (source, ignored), activity.svg (activity-bar icon).
media/screenshots/        Committed PNG screenshots (dark + light × top/agents/findings/timeline),
                          regenerated by `npm run screenshots` (headless Chromium). Committed so the
                          README gallery renders on the Marketplace without a build step.
WORKFLOW-AUTHORING.md     Guide shipped in the VSIX; opened via the "Open Workflow Authoring Guide" command.
README.md                 Marketplace listing source — includes screenshot gallery and unofficial disclaimer.
CHANGELOG.md              Keep an entry per release (see "Keep docs in sync").
LICENSE                   Full GPL-3.0 text.
CONTRIBUTING.md           Contributor guide: dev setup, test + coverage commands, PR expectations.
SECURITY.md               Security policy: what the extension reads (local CC transcripts), writes
                          nothing; how to report vulnerabilities privately.
CODE_OF_CONDUCT.md        Contributor Covenant 2.1.
.github/ISSUE_TEMPLATE/   bug_report.md + feature_request.md + config.yml.
.github/PULL_REQUEST_TEMPLATE.md  PR checklist template.
docs/DATA-FORMAT.md       Reverse-engineered spec of the journal/transcript format we consume.
ROADMAP.md                The plan. Start here for feature work. M0–M4 done; tech-debt items deferred.
.github/workflows/        ci.yml (validate+package), release.yml (tag→Marketplace+Open VSX+GitHub Release),
                          nightly.yml (daily pre-release). release.yml open-vsx step gated on OVSX_PAT secret.
PUBLISHING.md             LOCAL-ONLY release runbook — gitignored, never committed or shipped.
```

## Key internals

- `getCfg()` (`src/extension.ts`) — reads `claudeWorkflow.*` settings; defaults base
  to `~/.claude/projects`, repo to the first workspace folder.
- `findWorkflowDir(base)` (`src/data/discovery.ts`) — recursively finds the `wf_*`
  dir whose parent is named `workflows` with the **highest mtime**. Returns the
  single globally-newest run with **no date filter**.
- `listRecentRuns(base)` (`src/data/discovery.ts`) — collects ALL `wf_*` dirs under
  base, stats each, counts agent files, returns sorted newest-first. Used by the run
  picker (`runSelectRun` in `extension.ts`). `formatRelativeTime(mtimeMs)` formats an
  mtime as a human-readable relative string (`"3s ago"`, `"5m ago"`, etc.).
- `jload(p)` (`src/data/parse.ts`) — tolerant JSONL parse (skips blank/partial trailing lines); files larger than 10 MiB (`MAX_JSONL_BYTES`) are skipped entirely to prevent blocking the Extension Host event loop.
- `classify()` / `deriveLabel()` (`src/data/parse.ts`) — turn an agent's first user
  prompt into a role label. `DEFAULT_ROLE_RULES` is a neutral generic set covering
  review/fix/verify/plan/research/judge/synthesize vocabulary. `agentType` from
  `agent-<id>.meta.json` is the primary role signal (see `agentTypeToLabel()` in
  `parse.ts`); `classify()` + `roleRules` is the fallback, matching only the first
  line of the prompt (M1). User-supplied `roleRules` are guarded by `MAX_ROLE_RULE_RE_LEN`
  (500-char length cap) and `REDOS_DANGER_RE` (structural check for quantified-group-over-quantified-atom
  catastrophic backtracking patterns) before any `RegExp` is constructed.
- `agentStats()` (`src/data/parse.ts`) — sums `output_tokens`, counts `tool_use`,
  builds the activity tail.
- `buildSnapshot(cfg)` (`src/data/snapshot.ts`) — the heart: returns a `SnapshotOk`
  with fields `{ok, runId, workflowDir, updatedAt, loop, labels, agents, agentsCapped,
  allFindings, structuredResults, verdicts, verdictLabels, isPinned, changed,
  changedByAgents}` or `{ok:false, msg}`. See `SnapshotOk` type in `snapshot.ts` and
  `docs/DATA-FORMAT.md` for the full field contract. (`workflowDir` is stripped by
  `safeSnap()` before webview delivery; `verdictLabels` maps agentType keys to display
  labels; `isPinned` reflects whether a pinned run dir is in use;
  `changedByAgents` unions `filesChanged[]` from every agent's structured result.)
  Superseded-agent detection runs inside `buildSnapshot`: an agent is flagged
  `superseded=true` when it shares the same agentType+pass key with a newer agent,
  has no result, and its `start` predates the newer agent's — without mis-flagging
  genuine parallel fan-out cohorts.
- Host wiring: `activate()` (`src/extension.ts`) registers the sidebar `WebviewView`,
  the editor panel, commands, the status-bar item, an `fs.watch` on the run dir, and
  a polling timer.

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
- **Interactive element pattern:** `prompt-disc-hdr` is a real `<button>` element
  (native semantics, no ARIA needed). The agent card `.row`, filter chip `.chip`, and
  finding title `.ttl` remain `div`/`span` + `role="button"` due to CSS layout
  constraints (flex children, inline flow). All three carry `tabindex="0"`, correct
  `aria-pressed`/`aria-expanded`, and keyboard handlers — accessibility is functionally
  equivalent. Do not "fix" the pattern inconsistency without addressing layout first.

## Common commands

```bash
# Build (production, minified) → dist/extension.js:
npm run build

# Build and watch for changes (source-mapped):
npm run watch

# Type-check without emitting:
npm run typecheck

# Lint (typescript-eslint):
npm run lint

# Run unit tests once:
npm test

# Run tests with coverage report (90 % gate on src/data/**, src/webview/**, and src/export/**):
npm run coverage

# Generate the deterministic wf_* fixture (writes to .review-tmp/fixture-run/):
npm run make-fixture

# Headless screenshot harness (Playwright/Chromium) → media/screenshots/*.png:
# (generates the fixture then renders dark + light × full-page + tabs)
npm run screenshots

# Package a VSIX locally (validates the manifest; triggers npm run build via vscode:prepublish):
npx @vscode/vsce package

# Install the built VSIX:
code --install-extension claude-code-workflow-dashboard-*.vsix --force

# Run the Extension Development Host: press F5 (see .vscode/launch.json).
```

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
