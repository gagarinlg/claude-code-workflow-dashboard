import * as fs from 'fs';
import * as path from 'path';

// Recursively find the newest .../workflows/wf_* directory under base.
// Returns the single globally-newest wf_* dir by mtime (no date filter).
// node_modules and vendor subtrees are skipped; search depth is bounded.
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
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (e.name.startsWith('wf_') && path.basename(dir) === 'workflows') {
        let m: number;
        try {
          m = fs.statSync(p).mtimeMs;
        } catch {
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
