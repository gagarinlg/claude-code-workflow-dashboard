import * as fs from 'fs';
import * as path from 'path';

// Walk the repo directory and return files modified within maxAgeSec seconds,
// sorted and capped at 30 entries. Returns null if repo is empty/non-existent.
export function walkChanged(repo: string, maxAgeSec: number): string[] | null {
  if (!repo || !fs.existsSync(repo)) return null;
  const now = Date.now() / 1000;
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'vendor' || e.name.startsWith('.')) continue;
        walk(p);
      } else {
        try {
          if (now - fs.statSync(p).mtimeMs / 1000 < maxAgeSec) {
            out.push(path.relative(repo, p));
          }
        } catch {}
      }
    }
  };
  walk(repo);
  return out.sort().slice(0, 30);
}
