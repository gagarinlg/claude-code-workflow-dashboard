# Roadmap — Claude Code Workflow Dashboard

This is the agreed, sequenced plan to take the extension from "works for the
author" to a **maintained community tool for broad Claude Code power users**.
It was scoped via a 15-question planning interview; the answers are recorded in
the **Decision log** at the bottom — honor them, and re-open a decision explicitly
if you think it's wrong rather than silently diverging.

**How to use this doc:** work milestones top-down (M0 → M4); each is independently
shippable (cut a release after each). Within a milestone, do tasks in order. Tick
checkboxes and move a milestone to "Done" when its acceptance criteria pass.
Update [CLAUDE.md](CLAUDE.md), [README.md](README.md), and [CHANGELOG.md](CHANGELOG.md)
as part of each milestone, not after.

Read [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) first — most work touches the
parsing/aggregation layer.

---

## Guiding principles

- **Focus over breadth.** We are the best lens on *one* Workflow() run. We do not
  chase the 7-tab "teams monitor" surface area of `koh0001/claude-dashboard-extension`.
- **Read-only & crash-proof.** Never write to disk; never let a parse error reach
  the UI. Unknown/missing format → friendly empty state.
- **No rotting data.** Deliberately NO model→price tables (counts + charts only).
- **Hackable.** Keep the barrier to contribution low even after the TS migration.

---

## ✅ M0 — Foundation: TypeScript + bundler + tests  (DONE)

*Goal: make the codebase contributor-ready without changing runtime behavior.*

- [x] Introduce a build: `esbuild` (via `build.mjs`) bundling `src/extension.ts` →
      `dist/extension.js` (CommonJS, external `vscode`). `npm run build`
      (production, minified) and `npm run watch` both work.
- [x] Convert `extension.js` to TypeScript, split into modules:
  - `src/extension.ts` — activation/host wiring (commands, views, status bar, watcher, timer).
  - `src/data/discovery.ts` — `findWorkflowDir` (+ future recent-runs listing).
  - `src/data/parse.ts` — `jload`, `firstUserText`, `deriveLabel`, `classify`, `agentStats`, `sevCounts`.
  - `src/data/snapshot.ts` — `buildSnapshot` + the `Snapshot` types (mirror docs/DATA-FORMAT.md).
  - `src/data/changed.ts` — `walkChanged`.
  - `src/webview/html.ts` — the `getHtml()` template + client script.
- [x] Add `tsconfig.json` (strict), ESLint flat config (`eslint.config.mjs`,
      `typescript-eslint`), and `npm run lint`.
- [x] Add **vitest** unit tests for the pure functions, with fixtures: a sample
      `wf_*` dir (findings result, structured result, string result, a live agent,
      a dead agent, a malformed/partial JSONL line, a missing `meta.json`). Assert
      `buildSnapshot` output matches docs/DATA-FORMAT.md and that malformed input
      never throws. 90 % coverage gate on `src/data/**`.
- [x] Update `package.json`: `"main": "./dist/extension.js"`, `"vscode:prepublish":
      "npm run build"`, all scripts and devDeps. `src/`, tests, and config are
      excluded from the VSIX; `dist/extension.js` ships.
- [x] Update CI (`.github/workflows/ci.yml`): `npm ci`, `npm run lint`, `npm test`,
      then `vsce package`. Nightly and release workflows updated similarly.

**Acceptance:** `npm run build && npm test && npm run lint` all pass; `vsce package`
produces a VSIX whose `dist/extension.js` behaves identically to the original
(F5 dev-host parity — human gate, M0-T7); the VSIX does **not** contain `src/`,
tests, or `.github/`.

---

## ✅ M1 — Robustness & navigation  (DONE)

*Goal: it behaves well on a stranger's machine and across many runs.*

- [x] **Defensive everywhere:** wrap all `fs`/`JSON` access so a bad run yields
      `{ok:false, msg}`, not an exception. Add tests for each failure mode.
- [x] **Friendly empty state** in the webview when `ok:false`: explain "no Workflow
      run found under <base>", how to start one (link the authoring guide), and the
      configured base dir, with a Refresh button. Status bar shows the idle state.
- [x] **Recent-runs picker:** list all `wf_*` dirs (newest first) with run id +
      relative time + agent count; a command `claudeWorkflow.selectRun` (and a
      view-title dropdown) to pin one. Default remains "follow newest". Persist the
      pin per-workspace; "Follow newest" resets it.
- [x] **Replace `DEFAULT_ROLE_RULES`** with a neutral generic set keyed off common
      workflow vocabulary, e.g. review / verify / fix / research / judge / synthesize
      / plan. The author's crm-notes rules move to personal `claudeWorkflow.roleRules`
      (document this in the release notes). Auto-derivation stays the fallback.

### Discovered during M0 dogfooding (detail in `.review-tmp/implementation-plan.md`)

- [x] **Agent naming via `agentType` (M1-Naming)** — derive role labels from the reliable
      `agentType` in `agent-<id>.meta.json` (implementer→Implement/Fix, architect→Architecture,
      code-reviewer→Code review, security-reviewer→Security, uiux-reviewer→UI/UX,
      test-verifier→Verify, completeness-critic→Completeness; strip the `workflow-plugins:`
      namespace). `buildSnapshot` already opens `meta.json` for `start`. Prompt regex +
      `roleRules` become the FALLBACK only. **This supersedes the prompt-matching tactic** —
      regex-on-prompt collapses all reviewers to "reviewer" and even mislabels implementers.
- [x] **Pass-numbering fix (M1-Naming side-effect)** — `buildSnapshot` computes `pass` as a
      per-`key` counter, so today (all reviewers share one key) the 4 reviewers in ONE round
      show as 4 different passes. Distinct per-`agentType` keys make `pass` = the review round
      per reviewer. AC: one round → same pass for all reviewers; same reviewer across rounds
      increments.
- [x] **Sidebar UX (M1-SidebarUX)** — the sidebar webview crams the whole dashboard into the
      activity-bar pane. Render a compact summary in the sidebar (`mode:'sidebar'`) + a
      prominent "⤢ Open full dashboard" button (posts `{type:'openFull'}` → `claudeWorkflow.open`)
      + a `view/title` icon. (An activity-bar icon can't open an editor tab directly — hence
      the button, decided with the user.)
- [x] **Clear-filters availability (M1-ClearFilters)** — move the findings-panel "Clear filters"
      button out of the empty-result branch so it shows whenever ANY chip is off (use the
      existing `anyOff` flag), not only when the (sole) reviewer chip empties the list.

**Acceptance:** launching with no runs shows the empty state (no errors in the
Extension Host log); a malformed journal still renders; switching among ≥2 recent
runs works; agent labels are correct and distinct (reviewers by specialty, implementers
as Implement/Fix — never a generic "reviewer"); one review round shows one pass number.

> **Before starting M2:** restart Claude Code so the `workflow-plugins` plugin reloads at
> **v4.6.1** (verify-first review order). Also: **do not edit the working tree while a
> `workflow-live` run is active** — concurrent edits made the M0 review loops fail to
> converge (reviewers chase a moving target). Freeze the tree per run.

> **M2 note:** **M2-AgentFold** — give agent cards an explicit fold/unfold chevron (collapse
> output/activity tail; persist per-card state; Collapse-all/Expand-all). See M2 + the plan.

---

## ✅ M2 — Metrics + Markdown export + Layout  (DONE)

*Goal: quantify a run and get it out of the editor. **No pricing.***

- [x] **Metrics surfacing:** make per-agent and total **token** + **tool-call**
      counts first-class in the loop header and agent cards. Add `input_tokens` and
      cache token fields **only if present** (guard hard; see docs/DATA-FORMAT.md).
- [x] **Charts:** lightweight, dependency-free SVG (no chart lib): a per-agent
      output-token bar chart and a tokens-over-phases/time mini trend. Theme-native
      colors. Must render fine with 1 agent and with 50.
- [x] **Export run as Markdown** (`claudeWorkflow.exportMarkdown`): a single report
      with run id/time, loop summary + severity breakdown, findings grouped by
      reviewer (severity, title, why, fix), verdicts, structured results, and a
      per-agent metrics table. Offer **Save to file** and **Copy to clipboard**.
- [x] **Visible Export buttons in BOTH webviews (M2-Export-UI):** a prominent, clearly
      labelled **"Export ⭳ / Export Markdown"** button in the editor `#bar` (next to
      Guide/Refresh/Runs) AND in the compact sidebar header — posting `{type:'export'}`
      to the host, which runs `claudeWorkflow.exportMarkdown` (extend the
      `onDidReceiveMessage` switch, same pattern as the M1 run-picker button). Don't
      rely solely on the command palette / `view/title` menu (the editor panel has no
      title menu). Theme-native; `addEventListener` (nonce-safe); `aria-label` + tooltip.
      `getHtml` tests assert the button exists in both modes and posts `{type:'export'}`.
- [x] **Smart default export filename (M2-Export-Name):** the Save dialog must
      pre-fill a sensible, filesystem-safe default derived from the `latest` snapshot —
      no manual typing. Proposed algorithm: `claude-workflow-<runId>-<YYYYMMDD-HHmm>.md`,
      where `runId` is the snapshot's run id (already `wf_*`-safe) and the timestamp
      comes from the run's latest activity (`updatedAt`/mtime), falling back to export
      time; then sanitise to `[A-Za-z0-9._-]` (replace path separators/colons/spaces
      with `-`, collapse repeats, cap length ~120). Default the save location to the
      first workspace folder. Unit-test the name builder: deterministic for a fixed
      snapshot, always `.md`, never contains `/ \\ : *` or whitespace, and stays within
      the length cap.
- [x] Snapshot already carries everything needed — build the report from `latest`,
      don't re-read disk.
- [x] **View full agent prompt (M2-AgentPrompt):** surface each agent's complete
      initiating prompt (its first user message / instructions) in the agent card —
      a **"Prompt"** disclosure alongside the existing output / findings / activity
      tail. `firstUserText` (`src/data/parse.ts`) already extracts this text for
      label derivation; carry the **full** prompt through `buildSnapshot` per agent
      (guard size — workflow prompts can embed large findings JSON, so render it in a
      capped, scrollable `<pre>` with a **Copy** button) and `esc()` it before
      injecting into the webview. This is the inspection tool that would have made the
      M1 role-mislabelling incident (a Fix agent tagged "Compliance" because its
      prompt embedded a finding's text) obvious at a glance. Read-only; theme-native
      (`--vscode-*`); fold state persists with M2-AgentFold. Add a `buildSnapshot`
      test asserting the prompt is carried and a `getHtml` test asserting the
      disclosure renders and is escaped.
- [x] **Typed result displays for every agent type (M2-TypedResults):** today only
      reviewers get a rich rendering (the findings panel — severity / title / why /
      fix); every other agent's structured output falls back to a raw-JSON `<pre>` in
      the Results panel and agent card (`agentSub()` / `resultsPanel()` in
      `src/webview/html.ts`). Give each agent type a tailored, readable view of its
      structured result — keyed off the `agentType` that **M1-Naming** now resolves —
      mirroring the findings treatment. E.g. implementer → files-changed list +
      summary + tests/fixed counts; test-verifier → pass/fail + coverage gaps; judge →
      verdict + score + rationale; completeness-critic → gaps. **Workflow-agnostic:**
      ship renderers for the known result shapes plus a graceful generic fallback (a
      pretty key/value table, never a bare JSON dump) for unknown agent types/shapes.
      `buildSnapshot` already carries `structuredResults` + each agent's `result` —
      render from `latest`, don't re-read disk; `esc()` every transcript-derived value;
      theme-native (`--vscode-*`). Add a `getHtml` test per known shape and one for the
      fallback.
      - **Raw data goes BELOW the analyzed view, collapsed by default** (dogfooding):
        render the typed/structured view first; put the raw JSON in a collapsed
        `<details>`-style disclosure *beneath* it — never the raw `<pre>` as the primary
        display.
      - **Implementer result shape (observed):** `result` is
        `{ summary: <markdown string>, filesChanged: string[], testsRun: bool, fixed: number }`.
        Header from the structured fields (e.g. "N files changed · tests ✓ · M fixed" + the
        files-changed list). The `summary` markdown follows a stable section structure —
        `## Implementation: <task>` then `### What Was Built` / `### Files Changed` (a
        `| File | Change |` table) / `### Decisions Made` / `### Test Results` /
        `### Status` (COMPLETE→green badge). Parse these `###` sections into a readable
        layout WHEN present, but **degrade gracefully** (show `summary` as plain text)
        when the headings are absent or malformed — **must never throw on shape mismatch**
        (defensive parsing rule). Add a test feeding a non-conforming summary asserting it
        renders as text without error.
- [x] **Generic field-driven result renderer (M2-TypedResults-Generic):** rebuild
      `renderTypedResult` to be driven by the result's **fields**, not a per-`agentType`
      switch, so it works for every current agent AND any future/variant agent. Empirical
      result shapes (from the actual run journals the dashboard consumes):
      - reviewers (architect / code-reviewer / security-reviewer / uiux-reviewer):
        `{ verdict: string, findings: {severity,title,location,why,fix,category}[] }`
      - implementer: `{ summary: <md>, filesChanged: string[], testsRun: bool, fixed: number }`
      - test-verifier: `{ buildOk, lintOk, testsOk: bool, failures: any[], summary: string }`

      Render by **field pattern** (agentType only a label hint): `verdict`→status badge
      (APPROVED→ok; `*WORK*`/FAIL/REJECT→bad; else neutral); `findings[]`→reuse the
      severity-sorted findings rendering; `summary`→`##`/`###` section parse (What Was
      Built / Files Changed table / Test Results / Status→badge) when structured else
      plain text; `filesChanged[]`→file list w/ count; boolean flags matching
      `/Ok$|^testsRun$|passed/`→✓/✗ chips; `failures`/`gaps[]`→list (empty→"none");
      numeric counts→labeled; **every other/unknown key→a generic value renderer**
      (string/number/bool/array/nested-object → key-value table, NEVER a bare JSON dump).
      Raw JSON in a collapsed `<details>` below. **Wrap the whole renderer in try/catch —
      on ANY error, fall back to collapsed raw text and FAIL SILENTLY** (never throw into
      the webview). `esc()` every value; theme-native. Tests: each known shape renders its
      typed view; an unknown-agentType/extra-fields object renders via the generic
      key-value fallback; a malformed/throwing input falls back silently without error.
- [x] **Reduce vertical sprawl / information architecture (M2-Layout):** Full tabbed
      layout — Agents / Findings / Verdicts / Changed / Charts / Results (6 tabs;
      Timeline added in M3 making 7 total: Agents / Findings / Verdicts / Changed /
      Charts / Timeline / Results) — below an always-visible Overview strip; 7-checkbox `#toggles` panel bar removed. Active
      tab persists via `state.activeTab`; per-tab scroll captured/restored via
      `state.tabScroll`. Findings paginated at 50/page (Prev/Next; reset on filter
      change). WAI-ARIA tabs pattern: roving `tabindex`, ArrowLeft/Right/Home/End,
      active tab indicated by bottom border + font-weight (not color alone). Disabled
      tabs muted at 0.35 opacity. Card fold state persists; Collapse-all / Expand-all
      button with dynamic label.
- [x] **Demote the standalone Results (structured-results) panel (M2-Layout sub-item):**
      Results tab shown last and disabled when `structuredResults` is empty; typed
      renderers in agent cards are the primary view.
- [x] **Chart contrast across themes (M2-Charts follow-up):** chart fills use
      `--vscode-charts-*` (with hex fallbacks); `@media (forced-colors:active)` covers
      chart bar rects and trend paths. Implemented via CSS classes — CSP-safe (no
      inline `style=` attributes).

**Acceptance:** counts match a hand-check of a sample run; charts render across
1..N agents; the exported Markdown round-trips into a GitHub issue/PR cleanly and
contains every finding/verdict; each agent's full initiating prompt is viewable
(and copyable) from its card without re-reading disk; every agent type's structured
output renders in a tailored, readable view (with a generic fallback) — never raw JSON.

---

## ✅ M3 — Visualization: timeline (+ optional graph)  (DONE)

*Goal: see fan-out and duration at a glance, not just a list of cards.*

- [x] **Timeline (primary):** Gantt-style lanes — one row per agent (or grouped by
      phase/role), bars from `start`→`mtime` (live agents extend to "now"), colored
      by status (run/done/dead). Hover/click → the agent card. Pure SVG/HTML, theme
      variables, horizontally scrollable, virtualized/capped for large runs.
- [x] **Dependency graph (optional, behind a toggle):** a DAG of phases → agents.
      Keep layout simple (layered by phase/start order); this is the lower-priority
      half of "Both" — ship the timeline first, graph second. Toggle in the Timeline
      tab header switches between Gantt and DAG views; state persists via `api.setState`.
- [x] Panel toggles + remembered layout state, consistent with existing panels.
- [x] **M3-tech-debt: Shared walkWfDirs.** `listRecentRuns` and `findWorkflowDir` in
      `src/data/discovery.ts` now share a single `walkWfDirs(base)` traversal; both
      public functions are projections over its result, eliminating the duplicate
      O(N) readdirSync walk per polling tick. `findWorkflowDir` picks the highest-mtime
      entry; `listRecentRuns` sorts descending. A 2-second mtime cache remains a
      future improvement for burst-call scenarios.
- [ ] **M3-tech-debt: Activation-context object in extension.ts.** The eleven
      module-level mutable variables (`latest`, `webviews`, `statusItem`, `watcher`,
      `watchedDir`, `editorPanel`, `outputChannel`, `pinnedDir`, `PINNED_RUN_KEY` and
      the timer inside `activate`) form an implicit shared-state object. Wrap them all
      into an activation-context object created fresh in each `activate()` call and
      passed explicitly to all inner functions. `deactivate()` receives or closes over
      the context. This eliminates the stale-reference hazard, makes `activate()` a
      pure factory, and enables future unit tests without VS Code mocking.
      _(Tracked here from code TODO(tech-debt) comments — deferred to post-1.0.)_
- [x] **Detect superseded / retried agents (M3-Superseded):** when the Workflow engine
      retries a stalled agent it spawns a NEW agent for the same role/round while the
      original stays `started` with no result — a zombie. Today both render as "running"
      (and the zombie only flips to "Stalled" after `STALE_SECS`), so the live count and
      timeline overstate concurrency (observed: two identical "viktor review round 2"
      agents at once). Detect the superseded original — same `agentType` + same review
      round/pass (or identical first-prompt key), older `start`, no result, shadowed by a
      newer same-key agent — and mark it distinctly (a "superseded"/"stalled" status,
      excluded from the live count) instead of "running". Heuristic + defensive: the
      journal does NOT explicitly mark retries, so never mis-flag a legitimately parallel
      cohort (e.g. real fan-out of the same role). On the timeline, group/collapse
      superseded attempts under the surviving agent's lane. Unit-test the supersede
      detection in `buildSnapshot` against a fixture with a zombie + its retry.

**Acceptance:** timeline accurately reflects start/elapsed/status for a live run
and updates on refresh without losing scroll position; graph lays out without
overlap for a typical fan-out; a retried/zombie agent is shown as
superseded/stalled (not counted as live), without mis-flagging genuine parallel cohorts.

---

## ✅ M4 — Launch polish: screenshots, disclaimer, community files, Open VSX  (DONE)

*Goal: a listing people trust and can contribute to.*

- [x] **Automated screenshots/GIF** via the headless-webview harness (spec below).
      `scripts/make-sample-run.mjs` writes a deterministic wf_* fixture (fixed
      historical timestamps; live agents use real `Date.now()` so they appear live).
      `scripts/screenshot.mjs` renders against this fixture for both dark and light
      themes, capturing full-page + viewport + Agents/Findings/Timeline tab shots.
      `npm run screenshots` runs both steps. `npm run make-fixture` writes the
      fixture standalone. 36 unit tests in `test/m4-screenshots.test.ts` verify
      fixture shape, superseded detection, determinism, and label correctness.
- [x] **README gallery** using the generated images; full screenshot table in
      README.md covering dark + light × top / Agents / Findings / Timeline.
- [x] **Unofficial disclaimer** in README and the Marketplace listing:
      "An unofficial, community-built tool. Not affiliated with or endorsed by Anthropic."
- [x] **Community files:** `CONTRIBUTING.md`, `.github/ISSUE_TEMPLATE/` (bug +
      feature), `PULL_REQUEST_TEMPLATE.md`, `SECURITY.md` (note it reads local CC
      transcripts and writes nothing; how to report privately), `CODE_OF_CONDUCT.md`
      (Contributor Covenant).
- [x] **Open VSX:** `release.yml` includes the `ovsx publish` step (gated on
      `HAS_OVSX_PAT`). The `OVSX_PAT` secret and the `malte-langermann` namespace
      on Open VSX require one-time manual setup (see PUBLISHING.md Step 6) — those
      steps are out of scope for automation.

**Acceptance:** `npm run screenshots` regenerates `media/screenshots/*` headlessly;
README renders the gallery; all community files present; a tagged release publishes
to both Marketplace and Open VSX.

---

## Screenshot automation harness (for M4)

Render the **real** webview HTML against synthetic data in headless Chromium — no
VS Code, no display required.

1. **Fixture generator** (`scripts/make-sample-run.mjs`): writes a `wf_screenshot_fixture/`
   dir — `journal.jsonl` + 10 `agent-*.jsonl` files covering: two-pass code review
   with HIGH/MEDIUM/LOW findings, security review, implementer (with `filesChanged`),
   UI/UX zombie + retry (superseded detection), verify agent (structured result),
   completeness-critic (dead/stalled), two live architects/implementers mid-tool-call.
   Historical timestamps are fixed (`BASE_TIME_SECS = 1742032800`); live-agent mtimes
   use `Date.now()` so they appear as 'run'. `makeSampleRun(outDir, nowSecs?)` is a
   named export usable from tests and the screenshot harness.
2. **Headless renderer** (`scripts/screenshot.mjs`, Playwright Chromium):
   - Bundles `buildSnapshot()` and `getHtml()` via esbuild (in-memory ESM).
   - Calls `makeSampleRun()` into a temp dir, builds a snapshot, loads `getHtml()`
     into a page, stubs `acquireVsCodeApi`, and dispatches the snapshot message.
   - Injects dark/light `--vscode-*` CSS variables (CSP-safe property assignment).
   - Screenshots: full-page, viewport, Agents tab, Findings tab, Timeline tab.
   - Output: `media/screenshots/` (committed). 2× DPI (`deviceScaleFactor: 2`).
   - Uses cached Chromium at known paths; falls back to Playwright default.
3. **npm scripts:** `npm run screenshots` (full pipeline), `npm run make-fixture`
   (fixture only, writes to `.review-tmp/fixture-run`).
4. **Tests:** `test/m4-screenshots.test.ts` — 36 tests covering file structure,
   meta.json content, buildSnapshot shape, superseded/live/dead agent detection,
   determinism, label correctness, changedByAgents, and script/package.json checks.
5. **Stretch (optional):** full VS Code capture via Playwright `_electron` +
   `@vscode/test-electron` under `xvfb` for chrome-inclusive shots. Not blocked on M4.

> Determinism: historical review content (agent transcripts, journal, results) is
> byte-identical across runs. Live-agent mtimes track real time so they appear live
> against `buildSnapshot`'s `Date.now()`. Screenshot pixel output may differ by
> a few elapsed-seconds for live agents but visual structure is identical.

---

## Decision log (from the planning interview — do not silently override)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Goal of publishing | **Real, maintained community tool** |
| 2 | Positioning vs. the broad "Claude Flow Monitor" | **Hybrid** — keep Workflow-run focus, cherry-pick popular features |
| 3 | Primary audience | **Broad Claude Code power users** (zero-config, good defaults) |
| 4 | Features to adopt | **Token/cost metrics, Markdown export, agent graph/timeline** (NOT notifications/webhooks) |
| 5 | Metrics depth | **Counts + charts, NO pricing** |
| 6 | Export format | **Markdown report** (save + copy) |
| 7 | Visualization | **Both** — timeline primary, optional dependency graph |
| 8 | Hardcoded crm-notes role rules | **Replace with a neutral generic set**; author's rules → personal settings |
| 9 | Robustness vs. undocumented format | **Defensive + friendly empty states**, tolerate drift |
| 10 | Run history | **Newest by default + recent-runs picker** |
| 11 | Trademark / official-ness | **Keep name + clear "unofficial, not affiliated with Anthropic" disclaimer** |
| 12 | Screenshots | **Automated headless webview render** (VS Code-chrome capture is optional stretch) |
| 13 | Codebase engineering | **Migrate to TypeScript + bundler** |
| 14 | Community scaffolding | **Open VSX + CONTRIBUTING/templates + SECURITY.md + Code of Conduct** |

### Reference: the "similar project" we compared against
`https://github.com/koh0001/claude-dashboard-extension` ("Claude Flow Monitor") —
a broad, TypeScript, 7-tab teams monitor (tasks, dependency graph, activity feed,
token tracking, git AI-commit badges, CSV/MD export, Slack/Discord webhooks, an
MCP server mode, 4-language i18n). We intentionally stay narrower and sharper; use
it for feature inspiration (metrics/export/graph), not as a breadth target.
