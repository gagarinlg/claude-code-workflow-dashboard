// Webview CSS constants for the Claude Code Workflow Dashboard.
//
// Extracted from html.ts (M2-polish round-5) to keep that module under the
// 400-line limit. html.ts imports and assembles these into the <style> tag.
// All rules use --vscode-* CSS variables (no hardcoded colors per CLAUDE.md).

// ---------------------------------------------------------------------------
// Full-panel CSS — editor panel / webview panel mode.
// ---------------------------------------------------------------------------
// CSS is an opaque template string — theme-native via --vscode-* vars.
export const CSS = `
*{box-sizing:border-box}
body{margin:0;font:13px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-editor-background);display:flex;flex-direction:column;height:100vh;overflow:hidden}
.dim{opacity:.6}.pad{padding:14px}.grow{flex:1}
#bar{flex-shrink:0;display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);z-index:5}
#title{font-weight:600}
/* Uniform button height: line-height:1 collapses leading so glyph entities (⛐ ↧ ⤢ 📖)
   don't inflate the button box. min-height provides a stable tap target regardless of content.
   display:inline-flex + align-items:center keeps label+glyph vertically centred without relying
   on line-height of individual glyph characters. */
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;padding:3px 9px;cursor:pointer;display:inline-flex;align-items:center;gap:4px;line-height:1;min-height:22px;vertical-align:middle;white-space:nowrap}
button:hover{background:var(--vscode-button-hoverBackground)}
button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
input[type=checkbox]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.chip:focus-visible,[tabindex="0"]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.panel{margin:12px;border:1px solid var(--vscode-panel-border);border-radius:8px;overflow:visible}
/* Panel section header — the h3 provides heading-level landmark navigation for AT.
   The interactive collapse toggle is a <button> nested inside the h3 so screen readers
   see both a heading (for H-key navigation) and a button (for interactive control).
   cursor:pointer is intentionally NOT on the h3: the button fills the full h3 hit area
   (flex:1) so there is no unclickable gap in the header. A pointer on the h3 outside
   the button would be a visual lie (clicks outside the button area are not handled).
   The button itself has cursor:pointer from the global button rule. */
.panel>h3{margin:0;padding:0;background:var(--vscode-sideBarSectionHeader-background);font-size:12px;letter-spacing:.04em;text-transform:uppercase;border-bottom:1px solid var(--vscode-panel-border);display:flex;align-items:stretch}
/* The button fills the full h3 hit area and carries the interactive role. */
.panel>h3>button{flex:1;background:none;border:none;border-radius:0;padding:8px 12px;color:inherit;font:inherit;font-size:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;user-select:none;display:flex;align-items:center;gap:6px;text-align:left;min-height:unset}
.panel>h3>button:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
/* Keep the h3:focus-visible rule so keyboard users tabbing directly to h3 still see a ring
   (redundant in practice since the button captures focus, but satisfies existing tests). */
.panel>h3:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
/* Panel collapse chevron — rotates 90° when panel is open. Consistent with card-chevron timing. */
.panel-chevron{font-size:10px;opacity:.6;transition:transform 120ms ease;flex-shrink:0}
/* Chevron points right (▶) when collapsed; rotates 90° to point down (▼) when expanded. */
.panel:not(.collapsed) .panel-chevron{transform:rotate(90deg)}
/* When panel is collapsed, hide the body. Border-bottom on h3 also hidden (no content below). */
.panel.collapsed>.body{display:none}
.panel.collapsed>h3{border-bottom:none}
.panel>.body{padding:10px 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px}
.card{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:8px 10px;background:var(--vscode-editorWidget-background)}
.card.run{border-color:var(--vscode-charts-green,#3fb950)}
.card.dead{opacity:.65}
.row{display:flex;align-items:center;gap:8px;cursor:pointer}
.role{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.st{font-size:11px;padding:1px 6px;border-radius:10px}
.st.run{background:rgba(63,185,80,.2);color:var(--vscode-charts-green,#3fb950)}
.st.done{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.st.dead{background:rgba(248,81,73,.18);color:var(--vscode-charts-red,#f85149)}
.kpis{display:flex;gap:16px;flex-wrap:wrap;font-size:12px}
.kpi b{font-size:18px;font-variant-numeric:tabular-nums}
.activity{margin-top:6px;font-size:11px;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{margin-top:8px;border-top:1px dashed var(--vscode-panel-border);padding-top:8px;display:none;max-height:340px;overflow:auto;scrollbar-gutter:stable}
.card.open .sub{display:block}
.ev{font-family:var(--vscode-editor-font-family);font-size:11px;padding:3px 0;border-bottom:1px solid var(--vscode-panel-border);white-space:pre-wrap;word-break:break-word}
.ev.tool{opacity:.7}

.sev{font-size:11px;font-weight:600;padding:1px 6px;border-radius:4px;margin-right:4px;display:inline-block;vertical-align:middle}
/* Severity badge colors use VS Code chart variables so they adapt to light/dark/high-contrast
   themes. The rgba() background tint + border pattern matches VS Code's own severity chips.
   Per CLAUDE.md convention, hardcoded colors are forbidden; the rgba() tints here are
   semi-transparent overlays (15-20% alpha) that pair with --vscode-* foreground/border vars
   and are overridden by the @media (forced-colors:active) block below for high-contrast themes. */
.CRITICAL{background:rgba(248,81,73,.15);color:var(--vscode-charts-red,#f85149);border:1px solid var(--vscode-charts-red,#f85149)}
.HIGH{background:rgba(210,100,50,.15);color:var(--vscode-charts-orange,#d26432);border:1px solid var(--vscode-charts-orange,#d26432)}
.MEDIUM{background:rgba(220,170,0,.15);color:var(--vscode-charts-yellow,#dcaa00);border:1px solid var(--vscode-charts-yellow,#dcaa00)}
.LOW{background:rgba(63,135,185,.15);color:var(--vscode-charts-blue,#3f87b9);border:1px solid var(--vscode-charts-blue,#3f87b9)}
.NITPICK{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.UNRATED{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.ok{color:var(--vscode-charts-green,#3fb950)}.bad{color:var(--vscode-charts-red,#f85149)}
.finding{border:1px solid var(--vscode-panel-border);border-radius:6px;padding:6px 9px;margin-bottom:6px}
.finding .ttl[tabindex]{cursor:pointer}
.finding .detail{display:none;margin-top:6px;font-size:12px}
.finding.open .detail{display:block}
.finding .loc{font-family:var(--vscode-editor-font-family);opacity:.7;font-size:11px}
.filters{margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap}
/* WCAG 1.4.1: chips must not rely on opacity/color alone to convey active state.
   Active chips: solid 2px border + bold text (non-color shape indicator).
   Inactive chips: dashed 1px border + reduced opacity (shape + opacity combined).
   This satisfies 1.4.1 because a greyscale user still sees solid vs dashed border. */
.chip{font-size:11px;padding:2px 8px;border-radius:12px;cursor:pointer;border:1px solid var(--vscode-panel-border)}
.chip:not(.off){background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:2px solid var(--vscode-button-background);font-weight:600}
.chip.off{opacity:.5;border-style:dashed}
.files{padding:0;margin:0;list-style:none}
.files li{font-family:var(--vscode-editor-font-family);font-size:11px;list-style:none}
pre{margin:0;font-family:var(--vscode-editor-font-family);font-size:11px;white-space:pre-wrap;word-break:break-word}
/* Non-collapsible result items: override the pointer cursor set by .finding .ttl[tabindex]
   so users are not misled into thinking the row is interactive. */
.finding.result .ttl{cursor:default}
/* Explicit focus rule for collapsible finding/result titles — documents intent and
   survives future refactors that might remove the generic [tabindex="0"] selector. */
.finding .ttl:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
/* Empty-state action button row — gap-based layout prevents inline margin fragility. */
.empty-actions{display:flex;gap:6px;margin-top:10px}
/* Agents-cap warning banner — themed border/color; extracted from inline style. */
.cap-warn{margin-bottom:6px;padding:4px 8px;border:1px solid var(--vscode-inputValidation-warningBorder,var(--vscode-panel-border));color:var(--vscode-inputValidation-warningForeground,var(--vscode-foreground));border-radius:4px}
/* Clear-filters button pushed to the right of the filter bar via flex. */
.filters .clear-btn{margin-left:auto}
/* Empty-filtered-findings recovery block: column flex, gap, margin-top so the
   "Clear filters" button is clearly separated from the explanatory message and
   visually prominent as the primary recovery action. */
.findings-empty{display:flex;flex-direction:column;gap:8px;margin-top:8px}
.findings-empty-msg{font-size:12px;opacity:.7}
/* In the empty-filtered state the Clear-filters button is a full-size primary
   action (not the small inline clear-btn used in the filter bar). */
.findings-empty-btn{align-self:flex-start;font-size:12px;padding:5px 14px}
/* Visual separator between reviewer and severity chip groups in the filter bar.
   Using a CSS class instead of inline style allows theme overrides. */
.filter-sep{margin-left:10px;border-left:1px solid var(--vscode-panel-border);padding-left:10px}
/* Visible group dimension label before each chip group (e.g. "Reviewer", "Severity").
   Small, uppercase, muted — informational but not dominant. Keeps sighted users oriented
   without requiring them to infer the filter dimension from chip content alone. */
.filter-group-label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;padding:2px 4px 2px 0;white-space:nowrap;opacity:.7;align-self:center}
/* Pass-group heading: structural, not dimmed metadata. Distinct from .dim. */
.pass-heading{margin:6px 0;font-size:12px;font-weight:600}
/* Verdict item row spacing — extracted from inline style for theme compatibility. */
.verdict-item{margin-bottom:6px}
/* Overview severity badge row spacing — extracted from inline style. */
.overview-sev-row{margin-top:8px}
/* Cards instructional hint text — inline span beside Collapse-all/Expand-all in .agent-panel-hdr.
   No margin-bottom needed: .agent-panel-hdr handles spacing. */
.cards-hint{font-size:11px}
/* Finding fix detail top margin — extracted from inline style. */
.finding-fix{margin-top:4px}
/* Changed-files panel caption — extracted from inline style. */
.changed-caption{font-size:11px;margin-bottom:6px}
/* Secondary changed-caption (the mtime-based 'Recently touched' label) needs a top
   margin to separate it from the preceding agent-reported list. Uses a modifier class
   instead of inline style= (nonce-only CSP blocks style= on innerHTML-injected elements). */
.changed-caption-mt{margin-top:10px}
/* M2-AgentFold: card header chevron — visible fold/unfold affordance.
   The chevron rotates 90° when the card is open. Transition matches the
   prompt-disc-chevron so all disclosures feel consistent. */
.card-chevron{font-size:11px;opacity:.6;transition:transform 120ms ease;margin-right:4px;flex-shrink:0}
.card.open .card-chevron{transform:rotate(90deg)}
/* Agent panel header bar: holds Collapse-all/Expand-all + the hint text inline.
   flex + align-items:center keeps the button and hint on one line. */
.agent-panel-hdr{display:flex;align-items:center;gap:8px;margin-bottom:8px}
/* Collapse-all / Expand-all toggle button in the agents panel header.
   Uses secondary button styling to visually distinguish from primary actions. */
.agent-fold-btn{font-size:11px;padding:2px 7px}
/* Agent card metrics bar — token/tool-call counts, theme-native. */
.agent-metrics{font-size:11px;opacity:.75;margin-top:2px;display:flex;flex-wrap:wrap;gap:2px 4px}
.agent-metric{font-variant-numeric:tabular-nums}
.agent-metric-sep{opacity:.5}
/* Prompt disclosure — collapsible <details>-style section inside an agent card.
   Uses a themed border + background so it is visually distinct from the activity
   tail without adding hardcoded colors. The <pre> cap limits visible height while
   remaining scrollable; word-break ensures very long lines (e.g. JSON) wrap. */
.prompt-disc{margin-top:8px;border-top:1px dashed var(--vscode-panel-border);padding-top:6px}
/* prompt-disc-hdr is a <button> but must look like an inline label, not a button widget.
   Override the global button background/padding/border-radius so it renders flush with
   the surrounding card content. Real <button> gives us Enter/Space activation and correct
   AT focus management without manual keyboard wiring (unlike the former div+role=button). */
.prompt-disc-hdr{display:flex;align-items:center;gap:6px;cursor:pointer;font-size:11px;font-weight:600;user-select:none;background:none;border:none;border-radius:0;padding:0;color:inherit;width:100%;text-align:left}
.prompt-disc-hdr:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.prompt-disc-chevron{font-size:10px;opacity:.7;transition:transform 120ms ease}
.prompt-disc.open .prompt-disc-chevron{transform:rotate(90deg)}
.prompt-disc-body{display:none;margin-top:6px}
.prompt-disc.open .prompt-disc-body{display:block}
.prompt-pre{max-height:280px;overflow:auto;padding:6px 8px;background:var(--vscode-textBlockQuote-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);border-radius:4px;font-family:var(--vscode-editor-font-family);font-size:11px;white-space:pre-wrap;word-break:break-word;margin:0}
.prompt-copy-btn{font-size:10px;padding:2px 7px;margin-top:4px}
/* M2-TypedResults: typed result display elements.
   All colors use --vscode-* variables (no hardcoded hex). */
.typed-result{font-size:12px}
.typed-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:4px 0}
.typed-kv-key{font-family:var(--vscode-editor-font-family);font-size:11px;opacity:.6;white-space:nowrap;padding:1px 0}
.typed-kv-val{font-size:12px;padding:1px 0;word-break:break-word}
.typed-file-list{padding:0;margin:4px 0;list-style:none}
.typed-file{font-family:var(--vscode-editor-font-family);font-size:11px;padding:1px 0;word-break:break-word}
.typed-gap{font-size:12px;padding:1px 0;word-break:break-word}
.typed-gap::before{content:"• ";opacity:.5}
.typed-section-label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin:8px 0 3px}
.typed-verdict-ok{color:var(--vscode-charts-green,#3fb950);font-weight:600}
.typed-verdict-bad{color:var(--vscode-charts-red,#f85149);font-weight:600}
.typed-verdict-neutral{font-weight:600;opacity:.75}
.typed-bool-chips{display:flex;flex-wrap:wrap;gap:4px;margin:4px 0}
.typed-bool-chip{font-size:11px;font-variant-numeric:tabular-nums;padding:1px 7px;border-radius:10px;border:1px solid var(--vscode-panel-border)}
.typed-bool-chip.typed-verdict-ok{border-color:var(--vscode-charts-green,#3fb950)}
.typed-bool-chip.typed-verdict-bad{border-color:var(--vscode-charts-red,#f85149)}
.typed-finding{margin-bottom:4px;word-break:break-word}
.typed-finding-detail{margin-top:4px;font-size:12px;word-break:break-word;overflow-wrap:break-word}
.typed-score{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums}
.typed-summary{font-size:12px;padding:4px 0;border-left:2px solid var(--vscode-panel-border);padding-left:6px;margin:4px 0;opacity:.85}
/* Charts panel — two inline-SVG charts side by side (bar + trend).
   Each chart scrolls independently in overflow-x:auto so wide content (50+ agents)
   never overflows the page body. No external refs: all SVG is hand-rolled. */
.charts-row{display:flex;gap:16px;flex-wrap:wrap}
.chart-block{flex:1;min-width:0}
.chart-title{font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;opacity:.7;margin-bottom:6px}
.chart-scroll{overflow-x:auto;overflow-y:hidden}
.chart-empty{font-size:11px;opacity:.5;padding:6px 0}
/* KPI sub-label (e.g. 'no activity >3m' under Stalled) — extracted from inline style. */
.kpi-sublabel{font-size:10px}
/* Stalled KPI bold weight when count > 0 — extracted from inline style; shape signal independent of color. */
.kpi-stalled-active{font-weight:700}
/* Bar chart capped-agents note — extracted from inline style. */
.chart-cap-note{font-size:10px;margin-top:4px}
/* SVG chart element classes — replace inline style attributes on chart SVG elements.
   CLAUDE.md: no hardcoded colors; all values use --vscode-* CSS variables with fallbacks.
   Extracting to CSS classes allows the forced-colors @media block to override them — inline
   style attributes have higher specificity in normal mode and would resist class overrides,
   but forced-colors UA stylesheet wins regardless; using classes is the consistent pattern. */
.chart-bar{fill:var(--vscode-charts-blue,var(--vscode-editor-selectionBackground))}
.chart-bar-label{fill:var(--vscode-foreground);font-size:10px;font-family:var(--vscode-font-family,sans-serif)}
.chart-val-label{fill:var(--vscode-foreground);opacity:.7;font-size:10px;font-family:var(--vscode-font-family,sans-serif)}
.chart-trend-label{fill:var(--vscode-foreground);opacity:.6;font-size:9px;font-family:var(--vscode-font-family,sans-serif)}
.chart-axis-line{stroke:var(--vscode-panel-border);fill:none;stroke-width:1}
.chart-trend-area{fill:var(--vscode-charts-green);opacity:.12}
.chart-trend-line{stroke:var(--vscode-charts-green);fill:none;stroke-width:1.5}
/* Scrollable container for structured result body — prevents page overflow. */
.result-body{max-height:340px;overflow:auto}
/* AC4: Raw JSON <details> collapsed below the typed view.
   Uses native <details>/<summary> — no JS, CSP-safe. Themed via --vscode-* vars. */
.raw-json-details{margin-top:8px;border-top:1px dashed var(--vscode-panel-border);padding-top:6px}
.raw-json-summary{font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;opacity:.6;cursor:pointer;user-select:none;padding:2px 0}
.raw-json-summary:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.raw-json-body{margin-top:4px}
.raw-json-pre{max-height:200px;overflow:auto;font-family:var(--vscode-editor-font-family);font-size:10px;white-space:pre;padding:4px 6px;background:var(--vscode-textBlockQuote-background,var(--vscode-editor-background));border:1px solid var(--vscode-panel-border);border-radius:3px;margin:0;word-break:break-word}
/* AC4: Implementer markdown report view. */
.impl-report{font-size:12px}
.impl-status{font-weight:600;margin-bottom:4px}
/* Findings paginator: Prev / page-count / Next row above and below the findings list. */
.find-paginator{display:flex;align-items:center;gap:8px;margin:4px 0}
.find-page-btn{font-size:11px;padding:2px 8px}
.find-page-info{font-size:11px;opacity:.7;font-variant-numeric:tabular-nums}
/* Pinned run badge in the editor meta bar — extracted from inline style. */
.pinned-badge{margin-left:6px;font-size:10px;vertical-align:middle}
/* Visually hidden but screen-reader accessible — standard sr-only pattern for aria-describedby targets. */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
/* Empty-state container: a quiet, informative card — theme-native colors only. */
.empty-state{margin:24px 16px;padding:16px 18px;border:1px solid var(--vscode-panel-border);border-radius:8px;background:var(--vscode-editorWidget-background)}
/* Empty-state heading: h3 matches the panel h3 heading level (panel headers are h3).
   Using h2 here (when panels are h3) creates an inconsistent heading hierarchy because
   the empty-state h2 only appears when there is NO data — making h2 the root heading
   in a document whose normal layout uses h3 panel headers. h3 keeps it consistent. */
.empty-state h3{margin:0 0 8px;font-size:14px;font-weight:600;color:var(--vscode-foreground)}
.empty-state .empty-msg{font-family:var(--vscode-editor-font-family);font-size:12px;padding:6px 8px;margin:8px 0;border-radius:4px;background:var(--vscode-textBlockQuote-background,var(--vscode-editor-background));border-left:3px solid var(--vscode-panel-border);overflow-wrap:break-word;word-break:break-word}
.empty-state .empty-hint{font-size:12px;opacity:.75;margin-bottom:4px}
.empty-state .empty-hint b{font-weight:600;opacity:1}
/* Tab bar layout: #bar is flex-shrink:0 on the body flex column; #root takes flex:1.
   #tab-content is the single scrollable region — the page body never grows unbounded. */
#root{display:flex;flex-direction:column;flex:1;overflow:hidden}
/* Always-visible overview KPI strip — no collapse; rendered first inside #root. */
#overview-bar{padding:10px 12px;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);flex-shrink:0}
/* Tab bar: horizontal row of tab buttons below the overview strip. */
#tab-bar{display:flex;gap:0;border-bottom:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);flex-shrink:0;overflow-x:auto}
/* Individual tab button — look like a flat tab, not a raised button. */
.tab-btn{background:none;border:none;border-bottom:2px solid transparent;border-radius:0;padding:6px 14px;cursor:pointer;font-size:12px;color:var(--vscode-foreground);display:inline-flex;align-items:center;gap:5px;white-space:nowrap;min-height:32px;line-height:1;opacity:.7}
.tab-btn:hover{opacity:1;background:var(--vscode-list-hoverBackground)}
.tab-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px}
/* Active tab: 2px --vscode-focusBorder bottom border + bold weight — NOT color/opacity alone.
   This satisfies WCAG 1.4.1 (non-color indicator) and the WAI-ARIA tabs active-tab requirement. */
.tab-btn.tab-active{border-bottom:2px solid var(--vscode-focusBorder);font-weight:700;opacity:1}
/* Disabled tab: muted opacity, not-allowed cursor, non-interactive. */
.tab-btn[disabled]{opacity:.35;cursor:not-allowed}
/* Count badge on Agents and Findings tabs — small pill, themed. */
.tab-badge{font-size:10px;font-variant-numeric:tabular-nums;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);border-radius:8px;padding:1px 5px;min-width:16px;text-align:center}
/* Tab content: scrollable region that fills remaining height in #root flex column.
   padding:10px 12px creates breathing room (10px top+bottom, 12px left+right) between
   the tab bar and the first row of content (Collapse-all button, filter chips) — v3 correction #6. */
#tab-content{flex:1;overflow-y:auto;min-height:0;padding:10px 12px}
/* High-contrast mode overrides: replace semi-transparent rgba() tints with
   solid system-color pairs so severity badges remain visible regardless of theme.
   Also covers typed-verdict colors which use --vscode-charts-* (may not map in HC).
   Chart elements (bar rects, trend paths, chart containers) are explicitly listed so
   they remain visible in Windows High Contrast mode. */
@media (forced-colors:active){
  .CRITICAL,.HIGH,.MEDIUM,.LOW{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  .st.run,.st.dead{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  .typed-verdict-ok,.typed-verdict-bad,.typed-verdict-neutral{color:ButtonText;border:1px solid ButtonText}
  .typed-bool-chip{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  .chart-bar,rect[data-testid="chart-bar"]{fill:ButtonText}
  .charts-row,.chart-block,.chart-scroll{border-color:ButtonText}
  path[data-testid="trend-area"],.chart-trend-area{fill:ButtonFace}
  path[data-testid="trend-line"],.chart-trend-line{stroke:ButtonText}
  .chip:not(.off){background:ButtonFace;border:2px solid ButtonText;color:ButtonText;font-weight:600}
  .chip.off{background:ButtonFace;border:1px dashed GrayText;color:GrayText;opacity:1}
  /* .ok (green for live agents) and .bad (red for stalled) use color-only in normal mode.
     Map to semantic system colors so HC users still see meaningful differentiation. */
  .ok{color:LinkText}.bad{color:Mark}
  /* SVG chart text/axis classes: forced-colors resets fill/stroke; remap to system colors.
     stroke-width and font properties are authored in the class (not inline), so the forced-colors
     UA stylesheet can override fill/stroke while the author values for size/font remain. */
  .chart-bar-label,.chart-val-label,.chart-trend-label{fill:ButtonText;opacity:1}
  .chart-axis-line{stroke:ButtonText;stroke-width:1}
  .chart-trend-line{stroke:ButtonText;stroke-width:1.5}
  /* Active tab indicator: forced-colors mode collapses border colors to ButtonText.
     In high-contrast themes the 2px bottom border on .tab-active must remain visible
     as a distinct indicator — Highlight is the recommended system color for selected
     interactive items (analogous to a selected tab) in forced-colors mode. */
  .tab-btn.tab-active{border-bottom-color:Highlight;border-bottom-width:2px}
  /* Ensure disabled tabs remain clearly muted (GrayText) in HC mode. */
  .tab-btn[disabled]{color:GrayText;border-bottom-color:transparent}
}
/* Respect the user's motion preference (CLAUDE.md: 'respect prefers-reduced-motion').
   All three chevron selectors use transition:transform 120ms ease in normal mode;
   the override removes the animation entirely for users who have opted out of motion. */
@media (prefers-reduced-motion:reduce){
  .panel-chevron,.card-chevron,.prompt-disc-chevron{transition:none}
}
`;


// ---------------------------------------------------------------------------
// Sidebar CSS — compact, no horizontal scroll at default sidebar width (~250px).
// Uses only --vscode-* variables (CLAUDE.md: no hardcoded colors).
// ---------------------------------------------------------------------------
export const CSS_SIDEBAR = `
*{box-sizing:border-box}
body{margin:0;font:12px var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);overflow-x:hidden}
.dim{opacity:.6}.pad{padding:10px}
.sb-header{display:flex;align-items:center;gap:6px;padding:8px 10px 4px;border-bottom:1px solid var(--vscode-panel-border);flex-wrap:wrap;overflow-x:hidden}
.sb-title{font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* Sidebar action buttons: uniform height via min-height + line-height:1 so mixed glyphs
   (⛐ ↧ ⤢) don't inflate individual buttons. The .sb-btn-lbl text is always shown so
   sighted users have a visible label alongside the glyph — icon-only is not accessible
   for non-standard glyphs (↧ for export, ⛐ for run-picker are not universally recognised).
   flex-wrap on .sb-header allows the button row to wrap when the sidebar is very narrow. */
.sb-open-btn{display:inline-flex;align-items:center;gap:3px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:2px 6px;cursor:pointer;font-size:11px;white-space:nowrap;line-height:1;min-height:20px;vertical-align:middle}
.sb-btn-lbl{display:inline}
.sb-open-btn:hover{background:var(--vscode-button-hoverBackground)}
.sb-open-btn:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.sb-section{padding:8px 10px;border-bottom:1px solid var(--vscode-panel-border)}
.sb-section:last-child{border-bottom:none}
.sb-section-title{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;opacity:.6;margin-bottom:5px}
.sb-kpis{display:flex;flex-wrap:wrap;gap:6px 14px}
.sb-kpi{display:flex;flex-direction:column}
.sb-kpi .label{font-size:10px;opacity:.6}
.sb-kpi .val{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.2}
.sb-kpi .val.ok{color:var(--vscode-charts-green,#3fb950)}
.sb-kpi .val.bad{color:var(--vscode-charts-red,#f85149)}
.sev{font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;margin-right:3px;margin-bottom:3px;display:inline-block}
.CRITICAL{background:rgba(248,81,73,.15);color:var(--vscode-charts-red,#f85149);border:1px solid var(--vscode-charts-red,#f85149)}
.HIGH{background:rgba(210,100,50,.15);color:var(--vscode-charts-orange,#d26432);border:1px solid var(--vscode-charts-orange,#d26432)}
.MEDIUM{background:rgba(220,170,0,.15);color:var(--vscode-charts-yellow,#dcaa00);border:1px solid var(--vscode-charts-yellow,#dcaa00)}
.LOW{background:rgba(63,135,185,.15);color:var(--vscode-charts-blue,#3f87b9);border:1px solid var(--vscode-charts-blue,#3f87b9)}
.NITPICK{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.UNRATED{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.sb-agent{display:flex;align-items:baseline;gap:5px;padding:3px 0;border-bottom:1px solid var(--vscode-panel-border);min-width:0}
.sb-agent:last-child{border-bottom:none}
.sb-agent .role{font-weight:600;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.sb-agent .st{font-size:10px;padding:1px 5px;border-radius:8px;flex-shrink:0}
.st.run{background:rgba(63,185,80,.2);color:var(--vscode-charts-green,#3fb950)}
.st.done{background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.st.dead{background:rgba(248,81,73,.18);color:var(--vscode-charts-red,#f85149)}
.sb-phase{font-size:12px;font-weight:600}
.sb-runid{font-size:10px;opacity:.6;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty-state{margin:12px 10px;padding:12px 14px;border:1px solid var(--vscode-panel-border);border-radius:6px;background:var(--vscode-editorWidget-background)}
.empty-state h3{margin:0 0 6px;font-size:12px;font-weight:600}
.empty-state .empty-hint{font-size:11px;opacity:.75}
.empty-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
/* Sidebar empty-state snap.msg paragraph — mirrors full-panel .empty-msg pattern. */
.empty-msg{font-family:var(--vscode-editor-font-family);font-size:10px;overflow-wrap:break-word;word-break:break-word;margin-bottom:4px}
/* Agent list placeholder when no agents are live — extracted from inline style. */
.sb-agent-placeholder{font-size:10px;padding:2px 0}
/* Overflow indicator when more than 5 agents are active — extracted from inline style. */
.sb-agent-overflow{font-size:10px;padding-top:3px}
/* Pinned run badge in the sidebar run-id line — extracted from inline style. */
.sb-pinned-badge{margin-left:4px;font-size:9px}
/* Findings count in section title — tabular-nums so the digit aligns with KPI values. */
.sb-num{font-variant-numeric:tabular-nums}
/* Changed-files rows in the sidebar — extracted from inline style to allow forced-colors overrides. */
.sb-changed-file{font-family:var(--vscode-editor-font-family);font-size:10px;padding:1px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Overflow count row ('+N more') in the sidebar changed-files section. */
.sb-changed-more{font-size:10px;padding-top:2px}
/* Visually hidden but screen-reader accessible — standard sr-only pattern. */
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (forced-colors:active){
  .CRITICAL,.HIGH,.MEDIUM,.LOW{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  .st.run,.st.dead{background:ButtonFace;border:1px solid ButtonText;color:ButtonText}
  /* .chip.off active/inactive state uses opacity+dashed border in normal mode.
     Forced-colors resets opacity and may collapse borders to system colors, making
     active and inactive chips indistinguishable. Explicit system-color mapping restores
     the distinction. Matches the full-panel forced-colors block pattern. */
  .chip.off{background:ButtonFace;border:1px dashed GrayText;color:GrayText;opacity:1}
  /* Sidebar KPI bad/ok colors need explicit system-color mapping in HC mode. */
  .sb-kpi .val.bad{color:Mark}.sb-kpi .val.ok{color:LinkText}
}
`;
