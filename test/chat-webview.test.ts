/**
 * Chat tab — webview rendering tests (src/webview/js-panels.ts chatPanel(),
 * highlightChatTags(), the Chat entry in tabDefs()/tabContent(), the
 * chat-tag wiring in js-wire.ts, and the Chat CSS rules).
 *
 * Strategy: extract the relevant functions from the shipped webview JS string
 * (same harness pattern as m2-charts.test.ts / m3-timeline.test.ts) and
 * evaluate them against synthetic snap.chat fixtures.
 */
import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';
import { getPanelJs, extractBalancedFn, TEST_NONCE } from './helpers/webview';

function getPanelHtml(): string {
  return getHtml(TEST_NONCE);
}

// ---------------------------------------------------------------------------
// Harness: chatPanel() + the helpers it transitively needs.
// ---------------------------------------------------------------------------
function buildChatHarness(js: string): (snap: object) => string {
  const escFn = extractBalancedFn(js, 'esc');
  const safeNFn = extractBalancedFn(js, 'safeN');
  const normFn = extractBalancedFn(js, 'normalizeLiteralEscapes');
  const inlineSpansFn = extractBalancedFn(js, 'applyInlineSpans');
  const renderInlineMdFn = extractBalancedFn(js, 'renderInlineMd');
  const highlightFn = extractBalancedFn(js, 'highlightChatTags');
  const chatPanelFn = extractBalancedFn(js, 'chatPanel');

  const factory = new Function(
    'snap',
    [escFn, safeNFn, normFn, inlineSpansFn, renderInlineMdFn, highlightFn, chatPanelFn, 'return chatPanel();'].join('\n'),
  ) as (snap: object) => string;

  return (snap: object) => factory(snap);
}

function makeTurn(partial: Record<string, unknown> & { author: string; body: string }): Record<string, unknown> {
  return { addressed: [], ...partial };
}

function makeChatSnap(turns: Record<string, unknown>[], extra: Record<string, unknown> = {}): object {
  return { chat: { sourceFile: 'chat-wf_x.md', updatedAt: '', malformed: false, turnsCapped: false, truncated: false, turns, ...extra } };
}

// ---------------------------------------------------------------------------
// chatPanel() rendering
// ---------------------------------------------------------------------------
describe('chatPanel() — rendering', () => {
  it('renders the empty-state message when snap.chat is null', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run({ chat: null });
    expect(html).toContain('No cross-agent chat recorded for this run.');
  });

  it('renders the empty-state message when snap.chat.turns is empty', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([]));
    expect(html).toContain('No cross-agent chat recorded for this run.');
  });

  it('renders one .chat-turn element per turn', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([
      makeTurn({ author: 'Klaus', body: 'first' }),
      makeTurn({ author: 'Gerda', body: 'second' }),
    ]));
    expect(html.match(/class="chat-turn"/g)?.length).toBe(2);
  });

  it('escapes the author name (XSS defense)', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: '<img src=x onerror=alert(1)>', body: 'hi' })]));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  it('escapes the body text (XSS defense) before any markdown/tag processing', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Klaus', body: '<script>alert(1)</script>' })]));
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders a timestamp span when present, omits it when absent', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const withTs = run(makeChatSnap([makeTurn({ author: 'Klaus', body: 'hi', timestamp: '2026-10-14T10:00:00Z' })]));
    expect(withTs).toContain('class="chat-ts"');
    expect(withTs).toContain('2026-10-14T10:00:00Z');
    const withoutTs = run(makeChatSnap([makeTurn({ author: 'Klaus', body: 'hi' })]));
    expect(withoutTs).not.toContain('class="chat-ts"');
  });

  it('renders addressed @tags as .chat-tag chips with data-chattag', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Gerda', body: 'please review', addressed: ['Klaus', 'Fritz'] })]));
    expect(html).toContain('data-chattag="Klaus"');
    expect(html).toContain('data-chattag="Fritz"');
    expect(html).toContain('@Klaus');
    expect(html).toContain('@Fritz');
  });

  it('highlights an inline @mention inside the body text as a .chat-tag chip', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Gerda', body: 'Thanks @Klaus, looking into it.' })]));
    expect(html).toContain('data-chattag="Klaus"');
  });

  it('chat-tag chips are keyboard-focusable (tabindex=0, role=button)', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Gerda', body: 'hi @Klaus' })]));
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="button"');
  });

  it('renders markdown bold/list formatting in the body via renderInlineMd', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Klaus', body: '**important** finding' })]));
    expect(html).toContain('<strong>important</strong>');
  });

  it('shows a malformed-content note with data-testid when chat.malformed is true', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Unknown', body: 'raw dump' })], { malformed: true }));
    expect(html).toContain('data-testid="chat-malformed"');
  });

  it('does not show the malformed note when chat.malformed is false', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Klaus', body: 'hi' })]));
    expect(html).not.toContain('data-testid="chat-malformed"');
  });

  it('shows a capped note when turnsCapped is true', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Klaus', body: 'hi' })], { turnsCapped: true }));
    expect(html).toContain('Showing the most recent');
  });

  it('chat-turn elements have a stable, test-addressable id', () => {
    const js = getPanelJs(getPanelHtml());
    const run = buildChatHarness(js);
    const html = run(makeChatSnap([makeTurn({ author: 'Klaus', body: 'hi' })]));
    expect(html).toContain('id="chat-turn-0"');
  });
});

// ---------------------------------------------------------------------------
// highlightChatTags() — safety of the regex-wrapped output
// ---------------------------------------------------------------------------
describe('highlightChatTags()', () => {
  function run(s: string): string {
    const js = getPanelJs(getPanelHtml());
    const highlightFn = extractBalancedFn(js, 'highlightChatTags');
    const factory = new Function('s', `${highlightFn}\nreturn highlightChatTags(s);`) as (s: string) => string;
    return factory(s);
  }

  it('wraps a single @mention in a clickable span', () => {
    expect(run('hi @Klaus')).toBe('hi <span class="chat-tag" tabindex="0" role="button" data-chattag="Klaus">@Klaus</span>');
  });

  it('wraps multiple @mentions independently', () => {
    const out = run('@Klaus and @Gerda');
    expect(out).toContain('data-chattag="Klaus"');
    expect(out).toContain('data-chattag="Gerda"');
  });

  it('leaves text with no @mention untouched', () => {
    expect(run('no mentions here')).toBe('no mentions here');
  });

  it('does not match a bare @ with no following word character', () => {
    expect(run('email me at foo@ bar')).toBe('email me at foo@ bar');
  });
});

// ---------------------------------------------------------------------------
// tabDefs() / tabContent() — Chat tab registration
// ---------------------------------------------------------------------------
describe('tabDefs() — Chat tab', () => {
  it('html.ts getHtml() output contains the chat tab key', () => {
    expect(getPanelHtml()).toContain("key:'chat'");
  });

  it('chat tab is placed after results (end of tab order, like the other optional tabs)', () => {
    const js = getPanelJs(getPanelHtml());
    const tabDefsIdx = js.indexOf('function tabDefs()');
    const resultsPos = js.indexOf("key:'results'", tabDefsIdx);
    const chatPos = js.indexOf("key:'chat'", tabDefsIdx);
    expect(resultsPos).toBeGreaterThan(-1);
    expect(chatPos).toBeGreaterThan(resultsPos);
  });

  it('tabContent() dispatches to chatPanel() for k==="chat"', () => {
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain("k==='chat'");
    expect(js).toContain('chatPanel()');
  });

  it('tabContent() renders a data-testid="chat-empty" placeholder when there are no chat turns', () => {
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain('data-testid="chat-empty"');
  });
});

// ---------------------------------------------------------------------------
// wire() — @tag click/keyboard wiring (string-level assertions, matching the
// established pattern for untestable-without-DOM wiring code in this suite).
// ---------------------------------------------------------------------------
describe('wire() — chat-tag wiring', () => {
  it('wires [data-chattag] elements via addEventListener (nonce-safe, no inline handlers)', () => {
    const js = getPanelJs(getPanelHtml());
    expect(js).toContain("document.querySelectorAll('[data-chattag]')");
    expect(js).toContain("addEventListener('click',act)");
  });

  it('chat-tag activation also handles Enter/Space keydown (keyboard operable)', () => {
    const js = getPanelJs(getPanelHtml());
    const wireIdx = js.indexOf('[data-chattag]');
    const slice = js.slice(wireIdx, wireIdx + 1200);
    expect(slice).toContain("e.key==='Enter'");
    expect(slice).toContain("e.key===' '");
  });

  it('activating a chat tag switches to the agents tab and opens the matched agent card', () => {
    const js = getPanelJs(getPanelHtml());
    const wireIdx = js.indexOf('[data-chattag]');
    const slice = js.slice(wireIdx, wireIdx + 900);
    expect(slice).toContain("state.activeTab='agents'");
    expect(slice).toContain('state.openAgents[agent.id]=true');
  });
});

// ---------------------------------------------------------------------------
// CSS — theme-native, no hardcoded colors
// ---------------------------------------------------------------------------
describe('Chat tab — CSS', () => {
  it('defines .chat-thread, .chat-turn, .chat-tag and related rules', () => {
    const html = getPanelHtml();
    for (const cls of ['.chat-thread{', '.chat-turn{', '.chat-turn-hdr{', '.chat-author{', '.chat-ts{', '.chat-tag{', '.chat-body{']) {
      expect(html).toContain(cls);
    }
  });

  it('uses only --vscode-* variables in the chat rules (no hardcoded hex colors)', () => {
    const html = getPanelHtml();
    const start = html.indexOf('.chat-thread{');
    const end = html.indexOf('.pinned-badge{');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = html.slice(start, end);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it('has a forced-colors override for .chat-tag', () => {
    const html = getPanelHtml();
    const fcIdx = html.indexOf('@media (forced-colors:active){');
    expect(fcIdx).toBeGreaterThan(-1);
    const fcEnd = html.indexOf('.ok{color:LinkText}', fcIdx);
    const block = html.slice(fcIdx, fcEnd);
    expect(block).toContain('.chat-tag{');
  });
});
