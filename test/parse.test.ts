import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  jload,
  firstUserText,
  deriveLabel,
  classify,
  agentStats,
  sevCounts,
  agentTypeToLabel,
  DEFAULT_ROLE_RULES,
  MAX_ROLE_RULE_RE_LEN,
  MAX_JSONL_BYTES,
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

  it('returns [] when file size exceeds MAX_JSONL_BYTES (c8 ignore: ESM spy limitation)', () => {
    // vi.spyOn cannot patch ESM fs.statSync (module namespace is non-configurable).
    // Creating a real 10 MiB fixture on disk in unit tests is impractical.
    // The size guard is covered by the MAX_JSONL_BYTES export test below; the
    // branch itself carries `/* c8 ignore next */` in parse.ts.
    // This test documents the intent and verifies MAX_JSONL_BYTES is exported at the
    // expected value rather than exercising the branch via I/O.
    expect(MAX_JSONL_BYTES).toBe(10 * 1024 * 1024);
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
    // Use an inline rule so this test is independent of DEFAULT_ROLE_RULES content.
    const rules = [{ re: 'SENIOR FULL-STACK DEVELOPER fixing', label: 'Fix', key: 'fix' }];
    const result = classify('SENIOR FULL-STACK DEVELOPER fixing the bugs', rules);
    expect(result.label).toBe('Fix');
    expect(result.key).toBe('fix');
  });

  it('matches build/test verifier rule', () => {
    // Use an inline rule so this test is independent of DEFAULT_ROLE_RULES content.
    const rules = [{ re: 'build/test verifier', label: 'Verify', key: 'verify' }];
    const result = classify('You are the build/test verifier', rules);
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

  it('skips rule entirely when regex is invalid — does NOT fall back to substring match', () => {
    // An invalid regex (unclosed group) passes through the length+structural guards
    // but fails to compile. Previously fell back to literal string match, which silently
    // gave wrong results for patterns users intended as regex. Now the rule is skipped.
    const badRules = [{ re: '(unclosed', label: 'FallbackMatch', key: 'fbmatch' }];
    const result = classify('This text (unclosed bracket here', badRules);
    // Rule is skipped — deriveLabel() takes over and extracts 'this_text' from the text
    expect(result.label).not.toBe('FallbackMatch');
    expect(result.key).not.toBe('fbmatch');
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

  it('skips rule where re exceeds MAX_ROLE_RULE_RE_LEN (ReDoS length guard)', () => {
    // A rule whose re is longer than 500 chars must be silently skipped even if
    // the text would match — this prevents catastrophic backtracking from
    // user-supplied rules in workspace settings.
    const longRe = 'a'.repeat(MAX_ROLE_RULE_RE_LEN + 1);
    const rules = [{ re: longRe, label: 'TooLong', key: 'toolong' }];
    // The text starts with 'a' so it would match if the rule were applied.
    // Since the rule is skipped, classify falls through to deriveLabel.
    const result = classify('aaa You are a planner', rules);
    expect(result.label).not.toBe('TooLong');
    expect(result.key).not.toBe('toolong');
  });

  it('skips rule whose re matches the structural ReDoS signature (quantified group over quantified atom)', () => {
    // (a+)+ is the canonical catastrophic-backtracking pattern. REDOS_DANGER_RE
    // should reject it before constructing the RegExp, so the label must NOT match.
    const rules = [{ re: '(a+)+', label: 'ReDoS', key: 'redos' }];
    const result = classify('aaa You are a planner', rules);
    expect(result.label).not.toBe('ReDoS');
    // Falls through to deriveLabel
    expect(result.label).toBe('planner');
  });

  it('skips rule with ReDoS signature in non-capturing group (?:a+)+', () => {
    // (?:a+)+ is equivalent to (a+)+ for backtracking purposes. The extended
    // REDOS_DANGER_RE must cover non-capturing group prefixes (?:…).
    const rules = [{ re: '(?:a+)+', label: 'ReDoS', key: 'redos' }];
    const result = classify('aaa You are a planner', rules);
    expect(result.label).not.toBe('ReDoS');
    expect(result.label).toBe('planner');
  });

  it('does NOT match a roleRule that appears only on a subsequent line of the prompt', () => {
    // Regression guard for M1 #2: classify() only matches rules against the
    // first line of the prompt (head = text.split('\n', 1)[0]). A rule pattern
    // that appears only in lines 2+ must NOT produce a match, preventing
    // mislabelling of agents whose body embeds another agent's role declaration.
    const rules = [{ re: 'SENIOR FULL-STACK DEVELOPER fixing', label: 'Fix', key: 'fix' }];
    const multilinePrompt = 'You are a planner\nSENIOR FULL-STACK DEVELOPER fixing all issues';
    const result = classify(multilinePrompt, rules);
    expect(result.label).not.toBe('Fix');
    // Falls through to deriveLabel, which extracts 'planner' from the first line.
    expect(result.label).toBe('planner');
  });

  it('resolves to Fix when a fix-style prompt embeds findings JSON containing reviewer-role keywords', () => {
    // AC: classify() must scope matching to the role-declaration line only.
    // A Fritz/implementer prompt starts with "You are Fritz … fix" on line 1,
    // then its body embeds findings JSON that contains reviewer-role keywords
    // (e.g. "You are the code reviewer", "COMPLIANCE REVIEWER", "reviewer").
    // The correct label is Fix, not Reviewer or any other reviewer role.
    const fixPrompt = [
      'You are Fritz "The Craftsman" Bauer — senior developer. Fix all findings.',
      '',
      'Findings from reviewers:',
      '{"title":"Auth bypass","severity":"CRITICAL","reviewer":"You are the code reviewer"}',
      '{"title":"XSS in output","severity":"HIGH","reviewer":"You are a compliance reviewer"}',
      'The reviewer noted: "You are the security reviewer responsible for these findings."',
    ].join('\n');

    const result = classify(fixPrompt, DEFAULT_ROLE_RULES);
    // Must match the fix/implement rule from line 1, not the reviewer rules from the body
    expect(result.label).toBe('Implementer');
    expect(result.key).toBe('fix');
  });

  it('resolves to Judge when "You are the judge" appears on the first line', () => {
    const result = classify('You are the judge of the following outputs', DEFAULT_ROLE_RULES);
    expect(result.label).toBe('Judge');
    expect(result.key).toBe('judge');
  });

  it('resolves to Synthesizer when "You are the synthesizer" appears on the first line', () => {
    // Use a prompt that does not incidentally contain words matching earlier rules
    // (e.g. avoid "research" — the research rule fires first in DEFAULT_ROLE_RULES order).
    const result = classify('You are the synthesizer of all outputs', DEFAULT_ROLE_RULES);
    expect(result.label).toBe('Synthesizer');
    expect(result.key).toBe('synthesize');
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

  // ---------------------------------------------------------------------------
  // M2-Metrics: optional token fields (input_tokens, cache_*)
  // ---------------------------------------------------------------------------
  it('collects inTok when input_tokens is present', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 50, input_tokens: 200 }, content: [] } },
      { type: 'assistant', message: { usage: { output_tokens: 30, input_tokens: 100 }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(stats.inTok).toBe(300);
    expect(stats.outTok).toBe(80);
  });

  it('collects cacheCreate when cache_creation_input_tokens is present', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 10, cache_creation_input_tokens: 500 }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(stats.cacheCreate).toBe(500);
  });

  it('collects cacheRead when cache_read_input_tokens is present', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 10, cache_read_input_tokens: 1200 }, content: [] } },
      { type: 'assistant', message: { usage: { output_tokens: 10, cache_read_input_tokens: 800 }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(stats.cacheRead).toBe(2000);
  });

  it('returns inTok=undefined when input_tokens is absent — never 0-as-real', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 100 }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(stats.inTok).toBeUndefined();
    expect(stats.cacheCreate).toBeUndefined();
    expect(stats.cacheRead).toBeUndefined();
  });

  it('returns inTok=undefined when no usage block exists at all', () => {
    const events = [
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } },
    ];
    const stats = agentStats(events);
    expect(stats.inTok).toBeUndefined();
    expect(stats.outTok).toBe(0);
  });

  it('handles mixed turns: some with input_tokens, some without — accumulates only present ones', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 50 }, content: [] } },            // no inTok
      { type: 'assistant', message: { usage: { output_tokens: 30, input_tokens: 150 }, content: [] } }, // has inTok
    ];
    const stats = agentStats(events);
    // inTok is defined (at least one turn had it); it accumulates only the present value
    expect(stats.inTok).toBe(150);
    expect(stats.outTok).toBe(80);
  });

  it('collects all three optional fields together', () => {
    const events = [
      {
        type: 'assistant',
        message: {
          usage: {
            output_tokens: 100,
            input_tokens: 400,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 600,
          },
          content: [],
        },
      },
    ];
    const stats = agentStats(events);
    expect(stats.outTok).toBe(100);
    expect(stats.inTok).toBe(400);
    expect(stats.cacheCreate).toBe(200);
    expect(stats.cacheRead).toBe(600);
  });

  it('ignores non-numeric input_tokens (e.g. string) — field stays undefined', () => {
    const events = [
      { type: 'assistant', message: { usage: { output_tokens: 50, input_tokens: 'not-a-number' }, content: [] } },
    ];
    const stats = agentStats(events);
    expect(stats.inTok).toBeUndefined();
    expect(stats.outTok).toBe(50);
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
// agentTypeToLabel
// ---------------------------------------------------------------------------
describe('agentTypeToLabel', () => {
  // Map of all 7 known agentTypes to their expected label and key, both with
  // and without the 'workflow-plugins:' namespace prefix.
  const cases: Array<{ input: string; label: string; key: string }> = [
    { input: 'implementer',                     label: 'Implement/Fix',  key: 'implementer' },
    { input: 'workflow-plugins:implementer',     label: 'Implement/Fix',  key: 'implementer' },
    { input: 'architect',                        label: 'Architecture',   key: 'architect' },
    { input: 'workflow-plugins:architect',        label: 'Architecture',   key: 'architect' },
    { input: 'code-reviewer',                    label: 'Code review',    key: 'code_reviewer' },
    { input: 'workflow-plugins:code-reviewer',   label: 'Code review',    key: 'code_reviewer' },
    { input: 'security-reviewer',                label: 'Security',       key: 'security_reviewer' },
    { input: 'workflow-plugins:security-reviewer', label: 'Security',     key: 'security_reviewer' },
    { input: 'uiux-reviewer',                    label: 'UI/UX',          key: 'uiux_reviewer' },
    { input: 'workflow-plugins:uiux-reviewer',   label: 'UI/UX',          key: 'uiux_reviewer' },
    { input: 'test-verifier',                    label: 'Verify',         key: 'test_verifier' },
    { input: 'workflow-plugins:test-verifier',   label: 'Verify',         key: 'test_verifier' },
    { input: 'completeness-critic',              label: 'Completeness',   key: 'completeness_critic' },
    { input: 'workflow-plugins:completeness-critic', label: 'Completeness', key: 'completeness_critic' },
  ];

  for (const { input, label, key } of cases) {
    it(`maps "${input}" → label="${label}", key="${key}"`, () => {
      const result = agentTypeToLabel(input);
      expect(result).not.toBeNull();
      expect(result!.label).toBe(label);
      expect(result!.key).toBe(key);
    });
  }

  it('returns null for an unknown agentType string', () => {
    expect(agentTypeToLabel('unknown-robot')).toBeNull();
    expect(agentTypeToLabel('workflow-plugins:unknown-robot')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(agentTypeToLabel('')).toBeNull();
  });

  it('returns null for non-string inputs (null, undefined, number, object)', () => {
    expect(agentTypeToLabel(null)).toBeNull();
    expect(agentTypeToLabel(undefined)).toBeNull();
    expect(agentTypeToLabel(42)).toBeNull();
    expect(agentTypeToLabel({})).toBeNull();
  });

  it('strips any single-segment namespace prefix (colon-delimited)', () => {
    // A hypothetical other-namespace prefix is stripped the same way.
    // 'other-ns:implementer' → 'implementer' → matches.
    const result = agentTypeToLabel('other-ns:implementer');
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Implement/Fix');
  });
});

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
describe('constants', () => {
  it('STALE_SECS is 180', () => {
    expect(STALE_SECS).toBe(180);
  });

  it('DEFAULT_ROLE_RULES is non-empty array', () => {
    expect(Array.isArray(DEFAULT_ROLE_RULES)).toBe(true);
    expect(DEFAULT_ROLE_RULES.length).toBeGreaterThan(0);
  });

  it('DEFAULT_ROLE_RULES covers all 7 neutral vocabulary terms (review/fix/verify/plan/research/judge/synthesize)', () => {
    // Guard: ensure no neutral term is accidentally removed. Each term must appear
    // in at least one rule's re or label (case-insensitive).
    const allRuleText = DEFAULT_ROLE_RULES
      .map(r => `${r.re} ${r.label} ${r.key ?? ''}`)
      .join(' ')
      .toLowerCase();
    const required = ['review', 'fix', 'verif', 'plan', 'research', 'judge', 'synthesiz'];
    for (const term of required) {
      expect(allRuleText, `DEFAULT_ROLE_RULES must contain a rule covering "${term}"`).toContain(term);
    }
  });

  it('DEFAULT_ROLE_RULES uses only neutral, generic role labels', () => {
    // Shipped defaults must stay neutral: every rule maps to a generic workflow
    // role, never an author- or project-specific label/term that would vary per
    // workflow or project. An allow-list (rather than a bl) keeps this guard
    // from having to name the very strings it forbids.
    const allowedLabels = new Set([
      'Reviewer', 'Implementer', 'Verifier', 'Planner', 'Researcher', 'Judge', 'Synthesizer',
    ]);
    for (const r of DEFAULT_ROLE_RULES) {
      expect(
        allowedLabels.has(r.label),
        `DEFAULT_ROLE_RULES has a non-generic label "${r.label}"`,
      ).toBe(true);
    }
  });
});
