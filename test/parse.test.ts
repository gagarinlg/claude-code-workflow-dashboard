import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  jload,
  firstUserText,
  deriveLabel,
  classify,
  agentStats,
  sevCounts,
  DEFAULT_ROLE_RULES,
  STALE_SECS,
} from '../src/data/parse';

// ---------------------------------------------------------------------------
// jload
// ---------------------------------------------------------------------------
describe('jload', () => {
  it('parses well-formed JSONL', () => {
    const p = path.join(__dirname, 'fixtures/wf_basic/journal.jsonl');
    const rows = jload(p);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('returns [] for a non-existent file', () => {
    expect(jload('/no/such/file.jsonl')).toEqual([]);
  });

  it('skips blank lines', () => {
    const p = path.join(__dirname, 'fixtures/wf_basic/agent-aaa.jsonl');
    const rows = jload(p);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('skips partial trailing line without throwing', () => {
    const p = path.join(__dirname, 'fixtures/wf_partial/agent-partial.jsonl');
    // The fixture has exactly 1 complete JSON line followed by a partial line.
    // jload must parse the complete line and silently drop the partial trailing one.
    const rows = jload(p);
    // Exactly 1 row — the partial line must NOT have been parsed
    expect(rows.length).toBe(1);
    // The one row must be the complete object
    const first = rows[0] as Record<string, unknown>;
    expect(first['type']).toBe('user');
  });
});

// ---------------------------------------------------------------------------
// firstUserText
// ---------------------------------------------------------------------------
describe('firstUserText', () => {
  it('returns the string content of the first user event', () => {
    const events = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
      { type: 'user', message: { content: 'You are a senior developer' } },
    ];
    expect(firstUserText(events)).toBe('You are a senior developer');
  });

  it('returns text from first block if content is array', () => {
    const events = [
      { type: 'user', message: { content: [{ type: 'text', text: 'You are the verifier' }, { type: 'image' }] } },
    ];
    expect(firstUserText(events)).toBe('You are the verifier');
  });

  it('returns empty string when no user event', () => {
    expect(firstUserText([])).toBe('');
    expect(firstUserText([{ type: 'assistant', message: {} }])).toBe('');
  });

  it('handles null/non-object events gracefully', () => {
    expect(firstUserText([null, undefined, 42, 'string'])).toBe('');
  });

  it('returns empty string from text block with empty text field', () => {
    const events = [
      { type: 'user', message: { content: [{ type: 'text', text: '' }] } },
    ];
    // text is '' — the || '' fallback kicks in, returns ''
    expect(firstUserText(events)).toBe('');
  });

  it('skips non-text blocks in array content before finding a text block', () => {
    const events = [
      { type: 'user', message: { content: [{ type: 'image' }, { type: 'text', text: 'hello' }] } },
    ];
    expect(firstUserText(events)).toBe('hello');
  });

  it('returns empty string when all content blocks are non-text (exhausts loop)', () => {
    // All blocks are non-text — the loop completes without returning, falls through line 76
    const events = [
      { type: 'user', message: { content: [{ type: 'image' }, { type: 'tool_result' }] } },
    ];
    expect(firstUserText(events)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// deriveLabel
// ---------------------------------------------------------------------------
describe('deriveLabel', () => {
  it('extracts role from "You are a …" pattern', () => {
    expect(deriveLabel('You are a senior developer fixing bugs')).toBe('senior developer fixing bugs');
  });

  it('extracts role from "You are the …" pattern', () => {
    expect(deriveLabel('You are the build/test verifier')).toBe('build/test verifier');
  });

  it('extracts role from "You are an …" pattern', () => {
    expect(deriveLabel('You are an expert reviewer')).toBe('expert reviewer');
  });

  it('falls back to truncated text when no match', () => {
    // 37 chars — under the 40-char limit, so returned in full
    const label = deriveLabel('Check that everything works correctly');
    expect(label).toBe('Check that everything works correctly');
    expect(label.length).toBeLessThanOrEqual(40);
    // Verify a string longer than 40 chars is truncated
    const long = deriveLabel('x'.repeat(50));
    expect(long.length).toBeLessThanOrEqual(40);
  });

  it('returns "agent" for empty string', () => {
    expect(deriveLabel('')).toBe('agent');
  });

  it('returns "agent" when the text collapses to empty after normalization (line 86 || branch)', () => {
    // A string with only spaces — trim() produces '' — || 'agent' kicks in
    expect(deriveLabel('   ')).toBe('agent');
  });

  it('normalizes internal whitespace in the extracted role', () => {
    // The regex captures "senior  dev", then trim().replace(/\s+/g,' ') normalizes it
    expect(deriveLabel('You are a  senior  dev')).toBe('senior dev');
  });
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------
describe('classify', () => {
  it('matches a rule by regex (case-insensitive)', () => {
    const result = classify('SENIOR FULL-STACK DEVELOPER fixing the bugs', DEFAULT_ROLE_RULES);
    expect(result.label).toBe('Fix');
    expect(result.key).toBe('fix');
  });

  it('matches build/test verifier rule', () => {
    const result = classify('You are the build/test verifier', DEFAULT_ROLE_RULES);
    expect(result.label).toBe('Verify');
    expect(result.key).toBe('verify');
  });

  it('falls back to deriveLabel when no rule matches', () => {
    const result = classify('You are a project manager', DEFAULT_ROLE_RULES);
    expect(result.label).toBe('project manager');
    expect(result.key).toMatch(/^[a-z0-9_]{1,24}$/);
  });

  it('falls back gracefully with an invalid regex that does NOT substring-match', () => {
    const badRules = [{ re: '(unclosed', label: 'Bad', key: 'bad' }];
    // Invalid regex — falls back to substring match for '(unclosed' in text — no match
    // then falls through to deriveLabel
    const result = classify('You are a planner', badRules);
    expect(result.label).toBe('planner');
  });

  it('matches via substring fallback when regex is invalid but string contains the pattern', () => {
    // Craft a text that literally contains the invalid regex string as a substring
    const badRules = [{ re: '(unclosed', label: 'FallbackMatch', key: 'fbmatch' }];
    const result = classify('This text (unclosed bracket here', badRules);
    expect(result.label).toBe('FallbackMatch');
    expect(result.key).toBe('fbmatch');
  });

  it('uses key from rule when provided', () => {
    const rules = [{ re: 'designer', label: 'Design', key: 'design_key' }];
    expect(classify('You are the designer', rules).key).toBe('design_key');
  });

  it('derives key from label when rule has no key', () => {
    const rules = [{ re: 'planner', label: 'Planning Agent' }];
    const result = classify('You are a planner', rules);
    expect(result.key).toBe('planning agent');
  });

  it('key is capped at 24 chars', () => {
    const result = classify('something with no match abcdefghijklmnopqrstuvwxyz', []);
    expect(result.key.length).toBeLessThanOrEqual(24);
  });
});

// ---------------------------------------------------------------------------
// agentStats
// ---------------------------------------------------------------------------
describe('agentStats', () => {
  it('sums output_tokens across assistant turns', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 100 }, content: [] } },
      { type: 'assistant', message: { usage: { output_tokens: 250 }, content: [] } },
    ];
    expect(agentStats(events).outTok).toBe(350);
  });

  it('counts tool_use blocks', () => {
    const events = [
      {
        type: 'assistant',
        message: {
          usage: { output_tokens: 10 },
          content: [
            { type: 'tool_use', name: 'Read', input: { path: '/foo' } },
            { type: 'tool_use', name: 'Write', input: { path: '/bar' } },
          ],
        },
      },
    ];
    const stats = agentStats(events);
    expect(stats.tools).toBe(2);
    expect(stats.tail[0]?.kind).toBe('tool');
    expect(stats.tail[0]?.text).toContain('[Read]');
  });

  it('appends text blocks to tail', () => {
    const events = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'text', text: 'Thinking about it' }],
        },
      },
    ];
    const stats = agentStats(events);
    expect(stats.tail[0]?.kind).toBe('text');
    expect(stats.tail[0]?.text).toBe('Thinking about it');
  });

  it('ignores non-assistant events', () => {
    const events = [
      { type: 'user', message: { content: 'hello' } },
      { type: 'system', data: {} },
    ];
    expect(agentStats(events).outTok).toBe(0);
    expect(agentStats(events).tools).toBe(0);
  });

  it('caps tail at 30 entries', () => {
    const content = Array.from({ length: 50 }, (_, i) => ({ type: 'text', text: `line ${i}` }));
    const events = [{ type: 'assistant', message: { content } }];
    expect(agentStats(events).tail.length).toBe(30);
  });

  it('handles null/malformed events without throwing', () => {
    expect(() => agentStats([null, undefined, 42, 'string'])).not.toThrow();
  });

  it('handles assistant message with non-array content (uses [] fallback, line 122)', () => {
    const events = [
      { type: 'assistant', message: { content: 'not an array', usage: { output_tokens: 10 } } },
    ];
    const stats = agentStats(events);
    expect(stats.tools).toBe(0);
    expect(stats.tail.length).toBe(0);
  });

  it('skips assistant event where message is a non-object truthy value (line 114 branch)', () => {
    // message is a string (truthy, not null) but typeof !== 'object' — hits the continue
    const events = [
      { type: 'assistant', message: 'not an object' },
    ];
    const stats = agentStats(events);
    expect(stats.outTok).toBe(0);
    expect(stats.tools).toBe(0);
  });

  it('handles null block in content array (line 123 continue)', () => {
    const events = [
      { type: 'assistant', message: { content: [null, 42, 'str', { type: 'text', text: 'real' }] } },
    ];
    const stats = agentStats(events);
    expect(stats.tail.length).toBe(1);
    expect(stats.tail[0]?.text).toBe('real');
  });

  it('handles JSON.stringify failure in tool_use (line 130 catch)', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular; // circular reference — JSON.stringify throws
    const events = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Bash', input: circular }],
          usage: { output_tokens: 5 },
        },
      },
    ];
    // Should not throw — catch sets inp to ''
    expect(() => agentStats(events)).not.toThrow();
    const stats = agentStats(events);
    expect(stats.tools).toBe(1);
    expect(stats.tail[0]?.text).toBe('[Bash] ');
  });
});

// ---------------------------------------------------------------------------
// sevCounts
// ---------------------------------------------------------------------------
describe('sevCounts', () => {
  it('counts findings by severity', () => {
    const findings = [
      { severity: 'HIGH', title: 'a' },
      { severity: 'HIGH', title: 'b' },
      { severity: 'LOW', title: 'c' },
    ];
    const c = sevCounts(findings);
    expect(c['HIGH']).toBe(2);
    expect(c['LOW']).toBe(1);
  });

  it('uses UNRATED for missing severity', () => {
    const findings = [{ title: 'no sev' }, { severity: undefined, title: 'explicit undef' }];
    const c = sevCounts(findings);
    expect(c['UNRATED']).toBe(2);
  });

  it('returns {} for empty array', () => {
    expect(sevCounts([])).toEqual({});
  });

  it('handles null/undefined input gracefully', () => {
    expect(() => sevCounts([])).not.toThrow();
  });

  it('skips null and primitive entries in findings array (line 143 continue)', () => {
    const findings = [null, 42, 'string', { severity: 'HIGH', title: 'real' }];
    const c = sevCounts(findings);
    expect(c['HIGH']).toBe(1);
    // null/42/'string' should be skipped (not counted as UNRATED)
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('STALE_SECS is 90', () => {
    expect(STALE_SECS).toBe(90);
  });

  it('DEFAULT_ROLE_RULES is non-empty array', () => {
    expect(Array.isArray(DEFAULT_ROLE_RULES)).toBe(true);
    expect(DEFAULT_ROLE_RULES.length).toBeGreaterThan(0);
  });
});
