/**
 * generateMarkdown — pure function that converts a SnapshotOk into a single
 * Markdown report string.
 *
 * Contract:
 * - Input: SnapshotOk (the in-memory latest snapshot — NEVER re-reads disk).
 * - Output: a Markdown string that round-trips cleanly into a GitHub issue/PR.
 * - Contains: run id + time, loop summary + severity breakdown, findings grouped
 *   by reviewer (severity, title, why, fix), verdicts, structured results, and a
 *   per-agent metrics table (tokens + tool-calls; NO pricing).
 * - Defensive: all fields guarded for optional/missing values. Never throws.
 * - No external dependencies (only built-in string operations).
 */

import type { SnapshotOk, Finding, Verdict } from '../data/snapshot';
import { CHANGED_MAX_SECS } from '../data/snapshot';

// Severity display order — CRITICAL first so the most important findings rise
// to the top of each reviewer's section. NITPICK sits after LOW (lowest named
// severity above INFO) to match the implied priority from the webview CSS.
const SEV_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NITPICK', 'INFO', 'UNRATED'];

/**
 * Compare two severity strings by the canonical order defined in SEV_ORDER.
 * Unrecognised severities sort after the known ones, alphabetically.
 */
function cmpSev(a: string, b: string): number {
  const ai = SEV_ORDER.indexOf(a);
  const bi = SEV_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a.localeCompare(b);
}

/** Safe string coercion — converts null/undefined to empty string. */
function s(v: unknown): string {
  if (v == null) return '';
  return String(v);
}

/**
 * Format a token count: raw for < 1 000, "x.xk" for thousands, "x.xxM" for millions.
 * Broadly mirrors the embedded fmtTok in src/webview/html.ts (JS_PANEL constant).
 * Note intentional divergence: this TS version uses Math.round() for sub-1000 values;
 * the JS version uses raw coercion (safeN result is already a number, no rounding).
 * Keep the >=1000 rounding logic (toFixed(1)k / toFixed(2)M) in sync between versions.
 * True deduplication is blocked: the webview version runs in the webview DOM context.
 * Tech-debt: keep in sync with fmtTok in src/webview/js-panels.ts
 * See ROADMAP.md §"M2-tech-debt: deduplicate fmtTok" for the deduplication plan.
 */
function fmtTok(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1_000) return String(Math.round(n));
  if (n < 1_000_000) return (n / 1_000).toFixed(1) + 'k';
  return (n / 1_000_000).toFixed(2) + 'M';
}

/**
 * Format elapsed seconds as "Xs", "Xm Ys", or "Xh Ym".
 *
 * Intentional format divergence from the webview fmtT (src/webview/html.ts JS_PANEL):
 *   fmtElapsed(90)  → "1m 30s"  (space between m and s; no zero-padding)
 *   fmtT(90)        → "1m30s"   (no space; seconds zero-padded to 2 digits via padStart)
 *   fmtElapsed(3661) → "1h 1m"
 *   fmtT(3661)       → "1h01m"  (no space; minutes zero-padded)
 * The difference is intentional: the Markdown report uses a human-readable prose style;
 * the webview uses a compact monospace style suited for the narrow card layout.
 * Cross-reference: fmtT is defined in src/webview/html.ts (search for "function fmtT").
 * Test coverage: m2-export.test.ts 'fmtTok — TS/JS parity' section documents the known
 * fmtT/fmtElapsed format divergence.
 */
function fmtElapsed(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return '—';
  const sec = Math.round(secs);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const rem = sec % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mRem = m % 60;
  return mRem ? `${h}h ${mRem}m` : `${h}h`;
}

/**
 * Escape Markdown table cell content — replace `|` with `\|` and newlines with
 * a space so cell borders aren't broken.
 */
function escCell(v: unknown): string {
  return s(v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

/**
 * Escape a value for use in Markdown body text (blockquotes, paragraphs).
 * Strips leading/trailing whitespace; replaces repeated blank lines with one.
 * Blockquotes ATX-style heading markers (## at position 0 OR after a newline)
 * to prevent transcript-derived content from forging structural sections.
 * Escapes setext-style heading underlines (one or more = or - on their own line)
 * by inserting a backslash prefix — a line of only '=' or '-' chars after content
 * would promote the preceding paragraph line to H1/H2 in GitHub-flavored Markdown.
 * The CommonMark spec requires only a single '=' or '-', so we must guard =+ and -+
 * (not just ={3,} or -{3,}).
 * Replaces runs of 2+ asterisks with `\*` (a backslash-escaped asterisk) so the
 * output is never interpreted as a Markdown italic/bold opener. The backslash escape
 * renders the `*` character visually but prevents it from pairing with any surrounding
 * asterisks to form italic/bold structure.
 * Neutralises Markdown inline links [text](url) by rendering as plain text with
 * the URL in parentheses — prevents external hyperlinks to attacker-chosen
 * destinations in GitHub/PR rendered views.
 * Escapes triple-backtick sequences to prevent code-fence injection (guard runs before
 * the single-backtick replace so it has actual backtick characters to match).
 */
/**
 * Regex that matches a Markdown inline link [text](url).
 * Used in escBody and escKey to defang injected hyperlinks.
 * Applied in a loop until stable — see the block comment in escBody for rationale.
 *
 * Known limitation: [^)]+ stops at the first ')' inside the URL, so URLs containing
 * balanced parentheses (e.g. Wikipedia links with disambiguation in the path) are only
 * partially captured. The result is malformed text, not a live hyperlink — the security
 * goal of preventing injection is met. This is an accepted limitation documented here.
 */
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;

/**
 * Defang all Markdown inline links in a string by replacing [text](url) with
 * plain "text (url)". Applied in a loop (max 3 iterations) until the string
 * stabilises, because a single left-to-right pass leaves nested-bracket constructs
 * like '[a [b](harmless)](evil)' with a residual '[b (harmless)](evil)' link that
 * is fully valid GFM. Iterating until stable eliminates any nesting an attacker
 * could craft via prompt injection in a transcript value.
 */
function defangLinks(str: string): string {
  let result = str;
  let prev: string;
  let iters = 0;
  do {
    prev = result;
    result = result.replace(LINK_RE, (_, t: string, u: string) =>
      t.replace(/[\r\n]+/g, ' ') + ' (' + u.replace(/[\r\n]+/g, ' ') + ')');
  } while (result !== prev && ++iters < 3);
  return result;
}

function escBody(v: unknown): string {
  // defangLinks is applied last (after heading/setext/bold guards) so that those
  // guards see the original text first. A URL containing \n## would bypass the
  // heading guard if defangLinks ran before it (the URL text is emitted after the
  // guard's replacement position). defangLinks itself strips newlines from the URL
  // portion, closing the heading-bypass via URL vector.
  // The backtick guards run after defangLinks: triple-backtick guard first, then
  // single-backtick replace. This order ensures the ``` guard sees actual backtick
  // characters (not yet replaced apostrophes). No legitimate link text or URL
  // contains ``` so running them after defangLinks is safe.
  const processed = s(v)
    .trim()
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^|\n)(#{1,6} )/g, '$1> $2')
    .replace(/(^|\n)(=+|-+)(?=\s*(?:\n|$))/g, '$1\\$2')
    // Bold-guard: replace runs of 2+ asterisks with an escaped '\\*' (backslash-star)
    // so the result is never interpreted as a Markdown italic/bold opener. A bare single
    // '*' replacement was previously used but produced a dangling italic opener when the
    // reduced '*' appeared adjacent to the surrounding **Why:** bold span in the template
    // (e.g. '** Note:' → '* Note:' → '**Why:** * Note:' — the lone * has no closer).
    // Using '\\*' escapes it: '** Note:' → '\\* Note:' → renders as literal '* Note:'.
    .replace(/\*{2,}/g, '\\*')
    // Escape lone (unescaped) * at whitespace or string boundaries to prevent any remaining
    // dangling italic openers that slip past the ** guard above. Escaped as \\* rather than
    // deleted so the character is preserved for readers (avoids silent data loss).
    .replace(/(^|\s)\*(\s|$)/gm, '$1\\*$2');
  // Backtick guards: a backtick inside a transcript-derived value can open or close
  // an inline code span inside the surrounding **Why:** bold template, hiding content.
  // Triple-backtick guard runs FIRST (before the single-backtick replace) so that it
  // has actual backtick characters to match. If the single-backtick replace ran first,
  // every backtick would already be an apostrophe and the ``` guard would be permanently
  // unreachable. Applying both replacements in this order means: ``` → \`\`\` → the
  // remaining single backticks (including those from the already-escaped triples) are
  // then replaced by apostrophes, fully neutralising all code-fence and inline-code-span
  // injection paths.
  return defangLinks(processed).replace(/```/g, '\\`\\`\\`').replace(/`/g, "'");
}

/**
 * Escape a transcript-derived key for use inside a Markdown bold span (**key**).
 * Strips `**` sequences that would break or forge bold spans, removes embedded
 * newlines that would start a new paragraph or heading, and neutralises inline links
 * [text](url) → text (url) to prevent a crafted result key from injecting hyperlinks.
 * (escBody already neutralises links in value position; escKey must do the same for
 * key position to close the symmetric injection gap.)
 */
function escKey(v: unknown): string {
  // defangLinks is applied in a loop (same as escBody) to close the nested-bracket
  // bypass: '[a [b](harmless)](evil)' would survive a single-pass replace unchanged.
  return defangLinks(
    s(v)
      .replace(/\*\*/g, '')
      .replace(/[\r\n]+/g, ' ')
  ).trim();
}

/**
 * Escape a transcript-derived value for use inside a Markdown inline code span.
 * Strips newlines (which would break the span and could begin a heading line)
 * and replaces backticks with single-quotes (a backtick inside a code span
 * terminates it prematurely, forging inline structure).
 * Safe for file:line use-cases — no legitimate path contains a backtick.
 */
function escInlineCode(v: unknown): string {
  return s(v).replace(/[\r\n]+/g, ' ').replace(/`/g, "'");
}

/**
 * Escape a transcript-derived value for use in a Markdown heading.
 * Strips embedded newlines/carriage returns (they would forge additional heading
 * levels or code fences in the rendered output) and trims whitespace.
 * Replaces backtick characters with single-quotes: the heading template wraps
 * severity in an inline code span (`${sev}`) — an injected backtick would close
 * that span prematurely, producing malformed Markdown (cosmetic corruption only,
 * not an injection vector, since newlines are stripped). Consistent with the same
 * backtick replacement in escInlineCode.
 * Always use this — never s() or escBody() — when building a ### or #### line.
 */
function escHeading(v: unknown): string {
  return s(v).replace(/[\r\n]+/g, ' ').replace(/`/g, "'").trim();
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildHeader(snap: SnapshotOk, generatedAt: Date): string {
  const lines: string[] = [];
  lines.push(`# Claude Code Workflow Dashboard — Run Report`);
  lines.push('');
  lines.push(`**Run ID:** \`${escInlineCode(snap.runId)}\``);
  // Use the caller-supplied wall-clock time as the 'Generated' timestamp so the
  // report is unambiguously dated even when viewed days later. snap.updatedAt is a
  // short time-only string (e.g. '12:00:00') appropriate for the live dashboard
  // (where the date is obvious) but misleading in a standalone Markdown report.
  lines.push(`**Generated:** ${s(generatedAt.toISOString())}`);
  // Include the run's last-activity time as a secondary field for correlation.
  // escBody() rather than s(): defense-in-depth — updatedAt is currently generated by
  // new Date().toISOString() so attacker control is impossible, but if the source ever
  // changes (e.g. read from the journal), the escaping is already in place.
  if (snap.updatedAt) lines.push(`**Last activity:** ${escBody(snap.updatedAt)}`);
  if (snap.isPinned) lines.push(`**Note:** Pinned run`);
  lines.push('');
  return lines.join('\n');
}

function buildLoopSummary(snap: SnapshotOk): string {
  const L = snap.loop;
  const lines: string[] = [];
  lines.push(`## Loop Summary`);
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Phase | ${escCell(L.phase)} |`);
  lines.push(`| Agents total | ${L.total} |`);
  lines.push(`| Live | ${L.live} |`);
  lines.push(`| Done | ${L.done} |`);
  lines.push(`| Stalled | ${L.dead} |`);
  // Superseded: only shown when > 0 to keep the table uncluttered for typical runs.
  // Mirrors the conditional rendering in overview() in js-panels.ts.
  if (L.superseded) lines.push(`| Superseded | ${L.superseded} |`);
  lines.push(`| Review passes | ${L.passes} |`);
  lines.push(`| Total findings | ${L.findings} |`);
  lines.push(`| Output tokens | ${fmtTok(L.outTok)} |`);
  lines.push(`| Tool calls | ${L.tools} |`);
  if (L.inTok != null) lines.push(`| Input tokens | ${fmtTok(L.inTok)} |`);
  if (L.cacheRead != null) lines.push(`| Cache read tokens | ${fmtTok(L.cacheRead)} |`);
  if (L.cacheCreate != null) lines.push(`| Cache write tokens | ${fmtTok(L.cacheCreate)} |`);
  lines.push('');

  // Severity breakdown — only render when there are findings
  const sevTotals = L.sevTotals ?? {};
  const sevKeys = Object.keys(sevTotals).sort(cmpSev);
  if (sevKeys.length > 0) {
    lines.push(`### Severity Breakdown`);
    lines.push('');
    lines.push(`| Severity | Count |`);
    lines.push(`| --- | --- |`);
    for (const sev of sevKeys) {
      lines.push(`| ${escCell(sev)} | ${sevTotals[sev] ?? 0} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildFindings(snap: SnapshotOk): string {
  if (!snap.allFindings || snap.allFindings.length === 0) return '';

  const lines: string[] = [];
  lines.push(`## Findings`);
  lines.push('');

  // Group by agent key to avoid silently merging two distinct agents that share
  // the same display label. Fall back to reviewer display name, then 'Unknown'.
  // The heading still shows the display label (reviewer), not the key.
  const byReviewer = new Map<string, Finding[]>();
  const keyToLabel = new Map<string, string>();
  for (const f of snap.allFindings) {
    const groupKey = s(f.key) || s(f.reviewer) || 'Unknown';
    const displayLabel = s(f.reviewer) || groupKey;
    keyToLabel.set(groupKey, displayLabel);
    let arr = byReviewer.get(groupKey);
    if (!arr) { arr = []; byReviewer.set(groupKey, arr); }
    arr.push(f);
  }

  for (const [groupKey, findings] of byReviewer) {
    const reviewer = keyToLabel.get(groupKey) ?? groupKey;
    // Sort within each reviewer section by severity
    const sorted = [...findings].sort((a, b) => {
      const aSev = s(a.severity) || 'UNRATED';
      const bSev = s(b.severity) || 'UNRATED';
      return cmpSev(aSev, bSev);
    });

    const passNums = [...new Set(sorted.map((f) => f.pass).filter((p) => p != null))];
    // Cap the displayed pass list at 3 to prevent unbounded parentheticals for
    // runs with many passes (e.g. 10 reviewer passes → "(passes 1, 2, …+8 more)").
    let passInfo: string;
    if (passNums.length === 0) {
      passInfo = '';
    } else if (passNums.length === 1) {
      passInfo = ` (pass ${escHeading(String(passNums[0]))})`;
    } else if (passNums.length <= 3) {
      passInfo = ` (passes ${passNums.map((p) => escHeading(String(p))).join(', ')})`;
    } else {
      const shown = passNums.slice(0, 3).map((p) => escHeading(String(p))).join(', ');
      passInfo = ` (passes ${shown}, …+${passNums.length - 3} more)`;
    }
    lines.push(`### ${escHeading(reviewer)}${passInfo}`);
    lines.push('');

    for (const f of sorted) {
      const sev = escHeading(s(f.severity) || 'UNRATED');
      const title = escHeading(s(f.title) || '(untitled)');
      lines.push(`#### \`${sev}\` ${title}`);
      lines.push('');
      if (f.location) {
        lines.push(`**Location:** \`${escInlineCode(f.location)}\``);
        lines.push('');
      }
      const why = escBody(f.why);
      if (why) {
        lines.push(`**Why:** ${why}`);
        lines.push('');
      }
      const fix = escBody(f.fix);
      if (fix) {
        lines.push(`**Fix:** ${fix}`);
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

function buildVerdicts(snap: SnapshotOk): string {
  const verdicts: Verdict = snap.verdicts ?? {};
  const verdictLabels = snap.verdictLabels ?? {};
  const keys = Object.keys(verdicts);
  if (keys.length === 0) return '';

  const lines: string[] = [];
  lines.push(`## Verdicts`);
  lines.push('');
  lines.push(`| Reviewer | Verdict |`);
  lines.push(`| --- | --- |`);
  for (const key of keys) {
    const label = s(verdictLabels[key]) || s(key);
    const verdict = s(verdicts[key]);
    lines.push(`| ${escCell(label)} | ${escCell(verdict)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function buildStructuredResults(snap: SnapshotOk): string {
  if (!snap.structuredResults || snap.structuredResults.length === 0) return '';

  const lines: string[] = [];
  lines.push(`## Structured Results`);
  lines.push('');

  for (const sr of snap.structuredResults) {
    const label = escHeading(s(sr.label) || s(sr.key) || 'Agent');
    lines.push(`### ${label} (pass ${escHeading(String(sr.pass ?? '?'))})`);
    lines.push('');
    // Render key/value pairs from the result object — skip findings (already in Findings section)
    const result = sr.result ?? {};
    for (const [k, v] of Object.entries(result)) {
      if (k === 'findings') continue; // shown in Findings section
      // escKey strips ** to prevent bold-injection; escBody handles heading/fence injection in values.
      // Cap JSON.stringify output for deeply-nested objects to prevent unbounded line lengths.
      let vStr: unknown = v;
      if (typeof v === 'object' && v !== null) {
        const serialized = JSON.stringify(v);
        // Cap at 2000 chars to bound worst-case escBody() work. escBody runs six regex
        // passes each O(N) in the string length. For realistic inputs (< 50 results,
        // < 20 keys each), the 2000-char cap keeps total work well below any perceptible
        // threshold. If this becomes a hotspot, consider a simpler escPlainText() that
        // only strips heading markers and code fences without the full regex chain.
        vStr = serialized.length > 2000 ? serialized.slice(0, 2000) + '… (truncated)' : serialized;
      }
      lines.push(`**${escKey(k)}:** ${escBody(vStr)}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildAgentMetrics(snap: SnapshotOk): string {
  if (!snap.agents || snap.agents.length === 0) return '';

  const lines: string[] = [];
  lines.push(`## Agent Metrics`);
  lines.push('');

  // Determine which optional columns exist across all agents
  const hasInTok = snap.agents.some((a) => a.inTok != null);
  const hasCacheRead = snap.agents.some((a) => a.cacheRead != null);
  const hasCacheCreate = snap.agents.some((a) => a.cacheCreate != null);

  // Build header
  const cols = ['#', 'Agent', 'Status', 'Elapsed', 'Out tokens', 'Tool calls'];
  if (hasInTok) cols.push('In tokens');
  if (hasCacheRead) cols.push('Cache read');
  if (hasCacheCreate) cols.push('Cache write');

  lines.push(`| ${cols.join(' | ')} |`);
  lines.push(`| ${cols.map(() => '---').join(' | ')} |`);

  for (const a of snap.agents) {
    const cells: string[] = [
      s(a.idx ?? ''),
      escCell(a.label),
      a.superseded ? 'superseded' : a.status === 'dead' ? 'stalled' : a.status === 'run' ? 'live' : s(a.status),
      fmtElapsed(a.elapsed),
      fmtTok(a.tokens ?? 0),
      String(a.tools ?? 0),
    ];
    if (hasInTok) cells.push(a.inTok != null ? fmtTok(a.inTok) : '—');
    if (hasCacheRead) cells.push(a.cacheRead != null ? fmtTok(a.cacheRead) : '—');
    if (hasCacheCreate) cells.push(a.cacheCreate != null ? fmtTok(a.cacheCreate) : '—');
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');

  return lines.join('\n');
}

function buildChangedFiles(snap: SnapshotOk): string {
  const byAgents = snap.changedByAgents ?? [];
  const mtime = snap.changed ?? [];
  if (byAgents.length === 0 && mtime.length === 0) return '';

  const lines: string[] = [];
  lines.push(`## Changed Files`);
  lines.push('');

  if (byAgents.length > 0) {
    lines.push(`### Files reported by agents`);
    lines.push('');
    for (const f of byAgents) {
      lines.push(`- \`${escInlineCode(f)}\``);
    }
    lines.push('');
  }

  if (mtime.length > 0) {
    const changedMaxMin = Math.round(CHANGED_MAX_SECS / 60);
    lines.push(`### Recently touched (last ${changedMaxMin} min)`);
    lines.push('');
    for (const f of mtime) {
      lines.push(`- \`${escInlineCode(f)}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a complete Markdown report from a SnapshotOk.
 *
 * The snapshot must be the already-built in-memory object — this function
 * never reads disk. It is a pure transformation: same input → same output.
 *
 * Sections (all optional except header + loop summary):
 *   1. Header (run id, generated time)
 *   2. Loop Summary + Severity Breakdown
 *   3. Findings grouped by reviewer
 *   4. Verdicts
 *   5. Structured Results
 *   6. Agent Metrics table
 *
 * All values are string-coerced so a missing/null field never throws.
 * The output round-trips cleanly into a GitHub issue or PR comment.
 */
export function generateMarkdown(snap: SnapshotOk, generatedAt: Date = new Date()): string {
  const parts: string[] = [
    buildHeader(snap, generatedAt),
    buildLoopSummary(snap),
    buildFindings(snap),
    buildVerdicts(snap),
    buildStructuredResults(snap),
    buildAgentMetrics(snap),
    buildChangedFiles(snap),
  ];

  // Join non-empty sections; ensure a single trailing newline.
  return parts.filter(Boolean).join('\n').trimEnd() + '\n';
}

// Re-export helpers for test access (used in unit tests via the module boundary).
export { fmtTok, fmtElapsed, cmpSev };

// ---------------------------------------------------------------------------
// buildExportFilename — derive a filesystem-safe default filename for an export.
//
// Format: claude-workflow-<sanitisedRunId>-<YYYYMMDD-HHmm>.md
// Constraints (ROADMAP §M2):
//   - Only [A-Za-z0-9._-] characters (no / \ : * or whitespace)
//   - Filename body (prefix + sanitised id + timestamp suffix, before .md) ≤ 120 chars.
//     The full filename including '.md' is therefore ≤ 123 chars, well within the 255-byte
//     POSIX limit. The constraint is on the body (prefix+id+suffix), not the total filename.
//   - Deterministic: same snapshot → same filename (timestamp from now() at
//     minute granularity, which is stable within a single test run)
// ---------------------------------------------------------------------------

/**
 * Produce a filesystem-safe default filename for a Markdown export of snap.
 *
 * The timestamp segment is derived as follows (UTC, minute granularity):
 *   1. If snap.updatedAt parses as a valid ISO 8601 date, use that date.
 *   2. Otherwise fall back to `now` (wall-clock at export time).
 *
 * snap.updatedAt is typically a short time-only string (e.g. '12:00:00') which
 * produces Invalid Date — in that case the fallback fires and now is used.
 * When the caller provides an ISO string (e.g. in tests or future run-metadata),
 * the function honours it for deterministic filenames.
 *
 * Two calls in the same minute for the same snap produce identical results,
 * satisfying the ROADMAP §M2 determinism requirement.
 */
export function buildExportFilename(snap: SnapshotOk, now: Date = new Date()): string {
  // Prefer snap.updatedAt if it is a valid ISO date; fall back to `now`.
  const updatedDate = snap.updatedAt ? new Date(snap.updatedAt) : null;
  const ts_date = (updatedDate && isFinite(updatedDate.getTime())) ? updatedDate : now;
  // Sanitise runId: keep only [A-Za-z0-9._-], replace everything else with '-'.
  const rawId = s(snap.runId);
  const sanitisedId = rawId.replace(/[^A-Za-z0-9._\-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');

  // Build a UTC YYYYMMDD-HHmm timestamp. UTC is used so filenames are deterministic
  // regardless of the user's local timezone (a CI run in UTC and a developer machine
  // in UTC+9 produce identical names for the same snap). All getUTC* methods are used
  // consistently. ts_date is snap.updatedAt (parsed) when valid, else now.
  const yyyy = String(ts_date.getUTCFullYear());
  const mm = String(ts_date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ts_date.getUTCDate()).padStart(2, '0');
  const hh = String(ts_date.getUTCHours()).padStart(2, '0');
  const mi = String(ts_date.getUTCMinutes()).padStart(2, '0');
  const ts = `${yyyy}${mm}${dd}-${hh}${mi}`;

  // Prefix + separator + id + separator + timestamp
  const prefix = 'claude-workflow-';
  const suffix = `-${ts}`;
  // Max body length before .md is 120; reserve space for prefix and suffix.
  const maxIdLen = 120 - prefix.length - suffix.length;
  const trimmedId = maxIdLen > 0 ? sanitisedId.slice(0, maxIdLen) : '';

  return `${prefix}${trimmedId}${suffix}.md`;
}
