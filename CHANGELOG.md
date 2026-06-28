# Change Log

## [0.7.0] — 2026-06-28

### M2-Layout — Tabbed information architecture

- **Tabbed panel layout** replacing the 7-checkbox panel toggle bar: six tabs
  (Agents, Findings, Verdicts, Changed, Charts, Results) below an always-visible
  **Overview strip**. Only the active tab is rendered; scroll position per tab is
  captured and restored via `api.setState`.
- **Disabled tabs** (no data) shown at opacity 0.35 with `aria-disabled`; active
  tab falls back to Agents if its tab becomes disabled.
- **WAI-ARIA tabs pattern** (`role=tab/tablist/tabpanel`): roving `tabindex`,
  ArrowLeft/Right/Home/End navigation, Enter/Space activation. Active tab signalled
  by a 2 px `--vscode-focusBorder` bottom border + font-weight, never by color
  alone.
- **Findings pagination:** 131-item lists become 50-item pages with Prev/Next
  controls above and below the list; page resets to 0 on any filter change.
- Tab badges showing agent/finding counts; no in-tab `.panel` card wrappers (tab
  label is the section title).

### M2-TypedResults-Generic

- **Field-driven generic result renderer** (`renderTypedResult` in
  `src/webview/js-panels.ts`): renders any agent's structured result by **field
  pattern** rather than a per-`agentType` switch, so it handles current and future
  agent types without code changes.
  - `verdict` field → status badge (APPROVED → ok; `*WORK*`/FAIL/REJECT → bad;
    else neutral).
  - `findings[]` → severity-sorted findings list (reuses the Findings tab renderer).
  - `summary` string → `##`/`###` section parse (What Was Built / Files Changed
    table / Test Results / Status badge) when structured, else plain text.
  - `filesChanged[]` → file list with count.
  - Boolean flags matching `/Ok$|^testsRun$|passed/` → ✓/✗ chips.
  - `failures[]`/`gaps[]` → bullet list (empty → "none").
  - Numeric counts → labelled value.
  - All other unknown keys → key-value table, never a bare JSON dump.
  - Raw JSON in a collapsed `<details>` below the typed view.
  - Entire renderer wrapped in `try/catch`; any error falls back silently to
    collapsed raw text — never throws into the webview.

### Screenshot harness

- **`npm run screenshots`** (`scripts/screenshot.mjs`): bundles `getHtml()` +
  `buildSnapshot()` via esbuild, renders the real webview HTML in headless
  Playwright/Chromium against the newest local run (or a synthetic fallback),
  and writes PNGs to `.review-tmp/shots/`. Use this to visually verify layout
  changes before review.

### M2-Metrics

- **Per-agent token + tool-call metrics bar** in every agent card (output tokens,
  tool-call count; optional input/cache token fields rendered only when present).
- **Loop header optional KPIs:** `inTok`, `cacheRead`, `cacheCreate` appear in the
  Overview panel only when the snapshot carries them.

### M2-Charts

- **Charts panel** (new, after Changed files): per-agent output-token **horizontal
  bar chart** (capped at 50 bars; scrollable) and a **cumulative token trend
  sparkline** (up to 200 points). Both use `--vscode-charts-*` theme variables with
  `@media (forced-colors:active)` overrides. Zero external dependencies.

### M2-Export

- **`claudeWorkflow.exportMarkdown` command** — generates a complete Markdown report
  from the current in-memory snapshot: run id/time, loop summary + severity
  breakdown, findings grouped by reviewer, verdicts, structured results, and an
  agent metrics table. Offers **Save to file** and **Copy to clipboard** actions.
- **Export button** in both the editor `#bar` and the sidebar header, posting
  `{type:'export'}` via the existing IPC bridge.
- **Smart default filename** (`buildExportFilename`): the Save dialog pre-fills
  `claude-workflow-<sanitisedRunId>-<YYYYMMDD-HHmm>.md` — sanitised to
  `[A-Za-z0-9._-]`, length-capped at 120 chars, deterministic per minute.
- **Heading injection guard** (`escHeading`): all transcript-derived values used in
  Markdown headings are stripped of embedded newlines before emission, preventing
  crafted labels from forging fake sections in exported reports.

### M2-AgentPrompt

- **Agent prompt disclosure** in each agent card: the agent's full initiating prompt
  is shown in a collapsible `<details>`-style section with a **Copy** button (posts
  `{type:'copyText'}` to the host, which writes to the VS Code clipboard). Fold state
  persists alongside card fold state. Prompt capped at `MAX_PROMPT_CHARS` in
  `buildSnapshot` to prevent unbounded memory use.

### M2-AgentFold

- **Card fold/unfold chevron** on every agent card. `run` agents default to expanded;
  `done`/`dead` agents default to collapsed. Fold state persists via `api.setState`.
- **Collapse all / Expand all** button (rendered when ≥ 2 agents). Initial label
  reflects current state; label updates after each toggle.

### M2-TypedResults

- **Typed result renderers** for known agent types (keyed off `agentType`):
  - `implementer`: files-changed list, summary, tests-run / fixed counts.
  - `test-verifier`: pass/fail, coverage gaps.
  - `judge`: verdict, score, rationale.
  - `completeness-critic`: gaps list.
  - **Generic fallback**: key/value table for unknown types; never a bare JSON dump.
- **Results panel hidden by default** (shown at the end of PANELS) — typed renderers
  in agent cards make it largely redundant; power users can re-enable via the toggle.

### Bug fixes and polish

- `fmtT()` now returns `&lt;1s` (was `<1s`, which the browser parsed as a malformed
  tag, silently dropping the value for sub-second agents).
- All `.onclick` property assignments in `wire()` replaced with `addEventListener`
  for consistency and to match the stated CSP-safe wiring convention.
- Inline styles for the pinned-run badge and the Results panel scroll container
  extracted to named CSS classes (`.pinned-badge`, `.sb-pinned-badge`, `.result-body`).

### Dogfooding polish (v3 corrections)

- **Changed tab always enabled** — the Changed tab is no longer disabled when
  `snap.changed` is empty; it remains reachable to show agent-reported files.
- **Raw-JSON deduplication** — `<details>` raw JSON is owned exclusively by
  `renderTypedResult`; `resultsPanel` never appends a second copy.
- **`openRaw` persistence** — open/closed state of raw-JSON `<details>` blocks is
  preserved in `api.setState` across snapshot re-renders (analogous to `openPrompt`).
- **Tab-bar breathing room** — `padding-top` on `#tab-content` prevents the first
  item from crowding the tab bar.
- **`changedByAgents` aggregated from agent `filesChanged` fields** — `buildSnapshot`
  now unions `filesChanged[]` from every agent's structured result and exposes the
  deduplicated sorted list as `snap.changedByAgents`; the Changed tab uses this as
  the primary source (mtime scan as secondary). Markdown export also includes it.
- **mtime window widened to 15 minutes** — `CHANGED_MAX_SECS` increased from 120 s
  to 900 s so files changed during a long review pass remain visible.
- **Generic section handling in implementer markdown** — `parseImplementerMarkdown`
  now renders every `##`/`###` section generically (no hardcoded allow-list) with
  inline markdown (bullet lists, bold, code spans) and no aggressive truncation.
- **Sidebar shows agent-reported files** — the sidebar Changed section uses
  `changedByAgents` as its primary source, falling back to the mtime scan, so
  completed runs still show file activity.

## [0.6.0] — 2026-06-28

### M1-Naming

- **`agentType` is now the primary agent role signal.** `buildSnapshot` reads
  `agent-<id>.meta.json` and calls `agentTypeToLabel()` before falling back to
  `classify()`. The `workflow-plugins:` namespace prefix is stripped; known types
  are mapped via `AGENT_TYPE_MAP`: `implementer` → Implement/Fix, `architect` →
  Architecture, `code-reviewer` → Code review, `security-reviewer` → Security,
  `uiux-reviewer` → UI/UX, `test-verifier` → Verify, `completeness-critic` →
  Completeness. Unknown or absent `agentType` falls back to `classify()`/`deriveLabel()`.
- **Pass-numbering fix.** The pass counter is now keyed per `agentType` key so all
  reviewers in one round share `pass=1`, not 1/2/3/4. The same reviewer type across
  two rounds increments to `pass=2` as expected.

### M1-Defensive

- **All `fs` and `JSON` access is wrapped** so any bad or missing run directory,
  journal, or transcript degrades to `{ok:false, msg}` — no exception ever reaches
  the Extension Host log or the UI.
- **`jload` size guard**: JSONL files larger than 10 MB are skipped entirely
  (silent degradation). No per-line size guard exists; no logging is performed.
- **Agent transcript disappears mid-scan**: `statSync` failures on transcript files
  are caught per-agent with `continue` so one missing or unreadable file does not
  abort the entire snapshot.

### M1-EmptyState

- **Friendly `ok:false` state** in the webview: shows a headed card with a
  `data-testid="empty-state"` container, the error/discovery message via
  `esc(snap.msg)` in a quoted block, a hint pointing to the Workflows Glob Base
  setting, a **Refresh** button, and an **Open Authoring Guide** button.
- **Status bar idle state**: when no run is found the status bar shows
  `$(circuit-board) Workflow Dashboard` with tooltip "No active workflow run found".

### M1-RecentRuns

- **`claudeWorkflow.selectRun` command** — opens a Quick Pick listing all `wf_*`
  dirs under the configured base, newest first, with relative time (`"3m ago"`) and
  agent-file count. Selecting a run pins it for the current workspace; a
  **"$(sync) Follow newest"** item at the top resets the pin.
- **Pin persistence**: the selected run dir is stored in `workspaceState` under
  `claudeWorkflow.pinnedRun` and restored on every `activate()`.
- **`listRecentRuns(base)`** and **`formatRelativeTime(mtimeMs)`** are new exports
  from `src/data/discovery.ts` used by the run picker.

### M1-SidebarUX

- **Compact sidebar mode** (`mode:'sidebar'`): `getHtml()` now accepts a `mode`
  parameter. In sidebar mode a focused summary is rendered — run ID, phase, live/
  done/stalled KPI row, active-agent list (up to 5), and severity breakdown — with
  no horizontal overflow at default sidebar width.
- **"⤢ Open full dashboard" button** in the sidebar header posts `{type:'openFull'}`
  to the host, which executes `claudeWorkflow.open`. A view-title icon also opens
  the full panel directly.
- **`DashboardViewProvider`** registered as the `claudeWorkflow.dashboard`
  WebviewView; uses `attachWebview(…, 'sidebar')`.

### M1-ClearFilters

- **"Clear filters" always visible when any chip is off.** The button is now
  rendered in the filter bar (not in the empty-result branch) using the existing
  `anyOff` flag, so it appears whenever at least one reviewer or severity chip is
  deactivated — regardless of whether the filtered list is empty.

### M1-RoleRules

- **`DEFAULT_ROLE_RULES` is now a neutral generic set** covering the seven common
  Claude Code workflow vocabulary terms: `review`, `fix`/`implement`, `verify`,
  `plan`/`architect`, `research`, `judge`, and `synthesize`. No author- or
  project-specific rules are shipped with the extension.
- **`classify()` now matches role rules against only the first line** of each
  agent's opening prompt (the role-declaration line, e.g. `You are Fritz … fix`).
  Previously the entire prompt body was searched, which caused agents whose prompts
  embed findings JSON from other agents to be mislabelled (e.g. a Fix agent tagged
  as "Reviewer" because a quoted finding said "You are the code reviewer").
- **Migrating personal role rules:** if you previously relied on custom role rules
  baked into your workflow prompt, move them to the `claudeWorkflow.roleRules`
  VS Code setting. Example:
  ```json
  "claudeWorkflow.roleRules": [
    { "re": "You are.*the lead reviewer", "label": "Lead Reviewer", "key": "lead" },
    { "re": "You are.*implementing", "label": "Implementer", "key": "impl" }
  ]
  ```

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
