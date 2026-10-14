/**
 * Chat tab — Markdown export tests (src/export/markdown.ts buildChatThread()).
 *
 * Covers: the Cross-Agent Chat section is included/omitted correctly, turn
 * ordering, timestamp/addressed rendering, the malformed/capped/truncated
 * notices, and that chat content goes through the same injection-defense
 * escaping as every other section (headings, bold spans, links, code fences).
 */
import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../src/export/markdown';
import type { SnapshotOk, ChatFileSnapshot, ChatTurn } from '../src/data/snapshot';

function makeSnap(chat: ChatFileSnapshot | null, overrides: Partial<SnapshotOk> = {}): SnapshotOk {
  const base: SnapshotOk = {
    ok: true,
    runId: 'wf_test_20240101_120000',
    workflowDir: '/tmp/.claude/projects/proj/workflows/wf_test_20240101_120000',
    updatedAt: '12:00:00',
    isPinned: false,
    agentsCapped: false,
    loop: {
      phase: 'done', live: 0, done: 0, dead: 0, superseded: 0, total: 0,
      outTok: 0, tools: 0, passes: 0, findings: 0, sevTotals: {},
    },
    labels: [],
    agents: [],
    allFindings: [],
    structuredResults: [],
    verdicts: {},
    verdictLabels: {},
    changed: null,
    changedByAgents: [],
    chat,
  };
  return { ...base, ...overrides };
}

function turn(partial: Partial<ChatTurn> & { author: string; body: string }): ChatTurn {
  return { addressed: [], ...partial };
}

// ---------------------------------------------------------------------------
// Inclusion / omission
// ---------------------------------------------------------------------------
describe('generateMarkdown — Cross-Agent Chat section presence', () => {
  it('omits the Cross-Agent Chat section entirely when chat is null', () => {
    const md = generateMarkdown(makeSnap(null));
    expect(md).not.toContain('Cross-Agent Chat');
  });

  it('omits the section when chat.turns is an empty array', () => {
    const chat: ChatFileSnapshot = { sourceFile: 'chat-wf_x.md', updatedAt: '2026-01-01T00:00:00.000Z', turns: [], malformed: false, turnsCapped: false, truncated: false };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).not.toContain('Cross-Agent Chat');
  });

  it('omits the section when chat is undefined (older/hand-built SnapshotOk fixtures)', () => {
    const snap = makeSnap(null);
    delete (snap as { chat?: ChatFileSnapshot | null }).chat;
    expect(() => generateMarkdown(snap)).not.toThrow();
    expect(generateMarkdown(snap)).not.toContain('Cross-Agent Chat');
  });

  it('includes the section when at least one turn exists', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '2026-01-01T00:00:00.000Z', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'Found an issue.' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('## Cross-Agent Chat');
  });
});

// ---------------------------------------------------------------------------
// Turn rendering: author, timestamp, addressed, body, order
// ---------------------------------------------------------------------------
describe('generateMarkdown — Cross-Agent Chat turn rendering', () => {
  it('renders each turn as its own heading with the author name', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'first' }), turn({ author: 'Gerda', body: 'second' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('### Klaus');
    expect(md).toContain('### Gerda');
    // Turns must appear in file order (oldest first) — Klaus before Gerda.
    expect(md.indexOf('### Klaus')).toBeLessThan(md.indexOf('### Gerda'));
  });

  it('includes the timestamp in the heading when present', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'hi', timestamp: '2026-10-14T10:00:00Z' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('### Klaus — 2026-10-14T10:00:00Z');
  });

  it('omits a timestamp suffix entirely when the turn has none', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'hi' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('### Klaus\n');
    expect(md).not.toContain('### Klaus —');
  });

  it('renders a "To:" line with @-prefixed addressed agents when present', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Gerda', body: 'please review', addressed: ['Klaus', 'Fritz'] })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('**To:** @Klaus, @Fritz');
  });

  it('omits the "To:" line when addressed is empty', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'hi' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).not.toContain('**To:**');
  });

  it('renders the turn body text', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'This is the finding detail.' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('This is the finding detail.');
  });
});

// ---------------------------------------------------------------------------
// Notices: malformed / capped / truncated
// ---------------------------------------------------------------------------
describe('generateMarkdown — Cross-Agent Chat notices', () => {
  it('emits a malformed notice naming the source file when chat.malformed is true', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'team-review-full-20261014.md', updatedAt: '', malformed: true, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Unknown', body: 'raw dump' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('Could not detect structured turns');
    expect(md).toContain('team-review-full-20261014.md');
  });

  it('emits a capped notice when turnsCapped is true', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: true, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'hi' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('Showing the most recent');
  });

  it('emits a truncated notice when truncated is true', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: true,
      turns: [turn({ author: 'Klaus', body: 'hi' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).toContain('truncated read');
  });

  it('emits no notices at all for a clean, well-formed, uncapped thread', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'hi' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).not.toContain('Could not detect structured turns');
    expect(md).not.toContain('Showing the most recent');
    expect(md).not.toContain('truncated read');
  });
});

// ---------------------------------------------------------------------------
// Injection defense — chat content is transcript-derived (LLM agent output)
// and must receive the same escaping as findings/results/verdicts.
// ---------------------------------------------------------------------------
describe('generateMarkdown — Cross-Agent Chat injection defense', () => {
  it('neutralises a heading-marker injection attempt in the body', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: '## Forged Section\nattacker content' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    // The forged heading marker must be blockquoted, not rendered as a live heading.
    expect(md).toContain('> ## Forged Section');
  });

  it('neutralises a Markdown link injection attempt in the body', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'click [here](https://evil.example/phish)' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).not.toContain('[here](https://evil.example/phish)');
    expect(md).toContain('here (https://evil.example/phish)');
  });

  it('escapes ** in an addressed/author value so it cannot break the bold "To:"/heading span', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus', body: 'hi', addressed: ['Fritz** evil **bold'] })],
    };
    expect(() => generateMarkdown(makeSnap(chat))).not.toThrow();
    const md = generateMarkdown(makeSnap(chat));
    expect(md).not.toContain('@Fritz** evil **bold');
  });

  it('strips embedded newlines from the author/timestamp so they cannot forge an extra heading line', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: 'Klaus\n## Forged', body: 'hi' })],
    };
    const md = generateMarkdown(makeSnap(chat));
    expect(md).not.toContain('### Klaus\n## Forged');
  });

  it('round-trips cleanly: output always ends in a single trailing newline, never throws on any field', () => {
    const chat: ChatFileSnapshot = {
      sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false,
      turns: [turn({ author: '', body: '' })],
    };
    expect(() => generateMarkdown(makeSnap(chat))).not.toThrow();
    const md = generateMarkdown(makeSnap(chat));
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });
});
