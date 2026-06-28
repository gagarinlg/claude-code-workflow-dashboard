import * as fs from 'fs';
import * as path from 'path';
import { findWorkflowDir } from './discovery';
import { jload, firstUserText, classify, agentStats, sevCounts, agentTypeToLabel, STALE_SECS } from './parse';
import type { RoleRule, TailEntry } from './parse';
import { walkChanged } from './changed';

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

// Maximum age in seconds for the "changed files" panel (< 2 minutes).
// Must stay in sync with the panel title in html.ts.
export const CHANGED_MAX_SECS = 120;

// Maximum number of agent transcript files processed per refresh.
// Exported so html.ts can display the exact cap value in the user-visible warning.
export const MAX_AGENTS = 200;

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
  dead: number;
  total: number;
  outTok: number;
  tools: number;
  passes: number;
  findings: number;
  sevTotals: Record<string, number>;
}

export interface StructuredResult {
  pass: number;
  label: string;
  key: string;
  result: Record<string, unknown>;
}

export interface Agent {
  id: string;
  label: string;
  key: string;
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
};

export type SnapshotErr = {
  ok: false;
  msg: string;
};

export type Snapshot = SnapshotOk | SnapshotErr;

// --- buildSnapshot ---

export function buildSnapshot(cfg: Cfg): Snapshot {
  try {
    return _buildSnapshotUnsafe(cfg);
  } catch (err) {
    // Belt-and-suspenders: if any unexpected error escapes the inner guards,
    // degrade to {ok:false} rather than propagating an exception to the UI.
    // This path requires a genuine unguarded throw inside _buildSnapshotUnsafe —
    // all individual guards are unit-tested; this outer catch is a last resort.
    /* c8 ignore next 3 */
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, msg: `Internal error building snapshot: ${msg}` };
  }
}

function _buildSnapshotUnsafe(cfg: Cfg): Snapshot {
  // When a run is pinned, use it directly; otherwise search for the newest.
  // Note: cfg.base (an absolute path) is included in the error message. This is
  // intentional: the user configured the path themselves and seeing it in the
  // dashboard helps diagnose misconfiguration. The ok-path strips workflowDir
  // from the webview payload (see safeSnap in extension.ts) because workflowDir
  // is derived from an active run and carries more specific path info; the err-path
  // message is a single user-configured string with no additional run-level detail.
  let wfDir: string | null;
  let isPinned = false;
  if (cfg.pinnedDir) {
    // Security: validate that pinnedDir is under cfg.base so a tampered workspaceState
    // entry cannot redirect the extension to read arbitrary filesystem paths.
    const resolvedPin = path.resolve(cfg.pinnedDir);
    const resolvedBase = path.resolve(cfg.base);
    if (!resolvedPin.startsWith(resolvedBase + path.sep)) {
      return { ok: false, msg: `Pinned run is outside the configured base (${cfg.base}). Clear the pin via "Select Workflow Run…".` };
    }
    // Validate that the pinned dir still exists; if not, degrade gracefully.
    let ok = false;
    try { ok = fs.statSync(cfg.pinnedDir).isDirectory(); } catch {}
    wfDir = ok ? cfg.pinnedDir : null;
    if (!wfDir) return { ok: false, msg: `Pinned run no longer exists: ${path.basename(cfg.pinnedDir)}` };
    isPinned = true;
  } else {
    wfDir = findWorkflowDir(cfg.base);
  }
  if (!wfDir) return { ok: false, msg: `No workflow run (wf_*) found under ${cfg.base}` };
  const now = Date.now() / 1000;
  const journal = jload(path.join(wfDir, 'journal.jsonl'));
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
  const resultByAgent: Record<string, unknown> = {};
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
    rawFiles = fs.readdirSync(wfDir).filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'));
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
  for (const fn of files) {
    const aid = fn.slice('agent-'.length, -'.jsonl'.length);
    // Defense-in-depth: reject empty ids and aids containing path separators or traversal
    // sequences. Empty aid would produce agent-.jsonl round-trips; path separators and
    // '..' guard against crafted filenames on Windows (POSIX disallows '/' in filenames).
    // Note: the '..' check also rejects identifiers like 'a..b' — this is intentional
    // conservatism; real workflow agent ids never contain consecutive dots.
    if (!aid || aid.includes('/') || aid.includes('\\') || aid.includes('..')) continue;
    const fp = path.join(wfDir, fn);
    const events = jload(fp);
    if (!events.length) continue;

    let start: number;
    const metaP = path.join(wfDir, `agent-${aid}.meta.json`);
    // agentType from meta.json content — the most reliable role signal.
    // Read the content here (same file we stat for start mtime) so we don't
    // open it twice. Tolerate any parse failure — fall back to classify().
    let metaAgentType: unknown = undefined;
    try {
      const metaSt = fs.statSync(metaP);
      start = metaSt.mtimeMs / 1000;
      // Best-effort content read for agentType — defensive: never throw.
      // Size-guard: skip the content read when meta.json exceeds MAX_META_BYTES
      // to avoid blocking the Extension Host event loop on a crafted large file.
      // The stat object is reused (no extra syscall) — same mtimeMs, same file.
      try {
        if (metaSt.size <= MAX_META_BYTES) {
          const raw = fs.readFileSync(metaP, 'utf8');
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          metaAgentType = parsed['agentType'];
        }
      } catch {
        // meta.json unreadable or not valid JSON — agentType stays undefined,
        // classify() fallback will be used.
      }
    } catch {
      // meta.json absent — fall back to transcript mtime
      try {
        start = fs.statSync(fp).mtimeMs / 1000;
      /* c8 ignore start */
      } catch {
        // TOCTOU: transcript disappeared between readdir and statSync; skip agent.
        // Untestable without mocking — the race window is sub-millisecond.
        continue;
      }
      /* c8 ignore end */
    }

    // Derive label/key: agentType from meta.json is primary; prompt-based
    // classify() + roleRules is the fallback for unknown/missing agentType.
    const fromType = agentTypeToLabel(metaAgentType);
    const { label, key } = fromType ?? classify(firstUserText(events), cfg.roleRules);

    // transcript mtime for status / elapsed — wrap per same TOCTOU fix
    let mtime: number;
    /* c8 ignore start */
    try {
      mtime = fs.statSync(fp).mtimeMs / 1000;
    } catch {
      // TOCTOU: same race as above — transcript file removed between stat calls.
      // Untestable without mocking.
      continue;
    }
    /* c8 ignore end */

    const status: Agent['status'] = doneIds.has(aid) ? 'done' : (now - mtime < STALE_SECS ? 'run' : 'dead');
    const { outTok, tools, tail } = agentStats(events);
    const res = resultByAgent[aid];
    const a: Agent = {
      id: aid, label, key, status,
      elapsed: status === 'run' ? Math.round(now - start) : Math.round(mtime - start),
      tokens: outTok, tools, tail,
      lastActivity: tail.length ? (tail[tail.length - 1]?.text ?? '(starting…)') : '(starting…)',
      start, mtime,
    };
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
  agents.sort((x, y) => x.start - y.start);
  agents.forEach((a, i) => { a.idx = i + 1; });

  // O(1) lookup map — avoids O(J×A) agents.find() inside the journal result loop.
  const agentById = new Map(agents.map((a) => [a.id, a]));

  const seen: Record<string, number> = {};
  const allFindings: Finding[] = [];
  const verdicts: Verdict = {};
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
      structuredResults.push({ pass: seen[key] as number, label, key, result: res as Record<string, unknown> });
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

  return {
    ok: true,
    runId: path.basename(wfDir),
    workflowDir: wfDir,
    updatedAt: new Date().toLocaleTimeString(),
    agentsCapped,
    loop: {
      phase,
      live: live.length,
      done: agents.filter((a) => a.status === 'done').length,
      dead: agents.filter((a) => a.status === 'dead').length,
      total: agents.length,
      outTok: agents.reduce((s, a) => s + a.tokens, 0),
      tools: agents.reduce((s, a) => s + a.tools, 0),
      passes: Math.max(0, ...Object.values(seen)),
      findings: allFindings.length,
      sevTotals: sevCounts(allFindings),
    },
    labels: [...new Set(allFindings.map((f) => f.reviewer ?? ''))],
    agents,
    allFindings,
    structuredResults,
    verdicts,
    verdictLabels,
    isPinned,
    changed: cfg.repo ? walkChanged(cfg.repo, CHANGED_MAX_SECS) : null,
  };
}
