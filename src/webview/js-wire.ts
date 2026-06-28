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
    var card=pd.closest('[data-aid]');var agentLbl=card&&card.querySelector('.role')?card.querySelector('.role').textContent:'';hdr.setAttribute('aria-label',(nowOpen?'Collapse':'Expand')+' prompt for '+agentLbl);}
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
  // Panel section collapse toggle — targets '.panel>h3>button[data-pkey]' directly.
  // v3 BINDING: no tab panel currently calls panel(), so this forEach finds no elements.
  // TODO(M3): remove this block alongside panel() in js-panels.ts if no callers are added by M3.
  // Kept so the wire() + state.panelOpen machinery remains available for future callers.
  document.querySelectorAll('.panel>h3>button[data-pkey]').forEach(function(btn){var h3=btn.parentElement;if(!h3)return;var panelEl=h3.parentElement;if(!panelEl)return;function toggle_panel(){var k=btn.dataset.pkey;if(!k)return;var nowCollapsed=panelEl.classList.toggle('collapsed');var isOpen=!nowCollapsed;state.panelOpen[k]=isOpen?1:0;save();btn.setAttribute('aria-expanded',isOpen?'true':'false');}btn.addEventListener('click',toggle_panel);btn.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle_panel();}});});
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
