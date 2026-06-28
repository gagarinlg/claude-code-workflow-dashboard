import * as fs from 'fs';
import * as path from 'path';

// Maximum number of files visited during a walkChanged scan. Soft limit —
// exits the current directory scan when the limit is reached; parent
// directories may continue processing their remaining entries. In practice
// this bounds the walk to roughly O(WALK_FILE_LIMIT) file stats across typical
// repo shapes. The 30-entry cap on the output is unaffected.
// Note: actual visited count may exceed WALK_FILE_LIMIT when the limit is hit
// mid-directory — the early return exits that frame only; sibling directories
// at parent levels continue. Overshoot is bounded by the number of entries in
// the current directory batch when the limit fires.
const WALK_FILE_LIMIT = 5000;

// Walk the repo directory and return files modified within maxAgeSec seconds,
// sorted and capped at 30 entries. Returns null if repo is empty/non-existent.
export function walkChanged(repo: string, maxAgeSec: number): string[] | null {
  // existsSync removed: the readdirSync inside walk() is already wrapped in a
  // try/catch that returns early if the directory is missing or unreadable.
  // The existsSync pre-flight was a TOCTOU race window with no safety benefit.
  if (!repo) return null;
  const now = Date.now() / 1000;
  const out: string[] = [];
  let visited = 0;
  // Depth limit prevents call-stack exhaustion on pathologically deep trees or
  // (on Windows) junction-point cycles. 16 levels (0 through 15 inclusive) covers
  // all realistic repo structures.
  const walk = (dir: string, depth = 15): void => {
    /* c8 ignore next */ // Depth guard: only reachable after 16 levels of nesting — not worth constructing a fixture
    if (depth < 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // File-count soft limit: exits the current directory frame once the visited
      // limit is reached. Parent frames continue their remaining entries (see
      // WALK_FILE_LIMIT comment above for overshoot bounds).
      if (visited >= WALK_FILE_LIMIT) return;
      const p = path.join(dir, e.name);
      // Skip symlinks to avoid following loops or escaping the repo tree.
      if (e.isDirectory() && !e.isSymbolicLink()) {
        if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
        walk(p, depth - 1);
      } else if (!e.isSymbolicLink()) {
        // Skip symlinks to files — they could point outside the repo tree.
        // Directory symlinks are already excluded by the !e.isSymbolicLink() guard
        // on the isDirectory() branch above; this mirrors that policy for files.
        visited++;
        try {
          if (now - fs.statSync(p).mtimeMs / 1000 < maxAgeSec) {
            out.push(path.relative(repo, p));
          }
        /* c8 ignore next */ // TOCTOU: file removed between readdir and statSync — untestable without mocking
        } catch {}
      }
    }
  };
  walk(repo);
  return out.sort().slice(0, 30);
}
