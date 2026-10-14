/**
 * Chat tab — parseChatThread tests (src/data/chat.ts).
 *
 * The chat/team-review file is append-only markdown written by LLM agents, so
 * the format WILL sometimes deviate. Covers: well-formed heading-style turns,
 * the '---' horizontal-rule separator fallback, timestamp/@tag extraction,
 * the MAX_CHAT_TURNS cap, and a wide range of malformed/garbage input that
 * must never throw and must never silently drop content.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseChatThread, loadChatFile, MAX_CHAT_TURNS } from '../src/data/chat';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Well-formed heading-style turns
// ---------------------------------------------------------------------------
describe('parseChatThread — heading-style turns', () => {
  it('parses a single well-formed turn', () => {
    const raw = '## Klaus (security-reviewer) — 2026-10-14T10:00:00Z\nFound a SQL injection in login.php.\n';
    const t = parseChatThread(raw);
    expect(t.malformed).toBe(false);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]!.author).toBe('Klaus (security-reviewer)');
    expect(t.turns[0]!.timestamp).toBe('2026-10-14T10:00:00Z');
    expect(t.turns[0]!.body).toBe('Found a SQL injection in login.php.');
  });

  it('parses multiple turns in file order', () => {
    const raw = [
      '## Klaus — 2026-10-14T10:00:00Z',
      'Found an issue.',
      '## Gerda — 2026-10-14T10:05:00Z',
      '@Klaus acknowledged, looking into it.',
    ].join('\n');
    const t = parseChatThread(raw);
    expect(t.turns).toHaveLength(2);
    expect(t.turns[0]!.author).toBe('Klaus');
    expect(t.turns[1]!.author).toBe('Gerda');
    expect(t.turns[1]!.body).toContain('@Klaus');
  });

  it('extracts @tags from the header line into addressed[]', () => {
    const raw = '## Gerda @Klaus @Fritz — 2026-10-14T10:05:00Z\nPlease both take a look.\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.addressed).toEqual(['Klaus', 'Fritz']);
    // Author should not retain the @tags once stripped.
    expect(t.turns[0]!.author).not.toContain('@');
  });

  it('dedupes repeated @tags in the header, keeping first-seen order', () => {
    const raw = '## Gerda @Klaus @Klaus @Fritz\nbody\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.addressed).toEqual(['Klaus', 'Fritz']);
  });

  it('supports ### and #### heading levels, not just ##', () => {
    const raw = '### Klaus\nhi\n#### Gerda\nhello\n';
    const t = parseChatThread(raw);
    expect(t.turns).toHaveLength(2);
    expect(t.turns.map((x) => x.author)).toEqual(['Klaus', 'Gerda']);
  });

  it('supports a bracketed timestamp form', () => {
    const raw = '## Klaus [2026-10-14 10:00]\nbody text\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.timestamp).toBe('2026-10-14 10:00');
  });

  it('a turn with no timestamp has timestamp:undefined (not an empty string)', () => {
    const raw = '## Klaus\nno date here\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.timestamp).toBeUndefined();
  });

  it('a turn with no @tags has addressed:[] (never undefined/null)', () => {
    const raw = '## Klaus\nplain body\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.addressed).toEqual([]);
  });

  it('preserves a multi-line body verbatim (trimmed)', () => {
    const raw = '## Klaus\nline one\nline two\n\nline three\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.body).toBe('line one\nline two\n\nline three');
  });

  it('a bold-wrapped author line ("**Klaus:**") still recovers a clean author name', () => {
    const raw = '## **Klaus:**\nhello\n';
    const t = parseChatThread(raw);
    expect(t.turns[0]!.author).toBe('Klaus');
  });

  it('normalises CRLF line endings before parsing', () => {
    const raw = '## Klaus\r\nhello\r\n## Gerda\r\nhi\r\n';
    const t = parseChatThread(raw);
    expect(t.turns).toHaveLength(2);
    expect(t.turns[1]!.body).toBe('hi');
  });
});

// ---------------------------------------------------------------------------
// '---' horizontal-rule separator fallback (no headings present)
// ---------------------------------------------------------------------------
describe('parseChatThread — horizontal-rule separator fallback', () => {
  it('splits entries on --- when no # headings exist, using the next line as author', () => {
    const raw = [
      'Klaus — 2026-10-14T10:00:00Z',
      'Found an issue.',
      '---',
      'Gerda — 2026-10-14T10:05:00Z',
      'Looking into it.',
    ].join('\n');
    const t = parseChatThread(raw);
    expect(t.malformed).toBe(false);
    expect(t.turns).toHaveLength(2);
    expect(t.turns[0]!.author).toBe('Klaus');
    expect(t.turns[1]!.author).toBe('Gerda');
  });

  it('accepts a longer run of dashes (----- or more) as the rule', () => {
    const raw = 'Klaus\nhi\n-----\nGerda\nhello\n';
    const t = parseChatThread(raw);
    expect(t.turns).toHaveLength(2);
  });

  it('prefers heading-style parsing over --- when both are present', () => {
    const raw = '## Klaus\nhi\n---\nmore text under the same heading\n## Gerda\nhello\n';
    const t = parseChatThread(raw);
    // Heading pass wins (boundaries found in pass 1) — the '---' is just body content.
    expect(t.turns).toHaveLength(2);
    expect(t.turns[0]!.body).toContain('---');
  });
});

// ---------------------------------------------------------------------------
// Defensive: malformed / garbage input never throws, never loses content
// ---------------------------------------------------------------------------
describe('parseChatThread — defensive (malformed/garbage input)', () => {
  it('never throws for an empty string', () => {
    expect(() => parseChatThread('')).not.toThrow();
    expect(parseChatThread('').turns).toEqual([]);
  });

  it('never throws for whitespace-only content', () => {
    expect(() => parseChatThread('   \n\n\t  \n')).not.toThrow();
    expect(parseChatThread('   \n\n\t  \n').turns).toEqual([]);
  });

  it('falls back to a single raw turn when there is no structural marker at all', () => {
    const raw = 'just some free-form prose with no headings or rules whatsoever';
    const t = parseChatThread(raw);
    expect(t.malformed).toBe(true);
    expect(t.turns).toHaveLength(1);
    expect(t.turns[0]!.body).toBe(raw);
    expect(t.turns[0]!.author).toBe('Unknown');
  });

  it('does not lose content in the raw fallback even with unusual characters', () => {
    const raw = 'weird \u0000 control \uFFFD chars and emoji \u{1F600} here';
    expect(() => parseChatThread(raw)).not.toThrow();
    const t = parseChatThread(raw);
    expect(t.turns[0]!.body).toBe(raw);
  });

  it('never throws for a file consisting only of empty headings', () => {
    const raw = '##\n##\n##\n';
    expect(() => parseChatThread(raw)).not.toThrow();
    // Each empty heading produces nothing usable — degrades to an empty thread
    // rather than three content-free turns.
    const t = parseChatThread(raw);
    expect(t.turns.every((x) => x.body || x.author !== 'Unknown')).toBe(true);
  });

  it('never throws for a trailing --- with nothing after it', () => {
    const raw = 'Klaus\nhi\n---\n';
    expect(() => parseChatThread(raw)).not.toThrow();
  });

  it('never throws for deeply malformed @-mention spam', () => {
    const raw = '## ' + '@'.repeat(5000) + '\nbody\n';
    expect(() => parseChatThread(raw)).not.toThrow();
  });

  it('never throws for a pathologically long single header line with no newline', () => {
    const raw = '## ' + 'x'.repeat(200_000);
    expect(() => parseChatThread(raw)).not.toThrow();
  });

  it('never throws for binary-ish/garbage bytes reinterpreted as a string', () => {
    const buf = Buffer.alloc(2000);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 37) % 256;
    const raw = buf.toString('utf8');
    expect(() => parseChatThread(raw)).not.toThrow();
  });

  it('caps parsed turns at MAX_CHAT_TURNS, keeping the most recent ones', () => {
    const n = MAX_CHAT_TURNS + 25;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) { lines.push(`## Agent${i}`); lines.push(`turn ${i}`); }
    const t = parseChatThread(lines.join('\n'));
    expect(t.turnsCapped).toBe(true);
    expect(t.turns).toHaveLength(MAX_CHAT_TURNS);
    // The LAST turn in the original sequence must be the last one kept (most recent wins).
    expect(t.turns[t.turns.length - 1]!.author).toBe(`Agent${n - 1}`);
  });

  it('does not set turnsCapped when turn count is at or below the cap', () => {
    const lines: string[] = [];
    for (let i = 0; i < MAX_CHAT_TURNS; i++) { lines.push(`## Agent${i}`); lines.push(`turn ${i}`); }
    const t = parseChatThread(lines.join('\n'));
    expect(t.turnsCapped).toBe(false);
    expect(t.turns).toHaveLength(MAX_CHAT_TURNS);
  });
});

// ---------------------------------------------------------------------------
// loadChatFile — read + parse integration
// ---------------------------------------------------------------------------
describe('loadChatFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-load-'));
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('returns null for a missing file', () => {
    expect(loadChatFile('/no/such/file-xyz.md')).toBeNull();
  });

  it('returns a populated snapshot for a well-formed file', () => {
    const p = path.join(tmpDir, 'chat-wf_x.md');
    fs.writeFileSync(p, '## Klaus — 2026-10-14T10:00:00Z\nhello\n');
    const snap = loadChatFile(p);
    expect(snap).not.toBeNull();
    expect(snap!.sourceFile).toBe('chat-wf_x.md');
    expect(snap!.turns).toHaveLength(1);
    expect(snap!.malformed).toBe(false);
    expect(typeof snap!.updatedAt).toBe('string');
    expect(new Date(snap!.updatedAt).getTime()).not.toBeNaN();
  });

  it('returns null for a file that parses to zero turns (blank file)', () => {
    const p = path.join(tmpDir, 'chat-wf_blank.md');
    fs.writeFileSync(p, '   \n\n  \n');
    expect(loadChatFile(p)).toBeNull();
  });

  it('sourceFile is a basename only, never an absolute path', () => {
    const p = path.join(tmpDir, 'chat-wf_path.md');
    fs.writeFileSync(p, '## Klaus\nhi\n');
    const snap = loadChatFile(p);
    expect(snap!.sourceFile).not.toContain(path.sep);
    expect(snap!.sourceFile).not.toContain(tmpDir);
  });
});
