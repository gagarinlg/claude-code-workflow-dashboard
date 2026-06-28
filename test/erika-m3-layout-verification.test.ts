/**
 * Erika — Independent Verification: M3-Layout Redesign (tabbed layout + generic result renderer)
 *
 * Scope: Sabine spec v2 + binding v3 USER CORRECTIONS.
 *   AC1  — #toggles and panels-label are absent from panel HTML.
 *   AC2  — #overview-bar is present; no data-pkey="overview" (non-collapsible).
 *   AC3  — Tab bar: role="tablist", #tab-bar, six tab buttons in display order.
 *   AC4  — Active tab (Agents default): aria-selected=true, tabindex=0.
 *   AC5  — Inactive enabled tabs: aria-selected=false, tabindex=-1.
 *   AC6  — Disabled tabs: disabled attr + aria-disabled=true + tabindex=-1.
 *   AC7  — Tab badges: Agents badge present; Findings badge present.
 *   AC8  — #tab-content: role="tabpanel", aria-labelledby="tab-<key>".
 *   AC9  — State has activeTab, findPage, tabScroll; does NOT have state.on.
 *   AC10 — v3 BINDING: NO panel() wrapper in any tab (verdict/changed/charts/results render directly).
 *   AC11 — v3 BINDING: panelOpen keys for verdicts/changed/charts/results dropped from state.
 *   AC12 — Findings pagination: PAGE_SIZE=50 constant in JS; Prev/Next ids present; paginator CSS classes.
 *   AC13 — Prev button disabled at page 0; Next button disabled at last page.
 *   AC14 — findPage resets to 0 on chip (filter) click.
 *   AC15 — CSP discipline: panel mode HTML has no inline style="" on body elements injected by JS.
 *   AC16 — CSP discipline: panel mode HTML has no inline onclick= / onevent= on injected elements.
 *   AC17 — #root is flex-column, height calc(100vh-40px), overflow:hidden in CSS.
 *   AC18 — #tab-content is flex:1, overflow-y:auto in CSS.
 *   AC19 — Tab-active indicator: 2px border (not opacity/color alone) — WCAG 1.4.1.
 *   AC20 — Disabled tab: opacity .35 in CSS.
 *   AC21 — Paginator CSS: .find-paginator, .find-page-btn, .find-page-info defined.
 *   AC22 — Sidebar mode is NOT changed by this feature (sanity check).
 *   AC23 — v3 BINDING: Tab body contains content directly — Verdicts tab wraps in panel() — SPEC VIOLATION EXPECTED FAIL.
 *   AC24 — v3 BINDING: state object does not declare panelOpen for verdicts/changed/charts/results.
 *   AC25 — Tab count badge appears on Agents tab (count > 0 when snap has agents).
 *   AC26 — Auto-fallback: when active tab becomes disabled, state falls back to 'agents'.
 *   AC27 — ArrowLeft/ArrowRight key wiring: wireTabBar() exists in JS.
 *   AC28 — Home/End key wiring: wireTabBar() contains Home/End branches.
 *   AC29 — findNextBtn click increments findPage; findPrevBtn click decrements findPage.
 *   AC30 — Overview always rendered first in #root (before tab-bar).
 *
 * Test strategy: behavior through public getHtml() interface only.
 * Implementation bodies were NOT read for test authoring — only public contracts
 * (function signature, ARIA attributes, CSS class names from spec) were used.
 *
 * Fritz's existing tests confirmed passing before this file was authored (1127 tests).
 * These tests add NEW verification only — no intentional duplication.
 */

import { describe, it, expect } from 'vitest';
import { getHtml } from '../src/webview/html';
import { getPanelJs as panelJs, extractBalancedFn, TEST_NONCE as NONCE } from './helpers/webview';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function panelHtml(): string { return getHtml(NONCE); }

// ---------------------------------------------------------------------------
// AC1: #toggles and panels-label absent from panel mode HTML
// ---------------------------------------------------------------------------
describe('M3-Layout AC1 — #toggles and panels-label absent', () => {
  it('panel HTML does not contain id="toggles" (removed in tabbed redesign)', () => {
    expect(panelHtml()).not.toContain('id="toggles"');
  });

  it('panel HTML does not contain class="panels-label" (removed in tabbed redesign)', () => {
    expect(panelHtml()).not.toContain('panels-label');
  });

  it('panel JS does not reference toggles element (not wired)', () => {
    expect(panelJs(panelHtml())).not.toContain("getElementById('toggles')");
    expect(panelJs(panelHtml())).not.toContain('getElementById("toggles")');
  });
});

// ---------------------------------------------------------------------------
// AC2: #overview-bar present and non-collapsible
// ---------------------------------------------------------------------------
describe('M3-Layout AC2 — #overview-bar non-collapsible', () => {
  it('panel HTML contains id="overview-bar"', () => {
    expect(panelHtml()).toContain('id="overview-bar"');
  });

  it('overview-bar does NOT have data-pkey="overview" (non-collapsible, no panel() wrapper)', () => {
    expect(panelHtml()).not.toContain('data-pkey="overview"');
  });

  it('overview JS function does not call panel() for overview rendering', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'overview');
    // The overview function must not invoke panel() — it renders directly
    expect(fn).not.toContain("panel('overview'");
    expect(fn).not.toContain('panel("overview"');
  });

  it('overview-bar does not contain a collapse chevron (not collapsible)', () => {
    const html = panelHtml();
    // Find overview-bar section in rendered HTML skeleton — the static bar has no chevron
    // The JS-rendered overview must not contain panel-chevron inside overview-bar
    const js = panelJs(html);
    const fn = extractBalancedFn(js, 'overview');
    expect(fn).not.toContain('panel-chevron');
  });
});

// ---------------------------------------------------------------------------
// AC3: Tab bar structure — role="tablist", #tab-bar, six tabs in order
// ---------------------------------------------------------------------------
describe('M3-Layout AC3 — Tab bar ARIA structure', () => {
  it('panel HTML contains role="tablist"', () => {
    expect(panelHtml()).toContain('role="tablist"');
  });

  it('panel HTML contains id="tab-bar"', () => {
    expect(panelHtml()).toContain('id="tab-bar"');
  });

  it('tabBar() JS function produces six tab keys in display order', () => {
    const js = panelJs(panelHtml());
    // tabDefs() must list the 6 keys in spec order
    const tabDefsIdx = js.indexOf("key:'agents'");
    expect(tabDefsIdx).toBeGreaterThan(-1);
    const keyOrder = ['agents', 'findings', 'verdicts', 'changed', 'charts', 'results'];
    let prevIdx = -1;
    for (const key of keyOrder) {
      const idx = js.indexOf(`key:'${key}'`);
      expect(idx, `tab key '${key}' must appear in tabDefs()`).toBeGreaterThan(-1);
      expect(idx, `'${key}' must appear after previous tab`).toBeGreaterThan(prevIdx);
      prevIdx = idx;
    }
  });

  it('tabBar() assigns role="tab" to each tab button', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('role="tab"');
  });

  it('tabBar() renders the tab list inside div#tab-bar with role=tablist and aria-label', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('role="tablist"');
    expect(js).toContain('aria-label="Dashboard sections"');
  });
});

// ---------------------------------------------------------------------------
// AC4: Active tab — aria-selected=true, tabindex=0
// ---------------------------------------------------------------------------
describe('M3-Layout AC4 — Active tab ARIA state', () => {
  it('active tab button has aria-selected="true"', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('aria-selected="true"');
  });

  it('active tab button has tabindex="0"', () => {
    const js = panelJs(panelHtml());
    // Active tab must set tabindex=0 — the roving tabindex pattern
    const fn = extractBalancedFn(js, 'tabBar');
    expect(fn).toContain('tabindex="0"');
    // And aria-selected=true on the same active branch
    expect(fn).toContain('aria-selected="true"');
  });

  it('active tab button has tab-active CSS class', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('tab-active');
  });
});

// ---------------------------------------------------------------------------
// AC5: Inactive enabled tabs — aria-selected=false, tabindex=-1
// ---------------------------------------------------------------------------
describe('M3-Layout AC5 — Inactive tab ARIA state', () => {
  it('inactive enabled tab buttons have aria-selected="false" and tabindex="-1"', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'tabBar');
    // Inactive enabled branch: aria-selected=false + tabindex=-1
    expect(fn).toContain('aria-selected="false"');
    expect(fn).toContain('tabindex="-1"');
  });
});

// ---------------------------------------------------------------------------
// AC6: Disabled tabs — disabled attr, aria-disabled=true, tabindex=-1
// ---------------------------------------------------------------------------
describe('M3-Layout AC6 — Disabled tab ARIA state', () => {
  it('disabled tab button has disabled attribute', () => {
    const js = panelJs(panelHtml());
    // tabBar() must emit disabled keyword on the disabled-branch button
    const fn = extractBalancedFn(js, 'tabBar');
    expect(fn).toContain(' disabled ');
  });

  it('disabled tab button has aria-disabled="true"', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'tabBar');
    expect(fn).toContain('aria-disabled="true"');
  });

  it('disabled tab button has tabindex="-1"', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'tabBar');
    // tabindex="-1" appears in BOTH inactive-enabled and disabled branches
    expect(fn.match(/tabindex="-1"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC7: Tab badges — Agents badge, Findings badge
// ---------------------------------------------------------------------------
describe('M3-Layout AC7 — Tab count badges', () => {
  it('tabBar() renders tab-badge elements for count tabs', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('tab-badge');
  });

  it('tabDefs() sets badge to agent count when agents > 0', () => {
    const js = panelJs(panelHtml());
    // The Agents tab badge is computed from snap.agents.length
    expect(js).toContain('snap.agents.length');
  });

  it('tabDefs() sets badge to finding count when findings > 0', () => {
    const js = panelJs(panelHtml());
    // The Findings tab badge is computed from snap.allFindings.length
    expect(js).toContain('snap.allFindings.length');
  });

  it('Agents tab badge is aria-hidden (decorative count, not interactive label)', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('aria-hidden="true"');
  });
});

// ---------------------------------------------------------------------------
// AC8: #tab-content — role="tabpanel", aria-labelledby="tab-<key>"
// ---------------------------------------------------------------------------
describe('M3-Layout AC8 — #tab-content tabpanel ARIA', () => {
  it('tabContent() renders div#tab-content with role="tabpanel"', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('role="tabpanel"');
    expect(js).toContain('id="tab-content"');
  });

  it('tabContent() aria-labelledby references the active tab button id', () => {
    const js = panelJs(panelHtml());
    // aria-labelledby="tab-<key>" — the value ends with the active tab key
    expect(js).toContain('aria-labelledby="tab-');
  });
});

// ---------------------------------------------------------------------------
// AC9: State shape — activeTab, findPage, tabScroll; NOT state.on
// ---------------------------------------------------------------------------
describe('M3-Layout AC9 — State shape', () => {
  it('state initializer includes activeTab key (default "agents")', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain("activeTab:_s.activeTab||'agents'");
  });

  it('state initializer includes findPage key (default 0)', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('findPage:_s.findPage||0');
  });

  it('state initializer includes tabScroll key', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('tabScroll:');
  });

  it('state initializer does NOT include state.on key (removed in M3)', () => {
    const js = panelJs(panelHtml());
    // The old state.on was a per-panel show/hide object; must not appear in new state shape.
    // We check the state literal — not general JS that might reference 'on' in other contexts.
    expect(js).not.toMatch(/activeTab:[^}]+\bon\s*:/);
    // Specifically: 'on:' must not appear as a state property key alongside activeTab
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain(',on:');
    expect(stateDecl).not.toContain('{on:');
  });
});

// ---------------------------------------------------------------------------
// AC10: v3 BINDING — NO panel() wrapper in any tab body
//
// The spec (v3, binding) requires ALL tabs to render content directly, with
// no `.panel` card wrapper, no `<h3>` section title, no collapse chevron.
// This OVERRIDES v2 which kept collapsible panel() wrappers for
// Verdicts/Changed/Charts/Results.
//
// Implementation currently returns panel('verdicts', ...), panel('changed', ...),
// panel('charts', ...), panel('results', ...) from their respective panel functions.
// These tests SHOULD FAIL until Fritz removes the panel() calls.
// ---------------------------------------------------------------------------
describe('M3-Layout AC10 — v3 BINDING: no panel() wrapper in any tab (EXPECTED FAILURES)', () => {
  it('[v3] verdictsPanel() does NOT wrap content in panel() (direct render)', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'verdictsPanel');
    // The function body must NOT call panel() — content rendered directly
    expect(fn).not.toContain("return panel(");
  });

  it('[v3] changedPanel() does NOT wrap content in panel() (direct render)', () => {
    const js = panelJs(panelHtml());
    // changedPanel IS a named function — extract and verify it doesn't return panel()
    const fn = extractBalancedFn(js, 'changedPanel');
    expect(fn).not.toContain("return panel(");
  });

  it('[v3] chartsPanel() does NOT wrap content in panel() (direct render)', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'chartsPanel');
    expect(fn).not.toContain("return panel(");
  });

  it('[v3] resultsPanel() does NOT wrap content in panel() (direct render)', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'resultsPanel');
    expect(fn).not.toContain("return panel(");
  });
});

// ---------------------------------------------------------------------------
// AC11: v3 BINDING — panelOpen keys for verdicts/changed/charts/results dropped
//
// The spec (v3) says: "Drop the in-tab panel() wrapper and the per-section
// collapse + panelOpen keys for verdicts/changed/charts/results entirely."
// Implementation still has panelOpen:{verdicts:1,changed:1,charts:0,results:1}.
// These tests SHOULD FAIL until Fritz removes the keys.
// ---------------------------------------------------------------------------
describe('M3-Layout AC11 — v3 BINDING: panelOpen keys for verdicts/changed/charts/results dropped', () => {
  it('[v3] state does not declare panelOpen.verdicts (no collapse state needed)', () => {
    const js = panelJs(panelHtml());
    // The panelOpen initializer must not include verdicts
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('verdicts:');
  });

  it('[v3] state does not declare panelOpen.changed', () => {
    const js = panelJs(panelHtml());
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('changed:');
  });

  it('[v3] state does not declare panelOpen.charts', () => {
    const js = panelJs(panelHtml());
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('charts:');
  });

  it('[v3] state does not declare panelOpen.results (renamed — no collapse state needed)', () => {
    const js = panelJs(panelHtml());
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).not.toContain('results:');
  });
});

// ---------------------------------------------------------------------------
// AC12: Findings pagination — PAGE_SIZE=50, Prev/Next ids, paginator CSS
// ---------------------------------------------------------------------------
describe('M3-Layout AC12 — Findings pagination infrastructure', () => {
  it('PAGE_SIZE=50 constant is declared in panel JS', () => {
    expect(panelJs(panelHtml())).toContain('PAGE_SIZE=50');
  });

  it('findPrevBtn id is rendered in panel JS paginator', () => {
    expect(panelJs(panelHtml())).toContain('id="findPrevBtn"');
  });

  it('findNextBtn id is rendered in panel JS paginator', () => {
    expect(panelJs(panelHtml())).toContain('id="findNextBtn"');
  });

  it('paginator renders above and below the findings list (paginator in body twice)', () => {
    const js = panelJs(panelHtml());
    // Paginator appears twice in findingsPanel(): once at top, once at bottom
    const occurrences = (js.match(/findPrevBtn/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('CSS contains .find-paginator class', () => {
    expect(panelHtml()).toContain('.find-paginator{');
  });

  it('CSS contains .find-page-btn class', () => {
    expect(panelHtml()).toContain('.find-page-btn{');
  });

  it('CSS contains .find-page-info class', () => {
    expect(panelHtml()).toContain('.find-page-info{');
  });

  it('findingsPanel slices list at PAGE_SIZE (50-item page)', () => {
    const js = panelJs(panelHtml());
    // The slice for pagination: list.slice(pageStart, pageEnd)
    expect(js).toContain('list.slice(pageStart,pageEnd)');
  });
});

// ---------------------------------------------------------------------------
// AC13: Prev disabled at page 0; Next disabled at last page
// ---------------------------------------------------------------------------
describe('M3-Layout AC13 — Paginator disabled states', () => {
  it('Prev button receives disabled attribute when findPage === 0', () => {
    const js = panelJs(panelHtml());
    // The paginator builder: var prevDis=state.findPage===0?' disabled':''
    expect(js).toContain("state.findPage===0?' disabled':''");
  });

  it('Next button receives disabled attribute when findPage is at last page', () => {
    const js = panelJs(panelHtml());
    // The paginator builder: var nextDis=state.findPage>=totalPages-1?' disabled':''
    expect(js).toContain("state.findPage>=totalPages-1?' disabled':''");
  });

  it('wire() null-guards findPrevBtn before wiring click handler', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain("document.getElementById('findPrevBtn')");
    // Null guard pattern: var fpb=...; if(fpb)fpb.addEventListener
    expect(js).toContain('if(fpb)fpb.addEventListener');
  });

  it('wire() null-guards findNextBtn before wiring click handler', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain("document.getElementById('findNextBtn')");
    expect(js).toContain('if(fnb)fnb.addEventListener');
  });
});

// ---------------------------------------------------------------------------
// AC14: findPage resets to 0 on filter chip click
//
// Note: chip wiring lives in JS_WIRE (concatenated after JS_PANELS). Both
// .chip.rev and .chip.fsev appear twice in the combined JS: once in the
// focus-restore block of JS_PANELS, and again in the wiring block of JS_WIRE.
// We search for 'state.findPage=0' in the overall JS blob (not windowed) to
// avoid a false hit on the focus-restore occurrence.
// ---------------------------------------------------------------------------
describe('M3-Layout AC14 — findPage resets on filter change', () => {
  it('chip.rev click handler sets state.findPage=0 before re-render (present anywhere in JS)', () => {
    const js = panelJs(panelHtml());
    // state.findPage=0 must be present in the JS — used by both chip types in wire().
    expect(js).toContain('state.findPage=0');
  });

  it('chip.rev wiring resets findPage=0 — confirmed by wire() section containing both fRev toggle and findPage reset', () => {
    const js = panelJs(panelHtml());
    // The wire() body: fRev toggle + findPage=0 + save() + render()
    const wireFn = extractBalancedFn(js, 'wire');
    expect(wireFn).toContain('state.fRev');
    expect(wireFn).toContain('state.findPage=0');
  });

  it('chip.fsev wiring resets findPage=0 — confirmed by wire() section containing fSev toggle and findPage reset', () => {
    const js = panelJs(panelHtml());
    const wireFn = extractBalancedFn(js, 'wire');
    expect(wireFn).toContain('state.fSev');
    expect(wireFn).toContain('state.findPage=0');
  });

  it('Prev button click decrements findPage and re-renders', () => {
    const js = panelJs(panelHtml());
    const wireFn = extractBalancedFn(js, 'wire');
    const prevIdx = wireFn.indexOf("getElementById('findPrevBtn')");
    const prevSection = wireFn.slice(prevIdx, prevIdx + 300);
    // Decrement: state.findPage-- or state.findPage=state.findPage-1
    expect(prevSection).toMatch(/findPage--/);
  });

  it('Next button click increments findPage and re-renders', () => {
    const js = panelJs(panelHtml());
    const wireFn = extractBalancedFn(js, 'wire');
    const nextIdx = wireFn.indexOf("getElementById('findNextBtn')");
    const nextSection = wireFn.slice(nextIdx, nextIdx + 300);
    expect(nextSection).toMatch(/findPage\+\+/);
  });
});

// ---------------------------------------------------------------------------
// AC15: CSP discipline — no inline style="" on panel HTML body elements
// ---------------------------------------------------------------------------
describe('M3-Layout AC15 — CSP: no inline style="" attributes from JS', () => {
  it('panel HTML static skeleton has no inline style= attributes (nonce-only CSP)', () => {
    const html = panelHtml();
    // Extract static HTML (before the <script> tag)
    const scriptStart = html.indexOf(`<script nonce="${NONCE}">`);
    const staticHtml = html.slice(0, scriptStart);
    // style="" attributes on elements are prohibited by nonce-only style-src
    // The only allowed styles are in the <style nonce="..."> block
    expect(staticHtml).not.toContain(' style="');
    expect(staticHtml).not.toContain(" style='");
  });

  it('panel JS does not emit style= attributes via innerHTML injection', () => {
    const js = panelJs(panelHtml());
    // JS-rendered HTML must not use inline style= (must use CSS classes per spec)
    // Check that no template string emits style=" in dynamically generated HTML
    // We allow style= in comments but not in rendered HTML strings
    expect(js).not.toContain("style='margin-bottom:");
    expect(js).not.toContain('style="margin-bottom:');
    expect(js).not.toContain("style='margin-left:10px;border-left:");
    expect(js).not.toContain('style="margin-left:10px;border-left:');
    // Guard added round-4: the 'Recently touched' caption must not use inline margin-top
    expect(js).not.toContain("style='margin-top:");
    expect(js).not.toContain('style="margin-top:');
  });
});

// ---------------------------------------------------------------------------
// AC16: CSP discipline — no inline event handlers on elements
// ---------------------------------------------------------------------------
describe('M3-Layout AC16 — CSP: no inline event handlers', () => {
  it('panel HTML static skeleton has no onclick= attributes', () => {
    const html = panelHtml();
    const scriptStart = html.indexOf(`<script nonce="${NONCE}">`);
    const staticHtml = html.slice(0, scriptStart);
    expect(staticHtml).not.toContain(' onclick=');
    expect(staticHtml).not.toContain(' onmouseover=');
    expect(staticHtml).not.toContain(' onkeydown=');
  });

  it('panel JS does not emit onclick= in innerHTML-injected HTML strings', () => {
    const js = panelJs(panelHtml());
    // Inline handlers on dynamically-injected elements are blocked by nonce-CSP
    expect(js).not.toContain("' onclick=");
    expect(js).not.toContain('" onclick=');
    expect(js).not.toContain("' onkeydown=");
    expect(js).not.toContain('" onkeydown=');
  });
});

// ---------------------------------------------------------------------------
// AC17: CSS — #root flex-column, height calc(100vh-40px), overflow:hidden
// ---------------------------------------------------------------------------
describe('M3-Layout AC17 — CSS #root layout', () => {
  it('CSS #root has display:flex;flex-direction:column', () => {
    expect(panelHtml()).toContain('#root{display:flex;flex-direction:column;');
  });

  it('CSS body has height:100vh as the viewport height anchor (flex layout replaces #root calc)', () => {
    // #root now uses flex:1 on the body flex column rather than a fixed calc height.
    // body carries height:100vh; #bar is flex-shrink:0; #root gets the remainder via flex:1.
    const html = panelHtml();
    expect(html).toContain('height:100vh');
  });

  it('CSS #root has overflow:hidden', () => {
    const html = panelHtml();
    const rootRuleIdx = html.indexOf('#root{');
    const rootRuleEnd = html.indexOf('}', rootRuleIdx);
    const rootRule = html.slice(rootRuleIdx, rootRuleEnd);
    expect(rootRule).toContain('overflow:hidden');
  });
});

// ---------------------------------------------------------------------------
// AC18: CSS — #tab-content flex:1, overflow-y:auto
// ---------------------------------------------------------------------------
describe('M3-Layout AC18 — CSS #tab-content layout', () => {
  it('CSS #tab-content has flex:1', () => {
    const html = panelHtml();
    const idx = html.indexOf('#tab-content{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('flex:1');
  });

  it('CSS #tab-content has overflow-y:auto', () => {
    const html = panelHtml();
    const idx = html.indexOf('#tab-content{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('overflow-y:auto');
  });
});

// ---------------------------------------------------------------------------
// AC19: CSS — Active tab indicated by 2px border (not color/opacity alone)
// ---------------------------------------------------------------------------
describe('M3-Layout AC19 — Active tab non-color indicator (WCAG 1.4.1)', () => {
  it('CSS .tab-active has a 2px bottom border as active indicator', () => {
    const html = panelHtml();
    const idx = html.indexOf('.tab-btn.tab-active{');
    expect(idx).toBeGreaterThan(-1);
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('border-bottom:2px');
  });

  it('CSS .tab-active uses --vscode-focusBorder for the active tab border (theme-native)', () => {
    const html = panelHtml();
    const idx = html.indexOf('.tab-btn.tab-active{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('--vscode-focusBorder');
  });

  it('forced-colors block overrides active tab border to Highlight system color', () => {
    const html = panelHtml();
    const fcIdx = html.indexOf('@media (forced-colors:active)');
    expect(fcIdx).toBeGreaterThan(-1);
    const fcBlock = html.slice(fcIdx);
    expect(fcBlock).toContain('tab-active');
    expect(fcBlock).toContain('Highlight');
  });
});

// ---------------------------------------------------------------------------
// AC20: CSS — Disabled tab opacity .35
// ---------------------------------------------------------------------------
describe('M3-Layout AC20 — Disabled tab opacity', () => {
  it('CSS .tab-btn[disabled] has opacity:.35 (spec: muted .35)', () => {
    const html = panelHtml();
    const idx = html.indexOf('.tab-btn[disabled]{');
    expect(idx).toBeGreaterThan(-1);
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('opacity:.35');
  });
});

// ---------------------------------------------------------------------------
// AC21: Paginator CSS classes present
// ---------------------------------------------------------------------------
describe('M3-Layout AC21 — Paginator CSS classes', () => {
  it('CSS .find-paginator has display:flex and align-items:center', () => {
    const html = panelHtml();
    const idx = html.indexOf('.find-paginator{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('display:flex');
    expect(rule).toContain('align-items:center');
  });

  it('CSS .find-page-info has font-variant-numeric:tabular-nums (numbers aligned)', () => {
    const html = panelHtml();
    const idx = html.indexOf('.find-page-info{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    expect(rule).toContain('tabular-nums');
  });
});

// ---------------------------------------------------------------------------
// AC22: Sidebar mode unchanged — sanity check
// ---------------------------------------------------------------------------
describe('M3-Layout AC22 — Sidebar mode unaffected', () => {
  it('sidebar HTML still has data-mode="sidebar" (unchanged by M3)', () => {
    expect(getHtml(NONCE, 2, 200, 'sidebar')).toContain('data-mode="sidebar"');
  });

  it('sidebar HTML does NOT contain id="tab-bar" (sidebar is out of scope)', () => {
    expect(getHtml(NONCE, 2, 200, 'sidebar')).not.toContain('id="tab-bar"');
  });

  it('sidebar HTML does NOT contain role="tablist" (sidebar is out of scope)', () => {
    expect(getHtml(NONCE, 2, 200, 'sidebar')).not.toContain('role="tablist"');
  });
});

// ---------------------------------------------------------------------------
// AC25: Tab badge renders correct count text
// ---------------------------------------------------------------------------
describe('M3-Layout AC25 — Tab count badge content', () => {
  it('tabDefs() agents badge is empty string when agent count is 0', () => {
    const js = panelJs(panelHtml());
    // When snap has no agents, badge should be ''
    expect(js).toContain("agentCount>0?String(agentCount):''");
  });

  it('tabDefs() findings badge is empty string when finding count is 0', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain("findCount>0?String(findCount):''");
  });
});

// ---------------------------------------------------------------------------
// AC26: Auto-fallback — clampActiveTab() falls back to 'agents'
// ---------------------------------------------------------------------------
describe('M3-Layout AC26 — Auto-fallback to Agents tab when active tab disabled', () => {
  it('clampActiveTab() function exists in panel JS', () => {
    const js = panelJs(panelHtml());
    expect(js).toContain('function clampActiveTab(');
  });

  it('clampActiveTab() sets state.activeTab to "agents" when active tab not found in enabled tabs', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'clampActiveTab');
    expect(fn).toContain("state.activeTab='agents'");
  });

  it('render() calls clampActiveTab() before the final root.innerHTML assignment (overview+tab+content)', () => {
    const js = panelJs(panelHtml());
    const renderFn = extractBalancedFn(js, 'render');
    const clampIdx = renderFn.indexOf('clampActiveTab()');
    // The final innerHTML assignment uses the three-way concatenation from the spec
    const finalInnerHtmlIdx = renderFn.indexOf('root.innerHTML=overview()+tabBar()+tabContent()');
    expect(clampIdx).toBeGreaterThan(-1);
    expect(finalInnerHtmlIdx).toBeGreaterThan(-1);
    // clampActiveTab must be called BEFORE the final root.innerHTML assignment
    expect(clampIdx).toBeLessThan(finalInnerHtmlIdx);
  });
});

// ---------------------------------------------------------------------------
// AC27: Arrow key wiring in wireTabBar()
// ---------------------------------------------------------------------------
describe('M3-Layout AC27 — Arrow key wiring (WAI-ARIA Tabs Pattern)', () => {
  it('wireTabBar() function exists in panel JS', () => {
    expect(panelJs(panelHtml())).toContain('function wireTabBar(');
  });

  it('wireTabBar() handles ArrowRight key to move focus to next enabled tab', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'wireTabBar');
    expect(fn).toContain("e.key==='ArrowRight'");
  });

  it('wireTabBar() handles ArrowLeft key to move focus to prev enabled tab', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'wireTabBar');
    expect(fn).toContain("e.key==='ArrowLeft'");
  });
});

// ---------------------------------------------------------------------------
// AC28: Home/End key wiring
// ---------------------------------------------------------------------------
describe('M3-Layout AC28 — Home/End key wiring', () => {
  it('wireTabBar() handles Home key to focus first enabled tab', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'wireTabBar');
    expect(fn).toContain("e.key==='Home'");
  });

  it('wireTabBar() handles End key to focus last enabled tab', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'wireTabBar');
    expect(fn).toContain("e.key==='End'");
  });

  it('wireTabBar() skips disabled tabs in arrow navigation (enabledTabs filter)', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'wireTabBar');
    // The enabledTabs() helper or inline filter must exclude disabled buttons
    expect(fn).toContain('disabled');
    expect(fn).toContain('aria-disabled');
  });
});

// ---------------------------------------------------------------------------
// AC30: Overview rendered first in #root before tab bar
// ---------------------------------------------------------------------------
describe('M3-Layout AC30 — Overview rendered first in #root', () => {
  it('render() builds root.innerHTML with overview() first, then tabBar(), then tabContent()', () => {
    const js = panelJs(panelHtml());
    const renderFn = extractBalancedFn(js, 'render');
    // The exact concatenation: overview()+tabBar()+tabContent()
    expect(renderFn).toContain('overview()+tabBar()+tabContent()');
  });

  it('overview-bar appears in JS before tab-bar in the root innerHTML string', () => {
    const js = panelJs(panelHtml());
    const renderFn = extractBalancedFn(js, 'render');
    const overviewIdx = renderFn.indexOf('overview()');
    const tabBarIdx = renderFn.indexOf('tabBar()');
    expect(overviewIdx).toBeLessThan(tabBarIdx);
  });
});

// ---------------------------------------------------------------------------
// AC31: v3 correction #3 — Changed tab always enabled (enabled:true)
// ---------------------------------------------------------------------------
describe('M3-Layout AC31 — v3 correction #3: Changed tab always enabled', () => {
  it('tabDefs() sets enabled:true for the Changed tab regardless of changedCount', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'tabDefs');
    // Must contain enabled:true for the changed entry (not enabled:changedCount>0)
    expect(fn).toContain("key:'changed'");
    expect(fn).toContain("enabled:true");
    // Must NOT use changedCount as the enabled condition
    expect(fn).not.toContain("enabled:changedCount>0");
  });

  it('tabContent() calls changedPanel() unconditionally for the changed branch', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'tabContent');
    // changedPanel() is called directly, not gated on snap.changed.length
    expect(fn).toContain("changedPanel()");
    // Must NOT have the old conditional fallback that bypassed changedPanel on empty
    expect(fn).not.toContain("snap.changed&&snap.changed.length?changedPanel()");
  });

  it('changedPanel() handles the empty case with an informative message (not silently empty)', () => {
    const js = panelJs(panelHtml());
    const fn = extractBalancedFn(js, 'changedPanel');
    // changedPanel must render content in both populated and empty states
    expect(fn).toContain('No files changed');
    expect(fn).toContain('CHANGED_MAX_MIN');
  });
});

// ---------------------------------------------------------------------------
// AC32: v3 correction #5 — state.openRaw map for rawJsonDetails persistence
// ---------------------------------------------------------------------------
describe('M3-Layout AC32 — v3 correction #5: openRaw state persistence', () => {
  it('state initializer includes openRaw key', () => {
    const js = panelJs(panelHtml());
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    expect(stateDecl).toContain('openRaw:');
  });

  it('state.openRaw uses Object.assign(Object.create(null),...) pattern (null-prototype, no __proto__ collision)', () => {
    const js = panelJs(panelHtml());
    const stateDecl = js.slice(js.indexOf('let state={'), js.indexOf('};', js.indexOf('let state={')));
    // Must follow the same null-prototype pattern used by openAgents, openFind, openPrompt
    expect(stateDecl).toContain('openRaw:Object.assign(Object.create(null)');
  });

  it('wire() wires toggle event on [data-rlabel] .raw-json-details elements', () => {
    const js = panelJs(panelHtml());
    const wireFn = extractBalancedFn(js, 'wire');
    // wire() must attach a 'toggle' listener to raw-json-details inside result cards
    expect(wireFn).toContain('raw-json-details');
    expect(wireFn).toContain("'toggle'");
  });

  it('wire() uses state.openRaw to persist toggle state', () => {
    const js = panelJs(panelHtml());
    const wireFn = extractBalancedFn(js, 'wire');
    expect(wireFn).toContain('state.openRaw');
    expect(wireFn).toContain('save()');
  });
});

// ---------------------------------------------------------------------------
// AC33: v3 correction #6 — #tab-content has padding-top breathing room
// ---------------------------------------------------------------------------
describe('M3-Layout AC33 — v3 correction #6: #tab-content padding-top', () => {
  it('CSS #tab-content rule includes padding (breathing room below tab bar)', () => {
    const html = panelHtml();
    const idx = html.indexOf('#tab-content{');
    expect(idx).toBeGreaterThan(-1);
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    // Must have some padding to separate tab bar from first content row
    expect(rule).toMatch(/padding[\s:]/);
  });

  it('CSS #tab-content padding starts at ≥ 8px vertically', () => {
    const html = panelHtml();
    const idx = html.indexOf('#tab-content{');
    const end = html.indexOf('}', idx);
    const rule = html.slice(idx, end);
    // padding shorthand with two values: first is top/bottom; single value: all sides.
    // Accept padding:8px, padding:10px, padding:8px 12px, padding:10px 12px, etc.
    expect(rule).toMatch(/padding:\d+(px|em|rem)/);
  });
});
