# Terminal Experience Excellence — masterplan

**Commissioned:** 22 October 2026  
**Status:** Active implementation program. The north star is exceptional product quality; global superiority or an award is not a verified result.  
**Accountable owner:** Commissioning principal session; bounded reviewers advise, and each implementation wave has one source owner.  
**Canonical backlog:** This document. Update its task rows and continuation section in every accepted wave.  
**Source baseline:** Terminal `443b3fc0491418bfbcb46653a139c8bdee7db3e7`. Procedure pin: Mastermind `05a9eb52a54e29fb7bbd0d40813ed12623b176c7`.  
**Operation:** `terminal-experience-masterplan-20261022`.

## 1. Outcome

Terminal should feel immediately understandable and deeply capable. A returning user should recognize where they are, resume their work, and move between a chart, a company, an options investigation and a portfolio without rebuilding context. An experienced user should be able to move quickly with the keyboard. A new user should find the same actions through clear, visible controls.

The visual direction is calm precision: a quiet canvas, deliberate typography, restrained blue emphasis, clear separation between content levels, aligned financial numbers, and motion that explains a change. Dense analytical views remain dense where comparison benefits from density. Reading, onboarding and decision flows receive enough space to be understood.

The program changes the responsive web application, its shared interaction contracts, and its delivery discipline. It does not create another chart engine, mobile application, research datastore, entitlement authority, score, collector or monitoring system. Financial calculations, evidence identity and consent retain their existing owners.

### The five outcomes we will earn

1. **Orientation:** The current workspace, company, timeframe or event, and primary next action are immediately identifiable.
2. **Continuity:** Navigation, Back, dismissal and return preserve the user's intended context and work.
3. **Control:** Keyboard, pointer and touch can perform equivalent core tasks; nested surfaces have predictable focus and dismissal.
4. **Trust:** Fresh, delayed, stale, unavailable, empty, pending and restricted states remain distinct and understandable.
5. **Speed:** Input receives prompt feedback, layouts remain stable, and responsiveness is measured through complete journeys.

“Perfected production” requires every core UX row and this program’s retained-contract duties in §6 to be accepted with evidence. A beautiful screenshot, a merged PR, or a successful HTTP request alone does not satisfy that definition.

## 2. What was assessed, and what remains to assess

The October 22 census inspected current protected source, the actual authenticated application, existing design guidance, responsive contracts, the chart performance budget, and all **158 open PR metadata records** returned by the two-page repository census. Metadata identifies overlap; it is not review or approval of those PRs.

Live observations used the current desktop browser at approximately 1603×1180. The preceding accepted four-workspace release also supplies its separately attributed 1440×900, 820×1180 and 390×844 evidence. This census is not a claim to have exercised every feature, account state, browser or assistive technology. Task rows marked **Audit** require their own reproduction before implementation.

Private holdings, watchlists, account details and script contents are not publication fixtures. Committed images must use synthetic or public fixtures and identify their source revision, viewport, language, theme and state.

### Evidence register

| ID | Evidence and source | Finding | Confidence / limit |
|---|---|---|---|
| E01 | Live Chart → Compare, October 22; `terminal/components/SearchModal.tsx` | Shift+Tab from the search input moved focus to an “Ask Mastermind AI” button behind the visible modal. The generic panel had no dialog role and its ESC control was a span. | Reproduced live. First implementation target. |
| E02 | `SearchModal.tsx`, `terminal/components/studyTemplates/useDialogFocus.ts`, `terminal/components/ui/MobileSheet.tsx` | Company search and phone search already have stronger focus contracts. The nested add picker is portalled outside the generic desktop panel. | Source verified. An indiscriminate focus trap would break owned picker input. |
| E03 | `terminal/components/TerminalShell.tsx`, `terminal/components/chrome/shared-shell/SharedShellRuntime.tsx`, `terminal/lib/activeSymbol.ts` | Cmd/Ctrl+K has different meanings in the chart and optional shared shell; the active company cursor already has a canonical owner. | Source verified. SharedShell's optional rollout remains separate. |
| E04 | Live Intelligence Brief for a public company; `terminal/components/fin/CompanyIntelligenceV2Current.tsx` | Clear headline and evidence affordances coexist with large equal-height unavailable sections, repeated context labels and technical receipt vocabulary. | Visual assessment. Preserve all evidence/authority distinctions when simplifying presentation. |
| E05 | Live Discover Stock Screener | Market, asset, classification, presets, signal, liquidity, currency, capitalization, price position and density controls compete at similar emphasis across several rows. | Visual assessment. A grouped filter hierarchy is a candidate, not permission to remove advanced filters. |
| E06 | Live Dislocations; `terminal/components/dislocations/DislocationsView.tsx` | English UI shows a bilingual “Confirmed” heading; older events show very large hour counts with time-of-day visually dominant. Stale feed warnings correctly remain visible. | Language defect reproduced and source verified. Age/date presentation needs a defined product contract. |
| E07 | Live Scripts first frame | The editor is clearly organized, but “ready to add” coexists with multiple unsupported-output/timeframe warnings. The warning hierarchy and input labels deserve a focused usability pass. | Visual assessment only. No compiler correctness or user script changes claimed. |
| E08 | Accepted PRs [#1125](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1125) and [#1126](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1126) | Charts, Options, Intelligence and Portfolio received accepted shared chrome, responsive hardening and valuation/recovery improvements. | Completed baseline, not work to redo. Their deployment, migration and live-proof records remain authoritative. |
| E09 | `terminal/components/chrome/WorkspaceTabs.tsx`, `terminal/components/fin/ResearchWorkspaceNav.tsx` | Shared tabs already support keyboard traversal and reveal. The company mobile family chooser needs a live focus-boundary audit. | Source evidence; the chooser issue is a hypothesis until reproduced. |
| E10 | `terminal/components/WorkspaceLoading.tsx`, `docs/chart-engine-completion/performance-budget.md` | Generic workspace loading and precise chart-engine budgets already exist. Whole-product journey responsiveness needs its own baseline. | Source verified. No new INP/CLS or speed improvement is claimed yet. |
| E11 | Draft Paper atlas [#848](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/848), head `8db8bc39086550bbce17158e1c5d0dd59194dd86` | The earlier atlas inventories 16 non-shell Paper pages and 329 artboards, separates reusable families from held/duplicate designs, and preserves data/consent dependencies. | Attributed prior census, not a fresh inspection of all Paper boards. It remains a draft dependency reference. |

### Product surface census

| Surface family | Existing owner / entry | Experience to assess and upgrade | Current coverage |
|---|---|---|---|
| Global shell | `terminal/components/chrome/AppShell.tsx`, `TerminalShell.tsx` | Navigation, active context, command vocabulary, account, tool discoverability, consistent return paths | Source + live desktop |
| Chart canvas | `/terminal`, chart engine and toolbars | Chart as visual priority; resize, pane controls, crosshair, timeframe switching, studies, drawing selection, undo, comparison and replay | Accepted responsive baseline + live desktop; deeper journeys queued |
| Search and commands | `SearchModal.tsx`, `SymbolPicker.tsx`, `terminal/components/commandPalette/` | Search, compare, Add, nested destinations, keyboard ownership and meaningful labels | Source + reproduced live defect |
| Watchlists and news rail | Chart rail and existing watchlist/news owners | Column sizing, selection, drag alternatives, readable headlines, filter continuity, detail return | Live first frame; incumbent PRs must be reconciled |
| Company overview and navigation | `terminal/components/fin/MegaPane.tsx`, `ResearchWorkspaceNav.tsx` | One company context, clear page families, tabs versus lenses, predictable return from evidence | Source + accepted baseline |
| Company Intelligence | `CompanyIntelligenceV2Current.tsx` and existing event workspace | Brief, Results, Call/Q&A, History, Topics, Sources, receipts, unavailable states | Live Brief + previous accepted interactions; other states queued |
| Financials / Earnings / Market / Ownership / Lab | Existing `terminal/components/fin/` leaves | Reading hierarchy, chart/table alignment, period and unit clarity, long labels, source clocks, connected investigation paths | Source-family census; detailed per-leaf audit queued |
| Options | `terminal/components/workspaces/OptionsWorkspace.tsx`, `OptionsHubView.tsx` | Tape, structure, exposure, flow, volatility, planning, research, sources and saved cases as one coherent workflow | Accepted responsive baseline; advanced task journeys queued |
| Discover | `/discover` | Screener, Heatmap, Sector Central, Leaders, Leader Radar, RS pivot; filter hierarchy and table/visual parity | Live Screener; remaining views queued |
| Dislocations | `DislocationsView.tsx` | Scan relevance, event date/age, status, details, source delay and route return | Live + source |
| Portfolio | `/portfolio`, existing workspace and position owners | Overview, holdings, price coverage, entry completion, exposure, attribution, targets, import/edit/undo | Previous accepted live recovery flow; consequential writes need fixture verification |
| Alerts / monitor | `/alerts`, `/monitor` | Creation, eligibility, dry run, explicit enablement, delivery status, cancel/retry and recovery | Alerts live first frame + source; full state journey and Monitor queued |
| Scripts | `/scripts` and existing Pine editor | Editing, warnings, input naming, compile progress/cancel, preview, protected source and chart handoff | Live first frame; edits/compile jobs not performed in census |
| Saved research / theses | `/analysis` views and `/research` owners | Save versus watch distinction, version identity, reopen, evidence comparison and privacy | Existing design/contract references; full journey queued |
| Today / research / utility routes | `/today`, `/research`, `/learn`, shared links | Entry points, consistency, route purpose, dead ends, links back to primary workspaces | Route inventory only |
| Account / onboarding | `/login`, `/invite`, `/reset-password`, settings | Sign-in, session expiry, validation, preference persistence, readable EN/ZH, keyboard and touch | Current account access observed; fresh end-to-end flow queued |
| Embeds / shared views | `/embed/chart`, `/x/[slug]` | Responsive containment, identity, read-only boundaries, loading and return to Terminal | Route inventory only |
| Internal and experimental routes | `/admin`, `/dev/*`, `/options/futures` | Separate staff, preview and admitted product scope; avoid exposing experiments through redesign | Source inventory only; no launch implied |

## 3. Experience architecture

### 3.1 One product, three recurring activities

The navigation should support **orient → investigate → organize**:

- **Orient:** find a market, company, event or position; understand the current state.
- **Investigate:** compare evidence in charts, company research and options tools.
- **Organize:** retain a view, research case, watchlist, portfolio entry or explicitly enabled alert.

These activities describe journeys, not new applications or a new sidebar to ship without review. Existing route names remain until the navigation wave reconciles current owners and tests alternatives.

Keep the chart/company cursor in `activeSymbol.ts`. A temporary comparison, a selected option contract, a portfolio row and a historical event are distinct objects; do not overwrite global company context just because a panel was inspected. A pinned inspector states what it follows and offers a visible return to the current context.

### 3.2 Five page anatomies

| Anatomy | Primary content | Supporting controls | Use |
|---|---|---|---|
| Canvas workspace | Chart or spatial visualization | Compact toolbars and optional inspector; canvas receives remaining width and height | Charts, replay, some exposure views |
| Analytical desk | One decision question, its key measures and comparison | Filter/context strip, secondary lenses, drill-in detail | Options, Lab, market analysis |
| Research document | A readable conclusion or event summary followed by evidence | Company/event context, section navigation, nonmodal desktop source inspector | Intelligence, earnings, dossiers |
| Inventory | Search/filter summary, aligned rows and explicit selection | Batch actions only when selected, row detail, clear empty/recovery states | Holdings, watchlists, alerts, screeners |
| Editor | Editable artifact and its status | Inputs, diagnostics, preview and explicit apply/save | Scripts and structured research editing |

Every page must identify its primary question. A secondary absent dataset must not inherit the space and emphasis of a populated primary chart. Deeper controls stay available through named disclosure, not unexplained icons.

### 3.3 Navigation and command contract to resolve in wave 2

Use one visible distinction between **Find a symbol**, **Find a tool**, and **Run an action**. Decide one global shortcut mapping after comparing the incumbent chart and SharedShell implementations; display the mapping where it is used. Preserve familiar existing shortcuts during migration or provide an explicit transition.

Global shortcuts must stand down during text composition, text editing and modal tasks. Contextual shortcuts belong to the focused workspace. Browser Back, links opened in a new tab, direct URLs and refresh must retain meaningful identity. A workspace should not require a special entry sequence to work.

### 3.4 Shared framework strategy

Reuse the current token base and stronger behavior primitives. Standardize contracts first, then consolidate implementations where semantics match.

- Keep `globals.css` and `observatory.css` as token foundations; add a semantic alias only for a recurring role that existing tokens cannot express.
- Use scoped component styles for new owned rules. No unqualified generic selectors, global font scaling or another competing theme reset.
- Preserve `WorkspaceTabs` keyboard/reveal behavior, `MobileSheet` detents and safe areas, and the measured `svgChart.ts` chart geometry.
- A modal dialog, anchored menu, desktop inspector and mobile sheet are different patterns. Do not force them into one component.
- Grow the existing development fixtures into a review gallery of actual components, not a second visual implementation.
- Retain server/client boundaries and the existing data owners. Presentation changes should not increase client bundles by importing server-only logic.

## 4. Visual and layout system

### Typography and text allocation

Use the existing UI typeface and Inter/tabular numerals for financial values. Code remains monospaced. Labels align left; comparable numeric columns align right. Units, currency, period and scale are part of a value's identity.

Define semantic roles rather than dozens of local font sizes:

| Role | Direction for new/reworked surfaces | Review requirement |
|---|---|---|
| Workspace title | Clear, restrained; typically 18–24px depending on anatomy | One primary title; no repeated eyebrow with the same words |
| Research body | Comfortable reading; usually 14–16px with appropriate line height | Sensible line length, paragraphs and EN/ZH wrapping |
| Table / control text | Compact but legible; typically 12–14px | Density chosen for task; no clipping essential labels |
| Metadata | Quieter, usually 11–12px | Essential freshness, units and restrictions remain readable |
| Key measure | Deliberate 24–32px emphasis where it answers the primary question | No oversized empty/unknown metric; preserve units |
| Chart axes / dense evidence | Existing domain-specific sizes, adjusted from measured fit | Distinct ticks, no collision, no blanket enlargement |

These ranges are design targets to resolve against existing tokens, not a global CSS replacement. Long company names, long translated actions, large negative values, zero, unknown, multiple currencies, six-digit quantities and narrow windows are required specimens.

### Geometry and density

Use the existing 4px spacing rhythm and established radius/shadow families. Repeated headers, controls, cards and rows align to explicit container edges. Define content and sidebar minimums before selecting breakpoints.

- Desktop analytical pages use deliberate column priorities; a sidebar yields or moves when it would starve the primary task.
- Tablet supports touch and physical keyboards. It is not just a compressed desktop screenshot.
- Phone uses the same route/data/state owners with stacked content, sensible sheets and 44px primary touch targets.
- Wide data tables scroll inside an identified region with sticky identity/headers where useful. The document itself must not overflow horizontally.
- At 1024/1180 intermediate widths, audit the changeover itself, not just the three standard screenshots.
- At browser zoom and larger text sizes, controls and content reflow; fixed-height text containers are exceptional.
- Preserve safe areas, virtual-keyboard visibility and usable close controls on short screens.

### Color, contrast and themes

Use one emphasis accent per task. Reserve `--up/--down/--buy/--sell` for direction and retain east/west mapping. Health, source quality, pending, warning and destructive states use their own semantics. Do not make a stale quote look live through a green decorative dot.

Review foreground/background pairs in their actual nested surfaces, including disabled, hover, selected and focus states. Target WCAG 2.2 AA contrast and a visible focus indicator; document exceptions or failures, rather than declaring blanket compliance from screenshots.

Maintain the themes each route actually supports. Dark-only chart/research surfaces stay honestly dark-only; Portfolio and other theme-capable surfaces need both modes. A theme toggle must not expose an unreviewed palette.

## 5. Interaction and motion contracts

### Focus and layers

A modal owns its complete task, including portalled descendants. Opening moves focus to an intentional target; Tab and Shift+Tab stay inside; a real close button is available; dismissal restores a valid opener unless another explicit task receives focus. Background controls cannot receive keyboard actions while the modal is active.

Escape unwinds one layer at a time: local edit → owned picker/menu → dialog. It does not cancel IME composition or trigger chart shortcuts behind an overlay. Outside press and scroll behavior must be specified per pattern. Closing a child whose trigger disappears needs a safe in-task focus fallback.

Desktop inspectors remain nonmodal when continued comparison with the underlying content is useful. The equivalent phone sheet may be modal. Active selection and route changes must not leave invisible keyboard traps, stale scrims or body-scroll locks.

### Pointer, touch and keyboard

Every actionable icon has an accessible name and a visible explanation when needed. Destructive controls are clearly separated. Hover-only tools have keyboard and touch equivalents. Drag/reorder/resize interactions have a non-drag alternative where required; focus remains visible during scrolling and sticky-header movement.

Primary touch controls target 44×44 CSS pixels. WCAG's 24px minimum/spacing rules are a baseline, not a reason to ship frustratingly small primary actions. Dense chart marks need an equivalent accessible detail path instead of pretending each mark is a 44px button.

### Motion

Motion explains entry, exit, hierarchy, selection or continuity. It must never delay a command or replay simply because quotes refresh.

Use existing timing/easing tokens; resolve a small shared set around fast feedback, ordinary state change and layer transition. Prefer opacity/transform where appropriate, avoid animating expensive large-area blur/height on every tick, and allow transitions to be interrupted. Do not add perpetual decorative movement to analytical reading surfaces.

Respect reduced motion with equivalent immediate state changes. Smoothness is earned through frame and interaction measurements; adding animation to a slow task is not a performance improvement.

### Draft preservation

Each editable flow defines whether cancellation discards a temporary draft, retains it locally, or requires a deliberate discard decision. Escape, outside press, route navigation and session expiry must not silently lose meaningful work. Save/apply status distinguishes a local draft from persisted success. Use confirmation only when loss is consequential and cannot be recovered; ordinary navigation and disposable inputs do not need blanket confirmation dialogs.

Portfolio entry/import, Scripts and research editing must include an actual dirty-draft dismissal/navigation/recovery test. Recovery must retain the correct owner and object identity.

### Loading, errors and recovery

| State | Required behavior |
|---|---|
| Initial loading | Stable geometry representative of the actual page; meaningful task label |
| Background refresh | Keep last usable content, show refresh state locally, preserve selection and scroll |
| Empty result | Explain the current scope/filter; offer a relevant next action |
| Unsupported / restricted | State what is unavailable and why the user needs to know; no false empty or fabricated value |
| Stale / delayed | Retain exact source clock and qualification; keep last good data visibly qualified |
| Partial response | Show available sections and label missing sections independently |
| Error | Recover in place, retain inputs, expose an actionable retry/cancel; no reload-to-recover acceptance |
| Saving / applying | Explicit pending and settled outcome; no duplicate submission or success before persistence |
| Cancelled | Settle promptly, restore a usable state, do not silently restart |

Preserve last usable content only while its object identity, scope and access remain valid. During a company, event, contract, portfolio or account change, do not present the previous object’s values as the new selection. If retaining a previous view is useful, label its identity explicitly and separate it from the new loading state. Permission loss must not leave protected content displayed.

Producer receipts and hashes remain available in evidence detail. The first view uses plain language. Translate the user's decision, not every implementation term onto the main screen.

## 6. Prioritized master to-do list

**Status vocabulary:** Done = accepted production/qualified evidence; Building = owned work now; Review = implemented/locally verified with release acceptance still pending; Ready = bounded next work; Audit = reproduce/pin before building; Coordinate = existing carrier/owner must be reconciled; Dependency = cannot responsibly ship until its named prerequisite is satisfied.

### Acceptance scope

| Class | Rows | Completion rule |
|---|---|---|
| Required for core UX acceptance | EX-00–EX-23, EX-25–EX-28, EX-30–EX-34, EX-37–EX-51 | All 48 rows need their stated evidence. An audit may conclude that the current implementation already meets the requirement, but must record the task proof. |
| External dependency / retained contract | EX-24, EX-29, EX-35, EX-36 | This program must verify truthful unavailable/stale states, identity, explicit consent, and preserved producer/engine gates. A producer’s unshipped capability remains visibly blocked and is not counted as shipped functionality. Its separate program need not be completed to accept the current product’s UX contract. |
| Further enhancement | No current row assigned | New optional ideas may be recorded here with a reason and owner; changing an existing required row to optional requires an explicit scope decision and a durable explanation. |

Core UX acceptance therefore requires all 48 core rows plus the four retained-contract duties. The dependency rows separately record whether the producer capability is available; a UX acceptance must never imply that it is. Awards and universal superiority remain unverified unless independently established.

Prioritize task frequency × user cost × breadth, then confidence and risk. Safety/trust/keyboard failures outrank decorative refinements. The rows are not promises that all work is parallelizable.

### Wave 0 — durable plan and baseline

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-00 | Review | Publish this masterplan, evidence register and dependency map | GitHub PR, source pin, explicit unverified areas and recoverable continuation |
| EX-01 | Ready | Create an actual-component visual/state review gallery using existing dev fixtures | Desktop/tablet/phone, EN/ZH, supported themes, long-content and empty/error specimens |
| EX-02 | Audit | Baseline the recurring journeys listed in §8 | Reproducible measurements with source/environment/cache/data qualifications; no invented score |

### Wave 1 — reliable everyday interactions

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-03 | Review | Search / Compare / Add dialog ownership (`SearchModal.tsx`) | Named modal, real close, both Tab boundaries, Escape from any control, opener return, owned picker, safe task handoff; no background shortcuts. Phone primary drawer retained; its nested-picker lifecycle remains in EX-06/16 |
| EX-04 | Audit | Company mobile family chooser (`ResearchWorkspaceNav.tsx`) | Reproduce focus behavior, then verify focus entry/containment/return, selection and resize |
| EX-05 | Coordinate | Mobile global navigation and account targets | Reconcile #697; same keyboard/touch contract across chart and shared shell |
| EX-06 | Audit | Menus, popovers, phone primary-search nested picker, tooltips and inspector lifecycle census | Prioritized defect list; stale tooltip/scroll/route cleanup fixed one family at a time; reconcile #1006 |
| EX-07 | Coordinate | Search empty-result recovery and composition | Review current #885/#860 owners/heads; retain query, selection and input composition without duplicating their patches |
| EX-08 | Ready | Dislocations language and event-age clarity | EN and ZH are separate; dates/relative ages remain accurate across timezone/day boundaries; stale qualification preserved |

### Wave 2 — navigation and shared context

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-09 | Coordinate | Global search/tool/action vocabulary and shortcut map | Pin alternatives against real tasks; reconcile SharedShell and #1041 before changes |
| EX-10 | Audit | Context continuity across Chart, Analysis, Options and Portfolio | Company, timeframe/event and selected object behave intentionally through links, Back, direct entry and refresh |
| EX-11 | Audit | Visible navigation hierarchy and tool discoverability | New and expert users can locate primary tasks; labels, tooltips and keyboard access agree |
| EX-12 | Audit | Workspace memory and return position | Preserve meaningful filters/scroll/selection without leaking another company's context or private state |
| EX-13 | Audit | Account, session-expiry and onboarding handoff | Fresh-session journey works without manual reload; errors retain inputs; a new dialog owns focus |

### Wave 3 — coherent layout, type and states

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-14 | Ready | Pin page anatomy, density and semantic token usage | Actual fixture specimens, scoped rules, explicit responsive constraints; no competing token system |
| EX-15 | Audit | Typography / contrast / text allocation sweep | Long EN/ZH labels, numeric alignment, focus visibility and measured contrast per affected surface |
| EX-16 | Audit | Dialog/sheet/menu geometry and motion | Short-height windows, viewport edges, virtual keyboard, reduced motion, interrupted transitions |
| EX-17 | Ready | Loading / empty / error / partial-state recipes | Actual shape of each workspace; preserved last-good content; in-place recovery and stable layout |
| EX-18 | Coordinate | Plain-language status and progressive evidence disclosure | Reconcile #649/#650; keep clocks/rights/authority available and truthful |

### Wave 4 — chart workspace and rail

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-19 | Audit | Toolbar priority and intermediate-width allocation | Primary chart actions remain available; no accidental wrapping/overlap; preserve accepted #1125 fixes |
| EX-20 | Audit | Studies, drawings, object tree and contextual inspector | Clear selection and edit ownership, keyboard alternatives, undo, predictable pane attachment |
| EX-21 | Coordinate | Comparison, replay and date navigation | Reconcile #718/#1015/#621 and engine owners; qualified source/time labels and reliable keyboard controls |
| EX-22 | Coordinate | Watchlist columns, selection and import/export | Reconcile #1127/#1034/#639; widths remain valid, selection survives useful operations, batch intent is clear |
| EX-23 | Coordinate | News rail reading and evidence hierarchy | Reconcile #1128/#1129/#1130/#1113; one accepted direction, readable provenance, return position preserved |
| EX-24 | Dependency | Chart smoothness and engine-specific work | Preserve existing engine budget and default-flip gates; no incidental engine activation from this program |

### Wave 5 — company research and intelligence

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-25 | Ready | Intelligence Brief hierarchy and compact unavailable sections | First frame answers the event question; secondary absence consumes appropriate space; sources stay reachable |
| EX-26 | Audit | Results / Call / Q&A / Topics / Sources cohesion | Consistent event identity, stable lenses, readable evidence, selection/return through receipts |
| EX-27 | Coordinate | Overview, Financials, Earnings and Market layouts | Reconcile #736/#737/#738/#739; preserve normalized measures, units, periods and qualified historical scope |
| EX-28 | Audit | Ownership / Lab / valuation detail | Tables/charts align; invalid or missing values remain unknown; state and source boundaries read clearly |
| EX-29 | Dependency | Memory, historical identity, consensus and new derived views | Use existing Paper atlas/producer contracts; absence of licensed or historical inputs cannot be solved by styling |
| EX-30 | Coordinate | Saved research and thesis flows | Reconcile existing research owners and holds; save is not implied monitoring, and reopen retains version/evidence identity |

### Wave 6 — options workflow

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-31 | Audit | Options orientation and tool-family hierarchy | A user can understand current root, session, purpose and lens without learning internal tool names |
| EX-32 | Audit | Tape / flow filters and dense table interaction | Clear active filters, stable selection, meaningful row detail, sticky identity and responsive comparison |
| EX-33 | Coordinate | Exposure / structure / strike-expiry visualization | Retain source sessions and unknown cells; reconcile #768 and existing structure work; measured chart geometry |
| EX-34 | Coordinate | Volatility / payoff / scenario surfaces | Reconcile #781/#799/#640/#661; distinguish manual expiration payoff from qualified pre-expiry valuation |
| EX-35 | Dependency | Options evidence → retained case → explicit watch | Respect accepted investigation migration and save/watch consent owners; no automatic activation |
| EX-36 | Dependency | Delayed/stale/quiet/live data interpretation | Preserve truthful states; producer health, licensing and calibration work stays with the canonical data program |

### Wave 7 — portfolio and organization

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-37 | Audit | Portfolio overview, holdings and exposure hierarchy | Clear scope/currency/valuation basis; preserve accepted missing-value and recovery design |
| EX-38 | Audit | Add/edit/import/entry-completion flows | Clear units/validation, safe focus and fixture write proof; dirty-draft dismissal, navigation and recovery preserve the declared contract |
| EX-39 | Coordinate | Briefs, attribution, targets and saved views | Reconcile #888/#866; retain filters and state; qualify comparisons and missing entry data |
| EX-40 | Audit | Watchlist → research → portfolio continuity | Distinguish bookmark from holding; adding a destination never silently chooses the consequential one |

### Wave 8 — discovery, alerts and supporting workspaces

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-41 | Ready | Discover filter grouping and active-scope summary | Primary search remains visible; advanced filters disclose coherently; all current power retained |
| EX-42 | Coordinate | Heatmap / sectors / leaders consistency | Reconcile existing sector and saved-view carriers; table/visual filters agree and unknown sizing stays honest |
| EX-43 | Audit | Dislocations scan hierarchy and details | Relevant company/state/date before secondary metadata; accessible detail affordance; meaningful grouping |
| EX-44 | Coordinate | Alerts create / dry run / cancel / enable / delivery | Reconcile #1073/#1009; pending and delivered remain distinct; no unintended subscriptions |
| EX-45 | Audit | Scripts diagnostics, inputs and chart handoff | Readable grouped warnings, understandable unsupported behavior, clear run/cancel/apply and draft-versus-saved state; dirty-draft navigation/recovery proof |
| EX-46 | Audit | Today / research / learning / embeds / shared views / auth | Purposeful entry and return, correct permissions, stable responsive states, no orphan route |

### Wave 9 — production quality and comparative evaluation

| ID | Status | Work and owner surface | Acceptance |
|---|---|---|---|
| EX-47 | Audit | Keyboard and assistive-technology task pass | Named landmarks/controls, meaningful reading order, no focus loss; actual screen-reader limitations documented |
| EX-48 | Audit | Cross-browser, zoom, touch and long-session pass | Chromium plus supported WebKit/Firefox coverage; memory/listener/scroll stability through repeated tasks |
| EX-49 | Ready | Performance measurement and scoped regression gates | Before/after journey receipts and existing engine gates; real clocks and representative data |
| EX-50 | Audit | Comparative task study and final design review | Same task corpus across Terminal and lawfully available references; record errors, time, discoverability and readability, not unsupported “best” claims |
| EX-51 | Ready | Release/rollout and continued quality ownership | Exact source/CI/deploy/live identity per wave; unresolved rows and next pickup kept current |

## 7. Existing work and conflict map

The following records are dependencies or adjacent work, **not newly approved releases**. Refresh their heads before modifying overlapping files; a held or draft carrier remains held unless its own gate is resolved.

| Existing work | Relationship to this program |
|---|---|
| #1125 and #1126, accepted | Preserve the four-workspace rollout and migration receipt. Do not replay migration 0040. |
| #1124 / SharedShell beta | Source availability does not authorize a default-on flag change. Align vocabulary with its owner. |
| #885 and #860 | Search recovery/composition work. EX-03 owns dialog boundaries, not replacement ranking/recovery logic. |
| #697, #1041 | Mobile navigation and company navigation. Reconcile before same-surface changes. |
| #649, #650, #755 | Guidance, status copy and human-first acceptance proposals. Adopt useful accepted work; do not silently replace owners. |
| #1006, #1015, #718, #621 | Tooltip/replay/comparison/menu behavior. Check what remains unmerged and what source already contains. |
| #1127, #1034, #639 | Watchlist sizing, CSV and selection/drag work. |
| #1128 merged at 942eeb5; #1129, #1130, #1113, #1081 adjacent | News evidence, layout and language work. The #1128 merge adds tests/crops and has no EX-03 source overlap. Avoid a competing rail redesign. |
| #736, #737, #738, #739, #735 | Paper-derived company leaves and shared visual identity. |
| #781, #799, #768, #640, #661, #686 | Options planning/statistics/structure/scenario coverage. Preserve data and model gates. |
| #888, #866, #1073, #1009, #973 | Portfolio, alert and script recovery/units work. |
| Draft #848 Paper atlas | Reuse its family map, held nodes and source/consent distinctions; the original atlas is not blanket permission to implement every board. |
| Existing native-app masterplan | Separate installable-shell program. This program improves the shared web product and does not restart native apps. |
| Existing chart-engine masterplan and budgets | Retain renderer ownership, parity, performance and default-flip gates. |
| Macro Options Alpha recovery workstream | Preserve evidence/calibration and collector/lifecycle ownership. UX changes must not promote unqualified scores or probabilities. |

The older July UI doctrine remains useful for numerals, direction colors, localization and tokens. Its styling-only wave limits and former fixed visual idiom do not narrow the Chairman's new October commission. Current repository instructions and explicit user intent govern. This document does not relax protected CI, evidence, consent, licensing or production gates.

## 8. Quality ruler and measurement

### Repeated task corpus

Measure and manually review these journeys using stable fixtures and separately qualified real-data checks:

1. Open a company from search, compare it, dismiss, and resume the chart.
2. Add a symbol to a watchlist or open a portfolio-entry flow, then cancel/return; verify meaningful unsaved input follows the declared recovery contract.
3. Open company research, switch event/lens, inspect a source, and return to the same fact.
4. Filter Options, inspect a row/structure, change root, and return to the intended view.
5. Find a position needing entry/price information, correct a fixture record, and verify settled valuation state.
6. Build a screener scope, inspect a result, return with filters and position intact.
7. Create and cancel a fixture alert dry run; explicitly enable only within a permitted test flow.
8. Edit a fixture script, observe compile progress/diagnostics, inspect the chart handoff, and exercise dirty-draft navigation or session recovery.

### Targets and evidence, not claimed baselines

| Area | Proposed program target | Measurement / qualification |
|---|---|---|
| Field responsiveness | INP p75 ≤200ms, segmented mobile/desktop | Use existing approved telemetry or an explicitly scoped measurement; do not infer from one laptop |
| Layout stability | CLS ≤0.1, with stricter no-disruptive-shift review on core tasks | Loading, fonts, side panels and content refresh measured separately |
| Local feedback | Visible acknowledgment within 100ms for ordinary controls | A product target; measure input-to-next-paint, not only handler duration |
| Layer transitions | Fast, interruptible, ordinarily 120–220ms where motion helps | Resolve against existing tokens; reduced motion remains equivalent |
| Chart interaction | Existing B1–B6 and soak requirements | `docs/chart-engine-completion/performance-budget.md` remains controlling |
| Responsive layout | 1440×900, 820×1180, 390×844 plus relevant intermediate/short-height cases | Zero document overflow, intentional table scrolling, no clipped essential actions |
| Accessibility | WCAG 2.2 AA as target, plus practical keyboard usability | Automated checks plus actual task review; no blanket compliance claim without complete evidence |
| Localization | EN/ZH parity, no language leakage | Long translated strings, IME, date/number formatting, east/west direction semantics |
| Recovery | No manual reload required to complete the verified journey | Slow, unavailable, stale, partial and retry states tested without hidden workarounds |

Whole-product performance baselines are still **unmeasured** at plan publication. A wave must publish what it actually measured, including host/browser/build/viewport/data/cache/motion state, sample count and limitations. Keep lab and field measurements separate. Do not use fake clocks for timing claims.

## 9. Design, implementation and release process

1. **Select one bounded row or coherent group.** Read its evidence, incumbent carriers and exact source. Reproduce the defect or establish the baseline.
2. **Pin a real design.** Use actual fixture screenshots and an editable component prototype; use the existing Paper file where it materially helps compare structures. Record alternatives and why the selected one better serves the task.
3. **Define states before polishing.** Include content, long content, no content, loading, partial/stale/error, keyboard, reduced motion, touch, EN/ZH and supported themes.
4. **Implement in an isolated operation workspace.** Principal retains high-judgment design decisions. A bounded builder receives exact markup/behavior/ownership, not a vague instruction to “make it premium.”
5. **Review the running result.** Inspect screenshots at 100% scale and exercise the actual interaction. Browser test screenshots must use safe fixtures. A screenshot does not prove focus, data truth or performance.
6. **Run meaningful tests.** Add behavior coverage for the failure mode; retain existing responsive and protected suites. Do not add mirrored tests for trivial cosmetic changes or weaken gates to obtain green.
7. **Publish and integrate.** Commit, push, open a reviewable GitHub PR, reconcile current master, satisfy protected CI and merge through the normal path.
8. **Deploy and verify.** Use the existing git-gated deployment owner. Match deployed identity to accepted source, then check the affected live task. Source merge and live acceptance are separate.
9. **Update this backlog.** Record PR, accepted head/merge, production proof, limitations and exact next task. Preserve completed work and do-not-redo facts.

A genuine external dependency should block only its own row. Continue another useful authorized row while it remains unresolved. No repeated design approval is required for ordinary reversible decisions already authorized by the Chairman.

### First-wave design decision: Search ownership

Keep `.scrim > .smodal` geometry and the phone's existing `MobileSheet`. Give the desktop task one labelled modal scope that also contains its owned add picker. Portal the picker into that scope outside the clipped result/panel containers; preserve viewport-based placement.

Use the incumbent focus contract, a real localized close control, visible keyboard focus and a single dismissal policy. Prevent chart shortcuts from receiving keys that belong to Search. Cancel inline edits before the picker, and the picker before Search. When an action replaces a trigger, return focus to a valid in-task fallback. Verify Portfolio/signup handoff before changing shared focus utilities.

This choice solves the observed failure without replacing search scoring, company filtering, watchlist persistence or the stronger phone drawer.

## 10. Cross-turn continuation

**Current owned slice:** EX-00 and EX-03.  
**Workspace operation:** `terminal-experience-masterplan-20261022`.  
**Branch:** `sol/web-terminal-experience-masterplan-20261022`.  
**Next required acceptance:** publish the locally verified candidate, satisfy protected CI, merge, deploy through the git-gated owner, and append authenticated live proof. See the [EX-03 evidence packet](../terminal/docs/pr-crops/ex03-search/README.md).  
**Next independent UI improvement after first-wave acceptance:** EX-08 (Dislocations language/date clarity), then EX-25 (Intelligence information hierarchy), subject to current-source and overlap checks.

Do not redo the completed #1125/#1126 rollout, reapply migration 0040, enable SharedShell or a new chart engine incidentally, or treat a draft Paper board as production data authority. Do not call the core UX program complete while any of the 48 required rows lacks acceptance or any retained-contract duty remains unverified. Keep unresolved producer capabilities explicitly blocked even after their truthful UX contract is accepted.

At pickup, read this section, the latest PR/evidence packet, and current protected branch. Reconcile only relevant changes. Keep exact accepted results and remaining uncertainty; do not restart the census or invent a new competing backlog.

## 11. Reference standards

These are primary guidance sources, not proof that Terminal already meets them.

- [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles): familiarity, clarity and consistency as interaction goals.
- [Apple motion guidance](https://developer.apple.com/design/human-interface-guidelines/motion): purposeful motion and accessibility.
- [WAI-ARIA modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/): focus entry, containment, Escape and return.
- [WAI keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/): predictable keyboard conventions.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [focus not obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html): concrete accessibility review criteria.
- [web.dev INP](https://web.dev/articles/inp) and [Core Web Vitals guidance](https://developers.google.com/search/docs/appearance/core-web-vitals): field responsiveness and stability targets.
- [Responsive application architecture](RESPONSIVE_APP_ARCHITECTURE.md), [existing UI doctrine](TERMINAL_UI_DOCTRINE_2026-07-28.md), and [chart performance budget](chart-engine-completion/performance-budget.md): retained repository foundations.
