// Wire function for the panel webview JS — Claude Code Workflow Dashboard.
//
// Extracted from html.ts (M2-polish round-5) to keep that module under the 400-line limit.
// html.ts imports this and concatenates it after JS_PANELS (from js-panels.ts) into the
// panel <script> tag via the nonce CSP.
//
// This script runs in the webview DOM — acquireVsCodeApi() is available, tsc does not
// type-check the content of this string. Do NOT add TypeScript annotations here.
export const JS_WIRE = `
function wire(){
  function toggle_agent(c){const id=c.dataset.aid;state.openAgents[id]=!state.openAgents[id];save();c.classList.toggle('open');const row=c.querySelector('.row');if(row)row.setAttribute('aria-expanded',c.classList.contains('open')?'true':'false');
    // Keep the Collapse-all/Expand-all button label in sync after individual card toggles.
    // textContent is the accessible name — no separate aria-label needed.
    var cab2=document.querySelector('#agentCollapseAllBtn');if(cab2){var anyOpen2=document.querySelectorAll('.card.open').length>0;cab2.textContent=anyOpen2?'Collapse all':'Expand all';}}
  function toggle_find(t){const fd=t.closest('.finding');if(!fd)return;const id=fd.dataset.fid;if(!id)return;state.openFind[id]=!state.openFind[id];save();fd.classList.toggle('open');t.setAttribute('aria-expanded',fd.classList.contains('open')?'true':'false');}
  document.querySelectorAll('.card').forEach(c=>{const row=c.querySelector('.row');if(row){row.addEventListener('click',()=>toggle_agent(c));row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle_agent(c);}});}});
  // M2-AgentFold: Collapse-all / Expand-all toggle.
  // When any card is open, collapse all; when all are collapsed, expand all.
  // Persists the new state for every agent id via state.openAgents + save().
  var cab=document.getElementById('agentCollapseAllBtn');
  if(cab){cab.addEventListener('click',function(){
    var cards=document.querySelectorAll('.card[data-aid]');
    var anyOpen=false;
    cards.forEach(function(c){if(c.classList.contains('open'))anyOpen=true;});
    var next=!anyOpen;
    cards.forEach(function(c){
      var id=c.dataset.aid;
      if(!id)return;
      state.openAgents[id]=next;
      if(next){c.classList.add('open');}else{c.classList.remove('open');}
      var row=c.querySelector('.row');if(row)row.setAttribute('aria-expanded',next?'true':'false');
    });
    save();
    // Update button label to reflect the new state after toggle.
    // No static aria-label on the button — the visible textContent IS the accessible name.
    // Keeping them in sync satisfies WCAG 4.1.2 (Name, Role, Value) and 2.5.3 (Label in Name).
    var nextLabel=next?'Collapse all':'Expand all';
    cab.textContent=nextLabel;
    // Also update aria-label explicitly so AT name-caches are invalidated after the toggle.
    // textContent alone may not trigger an accessible-name refresh in all screen readers
    // when the button retains focus between renders.
    cab.setAttribute('aria-label',nextLabel);
  });}
  // Scope to [tabindex] to exclude non-collapsible result rows (.finding.result .ttl has no tabindex).
  document.querySelectorAll('.finding .ttl[tabindex]').forEach(t=>{t.addEventListener('click',()=>toggle_find(t));t.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle_find(t);}});});
  // After a chip toggle re-renders the panel, restore keyboard focus to the chip
  // that was activated so keyboard users don't lose their position in the filter row.
  // CSS.escape() is used in querySelector attribute selectors — esc() performs HTML
  // encoding which is wrong for CSS selectors (e.g. '"' → '&quot;' is a 6-char literal
  // in CSS, not a quote). CSS.escape() is available in all browsers and webview runtimes.
  // esc() is still correct for the attribute VALUE in the HTML (data-rev="…").
  document.querySelectorAll('.chip.rev').forEach(ch=>{function act(){const k=ch.dataset.rev;state.fRev[k]=state.fRev[k]?0:1;state.findPage=0;save();render();const next=document.querySelector('.chip.rev[data-rev="'+CSS.escape(k)+'"]');if(next)next.focus();}ch.addEventListener('click',act);ch.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}});});
  // ch.dataset.sev is browser-decoded (HTML entities resolved) → equals the raw key used in state.fSev.
  // data-sev is set via esc() in findingsPanel(); the browser reverses the encoding on .dataset access.
  document.querySelectorAll('.chip.fsev').forEach(ch=>{function act(){const k=ch.dataset.sev;state.fSev[k]=state.fSev[k]?0:1;state.findPage=0;save();render();const next=document.querySelector('.chip.fsev[data-sev="'+CSS.escape(k)+'"]');if(next)next.focus();}ch.addEventListener('click',act);ch.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act();}});});
  // Clear filters button — wired here (not via inline onclick) so the nonce CSP is satisfied.
  // Inline event handlers on innerHTML-injected elements are always blocked by nonce-based CSP
  // regardless of whether a nonce attribute is present; addEventListener is the correct pattern.
  var cf=document.getElementById('clearFiltersBtn');if(cf)cf.addEventListener('click',function(){Object.keys(state.fRev).forEach(function(k){state.fRev[k]=1;});Object.keys(state.fSev).forEach(function(k){state.fSev[k]=1;});state.findPage=0;save();render();});
  // The empty-result branch may also render a clear-filters button (emptyFiltersBtn).
  var ef=document.getElementById('emptyFiltersBtn');if(ef)ef.addEventListener('click',function(){Object.keys(state.fRev).forEach(function(k){state.fRev[k]=1;});Object.keys(state.fSev).forEach(function(k){state.fSev[k]=1;});state.findPage=0;save();render();});
  // Findings pagination buttons — Prev/Next advance state.findPage and re-render.
  var fpb=document.getElementById('findPrevBtn');if(fpb)fpb.addEventListener('click',function(){if(state.findPage>0){state.findPage--;save();render();}});
  // findNextBtn mirrors findPrevBtn's guard: increment only when below the last page.
  // data-total carries totalPages (emitted by findingsPanel) so the handler can check
  // the bound without a re-render. The disabled attribute already prevents pointer clicks
  // at the last page, but keyboard AT virtual-cursor modes may still dispatch synthetic
  // click events on a disabled button — the guard is the authoritative safety net.
  var fnb=document.getElementById('findNextBtn');if(fnb)fnb.addEventListener('click',function(){var total=parseInt(fnb.dataset.total||'1',10);if(state.findPage<total-1){state.findPage++;save();render();}});
  // Prompt disclosure toggle — persists open/closed state per agent id via openPrompt.
  document.querySelectorAll('.prompt-disc').forEach(function(pd){
    var hdr=pd.querySelector('.prompt-disc-hdr');
    if(!hdr)return;
    function toggle_prompt(){var id=pd.dataset.paid;if(!id)return;state.openPrompt[id]=!state.openPrompt[id];save();pd.classList.toggle('open');var nowOpen=pd.classList.contains('open');hdr.setAttribute('aria-expanded',nowOpen?'true':'false');
    // Keep aria-label in sync with aria-expanded so AT announces the current action
    // ("Collapse prompt for X" when open, "Expand prompt for X" when closed).
    var card=pd.closest('[data-aid]');var rawLbl=card&&card.querySelector('.role')?(card.querySelector('.role').textContent||''):'';
    // Strip control characters (U+0000 through U+001F, which includes CR and LF) from the
    // transcript-derived label before embedding in aria-label. Some screen readers
    // (NVDA+Chrome, JAWS) handle embedded newlines in aria-label unpredictably, announcing
    // them as 'blank' or splitting the label mid-announcement.
    // NOTE: this lives inside a template literal, so the char-class escapes are double-backslashed
    // (\\x00 -> \x00 in the emitted webview JS). A single backslash here would collapse to a real
    // control char and break the script (the bug this comment replaces).
    var agentLbl=rawLbl.replace(/[\\x00-\\x1f]/g,' ');hdr.setAttribute('aria-label',(nowOpen?'Collapse':'Expand')+' prompt for '+agentLbl);}
    hdr.addEventListener('click',toggle_prompt);
    hdr.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle_prompt();}});
  });
  // Prompt copy button — posts {type:'copyText',text:...} to the extension host
  // which writes to the VS Code clipboard (vscode.env.clipboard.writeText).
  // Data-pcopied carries the agent id so we look up a.prompt in snap.agents.
  document.querySelectorAll('.prompt-copy-btn').forEach(function(btn){
    btn.addEventListener('click',function(){
      var aid=btn.dataset.pcopied;
      var agent=snap&&snap.agents&&snap.agents.find(function(a){return a.id===aid;});
      if(agent&&agent.prompt)api.postMessage({type:'copyText',text:agent.prompt});
    });
  });
  // Raw-JSON <details> toggle — persists open/closed state per result key via state.openRaw.
  // Key is the data-rlabel of the closest [data-rlabel] ancestor (r.label+':'+r.pass).
  // First, restore persisted open state on each .raw-json-details inside a [data-rlabel] card.
  // Then wire the 'toggle' event to save new state. The 'toggle' event fires after the browser
  // has already changed the open attribute, so det.open reflects the NEW state.
  document.querySelectorAll('[data-rlabel] .raw-json-details').forEach(function(det){
    var card=det.closest('[data-rlabel]');
    var k=card?card.dataset.rlabel:'';
    if(!k)return;
    // Restore open state from persisted state.openRaw on every re-render.
    if(state.openRaw[k])det.open=true;
    det.addEventListener('toggle',function(){state.openRaw[k]=det.open?1:0;save();});
  });
  // Agent-card sub raw-JSON wiring — covers .raw-json-details inside .card[data-aid] .sub.
  // The Results-tab variant uses [data-rlabel]; agent cards use [data-aid] and are not
  // matched by the query above. Key: aid+':sub-raw' — avoids collision with result keys.
  // v3 correction #5 partial fix: agent-sub raw-JSON now persists across re-renders.
  document.querySelectorAll('.card[data-aid] .sub .raw-json-details').forEach(function(det){
    var card=det.closest('[data-aid]');
    var aid=card?card.dataset.aid:'';
    if(!aid)return;
    var k=aid+':sub-raw';
    if(state.openRaw[k])det.open=true;
    det.addEventListener('toggle',function(){state.openRaw[k]=det.open?1:0;save();});
  });
  // ---------------------------------------------------------------------------
  // M3-Timeline wiring: zoom buttons, bar click/keyboard, hover tooltip, scroll.
  // ---------------------------------------------------------------------------
  // Zoom buttons: clamp to 0.5–4, persist, re-render.
  var tlZoomIn=document.getElementById('tlZoomIn');
  var tlZoomOut=document.getElementById('tlZoomOut');
  if(tlZoomIn){tlZoomIn.addEventListener('click',function(){
    state.tlZoom=Math.min(4,Math.round((state.tlZoom+0.25)*100)/100);
    save();render();
  });}
  if(tlZoomOut){tlZoomOut.addEventListener('click',function(){
    state.tlZoom=Math.max(0.5,Math.round((state.tlZoom-0.25)*100)/100);
    save();render();
  });}

  // Segmented control [Gantt | Graph] — each button sets state.timelineView directly.
  // aria-pressed and tl-view-toggle-active are updated by timelinePanel() on next render.
  // tlViewGantt: the Gantt segment button (no tl-view-toggle-active in gantt view).
  var tlViewGantt=document.getElementById('tlViewGantt');
  if(tlViewGantt){tlViewGantt.addEventListener('click',function(){
    state.timelineView='gantt';
    save();render();
  });}
  // tlViewToggle: the Graph/DAG segment button (id backward-compatible with wire tests).
  // Segmented control: clicking Graph always sets view to 'dag' (no toggle — use Gantt button to go back).
  var tlViewToggle=document.getElementById('tlViewToggle');
  if(tlViewToggle){tlViewToggle.addEventListener('click',function(){
    state.timelineView='dag';
    save();render();
  });}
  // WAI-ARIA radiogroup keyboard pattern (APG): ArrowRight/ArrowDown move to the next option;
  // ArrowLeft/ArrowUp move to the previous option. Both buttons are present when the timeline
  // tab is active; only the segmented control's radiogroup needs this wiring (the tab bar
  // already implements its own arrow navigation via wireTabBar()).
  if(tlViewGantt){tlViewGantt.addEventListener('keydown',function(e){
    if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();if(tlViewToggle){tlViewToggle.click();tlViewToggle.focus();}}
  });}
  if(tlViewToggle){tlViewToggle.addEventListener('keydown',function(e){
    if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();if(tlViewGantt){tlViewGantt.click();tlViewGantt.focus();}}
  });}

  // Bar click/Enter → switch to Agents tab, expand that agent's card.
  // Also handles ArrowRight/ArrowLeft/Home/End keyboard nav within bars.
  var tlBars=Array.from(document.querySelectorAll('.tl-bar-group'));
  function tlActivateBar(g){
    var aid=g.dataset.tlaid;
    if(!aid)return;
    // Expand the agent card in Agents tab.
    state.openAgents[aid]=true;
    state.activeTab='agents';
    save();
    render();
    // After render, scroll the card into view.
    var card=document.querySelector('[data-aid="'+CSS.escape(aid)+'"]');
    if(card)card.scrollIntoView({block:'nearest'});
  }
  tlBars.forEach(function(g){
    g.addEventListener('click',function(){tlActivateBar(g);});
    g.addEventListener('keydown',function(e){
      var idx=tlBars.indexOf(g);
      if(e.key==='Enter'||e.key===' '){e.preventDefault();tlActivateBar(g);}
      else if(e.key==='ArrowRight'){e.preventDefault();var next=tlBars[idx+1];if(next)next.focus();}
      else if(e.key==='ArrowLeft'){e.preventDefault();var prev=tlBars[idx-1];if(prev)prev.focus();}
      else if(e.key==='Home'){e.preventDefault();if(tlBars[0])tlBars[0].focus();}
      else if(e.key==='End'){e.preventDefault();var last=tlBars[tlBars.length-1];if(last)last.focus();}
    });
  });

  // DAG node group wiring — click/Enter/Space navigates to the agent card (same as Gantt bars).
  // Nodes have role=button and tabindex=0 (rendered by dagPanel()), so keyboard activation
  // requires explicit event listeners here per WCAG 4.1.2 (Name/Role/Value).
  var tlDagNodes=Array.from(document.querySelectorAll('.tl-dag-node-group'));
  tlDagNodes.forEach(function(g){
    g.addEventListener('click',function(){tlActivateBar(g);});
    g.addEventListener('keydown',function(e){
      var idx=tlDagNodes.indexOf(g);
      if(e.key==='Enter'||e.key===' '){e.preventDefault();tlActivateBar(g);}
      else if(e.key==='ArrowRight'){e.preventDefault();var next=tlDagNodes[idx+1];if(next)next.focus();}
      else if(e.key==='ArrowLeft'){e.preventDefault();var prev=tlDagNodes[idx-1];if(prev)prev.focus();}
      else if(e.key==='Home'){e.preventDefault();if(tlDagNodes[0])tlDagNodes[0].focus();}
      else if(e.key==='End'){e.preventDefault();var last=tlDagNodes[tlDagNodes.length-1];if(last)last.focus();}
    });
  });

  // Hover tooltip: show on mouseenter, hide on mouseleave.
  // Position via el.style.left/top on the named tooltip node — CSP allows this.
  // The tooltip div is rendered outside any view-specific branch so it is present in the
  // DOM in both Gantt and DAG views (see timelinePanel() in js-panels.ts).
  var tlTooltip=document.getElementById('tl-tooltip');

  // Shared helper: populate and position the tooltip for a given bar/node group element.
  // scrollContainerId: the element whose scroll offset the bar coordinates are relative to.
  function showTlTooltip(g,scrollContainerId){
    if(!tlTooltip)return;
    var aid=g.dataset.tlaid;
    var status=g.dataset.tlstatus||'';
    var agent=snap&&snap.agents&&snap.agents.find(function(a){return a.id===aid;});
    if(!agent)return;
    // Build tooltip content using textContent (injection-safe — browser does not parse HTML).
    // Lines are newline-separated; CSS white-space:pre-line renders each on its own line.
    var lines=[
      agent.label||'agent',
      'Status: '+status,
      'Elapsed: '+fmtElapsedSR(safeN(agent.elapsed)),
      'Tokens: '+fmtTok(safeN(agent.tokens)),
      'Tools: '+safeN(agent.tools)
    ];
    tlTooltip.textContent=lines.join('\\n');
    tlTooltip.removeAttribute('hidden');
    // Use viewport-relative (getBoundingClientRect) coordinates with position:fixed
    // so the tooltip is not affected by scroll offset inside .tl-scroll.
    // The tooltip div is a sibling of .tl-scroll (not a child) so offsetParent-relative
    // positioning would require compensating for .tl-scroll.scrollLeft — fragile and
    // one render cycle stale. Fixed positioning bypasses that entirely.
    var rect=g.getBoundingClientRect();
    var tipX=rect.left+4;
    // Clamp y: position above the bar; if that would clip to <4px from the top, go below.
    var tipY=rect.top-42;
    if(tipY<4)tipY=rect.bottom+4;
    tlTooltip.style.left=tipX+'px';
    tlTooltip.style.top=tipY+'px';
  }

  tlBars.forEach(function(g){
    g.addEventListener('mouseenter',function(){showTlTooltip(g,'tl-scroll');});
    g.addEventListener('mouseleave',function(){
      if(tlTooltip)tlTooltip.setAttribute('hidden','');
    });
    // WCAG 1.4.13: tooltip triggered on hover must also trigger on keyboard focus.
    g.addEventListener('focus',function(){showTlTooltip(g,'tl-scroll');});
    // Hide on blur (keyboard users navigating away).
    g.addEventListener('blur',function(){
      if(tlTooltip)tlTooltip.setAttribute('hidden','');
    });
  });

  // DAG node tooltip — mirrors Gantt bar tooltip so hover behaviour is consistent across views.
  tlDagNodes.forEach(function(g){
    g.addEventListener('mouseenter',function(){showTlTooltip(g,'tl-dag-scroll');});
    g.addEventListener('mouseleave',function(){
      if(tlTooltip)tlTooltip.setAttribute('hidden','');
    });
    // WCAG 1.4.13: tooltip triggered on hover must also trigger on keyboard focus.
    g.addEventListener('focus',function(){showTlTooltip(g,'tl-dag-scroll');});
    g.addEventListener('blur',function(){
      if(tlTooltip)tlTooltip.setAttribute('hidden','');
    });
  });

  // WCAG 1.4.13: Escape key dismisses any visible timeline/DAG tooltip.
  // The listener is attached after each innerHTML re-render (wire() is called after
  // each render); the old listener is GC'd with the old DOM scope. This is idempotent
  // and covers both Gantt bar tooltips and DAG node tooltips from a single handler.
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'&&tlTooltip&&!tlTooltip.hasAttribute('hidden')){
      tlTooltip.setAttribute('hidden','');
    }
  });

  // Tab bar wiring — WAI-ARIA keyboard model for the tablist.
  wireTabBar();
}

// wireTabBar(): keyboard + click wiring for the #tab-bar tablist.
// Implements WAI-ARIA Tabs Pattern:
//   - Click on an enabled tab → activate it (update state.activeTab, roving tabindex, re-render).
//   - ArrowRight/ArrowLeft → move focus to next/prev enabled tab (wrapping), skipping disabled.
//   - Home → move focus to first enabled tab.
//   - End → move focus to last enabled tab.
//   - Enter/Space → activate the currently focused tab.
//   - Active tab indicator: aria-selected=true + tabindex=0 + 2px bottom border (CSS).
//   - Disabled tabs: tabindex=-1, aria-disabled=true, disabled attr — non-focusable.
// Per-tab scroll position is captured before switching and restored after re-render.
function wireTabBar(){
  var tabBar=document.getElementById('tab-bar');
  if(!tabBar)return;
  var tabs=Array.from(tabBar.querySelectorAll('[role="tab"]'));
  if(!tabs.length)return;

  function activateTab(btn){
    var key=btn.dataset.tabkey;
    if(!key||btn.disabled||btn.getAttribute('aria-disabled')==='true')return;
    // Capture current tab-content scroll before switching.
    var tc=document.getElementById('tab-content');
    if(tc&&state.activeTab){
      if(!state.tabScroll||typeof state.tabScroll!=='object')state.tabScroll=Object.create(null);
      state.tabScroll[state.activeTab]=tc.scrollTop;
    }
    state.activeTab=key;
    save();
    render();
    // After render, focus the newly activated tab button (it has tabindex=0 now).
    var newBtn=document.querySelector('[role="tab"][data-tabkey="'+CSS.escape(key)+'"]');
    if(newBtn)newBtn.focus({preventScroll:true});
  }

  function enabledTabs(){
    return tabs.filter(function(t){return !t.disabled&&t.getAttribute('aria-disabled')!=='true';});
  }

  tabs.forEach(function(btn){
    btn.addEventListener('click',function(){activateTab(btn);});
    btn.addEventListener('keydown',function(e){
      var enabled=enabledTabs();
      var cur=enabled.indexOf(btn);
      if(e.key==='ArrowRight'){
        e.preventDefault();
        var next=enabled[(cur+1)%enabled.length];
        if(next)next.focus();
      }else if(e.key==='ArrowLeft'){
        e.preventDefault();
        var prev=enabled[(cur-1+enabled.length)%enabled.length];
        if(prev)prev.focus();
      }else if(e.key==='Home'){
        e.preventDefault();
        if(enabled[0])enabled[0].focus();
      }else if(e.key==='End'){
        e.preventDefault();
        if(enabled[enabled.length-1])enabled[enabled.length-1].focus();
      }else if(e.key==='Enter'||e.key===' '){
        e.preventDefault();
        activateTab(btn);
      }
    });
  });
}

render();
`;
