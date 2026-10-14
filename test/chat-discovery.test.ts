/**
 * Chat tab — file discovery tests (src/data/chat.ts).
 *
 * Covers both naming conventions (`chat-<runId>.md` and `team-review-*.md`),
 * the default `.review-tmp` records directory plus a configurable override,
 * the bounded recursive fallback scan for a differently-located directory,
 * runId-based selection among several candidates, "most recently modified"
 * fallback when no runId match exists, multiple workspace folders, and
 * defensive degradation (missing/unreadable paths never throw).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findChatFiles,
  resolveChatFile,
  readChatFile,
  DEFAULT_RECORDS_DIR,
  MAX_CHAT_BYTES,
  SCAN_MAX_DEPTH,
  SCAN_FILE_LIMIT,
} from '../src/data/chat';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-discovery-'));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

function write(p: string, content = '## A\nhello\n'): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// ---------------------------------------------------------------------------
// findChatFiles — direct lookup, both naming conventions
// ---------------------------------------------------------------------------
describe('findChatFiles — direct lookup in the default records dir', () => {
  it('finds a chat-<runId>.md file in .review-tmp', () => {
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'chat-wf_abc123.md'));
    const found = findChatFiles([tmpRoot]);
    expect(found).toHaveLength(1);
    expect(found[0]!.runId).toBe('wf_abc123');
  });

  it('finds a team-review-<scope>-<timestamp>.md file in .review-tmp', () => {
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'team-review-full-20261014-1200.md'));
    const found = findChatFiles([tmpRoot]);
    expect(found).toHaveLength(1);
    // team-review-* does not encode a runId — distinct from chat-<runId>.md.
    expect(found[0]!.runId).toBeNull();
  });

  it('finds both conventions together', () => {
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'chat-wf_abc.md'));
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'team-review-audit-20261014.md'));
    const found = findChatFiles([tmpRoot]);
    expect(found).toHaveLength(2);
  });

  it('ignores unrelated files in the records dir', () => {
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'chat-wf_abc.md'));
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'implementation-plan.md'));
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'notes.txt'));
    const found = findChatFiles([tmpRoot]);
    expect(found).toHaveLength(1);
    expect(found[0]!.runId).toBe('wf_abc');
  });

  it('returns [] when the records dir does not exist and nothing is found by the fallback scan', () => {
    expect(findChatFiles([tmpRoot])).toEqual([]);
  });

  it('returns [] for an empty workspaceFolders array', () => {
    expect(findChatFiles([])).toEqual([]);
  });

  it('skips a symlinked chat file in the records dir (defense-in-depth, mirrors snapshot.ts pattern)', () => {
    const dir = path.join(tmpRoot, DEFAULT_RECORDS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const real = path.join(tmpRoot, 'real-chat.md');
    fs.writeFileSync(real, '## A\nhi\n');
    try {
      fs.symlinkSync(real, path.join(dir, 'chat-wf_x.md'));
    } catch {
      // Symlinks may be unsupported/unprivileged in some CI sandboxes — skip silently.
      return;
    }
    expect(findChatFiles([tmpRoot])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findChatFiles — configurable records directory
// ---------------------------------------------------------------------------
describe('findChatFiles — configurable recordsDir', () => {
  it('uses a custom records directory name when provided', () => {
    write(path.join(tmpRoot, 'my-records', 'chat-wf_custom.md'));
    // Note: without an explicit recordsDir, the bounded fallback scan (tested
    // separately below) would ALSO find this file — 'my-records' is not a
    // hidden/node_modules/vendor name. This test asserts the direct,
    // explicitly-configured lookup resolves the right file deterministically,
    // not that the fallback scan is somehow prevented from finding it too.
    const found = findChatFiles([tmpRoot], 'my-records');
    expect(found).toHaveLength(1);
    expect(found[0]!.runId).toBe('wf_custom');
  });

  it('trims whitespace around a configured recordsDir', () => {
    write(path.join(tmpRoot, 'my-records', 'chat-wf_custom.md'));
    const found = findChatFiles([tmpRoot], '  my-records  ');
    expect(found).toHaveLength(1);
  });

  it('falls back to .review-tmp when recordsDir is an empty/blank string', () => {
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'chat-wf_default.md'));
    expect(findChatFiles([tmpRoot], '   ')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// findChatFiles — bounded recursive fallback scan
// ---------------------------------------------------------------------------
describe('findChatFiles — fallback recursive scan', () => {
  it('finds a chat file nested under a non-default, non-hidden directory name', () => {
    write(path.join(tmpRoot, 'subpkg', 'build', 'chat-wf_nested.md'));
    const found = findChatFiles([tmpRoot]);
    expect(found).toHaveLength(1);
    expect(found[0]!.runId).toBe('wf_nested');
  });

  it('does not descend into node_modules during the fallback scan', () => {
    write(path.join(tmpRoot, 'node_modules', 'some-pkg', 'chat-wf_hidden.md'));
    expect(findChatFiles([tmpRoot])).toEqual([]);
  });

  it('does not descend into a hidden directory other than via the direct default-dir check', () => {
    // A hidden dir OTHER than the default records dir name must be skipped by
    // the fallback walker (matches discovery.ts/changed.ts walker convention).
    write(path.join(tmpRoot, '.hidden-other', 'chat-wf_x.md'));
    expect(findChatFiles([tmpRoot])).toEqual([]);
  });

  it('prefers the direct lookup over the fallback scan when both would match', () => {
    // Direct dir has a candidate — the (expensive) fallback must not run at all.
    // We can't directly observe "did not run" without mocking fs, so we assert
    // behaviourally: only the direct-dir candidate is returned even though a
    // second candidate exists elsewhere in the tree.
    write(path.join(tmpRoot, DEFAULT_RECORDS_DIR, 'chat-wf_direct.md'));
    write(path.join(tmpRoot, 'subpkg', 'chat-wf_elsewhere.md'));
    const found = findChatFiles([tmpRoot]);
    expect(found).toHaveLength(1);
    expect(found[0]!.runId).toBe('wf_direct');
  });

  it('finds a candidate at exactly SCAN_MAX_DEPTH nesting levels', () => {
    // visit(root, SCAN_MAX_DEPTH) still processes entries SCAN_MAX_DEPTH
    // directory-levels below root before the depth guard cuts off the NEXT
    // level — so a file this many directories deep is still reachable.
    const parts = Array.from({ length: SCAN_MAX_DEPTH }, (_, i) => `d${i}`);
    write(path.join(tmpRoot, ...parts, 'chat-wf_deep.md'));
    expect(findChatFiles([tmpRoot])).toHaveLength(1);
  });

  it('does not descend past SCAN_MAX_DEPTH + 1 nesting levels', () => {
    const parts = Array.from({ length: SCAN_MAX_DEPTH + 1 }, (_, i) => `d${i}`);
    write(path.join(tmpRoot, ...parts, 'chat-wf_toodeep.md'));
    expect(findChatFiles([tmpRoot])).toEqual([]);
  });

  it('skips a symlinked candidate file encountered during the fallback scan', () => {
    const nested = path.join(tmpRoot, 'subpkg');
    fs.mkdirSync(nested, { recursive: true });
    const real = path.join(tmpRoot, 'real-chat.md');
    fs.writeFileSync(real, '## A\nhi\n');
    try {
      fs.symlinkSync(real, path.join(nested, 'chat-wf_x.md'));
    } catch {
      return; // symlinks unsupported/unprivileged in this sandbox — skip silently
    }
    expect(findChatFiles([tmpRoot])).toEqual([]);
  });

  it('does not throw when a nested directory becomes unreadable (EACCES) mid-scan', () => {
    const unreadable = path.join(tmpRoot, 'locked');
    fs.mkdirSync(unreadable, { recursive: true });
    fs.writeFileSync(path.join(unreadable, 'chat-wf_hidden.md'), '## A\nhi\n');
    // A sibling, readable directory with its own candidate — proves the walk
    // continues past the unreadable one instead of aborting entirely.
    write(path.join(tmpRoot, 'sibling', 'chat-wf_visible.md'));
    try {
      fs.chmodSync(unreadable, 0o000); // readdirSync on 'locked' itself now fails (EACCES)
      expect(() => findChatFiles([tmpRoot])).not.toThrow();
      const found = findChatFiles([tmpRoot]);
      expect(found).toHaveLength(1);
      expect(found[0]!.runId).toBe('wf_visible');
    } finally {
      try { fs.chmodSync(unreadable, 0o755); } catch {}
    }
  });

  it('stops without throwing once the fallback scan reaches SCAN_FILE_LIMIT', () => {
    // A flat directory with SCAN_FILE_LIMIT + 1 non-matching files exercises the
    // visited-count early-return inside the recursive walker without needing a
    // pathologically large fixture — mirrors the WALK_FILE_LIMIT test in changed.test.ts.
    const dir = path.join(tmpRoot, 'many-files');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < SCAN_FILE_LIMIT + 1; i++) {
      fs.writeFileSync(path.join(dir, `f${i}.txt`), '');
    }
    fs.writeFileSync(path.join(dir, 'chat-wf_capped.md'), '## A\nhi\n');
    expect(() => findChatFiles([tmpRoot])).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// findChatFiles — multiple workspace folders
// ---------------------------------------------------------------------------
describe('findChatFiles — multiple workspace folders', () => {
  it('collects candidates across every open workspace folder', () => {
    const folderA = path.join(tmpRoot, 'folderA');
    const folderB = path.join(tmpRoot, 'folderB');
    write(path.join(folderA, DEFAULT_RECORDS_DIR, 'chat-wf_a.md'));
    write(path.join(folderB, DEFAULT_RECORDS_DIR, 'chat-wf_b.md'));
    const found = findChatFiles([folderA, folderB]);
    const runIds = found.map((c) => c.runId).sort();
    expect(runIds).toEqual(['wf_a', 'wf_b']);
  });

  it('ignores a falsy entry in workspaceFolders without throwing', () => {
    const folderA = path.join(tmpRoot, 'folderA');
    write(path.join(folderA, DEFAULT_RECORDS_DIR, 'chat-wf_a.md'));
    expect(() => findChatFiles([folderA, ''])).not.toThrow();
    expect(findChatFiles([folderA, ''])).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// resolveChatFile — runId matching and newest-wins fallback
// ---------------------------------------------------------------------------
describe('resolveChatFile', () => {
  it('returns null when there are no candidates at all', () => {
    expect(resolveChatFile([tmpRoot], 'wf_x')).toBeNull();
    expect(resolveChatFile([], undefined)).toBeNull();
  });

  it('prefers an exact chat-<runId>.md match over other candidates', () => {
    const dir = path.join(tmpRoot, DEFAULT_RECORDS_DIR);
    write(path.join(dir, 'chat-wf_target.md'));
    write(path.join(dir, 'chat-wf_other.md'));
    write(path.join(dir, 'team-review-full-20261001.md'));
    const resolved = resolveChatFile([tmpRoot], 'wf_target');
    expect(resolved).not.toBeNull();
    expect(resolved!.runId).toBe('wf_target');
  });

  it('falls back to a filename-substring match (e.g. a team-review file whose scope embeds the runId)', () => {
    const dir = path.join(tmpRoot, DEFAULT_RECORDS_DIR);
    write(path.join(dir, 'team-review-wf_scoped-20261001.md'));
    write(path.join(dir, 'chat-wf_other.md'));
    const resolved = resolveChatFile([tmpRoot], 'wf_scoped');
    expect(resolved).not.toBeNull();
    expect(path.basename(resolved!.path)).toContain('wf_scoped');
  });

  it('falls back to the most recently modified candidate when runId matches nothing', () => {
    const dir = path.join(tmpRoot, DEFAULT_RECORDS_DIR);
    write(path.join(dir, 'chat-wf_old.md'));
    const older = fs.statSync(path.join(dir, 'chat-wf_old.md')).mtime;
    fs.utimesSync(path.join(dir, 'chat-wf_old.md'), older, new Date(older.getTime() - 60_000));
    write(path.join(dir, 'chat-wf_new.md'));
    const resolved = resolveChatFile([tmpRoot], 'wf_does_not_exist');
    expect(resolved).not.toBeNull();
    expect(resolved!.runId).toBe('wf_new');
  });

  it('returns the most recently modified candidate when runId is undefined', () => {
    const dir = path.join(tmpRoot, DEFAULT_RECORDS_DIR);
    write(path.join(dir, 'chat-wf_old.md'));
    fs.utimesSync(path.join(dir, 'chat-wf_old.md'), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
    write(path.join(dir, 'chat-wf_new.md'));
    const resolved = resolveChatFile([tmpRoot], undefined);
    expect(resolved!.runId).toBe('wf_new');
  });

  it('honours a custom recordsDir when resolving', () => {
    write(path.join(tmpRoot, 'custom-dir', 'chat-wf_custom.md'));
    const resolved = resolveChatFile([tmpRoot], 'wf_custom', 'custom-dir');
    expect(resolved).not.toBeNull();
    expect(resolved!.runId).toBe('wf_custom');
  });

  it('returns null when neither the configured recordsDir nor the fallback scan finds anything', () => {
    // No file written anywhere under tmpRoot — a clean negative case.
    expect(resolveChatFile([tmpRoot], 'wf_custom', 'custom-dir')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// readChatFile — defensive reads
// ---------------------------------------------------------------------------
describe('readChatFile', () => {
  it('reads file content and mtime', () => {
    const p = path.join(tmpRoot, 'chat-wf_x.md');
    write(p, '## Klaus\nhello world\n');
    const read = readChatFile(p);
    expect(read).not.toBeNull();
    expect(read!.raw).toContain('hello world');
    expect(read!.truncated).toBe(false);
  });

  it('returns null for a missing file', () => {
    expect(readChatFile(path.join(tmpRoot, 'nope.md'))).toBeNull();
  });

  it('returns null when the path is a directory, not a file', () => {
    const dir = path.join(tmpRoot, 'a-directory');
    fs.mkdirSync(dir);
    expect(readChatFile(dir)).toBeNull();
  });

  it('does not throw for a permission-denied file (EACCES)', () => {
    const p = path.join(tmpRoot, 'noperm.md');
    write(p, 'content');
    try {
      fs.chmodSync(p, 0o000);
      expect(() => readChatFile(p)).not.toThrow();
      expect(readChatFile(p)).toBeNull();
    } finally {
      try { fs.chmodSync(p, 0o644); } catch {}
    }
  });

  it('truncates and flags truncated:true for a file larger than MAX_CHAT_BYTES', () => {
    const p = path.join(tmpRoot, 'huge.md');
    // Write just over the cap using a repeated small buffer (cheap on disk).
    const chunk = 'x'.repeat(1024);
    const fd = fs.openSync(p, 'w');
    const chunks = Math.ceil((MAX_CHAT_BYTES + 1024) / chunk.length);
    for (let i = 0; i < chunks; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
    const read = readChatFile(p);
    expect(read).not.toBeNull();
    expect(read!.truncated).toBe(true);
    expect(read!.raw.length).toBeLessThanOrEqual(MAX_CHAT_BYTES);
  });
});
