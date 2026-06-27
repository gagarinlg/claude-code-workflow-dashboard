# Data format consumed by the dashboard

This documents the on-disk Claude Code `Workflow()` run format the extension
**reads** (it never writes). It is reverse-engineered from the modules under `src/data/` and live
runs under `~/.claude/projects`. **It is an internal, undocumented Claude Code
format and may change between CLI versions** — parse everything defensively.

## Discovery / location

Runs live under the configurable base dir (`claudeWorkflow.workflowsGlobBase`,
default `~/.claude/projects`). The extension recursively searches for a directory
**named `wf_*` whose immediate parent directory is named `workflows`**, i.e.:

```
~/.claude/projects/<project-hash>/subagents/workflows/wf_<id>/
```

`findWorkflowDir()` returns the **single most-recently-modified** such dir.
`node_modules`/`vendor` subtrees are skipped; search depth is bounded (5).

> M1 adds a "recent runs" picker — collect ALL matching `wf_*` dirs, sort by
> mtime, and let the user choose, defaulting to newest.

## Files inside a `wf_<id>/` directory

| File | Role |
| --- | --- |
| `journal.jsonl` | One record per `agent()` call lifecycle event. The source of truth for results. |
| `agent-<agentId>.jsonl` | Each agent's full transcript (user/assistant turns, tool calls, token usage). |
| `agent-<agentId>.meta.json` | Optional. Its mtime is used as the agent's **start time** (falls back to the transcript file's mtime). |

`<agentId>` is the substring between `agent-` and `.jsonl`.

## `journal.jsonl` records

JSONL; each line is one object. Observed `type` values:

- `{ "type": "started", "agentId": "<id>", ... }` — an `agent()` call began.
- `{ "type": "result", "agentId": "<id>", "result": <payload> }` — it finished.

An agent is **done** iff a `result` record exists for its id.

### `result.result` payload shapes (interpreted by shape)

1. **Findings result** — object with an array under `findings`:
   ```json
   { "findings": [ { "severity": "HIGH", "title": "...", "why": "...", "fix": "..." } ],
     "verdict": "optional summary string" }
   ```
   Each finding is aggregated into the Findings panel, tagged with `reviewer`
   (the agent's role label), `key`, and `pass` (Nth result from that role).
   `severity` is free-form; missing ⇒ `UNRATED`.
2. **Structured result** — any other object (e.g. a build/verify result). Shown
   pretty-printed in the Structured Results panel.
3. **Text result** — a string. Shown as the agent's text output.

> The webview decides panels purely from these shapes. Keep that contract when
> adding the Markdown export (M2): export findings, verdicts, structured results,
> and per-agent metrics.

## `agent-<id>.jsonl` transcript events

JSONL of turn objects. Fields the extension uses:

- `{ "type": "user", "message": { "content": <string | block[]> } }` — the FIRST
  user turn's text is the prompt used to derive the agent's role label
  (`classify()`/`deriveLabel()`; matches `You are a/an/the <role>`).
- `{ "type": "assistant", "message": { "content": block[], "usage": { "output_tokens": <n> } } }`
  - `usage.output_tokens` is summed per agent (token counts; M2 charts).
  - content blocks:
    - `{ "type": "tool_use", "name": "<tool>", "input": {...} }` — counted as a
      tool call; `[name] <json-input-prefix>` is appended to the activity tail.
    - `{ "type": "text", "text": "..." }` — appended to the activity tail.

The last ~30 tail entries drive the "current activity" line and the expandable
per-agent output.

> For richer metrics (M2) also consider `usage.input_tokens`,
> `cache_creation_input_tokens`, and `cache_read_input_tokens` if present — but
> verify they exist before relying on them, and never assume a field is there.

## Derived agent status

For each agent, with `STALE_SECS = 90`:

- **done** — a `result` exists in the journal.
- **run** (live) — no result, transcript mtime within the last 90 s.
- **dead** — no result and no recent activity (e.g. interrupted by stop/resume).

## Snapshot object (host → webview)

`buildSnapshot()` returns either `{ ok: false, msg }` (no run found) or:

```jsonc
{
  "ok": true,
  "runId": "wf_<id>",
  "workflowDir": "<abs path>",   // NOTE: stripped by safeSnap() before webview delivery — present in the host's SnapshotOk type but absent from every message the webview receives.
  "updatedAt": "<localized time>",
  "loop": { "phase", "live", "done", "dead", "total", "outTok", "tools",
            "passes", "findings", "sevTotals": { "HIGH": 2, ... } },
  "labels": ["Review", "Verify", ...],          // distinct reviewer labels
  "agents": [ { "id", "label", "key", "status", "elapsed", "tokens", "tools",
               "tail", "lastActivity", "start", "mtime", "idx",
               "findings?"|"result?"|"resultText?", "verdict?" } ],
  "allFindings": [ { "pass", "reviewer", "key", ...finding } ],
  "structuredResults": [ { "pass", "label", "key", "result" } ],
  "verdicts": { "<label>": "verdict text" },
  "changed": ["relative/path", ...] | null       // files changed in repo in last 120s
}
```

Preserve this contract during the M0 TypeScript migration — type it, don't reshape
it, so the webview keeps working unchanged.
