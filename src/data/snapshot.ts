import * as fs from 'fs';
import * as path from 'path';
import { findWorkflowDir } from './discovery';
import { classify, sevCounts, agentTypeToLabel, STALE_SECS } from './parse';
import type { RoleRule, TailEntry } from './parse';
import { walkChanged } from './changed';
import { JsonlFollower, JOURNAL_OPS, TRANSCRIPT_OPS, newBudget } from './incremental';
import type { TranscriptAcc } from './incremental';

// Re-export so callers that import from snapshot.ts get the canonical types.
export type { RoleRule, TailEntry } from './parse';

// --- Exported types mirroring docs/DATA-FORMAT.md ---

export interface Cfg {
  base: string;
  repo: string;
  refreshMs: number;
  statusBar: boolean;
  roleRules: RoleRule[];
  /** When set, use this wf_* dir directly instead of searching under base. */
  pinnedDir?: string;
}

// Maximum age in seconds for the "changed files" panel (< 15 minutes).
// Must stay in sync with the changedMaxMin default in html.ts (CHANGED_MAX_SECS / 60 = 15).
export const CHANGED_MAX_SECS = 900;

// Maximum elapsed seconds for a dead-with-no-result agent to be flagged as superseded.
// An agent whose transcript lifespan is shorter than this threshold AND is shadowed by
// a later same-key survivor is considered a zombie/retry rather than a genuine parallel
// worker. 120 s (2 min) is conservative: real implementer runs take several minutes;
// a crash-retry typically dies within seconds.
export const SUPERSEDED_MAX_ELAPSED_SECS = 120;

// Maximum number of agent transcript files processed per refresh.
// Exported so html.ts can display the exact cap value in the user-visible warning.
export const MAX_AGENTS = 200;

// Maximum character length for the per-agent initiating prompt carried in the snapshot.
// Workflow prompts can embed large findings JSON, so we cap to avoid bloating the
// snapshot payload. The webview renders the capped value in a scrollable <pre>;
// the Copy button sends the same capped text (full transcript is on disk).
// 10 000 chars ≈ 10 KiB which covers typical prompt + system instructions comfortably.
export const MAX_PROMPT_CHARS = 10_000;

// Maximum size in bytes for agent-<id>.meta.json files. Files larger than this
// are treated as if they had no agentType field — the label falls back to classify().
// 64 KiB is far more than any realistic meta.json (typically < 1 KiB). This guard
// prevents a large or crafted meta.json from blocking the Extension Host event loop
// on every polling tick.
const MAX_META_BYTES = 64 * 1024; // 64 KiB

export interface Finding {
  severity?: string;
  title?: string;
  why?: string;
  fix?: string;
  location?: string;
  pass?: number;
  reviewer?: string;
  key?: string;
  [key: string]: unknown;
}

export interface Verdict {
  [label: string]: string;
}

export interface LoopStats {
  phase: string;
  live: number;
  done: number;
  /** Dead agents that are NOT superseded (genuine failures/timeouts). */
  dead: number;
  /** Zombie/retry agents: dead + no result + short-elapsed + shadowed by a later same-key survivor. */
  superseded: number;
  total: number;
  outTok: number;
  tools: number;
  passes: number;
  findings: number;
  sevTotals: Record<string, number>;
  /** Sum of input_tokens across all agents — only present when at least one
   *  agent transcript contains the field; undefined otherwise. */
  inTok?: number;
  /** Sum of cache_creation_input_tokens — only present when field exists. */
  cacheCreate?: number;
  /** Sum of cache_read_input_tokens — only present when field exists. */
  cacheRead?: number;
}

export interface StructuredResult {
  pass: number;
  label: string;
  key: string;
  /** Raw agentType (namespace-stripped) for typed renderer dispatch in the webview.
   *  Matches the agentType field on the Agent that produced this result. */
  agentType?: string;
  result: Record<string, unknown>;
}

export interface Agent {
  id: string;
  label: string;
  key: string;
  /** Raw agentType from meta.json (namespace-stripped, e.g. 'implementer', 'test-verifier').
   *  Used by the webview to dispatch typed result renderers. Absent when agentType is
   *  unknown or the agent was classified by prompt heuristic only. */
  agentType?: string;
  status: 'run' | 'done' | 'dead';
  elapsed: number;
  tokens: number;
  tools: number;
  tail: TailEntry[];
  lastActivity: string;
  start: number;
  mtime: number;
  idx?: number;
  findings?: Finding[];
  verdict?: string;
  result?: Record<string, unknown>;
  resultText?: string;
  /** input_tokens for this agent — only present when the transcript contains
   *  the field; undefined otherwise (never 0-as-real). */
  inTok?: number;
  /** cache_creation_input_tokens for this agent — only present when field exists. */
  cacheCreate?: number;
  /** cache_read_input_tokens for this agent — only present when field exists. */
  cacheRead?: number;
  /** Full initiating prompt (first user message). Capped at MAX_PROMPT_CHARS to
   *  prevent large findings-embedded prompts from bloating the snapshot payload.
   *  Absent when the transcript has no user event. */
  prompt?: string;
  /** True when this agent is a detected zombie/retry: dead, no result, short-elapsed,
   *  and shadowed by a later same-key survivor. Absent (undefined) when not superseded. */
  superseded?: boolean;
}

export type SnapshotOk = {
  ok: true;
  runId: string;
  workflowDir: string;
  updatedAt: string;
  loop: LoopStats;
  labels: string[];
  agents: Agent[];
  agentsCapped: boolean;
  allFindings: Finding[];
  structuredResults: StructuredResult[];
  verdicts: Verdict;
  /** Human-readable label for each verdict key (agentType → display label). */
  verdictLabels: Record<string, string>;
  /** True when a pinned run is in use (cfg.pinnedDir was set and exists). */
  isPinned: boolean;
  changed: string[] | null;
  /** Union of filesChanged arrays from all agent structured results, deduplicated and sorted.
   *  Empty array when no agents have reported filesChanged. Never null. */
  changedByAgents: string[];
};

export type SnapshotErr = {
  ok: false;
  msg: string;
};

export type Snapshot = SnapshotOk | SnapshotErr;

// --- Incremental state carried between builds ---

interface ResolvedRun {
  base: string;
  pinnedDir: string | undefined;
  wfDir: string;
  isPinned: boolean;
}

// The followed files of one run directory.
export interface RunFiles {
  journal: JsonlFollower<unknown[]>;
  /** By transcript file name. */
  transcripts: Map<string, JsonlFollower<TranscriptAcc>>;
  /** By meta.json path. */
  metas: Map<string, { size: number; mtimeMs: number; agentType: unknown }>;
}

// Runs whose followed-file state is kept. Two workflow runs active at once make
// discovery alternate between them; keeping both avoids re-reading each on every switch.
export const MAX_FOLLOWED_RUNS = 3;

// What a build keeps for the next one, so a refresh costs roughly the bytes
// appended since the previous refresh instead of the size of the whole run.
// The extension host holds one for its lifetime; buildSnapshot(cfg) without a
// cache uses a throwaway one and reads everything, as before.
export class SnapshotCache {
  /** Run directory resolved by the last build; reused when discovery is skipped. */
  run: ResolvedRun | null = null;
  /** Result of the last repo walk; reused when the walk is skipped. */
  changed: { repo: string; files: string[] | null } | null = null;
  /** Followed files per run directory, least recently used first. */
  readonly runs = new Map<string, RunFiles>();
  /** True when the last build ran out of byte budget; build again to finish. Its snapshot is partial. */
  pending = false;
  /** Journal and transcript bytes read by the last build. */
  bytesRead = 0;

  /** The followed files of wfDir, created on first use; marks wfDir most recently used. */
  files(wfDir: string): RunFiles {
    let r = this.runs.get(wfDir);
    if (r) {
      this.runs.delete(wfDir);
    } else {
      r = { journal: new JsonlFollower(JOURNAL_OPS), transcripts: new Map(), metas: new Map() };
    }
    this.runs.set(wfDir, r);
    for (const dir of this.runs.keys()) {
      if (this.runs.size <= MAX_FOLLOWED_RUNS) break;
      this.runs.delete(dir);
    }
    return r;
  }

  clear(): void {
    this.run = null;
    this.changed = null;
    this.runs.clear();
    this.pending = false;
    this.bytesRead = 0;
  }
}

export interface SnapshotOptions {
  /** State from previous builds. Omit to read everything from scratch. */
  cache?: SnapshotCache;
  /** Re-run run discovery. When false, the cache's run directory is reused while it
   *  exists and cfg.base / cfg.pinnedDir are unchanged. Default true. */
  discover?: boolean;
  /** Walk cfg.repo for recently changed files. When false, the cache's last list for
   *  the same repo is reused (null if there is none). Default true. */
  walkRepo?: boolean;
  /** Bytes this build may read. When they run out, cache.pending is set and the
   *  snapshot is partial. Default: unlimited. */
  byteBudget?: number;
}

// --- buildSnapshot ---

export function buildSnapshot(cfg: Cfg, opts: SnapshotOptions = {}): Snapshot {
  try {
    return _buildSnapshotUnsafe(cfg, opts);
  } catch (err) {
    // An error is final for this build: the caller must not keep re-building a
    // snapshot that throws on every attempt.
    if (opts.cache) opts.cache.pending = false;
    // Belt-and-suspenders: if any unexpected error escapes the inner guards,
    // degrade to {ok:false} rather than propagating an exception to the UI.
    // This path requires a genuine unguarded throw inside _buildSnapshotUnsafe —
    // all individual guards are unit-tested; this outer catch is a last resort.
    // Redact filesystem paths from the error message before surfacing it in the
    // webview to avoid leaking internal path information to the user.
    /* c8 ignore next 5 */
    const raw = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line security/detect-unsafe-regex -- path-redaction: non-backtracking character class [A-Za-z0-9._-], no catastrophic alternation
    const redacted = raw.replace(/\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]*/g, '<path>');
    return { ok: false, msg: `Internal error building snapshot: ${redacted}` };
  }
}

/**
 * Resolve the workflow directory from cfg, applying containment and symlink-traversal
 * guards for pinned runs. Returns { wfDir, isPinned } on success or { err } on failure.
 *
 * Security note: path.resolve() normalises '..' segments but does NOT expand symlinks.
 * fs.realpathSync() is used after the initial startsWith check to catch symlink escapes:
 * a symlink inside cfg.base that points outside it passes path.resolve startsWith but
 * its target (followed by subsequent fs reads) reaches an unintended location.
 */
function _resolveWfDir(cfg: Cfg): { wfDir: string; isPinned: boolean } | { err: string } {
  if (cfg.pinnedDir) {
    // Security: validate that pinnedDir is lexically under cfg.base (catches '..' traversal).
    const resolvedPin = path.resolve(cfg.pinnedDir);
    const resolvedBase = path.resolve(cfg.base);
    if (!resolvedPin.startsWith(resolvedBase + path.sep)) {
      return { err: `Pinned run is outside the configured base (${cfg.base}). Clear the pin via "Select Workflow Run…".` };
    }
    // Security: validate via fs.realpathSync to catch symlink-escape attacks. A symlink
    // named wf_crafted inside cfg.base can pass the startsWith check above but point to
    // an arbitrary filesystem location. realpathSync resolves the canonical path; we
    // re-validate containment against the canonicalised base.
    let realPin: string;
    let realBase: string;
    try {
      realPin = fs.realpathSync(cfg.pinnedDir);
      realBase = fs.realpathSync(cfg.base);
    } catch {
      // Path does not exist or is not accessible — degrade to not-found.
      return { err: `Pinned run no longer exists: ${path.basename(cfg.pinnedDir)}` };
    }
    if (!realPin.startsWith(realBase + path.sep)) {
      return { err: `Pinned run is outside the configured base (symlink check). Clear the pin via "Select Workflow Run…".` };
    }
    // Validate that the pinned dir is actually a directory (not a file symlink).
    let isDir = false;
    try { isDir = fs.statSync(realPin).isDirectory(); } catch {}
    if (!isDir) return { err: `Pinned run no longer exists: ${path.basename(cfg.pinnedDir)}` };
    // Use the canonical (symlink-resolved) path for all subsequent reads.
    return { wfDir: realPin, isPinned: true };
  }
  const wfDir = findWorkflowDir(cfg.base);
  if (!wfDir) return { err: `No workflow run (wf_*) found under ${cfg.base}` };
  return { wfDir, isPinned: false };
}

// _resolveWfDir, or the cache's previous answer when discovery is skipped. Walking
// cfg.base visits every run of every project, so the host does it on poll ticks
// only, not on each file-change event inside the current run.
function _resolveRun(cfg: Cfg, cache: SnapshotCache, discover: boolean): { wfDir: string; isPinned: boolean } | { err: string } {
  const r = cache.run;
  if (!discover && r && r.base === cfg.base && r.pinnedDir === cfg.pinnedDir) {
    let isDir = false;
    try { isDir = fs.statSync(r.wfDir).isDirectory(); } catch {}
    if (isDir) return r;
  }
  const resolved = _resolveWfDir(cfg);
  cache.run = 'err' in resolved ? null : { base: cfg.base, pinnedDir: cfg.pinnedDir, ...resolved };
  return resolved;
}

// agentType from agent-<id>.meta.json, re-read only when the file's size or mtime
// changes. Files over MAX_META_BYTES or not valid JSON yield undefined, so the
// label falls back to classify().
function _metaAgentType(run: RunFiles, metaP: string, st: fs.Stats): unknown {
  const hit = run.metas.get(metaP);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.agentType;
  let agentType: unknown = undefined;
  // Size-guard: skip the content read when meta.json exceeds MAX_META_BYTES
  // to avoid blocking the Extension Host event loop on a crafted large file.
  try {
    if (st.size <= MAX_META_BYTES) {
      const parsed = JSON.parse(fs.readFileSync(metaP, 'utf8')) as Record<string, unknown>;
      agentType = parsed['agentType'];
    }
  } catch {
    // meta.json unreadable or not valid JSON — agentType stays undefined,
    // classify() fallback will be used.
  }
  run.metas.set(metaP, { size: st.size, mtimeMs: st.mtimeMs, agentType });
  return agentType;
}

function _buildSnapshotUnsafe(cfg: Cfg, opts: SnapshotOptions): Snapshot {
  const cache = opts.cache ?? new SnapshotCache();
  cache.pending = false;
  cache.bytesRead = 0;
  // When a run is pinned, use it directly; otherwise search for the newest.
  // Note: cfg.base (an absolute path) is included in the error message. This is
  // intentional: the user configured the path themselves and seeing it in the
  // dashboard helps diagnose misconfiguration. The ok-path strips workflowDir
  // from the webview payload (see safeSnap in extension.ts) because workflowDir
  // is derived from an active run and carries more specific path info; the err-path
  // message is a single user-configured string with no additional run-level detail.
  const resolved = _resolveRun(cfg, cache, opts.discover !== false);
  if ('err' in resolved) return { ok: false, msg: resolved.err };
  const { wfDir, isPinned } = resolved;
  const run = cache.files(wfDir);
  const budget = newBudget(opts.byteBudget ?? Infinity);
  const now = Date.now() / 1000;
  const journal = run.journal.sync(path.join(wfDir, 'journal.jsonl'), budget).acc;
  if (!run.journal.complete) cache.pending = true;
  const doneIds = new Set(
    journal
      .filter((o) => {
        if (o == null || typeof o !== 'object') return false;
        const obj = o as Record<string, unknown>;
        // Defensive: skip result records with missing/non-string agentId (malformed journal line).
        // Without this, a cast of undefined produces the JS string 'undefined' as a Set member,
        // which could cause doneIds.has(aid) to falsely match a real agent.
        return obj['type'] === 'result' && typeof obj['agentId'] === 'string';
      })
      .map((o) => (o as Record<string, unknown>)['agentId'] as string)
  );
  const resultByAgent: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const o of journal) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    // Defensive: skip result records with missing/non-string agentId (malformed journal line).
    if (obj['type'] === 'result' && typeof obj['agentId'] === 'string') {
      resultByAgent[obj['agentId'] as string] = obj['result'];
    }
  }

  // Cap the number of agent files processed per refresh to bound synchronous I/O.
  // A workflow with 200+ agents would otherwise read and stat 200+ files per tick,
  // blocking the Extension Host event loop. The UI shows a warning when capped.
  let rawFiles: string[] = [];
  try {
    // Use withFileTypes to obtain Dirent objects so we can guard against symlinks.
    // A symlink named agent-crafted.jsonl inside a wf_* directory would otherwise be
    // followed by the transcript reader, potentially reading outside the trusted
    // workflow directory.
    // Matching the pattern in changed.ts and discovery.ts: skip any entry that is a
    // symbolic link before checking the name filter.
    rawFiles = fs.readdirSync(wfDir, { withFileTypes: true })
      .filter((e) => !e.isSymbolicLink() && e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl'))
      .map((e) => e.name);
  } catch {}
  const agentsCapped = rawFiles.length > MAX_AGENTS;
  // When capped, retain the MAX_AGENTS most-recently-modified files so we prefer
  // active agents over older idle ones. fs.readdirSync() returns inode/filesystem
  // order which is neither chronological nor by recency, so we must stat+sort.
  let files: string[];
  /* c8 ignore start */ // agentsCapped path: requires >200 agent files — impractical in unit tests
  if (agentsCapped) {
    files = rawFiles
      .map((fn) => {
        let mtime = 0;
        try { mtime = fs.statSync(path.join(wfDir, fn)).mtimeMs; } catch {}
        return { fn, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_AGENTS)
      .map((x) => x.fn);
  } /* c8 ignore end */ else {
    files = rawFiles;
  }
  const agents: Agent[] = [];
  const followed = new Set<string>();
  for (const fn of files) {
    const aid = fn.slice('agent-'.length, -'.jsonl'.length);
    // Defense-in-depth: reject empty ids and aids containing path separators or traversal
    // sequences. Empty aid would produce agent-.jsonl round-trips; path separators and
    // '..' guard against crafted filenames on Windows (POSIX disallows '/' in filenames).
    // Note: the '..' check also rejects identifiers like 'a..b' — this is intentional
    // conservatism; real workflow agent ids never contain consecutive dots.
    if (!aid || aid.includes('/') || aid.includes('\\') || aid.includes('..')) continue;
    const fp = path.join(wfDir, fn);
    // One stat serves change detection, status and elapsed.
    let st: fs.Stats;
    try {
      st = fs.statSync(fp);
    } catch {
      // Transcript disappeared between readdir and stat: skip the agent.
      continue;
    }
    followed.add(fn);
    let follower = run.transcripts.get(fn);
    if (!follower) {
      follower = new JsonlFollower(TRANSCRIPT_OPS);
      run.transcripts.set(fn, follower);
    }
    const { acc: tx, count } = follower.sync(fp, budget, st);
    if (!follower.complete) cache.pending = true;
    if (!count) continue;

    let start: number;
    const metaP = path.join(wfDir, `agent-${aid}.meta.json`);
    // agentType from meta.json content — the most reliable role signal.
    // Tolerate any failure — fall back to classify().
    let metaAgentType: unknown = undefined;
    try {
      const metaSt = fs.statSync(metaP);
      start = metaSt.mtimeMs / 1000;
      metaAgentType = _metaAgentType(run, metaP, metaSt);
    } catch {
      // meta.json absent — fall back to transcript mtime
      start = st.mtimeMs / 1000;
    }

    // Derive label/key: agentType from meta.json is primary; prompt-based
    // classify() + roleRules is the fallback for unknown/missing agentType.
    const fromType = agentTypeToLabel(metaAgentType);
    // The prompt (firstUserText) is used for both labelling and the prompt field.
    const promptFull = tx.prompt ?? '';
    const { label, key } = fromType ?? classify(promptFull, cfg.roleRules);
    // cleanType: namespace-stripped agentType string for typed renderer dispatch.
    // Only set when the type was recognised (fromType != null), so the webview
    // renderer can use it as a reliable switch key without guessing.
    const cleanType: string | undefined = fromType != null && typeof metaAgentType === 'string'
      ? metaAgentType.replace(/^[^:]+:/, '')
      : undefined;

    // transcript mtime for status / elapsed
    const mtime = st.mtimeMs / 1000;

    const status: Agent['status'] = doneIds.has(aid) ? 'done' : (now - mtime < STALE_SECS ? 'run' : 'dead');
    const { outTok, tools, inTok, cacheCreate, cacheRead } = tx.stats;
    // Copy: the follower keeps appending to its own tail array on later builds.
    const tail = tx.stats.tail.slice();
    const res = resultByAgent[aid];
    const a: Agent = {
      id: aid, label, key, status,
      elapsed: status === 'run' ? Math.round(now - start) : Math.round(mtime - start),
      tokens: outTok, tools, tail,
      lastActivity: tail.length ? (tail[tail.length - 1]?.text ?? '(starting…)') : '(starting…)',
      start, mtime,
    };
    // Carry the namespace-stripped agentType for typed result rendering in the webview.
    if (cleanType) a.agentType = cleanType;
    // Carry the full initiating prompt (capped) so the webview can render it
    // in a Prompt disclosure without re-reading disk. Empty prompts are omitted.
    if (promptFull) {
      a.prompt = promptFull.length > MAX_PROMPT_CHARS
        ? promptFull.slice(0, MAX_PROMPT_CHARS)
        : promptFull;
    }
    // Propagate optional token fields only when present — undefined means absent.
    if (inTok !== undefined) a.inTok = inTok;
    if (cacheCreate !== undefined) a.cacheCreate = cacheCreate;
    if (cacheRead !== undefined) a.cacheRead = cacheRead;
    if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>)['findings'])) {
      a.findings = (res as Record<string, unknown>)['findings'] as Finding[];
      a.verdict = ((res as Record<string, unknown>)['verdict'] as string) || '';
    } else if (res && typeof res === 'object') {
      a.result = res as Record<string, unknown>;
    } else if (typeof res === 'string') {
      a.resultText = res;
    }
    agents.push(a);
  }
  // Forget files that are gone (or fell outside the MAX_AGENTS cap).
  for (const fn of run.transcripts.keys()) {
    if (!followed.has(fn)) run.transcripts.delete(fn);
  }
  for (const metaP of run.metas.keys()) {
    const fn = path.basename(metaP).replace(/\.meta\.json$/, '.jsonl');
    if (!followed.has(fn)) run.metas.delete(metaP);
  }
  cache.bytesRead = budget.bytesRead;
  agents.sort((x, y) => x.start - y.start);
  agents.forEach((a, i) => { a.idx = i + 1; });

  // --- Superseded detection ---
  // Flag dead agents that are zombie/retry crashes: they have no result, their
  // elapsed lifespan is shorter than SUPERSEDED_MAX_ELAPSED_SECS, and a later
  // agent with the same key exists (either done, run, or a later-starting dead).
  // Conservative by design: 'done' agents are never flagged; the no-result guard
  // prevents mis-flagging genuine parallel cohorts that happen to die.
  // Build a per-key map of agent starts for quick "later survivor" lookup.
  // A survivor B of key K must satisfy B.start > A.start AND B.id !== A.id.
  // We accept any status for B (done/run/dead) — a later-starting dead agent is
  // still a retry attempt, and it may itself be superseded in a later pass.
  const laterByKey = new Map<string, number>(); // key → max start among all agents with that key
  for (const a of agents) {
    const cur = laterByKey.get(a.key) ?? -Infinity;
    if (a.start > cur) laterByKey.set(a.key, a.start);
  }

  for (const a of agents) {
    if (a.status !== 'dead') continue;
    // No result: agent must have no findings, no result, no resultText.
    const hasResult = a.findings !== undefined || a.result !== undefined || a.resultText !== undefined;
    if (hasResult) continue;
    // Short-elapsed: elapsed time from start to mtime must be under threshold.
    const elapsed = a.mtime - a.start;
    if (elapsed >= SUPERSEDED_MAX_ELAPSED_SECS) continue;
    // Later same-key survivor: another agent with the same key started after A.
    const latestStart = laterByKey.get(a.key) ?? -Infinity;
    if (latestStart <= a.start) continue;
    // All conditions met — this agent is superseded.
    a.superseded = true;
  }

  // O(1) lookup map — avoids O(J×A) agents.find() inside the journal result loop.
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const seen: Record<string, number> = Object.create(null) as Record<string, number>;
  const allFindings: Finding[] = [];
  const verdicts: Verdict = Object.create(null) as Verdict;
  const verdictLabels: Record<string, string> = {};
  const structuredResults: StructuredResult[] = [];
  for (const o of journal) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    if (obj['type'] !== 'result') continue;
    // Defensive: skip result records with missing/non-string agentId, matching the
    // doneIds and resultByAgent loops above. Without this guard, obj['agentId'] could
    // be undefined/null, and Map.get(undefined) silently returns undefined here —
    // consistent degradation, but inconsistent defensive style.
    if (typeof obj['agentId'] !== 'string') continue;
    const res = obj['result'];
    const a = agentById.get(obj['agentId']) ?? null;
    const label = a ? a.label : 'agent';
    const key = a ? a.key : '?';
    if (res && typeof res === 'object' && Array.isArray((res as Record<string, unknown>)['findings'])) {
      seen[key] = (seen[key] ?? 0) + 1;
      const pass = seen[key] as number;
      // Key verdicts by agentType key (same key used in allFindings/seen) so two
      // distinct agents that share the same display label do not silently overwrite
      // each other. The webview iterates Object.keys(snap.verdicts) and esc()s each
      // key for display — keying by key (not label) is consistent and safe.
      verdicts[key] = (((res as Record<string, unknown>)['verdict'] as string) || '').replace(/[\r\n]/g, ' ');
      verdictLabels[key] = label;
      for (const f of (res as Record<string, unknown>)['findings'] as Finding[]) {
        allFindings.push({ ...f, pass, reviewer: label, key });
      }
    } else if (res && typeof res === 'object') {
      seen[key] = (seen[key] ?? 0) + 1;
      const sr: StructuredResult = { pass: seen[key] as number, label, key, result: res as Record<string, unknown> };
      // Propagate agentType from the agent that produced this result — used by the
      // webview to dispatch typed renderers. Only set when the agent is known and
      // has a recognised agentType.
      if (a?.agentType) sr.agentType = a.agentType;
      structuredResults.push(sr);
    }
  }

  const live = agents.filter((a) => a.status === 'run');
  // Stable phase label. Show the shared role when the live cohort is homogeneous,
  // otherwise a count. Do NOT track the most-recently-active agent's label — that made
  // the header flicker to whichever agent last posted output.
  const liveLabels = [...new Set(live.map((a) => a.label))];
  let phase: string;
  if (!live.length) phase = 'idle / between passes';
  else if (liveLabels.length === 1) phase = liveLabels[0] ?? 'Working';
  else phase = `${live.length} agents working`;

  // Aggregate optional token fields across all agents.
  // Only include the total in loop stats when at least one agent has the field —
  // this preserves the "undefined means absent" contract at the loop level too.
  const loopInTok = agents.some((a) => a.inTok !== undefined)
    ? agents.reduce((s, a) => s + (a.inTok ?? 0), 0)
    : undefined;
  const loopCacheCreate = agents.some((a) => a.cacheCreate !== undefined)
    ? agents.reduce((s, a) => s + (a.cacheCreate ?? 0), 0)
    : undefined;
  const loopCacheRead = agents.some((a) => a.cacheRead !== undefined)
    ? agents.reduce((s, a) => s + (a.cacheRead ?? 0), 0)
    : undefined;
  const supersededCount = agents.filter((a) => a.superseded).length;
  const loopStats: LoopStats = {
    phase,
    live: live.length,
    done: agents.filter((a) => a.status === 'done').length,
    // dead excludes superseded agents — superseded is a sub-classification of dead
    dead: agents.filter((a) => a.status === 'dead' && !a.superseded).length,
    superseded: supersededCount,
    total: agents.length,
    outTok: agents.reduce((s, a) => s + a.tokens, 0),
    tools: agents.reduce((s, a) => s + a.tools, 0),
    passes: Math.max(0, ...Object.values(seen)),
    findings: allFindings.length,
    sevTotals: sevCounts(allFindings),
  };
  if (loopInTok !== undefined) loopStats.inTok = loopInTok;
  if (loopCacheCreate !== undefined) loopStats.cacheCreate = loopCacheCreate;
  if (loopCacheRead !== undefined) loopStats.cacheRead = loopCacheRead;

  // Aggregate filesChanged from ALL raw journal result records.
  // Iterates the full journal (not the capped agents[] slice) so agents beyond
  // MAX_AGENTS=200 still contribute their filesChanged entries. The journal loop
  // above handles findings/verdicts/structuredResults; this loop covers the
  // orthogonal filesChanged union across every result record.
  // Tolerates missing, null, or non-array filesChanged gracefully.
  const changedByAgentsSet = new Set<string>();
  for (const o of journal) {
    if (o == null || typeof o !== 'object') continue;
    const obj = o as Record<string, unknown>;
    if (obj['type'] !== 'result') continue;
    const res = obj['result'];
    if (res && typeof res === 'object') {
      const fc = (res as Record<string, unknown>)['filesChanged'];
      if (Array.isArray(fc)) {
        for (const f of fc) {
          if (typeof f === 'string' && f) changedByAgentsSet.add(f);
        }
      }
    }
  }
  const changedByAgents = [...changedByAgentsSet].sort();

  return {
    ok: true,
    runId: path.basename(wfDir),
    workflowDir: wfDir,
    updatedAt: new Date().toISOString(),
    agentsCapped,
    loop: loopStats,
    labels: [...new Set(allFindings.map((f) => f.reviewer ?? ''))],
    agents,
    allFindings,
    structuredResults,
    verdicts,
    verdictLabels,
    isPinned,
    changed: _changed(cfg, cache, opts.walkRepo !== false),
    changedByAgents,
  };
}

// walkChanged() stats up to WALK_FILE_LIMIT files of the repo, so the host runs it
// on poll ticks only and reuses the last list in between.
function _changed(cfg: Cfg, cache: SnapshotCache, walk: boolean): string[] | null {
  if (!cfg.repo) return null;
  if (!walk) return cache.changed && cache.changed.repo === cfg.repo ? cache.changed.files : null;
  const files = walkChanged(cfg.repo, CHANGED_MAX_SECS);
  cache.changed = { repo: cfg.repo, files };
  return files;
}
