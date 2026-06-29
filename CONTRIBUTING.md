# Contributing to Claude Code Workflow Dashboard

Thank you for your interest in contributing. This is an unofficial community
project — not affiliated with Anthropic. All contributions are welcome.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Dev setup](#dev-setup)
- [Common commands](#common-commands)
- [Project structure](#project-structure)
- [Code style](#code-style)
- [Coverage gate](#coverage-gate)
- [dist/ is generated, not committed](#dist-is-generated-not-committed)
- [Pull request flow](#pull-request-flow)
- [Issue templates](#issue-templates)

---

## Code of Conduct

By participating in this project you agree to abide by the
[Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).

---

## Dev setup

**Prerequisites:** Node.js >= 18, npm >= 9, VS Code >= 1.84.

```bash
# 1. Fork and clone
git clone https://github.com/gagarinlg/claude-code-workflow-dashboard.git
cd claude-code-workflow-dashboard

# 2. Install dependencies (use ci to match CI exactly)
npm ci

# 3. Build once
npm run build

# 4. Launch the Extension Development Host
# Press F5 in VS Code (see .vscode/launch.json)
```

There are no third-party runtime dependencies — only the `vscode` API and
Node built-ins (`fs`, `os`, `path`). All devDependencies are development-only
and not shipped in the VSIX.

---

## Common commands

| Command | What it does |
|---------|--------------|
| `npm run build` | Production build (minified) → `dist/extension.js` |
| `npm run watch` | Rebuild on change (source-mapped) |
| `npm run typecheck` | `tsc --noEmit` (no output) |
| `npm run lint` | ESLint with `typescript-eslint` |
| `npm test` | Run vitest unit tests once |
| `npm run coverage` | Tests + Istanbul coverage report (90 % gate) |
| `npm run make-fixture` | Write the screenshot fixture to `.review-tmp/fixture-run` |
| `npm run screenshots` | Regenerate `media/screenshots/*` headlessly (Playwright Chromium) |
| `npx @vscode/vsce package` | Package a `.vsix` locally (runs `npm run build` first) |

---

## Project structure

```
src/extension.ts          Activation / host wiring (commands, views, status bar, watcher, timer)
src/data/discovery.ts     findWorkflowDir — discovers the newest wf_* run
src/data/parse.ts         jload, deriveLabel, classify, agentStats, sevCounts
src/data/snapshot.ts      buildSnapshot + Snapshot types
src/data/changed.ts       walkChanged
src/webview/html.ts       getHtml() — webview template + inline client script
build.mjs                 esbuild build script
vitest.config.ts          Vitest config; 90 % coverage gate on src/data/**, src/webview/**, and src/export/**
eslint.config.mjs         ESLint flat config
tsconfig.json             TypeScript strict config
test/                     Vitest unit tests (*.test.ts) + fixtures/
scripts/                  Standalone scripts (make-sample-run.mjs, screenshot.mjs, typecheck.mjs)
dist/                     Bundled output — generated, never committed
media/screenshots/        Generated screenshots — committed after `npm run screenshots`
docs/DATA-FORMAT.md       Reverse-engineered spec of the on-disk journal/transcript format
ROADMAP.md                Feature plan and decision log — read this before starting feature work
```

---

## Code style

- **TypeScript strict** — `tsconfig.json` enables `strict: true`. No `any` unless
  unavoidable (comment why).
- **ESLint** — run `npm run lint` before pushing. Fix all reported issues; the CI
  gate is zero warnings.
- **Theme-native UI** — use `--vscode-*` CSS variables exclusively. No hardcoded
  colors.
- **No inline `style=` on `innerHTML` content** — apply styles via nonce'd `<style>`
  blocks or CSS classes. Setting `el.style.left` on a named DOM node is fine;
  injecting `style=` via `innerHTML` is not (CSP blocks it).
- **No inline event handlers** — use `addEventListener` only.
- **Read-only, always** — the extension must never write to `~/.claude`, the
  workspace, or anywhere else. Every `fs` access must be guarded; errors degrade to
  `{ok:false, msg}`, never throw into the UI.
- **Defensive parsing** — tolerate missing files/fields and unknown JSON shapes.
  Never throw on malformed input; degrade to a friendly empty state.
- **No hardcoded personal data** — anything personal (role rules, paths) belongs in
  user settings, not shipped defaults.
- **Sanitize webview output** — `esc()` every transcript-derived value before
  injecting into the webview. No raw `innerHTML` of untrusted text.
- **i18n / user-facing strings** — user-visible strings live in the webview
  template; keep them in English (the project does not currently ship i18n).
- **Naming** — internal command/setting ids stay `claudeWorkflow.*` (renaming
  breaks user keybindings/settings); only titles use the full product name.

---

## Coverage gate

Vitest is configured with a **90 % statement/branch/function/line coverage gate**
on `src/data/**`, `src/webview/**`, and `src/export/**`. Pull requests that drop
coverage below 90 % in any of these three directories will fail CI.

When you add a new pure function under `src/data/`, a new webview rendering path
under `src/webview/`, or a new export function under `src/export/`, add tests for
it in `test/`. The test files mirror the source structure (e.g. `src/data/parse.ts`
→ `test/parse.test.ts`, `src/export/markdown.ts` → `test/m2-export.test.ts`).

Run `npm run coverage` locally before pushing to see the coverage report.

---

## `dist/` is generated, not committed

`dist/extension.js` is the bundled output produced by `npm run build`. It is
**not committed** to source control and is **not in `.gitignore`** — it only
appears in the VSIX (via `vscode:prepublish`).

Do not add `dist/` files to commits. The CI pipeline builds fresh on every push.

---

## Pull request flow

1. **Open an issue first** for anything beyond a trivial fix so we can align on
   approach before you invest time.
2. **Branch from `master`** using a descriptive name:
   `feature/<short-name>`, `fix/<short-name>`, `docs/<short-name>`.
3. **Keep commits focused.** One logical change per commit; `git rebase -i` to
   clean up before opening the PR.
4. **Run the full suite locally** before pushing:
   ```bash
   npm run typecheck && npm run lint && npm run coverage
   ```
   All must pass.
5. **Fill in the pull request template** — describe what the change does, why,
   and how you tested it.
6. **One approval** is required before merge. The maintainer will review within a
   few days. Be patient — this is a community project maintained in spare time.
7. **Squash or rebase** on merge (no merge commits on `master`).

---

## Issue templates

Use the GitHub issue templates:

- **Bug report** — for reproducible defects.
- **Feature request** — for new functionality.

For security vulnerabilities, see [SECURITY.md](SECURITY.md) — **do not open a
public issue**.
