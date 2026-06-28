import * as fs from 'fs';
import * as path from 'path';

// Metadata for a single discovered workflow run directory.
export interface RecentRun {
  /** Absolute filesystem path to the wf_* directory. */
  dir: string;
  /** Basename of the wf_* directory (the run id). */
  runId: string;
  /** Directory mtime in milliseconds since epoch. */
  mtimeMs: number;
  /** Number of agent-*.jsonl transcript files present. */
  agentCount: number;
}

// Collect ALL .../workflows/wf_* directories under base (no depth limit beyond
// the traversal bound), stat each once, count agent files, and return them
// sorted newest-first by mtime. node_modules and vendor subtrees are skipped.
// Returns an empty array if base is inaccessible or contains no wf_* dirs.
// TODO(M3-tech-debt): listRecentRuns and findWorkflowDir independently traverse the same
// directory tree. On every polling tick (default 4 s), buildSnapshot() calls findWorkflowDir()
// and runSelectRun() calls listRecentRuns() — both performing a full O(N) readdirSync walk.
// The correct fix is to extract a shared walkWfDirs(base) function that both call, with a
// 2-second in-memory cache to absorb file-watcher burst calls. Alternatively, derive
// findWorkflowDir as a simple first-element projection over listRecentRuns() results
// (dependency direction is already correct: snapshot.ts → discovery.ts). Deferred to M3.
export function listRecentRuns(base: string, depth = 5): RecentRun[] {
  const runs: RecentRun[] = [];
  const visit = (dir: string, d: number): void => {
    if (d < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith('wf_') && path.basename(dir) === 'workflows') {
        let mtimeMs: number;
        try {
          mtimeMs = fs.statSync(p).mtimeMs;
        } catch {
          /* c8 ignore next */ // TOCTOU: dir appeared in readdirSync but is gone by statSync
          continue;
        }
        // Count agent transcript files defensively (readdirSync may fail for any dir).
        // withFileTypes:true + isSymbolicLink() matches the symlink-safe pattern used
        // everywhere else in the codebase (snapshot.ts, changed.ts, findWorkflowDir).
        let agentCount = 0;
        try {
          agentCount = fs.readdirSync(p, { withFileTypes: true }).filter(
            (e) => !e.isSymbolicLink() && e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl'),
          ).length;
        } catch {
          // Leave agentCount = 0 if the dir is unreadable.
        }
        runs.push({ dir: p, runId: e.name, mtimeMs, agentCount });
      } else if (e.name === 'node_modules' || e.name === 'vendor') {
        continue;
      } else {
        visit(p, d - 1);
      }
    }
  };
  visit(base, depth);
  runs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return runs;
}

// Format a mtime (ms since epoch) as a human-readable relative time string.
// Returns strings like "3s ago", "5m ago", "2h ago", "4d ago".
// Exported so callers (QuickPick, tests) can use it without re-implementing.
export function formatRelativeTime(mtimeMs: number, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Recursively find the newest .../workflows/wf_* directory under base.
// Returns the single globally-newest wf_* dir by mtime (no date filter).
// node_modules and vendor subtrees are skipped; search depth is bounded.
// TODO(M3-tech-debt): this traversal duplicates the one in listRecentRuns — see note there.
export function findWorkflowDir(base: string, depth = 5): string | null {
  let best: string | null = null;
  let bestM = 0;
  const visit = (dir: string, d: number): void => {
    if (d < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Skip symlinks to avoid following loops or escaping the watched tree.
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith('wf_') && path.basename(dir) === 'workflows') {
        let m: number;
        try {
          m = fs.statSync(p).mtimeMs;
        } catch {
          /* c8 ignore next */ // TOCTOU: dir existed at readdirSync but is gone/inaccessible by statSync
          continue;
        }
        if (m > bestM) {
          bestM = m;
          best = p;
        }
      } else if (e.name === 'node_modules' || e.name === 'vendor') {
        continue;
      } else {
        visit(p, d - 1);
      }
    }
  };
  visit(base, depth);
  return best;
}
