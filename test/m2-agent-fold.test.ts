/**
 * M2-AgentFold: explicit fold/unfold affordance for agent cards.
 *
 * AC (from task brief):
 *  - Visible chevron/caret + cursor:pointer + aria-expanded on each card row.
 *  - Keyboard-operable (Enter/Space).
 *  - Per-card collapse state keyed by agent id via openAgents (persists across refreshes).
 *  - Default: run agents expanded, done/dead agents collapsed (no prior state).
 *  - Collapse-all / Expand-all toggle for multi-agent runs.
 *  - Theme-native (--vscode-*); no layout shift or theme-color regression.
 *  - getHtml/state tests assert toggle renders, persists, and collapse-all/expand-all works.
 */
import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';

const TEST_NONCE = 'dGVzdG5vbmNlMTIz';

function getPanelJs(html: string): string {
  const scriptOpen = `<script nonce="${TEST_NONCE}">`;
  const scriptClose = '</script>';
  const s = html.indexOf(scriptOpen);
  const e = html.lastIndexOf(scriptClose);
  return html.slice(s + scriptOpen.length, e);
}

// ---------------------------------------------------------------------------
// CSS: chevron rule exists and uses theme-native variables
// ---------------------------------------------------------------------------
describe('M2-AgentFold — CSS', () => {
  it('CSS contains .card-chevron rule for fold/unfold affordance', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.card-chevron{');
  });

  it('CSS .card-chevron has a transition property (smooth rotation)', () => {
    const html = getHtml(TEST_NONCE);
    const start = html.indexOf('.card-chevron{');
    const end = html.indexOf('}', start);
    const rule = html.slice(start, end);
    expect(rule).toContain('transition');
  });

  it('CSS .card.open .card-chevron rotates (transform:rotate)', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.card.open .card-chevron{transform:rotate(');
  });

  it('CSS .agent-fold-btn rule exists for collapse-all/expand-all button', () => {
    const html = getHtml(TEST_NONCE);
    expect(html).toContain('.agent-fold-btn{');
  });

  it('CSS contains no hardcoded hex colors in fold/unfold rules (--vscode-* only)', () => {
    const html = getHtml(TEST_NONCE);
    // Extract the card-chevron and agent-fold-btn rules
    const start = html.indexOf('.card-chevron{');
    const endAfterFoldBtn = html.indexOf('}', html.indexOf('.agent-fold-btn{')) + 1;
    const block = html.slice(start, endAfterFoldBtn);
    // No # hex color literals inside these rules
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });
});

// ---------------------------------------------------------------------------
// HTML structure: chevron inside .row, aria-expanded present
// ---------------------------------------------------------------------------
describe('M2-AgentFold — card row HTML structure', () => {
  it('JS agentsPanel renders a .card-chevron span inside .row for each agent', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('card-chevron');
  });

  it('JS agentsPanel .row carries aria-expanded reflecting open state', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // aria-expanded must be on the .row element and keyed to the open variable
    expect(js).toContain('aria-expanded=');
    // The .row div also carries aria-controls (WCAG 4.1.2) so the trailing '>' is not
    // immediately after the aria-expanded value — check up to the attribute value only.
    expect(js).toContain("'<div class=\"row\" tabindex=\"0\" role=\"button\" aria-expanded=\"'+(open?'true':'false')+'\"");
  });

  it('JS agentsPanel card-chevron span has aria-hidden="true" (decorative)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The chevron is decorative — label comes from aria-expanded on .row
    expect(js).toContain('card-chevron" aria-hidden="true"');
  });

  it('JS agentsPanel uses &#9658; (right-pointing triangle) as the chevron character', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('&#9658;');
  });
});

// ---------------------------------------------------------------------------
// Default state: run=expanded, done/dead=collapsed (no prior persisted state)
// ---------------------------------------------------------------------------
describe('M2-AgentFold — default open state logic', () => {
  it('JS agentsPanel sets openAgents default to true for run agents when state is undefined', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The default assignment: when no persisted state, run => true, else false
    expect(js).toContain("state.openAgents[a.id]===undefined");
    // run agents default open
    expect(js).toContain("a.status==='run'");
  });

  it('JS agentsPanel only applies the default when state.openAgents[id] is undefined (persisted state wins)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The check must gate on ===undefined so that an explicit false (collapsed) is respected
    const idx = js.indexOf("state.openAgents[a.id]===undefined");
    expect(idx).toBeGreaterThan(-1);
    // The block after the check assigns the default
    const block = js.slice(idx, idx + 120);
    expect(block).toContain("state.openAgents[a.id]=a.status==='run'");
  });

  it('JS agentsPanel default-state block iterates snap.agents (not a partial list)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Must use snap.agents.forEach (not snap.agents.filter or slice)
    expect(js).toContain('snap.agents.forEach(function(a)');
  });
});

// ---------------------------------------------------------------------------
// Collapse-all / Expand-all button
// ---------------------------------------------------------------------------
describe('M2-AgentFold — Collapse-all / Expand-all button', () => {
  it('JS agentsPanel renders agentCollapseAllBtn when there are 2+ agents', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('agentCollapseAllBtn');
  });

  it('JS agentsPanel only renders the button when snap.agents.length > 1', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Gated on length > 1 — single-agent runs don't need it
    expect(js).toContain('snap.agents.length>1');
  });

  it('Collapse-all button has data-testid="collapse-all-btn" for test addressability', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('data-testid="collapse-all-btn"');
  });

  it('Collapse-all button uses visible text as accessible name (no static aria-label)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The button text IS the accessible name — WCAG 4.1.2 + 2.5.3 require the visible
    // text and AT name to match. A static aria-label that does not update with textContent
    // would diverge when the button toggles between "Collapse all" and "Expand all".
    // Correct: no static aria-label; accessible name comes from the visible textContent.
    expect(js).not.toContain('aria-label="Collapse all / Expand all agent cards"');
    // The button still uses aria-describedby to surface the cards-hint text to AT users.
    expect(js).toContain('aria-describedby="cards-hint-text"');
  });

  it('Collapse-all button has a title tooltip', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('title="Collapse or expand all agent cards"');
  });

  it('Collapse-all button visible text is either "Collapse all" or "Expand all"', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The visible textContent toggles between these two labels as the button is activated.
    expect(js).toContain('Collapse all');
    expect(js).toContain('Expand all');
  });
});

// ---------------------------------------------------------------------------
// wire() — event wiring for fold/unfold
// ---------------------------------------------------------------------------
describe('M2-AgentFold — wire() event wiring', () => {
  it('wire() wires .card .row with addEventListener click to toggle_agent', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // toggle_agent is declared and used in the click handler
    expect(js).toContain('function toggle_agent(c)');
    expect(js).toContain("row.addEventListener('click',()=>toggle_agent(c))");
  });

  it('wire() wires .card .row with keydown handler for Enter and Space keys', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain("e.key==='Enter'||e.key===' '");
  });

  it('wire() toggle_agent updates state.openAgents[id] and calls save()', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // toggle_agent must flip the state entry and persist
    expect(js).toContain('state.openAgents[id]=!state.openAgents[id]');
    expect(js).toContain('save()');
  });

  it('wire() toggle_agent updates aria-expanded on the .row element', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The toggle must update aria-expanded after toggling
    const idx = js.indexOf('function toggle_agent(c)');
    expect(idx).toBeGreaterThan(-1);
    const block = js.slice(idx, idx + 250);
    expect(block).toContain("setAttribute('aria-expanded'");
  });

  it('wire() wires agentCollapseAllBtn via getElementById and addEventListener (nonce-safe)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // Must use getElementById + null guard + addEventListener (no inline onclick)
    expect(js).toContain("document.getElementById('agentCollapseAllBtn')");
    // Null guard: if(cab){cab.addEventListener
    expect(js).toContain('if(cab){cab.addEventListener');
    // No inline onclick on the button
    expect(js).not.toContain('agentCollapseAllBtn" onclick');
    expect(js).not.toContain("agentCollapseAllBtn' onclick");
  });

  it('wire() collapse-all handler checks anyOpen to decide collapse vs expand direction', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The handler computes anyOpen by checking .open class, then toggles all the opposite way
    expect(js).toContain('anyOpen');
    expect(js).toContain('var next=!anyOpen');
  });

  it('wire() collapse-all handler updates state.openAgents for all agent ids and calls save()', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const idx = js.indexOf('document.getElementById(\'agentCollapseAllBtn\')');
    expect(idx).toBeGreaterThan(-1);
    const block = js.slice(idx, idx + 600);
    // Updates each card's state entry
    expect(block).toContain('state.openAgents[id]=next');
    // Persists
    expect(block).toContain('save()');
  });

  it('wire() collapse-all handler also updates aria-expanded on each .row', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const idx = js.indexOf("document.getElementById('agentCollapseAllBtn')");
    expect(idx).toBeGreaterThan(-1);
    const block = js.slice(idx, idx + 700);
    expect(block).toContain("setAttribute('aria-expanded'");
  });

  it('wire() collapse-all does NOT call render() (avoids re-render flicker, updates DOM directly)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    const idx = js.indexOf("document.getElementById('agentCollapseAllBtn')");
    expect(idx).toBeGreaterThan(-1);
    // The handler block ends before the next top-level document.querySelectorAll
    const block = js.slice(idx, idx + 800);
    // Within the collapse-all handler we do NOT call render() — we patch DOM directly
    expect(block).not.toMatch(/cab\.addEventListener\([^)]+\);\s*\}\s*render\(\)/);
  });
});

// ---------------------------------------------------------------------------
// State persistence: openAgents keyed by agent id
// ---------------------------------------------------------------------------
describe('M2-AgentFold — state persistence', () => {
  it('JS state object includes openAgents (already present from M0)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    expect(js).toContain('openAgents');
  });

  it('JS state.openAgents is restored from api.getState() on load', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The state initialisation: _s.openAgents||{}
    expect(js).toContain("_s.openAgents||{}");
  });

  it('JS state prune block filters openAgents by live agent ids (prevents unbounded growth)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // The prune: state.openAgents = Object.fromEntries(... filter by agentIds)
    expect(js).toContain('state.openAgents=Object.fromEntries');
  });

  it('JS save() is called after any state mutation (openAgents and collapse-all)', () => {
    const js = getPanelJs(getHtml(TEST_NONCE));
    // save() must be present and called in toggle_agent and the collapse-all handler
    expect(js).toContain('function save(){api.setState(state);}');
  });
});

// ---------------------------------------------------------------------------
// Script well-formedness: the JS with fold additions must still parse cleanly
// ---------------------------------------------------------------------------
describe('M2-AgentFold — script well-formedness', () => {
  it('inline panel script is still syntactically valid after M2-AgentFold additions', () => {
    const html = getHtml(TEST_NONCE);
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const sStart = html.indexOf(scriptOpen);
    const sEnd = html.lastIndexOf(scriptClose);
    expect(sStart).toBeGreaterThan(-1);
    expect(sEnd).toBeGreaterThan(sStart);
    const scriptContent = html.slice(sStart + scriptOpen.length, sEnd);
    expect(() => {
      new Function('acquireVsCodeApi', 'document', 'window', 'CSS', scriptContent);
    }).not.toThrow();
  });

  it('inline panel script does not contain backticks (no template literals)', () => {
    const html = getHtml(TEST_NONCE);
    const scriptOpen = `<script nonce="${TEST_NONCE}">`;
    const scriptClose = '</script>';
    const sStart = html.indexOf(scriptOpen);
    const sEnd = html.lastIndexOf(scriptClose);
    const scriptContent = html.slice(sStart + scriptOpen.length, sEnd);
    expect(scriptContent).not.toContain('`');
  });
});
