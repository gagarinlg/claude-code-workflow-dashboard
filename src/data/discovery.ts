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

// ---------------------------------------------------------------------------
// walkWfDirs: shared traversal used by both listRecentRuns and findWorkflowDir.
//
// Previously each function independently walked the same directory tree, resulting
// in two full O(N) readdirSync walks per polling tick (findWorkflowDir for
// buildSnapshot + listRecentRuns for the run-picker QuickPick). This shared
// implementation eliminates the duplicate work. Both public functions are now
// simple projections over walkWfDirs results.
//
// Skips node_modules, vendor, and hidden directories — mirrors changed.ts:53
// and the existing findWorkflowDir pattern (no wf_* dirs live inside them).
// ---------------------------------------------------------------------------
function walkWfDirs(base: string, depth = 5): RecentRun[] {
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
      // Skip symlinks to avoid following loops or escaping the watched tree.
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
        // everywhere else in the codebase (snapshot.ts, changed.ts).
        let agentCount = 0;
        try {
          agentCount = fs.readdirSync(p, { withFileTypes: true }).filter(
            (e) => !e.isSymbolicLink() && e.isFile() && e.name.startsWith('agent-') && e.name.endsWith('.jsonl'),
          ).length;
        } catch {
          // Leave agentCount = 0 if the dir is unreadable.
        }
        runs.push({ dir: p, runId: e.name, mtimeMs, agentCount });
      } else if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) {
        // Skip hidden directories (.git, .ssh, .cache, etc.) — no wf_* dirs live there
        // and descending into them adds unnecessary I/O. Mirrors changed.ts:53 pattern.
        continue;
      } else {
        visit(p, d - 1);
      }
    }
  };
  visit(base, depth);
  return runs;
}

// Collect ALL .../workflows/wf_* directories under base, stat each once,
// count agent files, and return them sorted newest-first by mtime.
// node_modules and vendor subtrees are skipped; search depth is bounded.
// Returns an empty array if base is inaccessible or contains no wf_* dirs.
export function listRecentRuns(base: string, depth = 5): RecentRun[] {
  const runs = walkWfDirs(base, depth);
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
// Implemented as the first-element projection over walkWfDirs() results, which
// eliminates code duplication — both callers still invoke walkWfDirs() independently
// at separate lifecycle points (see NOTE below).
//
// NOTE on per-tick I/O: findWorkflowDir() and listRecentRuns() both call walkWfDirs()
// independently. They are invoked at separate points in the lifecycle (buildSnapshot vs.
// runSelectRun), so they typically do not overlap on a single tick. A per-refresh cache
// keyed by (base, timestamp) would halve I/O when the run picker is open simultaneously
// with a snapshot build, but the overhead is bounded by depth=5 directory traversal and
// is acceptable at 4-second polling intervals. This is logged as a tech-debt item in ROADMAP.md.
export function findWorkflowDir(base: string, depth = 5): string | null {
  const runs = walkWfDirs(base, depth);
  if (runs.length === 0) return null;
  // Pick the entry with the highest mtime.
  // runs[0] is guaranteed non-undefined here because runs.length > 0,
  // but TypeScript's strict index signature cannot narrow it from the length
  // check alone. Use a reduce to keep the narrowing airtight.
  const best = runs.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a));
  return best.dir;
}
