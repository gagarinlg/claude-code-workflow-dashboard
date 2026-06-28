# Authoring workflows for the Claude Code Workflow Dashboard

This guide is written to be handed to a **Claude Code session**. Follow it when
writing a `Workflow` script so the **Claude Code Workflow Dashboard** extension shows
rich, structured data instead of just raw text.

## TL;DR for the model

When you author a workflow script:

1. **Give every `agent()` a stable, descriptive `label`** (e.g. `fix-round-3`,
   `dev-review-round-2`). The dashboard groups and names agents by role.
2. **Start each agent prompt with a recognizable role sentence** — `"You are a
   SENIOR ... DEVELOPER ..."`, `"You are a ... REVIEWER ..."` — so the dashboard
   can auto-derive a clean role label even without configuration.
3. **For any agent whose output should be inspectable, pass a `schema`** so the
   result is a structured object, not a string.
4. **For review/audit agents, use the findings schema below** (`findings[]` with
   `severity`/`title`/`location`/`why`/`fix`). This lights up the **Findings**
   panel with severity badges and filters.
5. **For check/build/verify agents, return a flat object** (e.g. `{ buildOk,
   lintOk, testsOk, failures }`). This appears in the **Structured results**
   panel.
6. **Use `phase()` to name stages** and run repeated stages so the dashboard can
   count **passes** (it counts per-role result occurrences).

No path configuration is needed — the dashboard auto-discovers the newest run
under `~/.claude/projects`.

## Why these rules

The dashboard reads two files every workflow already writes:

- `journal.jsonl` — a `started` and a `result` record per `agent()` call.
- `agent-<id>.jsonl` — each agent's transcript (used for tokens, tool-calls,
  the current-activity line, and the expandable output tail).

It then interprets each `result` **by shape**:

| `result` shape | Dashboard treatment |
| --- | --- |
| object with a `findings` array | **Findings** panel + per-agent findings sub-window; `verdict` string shown under **Verdicts** |
| any other object | **Structured results** panel + pretty-printed in the agent sub-window |
| string | shown as the agent's text output in its sub-window |
| (no result yet) | live text/tool-call **tail** from the transcript |

Agent **status** is derived automatically: `done` (a result exists), `live`
(transcript changed in the last 90 s), or `dead` (interrupted — no result and no
recent activity).

## The findings schema (recommended for reviewers)

Pass this as the `schema` to any reviewer/auditor agent. Severities should be one
of `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, `NITPICK` (these get colored badges;
anything else shows as `UNRATED`).

```js
const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NITPICK'] },
          title:    { type: 'string' },
          location: { type: 'string', description: 'file:line' },
          why:      { type: 'string' },
          fix:      { type: 'string' },
        },
        required: ['severity', 'title', 'location', 'why', 'fix'],
      },
    },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
};
```

## A dashboard-friendly skeleton

```js
export const meta = {
  name: 'review-loop',
  description: 'Fix, verify, and review until clean',
  phases: [{ title: 'Fix' }, { title: 'Verify' }, { title: 'Review' }],
};

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    buildOk: { type: 'boolean' }, lintOk: { type: 'boolean' },
    testsOk: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['buildOk', 'lintOk', 'testsOk', 'failures', 'summary'],
};

for (let round = 1; round <= MAX_ROUNDS; round++) {
  phase('Fix');
  // Prompt starts with a recognizable role sentence; stable per-round label.
  await agent(`You are a SENIOR FULL-STACK DEVELOPER fixing ...`,
    { label: `fix-round-${round}`, phase: 'Fix' });

  phase('Verify');
  const verify = await agent(`You are a build/test verifier ...`,
    { label: `verify-round-${round}`, phase: 'Verify', schema: VERIFY_SCHEMA });

  phase('Review');
  const [dev, ux] = await parallel([
    () => agent(`You are a GRUMPY, SENIOR ... DEVELOPER reviewing ...`,
      { label: `dev-review-round-${round}`, phase: 'Review', schema: REVIEW_SCHEMA }),
    () => agent(`You are a NITPICKY, GRUMPY, SENIOR UX DESIGNER ...`,
      { label: `ux-review-round-${round}`, phase: 'Review', schema: REVIEW_SCHEMA }),
  ]);

  if ([...dev.findings, ...ux.findings].length === 0 &&
      verify.buildOk && verify.lintOk && verify.testsOk) {
    return { converged: true, roundsRun: round };
  }
}
```

This produces, in the dashboard:

- **Overview**: pass count (from repeated `dev`/`ux` results), phase, live/done/
  dead agents, total tokens & tool-calls, findings + severity totals.
- **Agents**: a card per `agent()`; expand to see findings, the verify object,
  or the live tail.
- **Findings**: every reviewer's findings, filterable by role and severity.
- **Structured results**: each `verify` object.
- **Verdicts**: the `verdict` string from each reviewer.

## Optional: explicit role labels

If your prompts don't start with a clear role sentence, label agents via the
`claudeWorkflow.roleRules` setting — an array of `{ re, label, key }` matched
against each agent's first prompt:

```json
"claudeWorkflow.roleRules": [
  { "re": "fixing review findings", "label": "Fix", "key": "fix" },
  { "re": "build/test verifier",    "label": "Verify", "key": "verify" },
  { "re": "reviewing the ENTIRE",   "label": "Reviewer", "key": "rev" }
]
```

Without rules, the dashboard derives a label from the prompt's
`"You are a/an/the <…>"` phrase, so a clear opening sentence is usually enough.

## Things that confuse the dashboard (avoid)

- **Returning JSON as a string** from a reviewer — pass a `schema` instead, or it
  shows as opaque text rather than filterable findings.
- **Reusing the same `label`** for unrelated agents — pass counting and grouping
  rely on distinct, role-stable labels.
- **Non-standard severity values** — they render as `UNRATED` (still listed, just
  uncolored).
- **Long-lived stopped runs** — after a stop/resume, killed agents show as
  `dead`; that's expected and informational, not an error.
