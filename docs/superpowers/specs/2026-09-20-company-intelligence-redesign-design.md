# Company Intelligence Redesign — Brief-First Research Workspace

Date: 2026-09-20  
Operation: `terminal-company-intelligence-redesign-20260920-sol-001`  
Carrier: mastermind-terminal #679  
Terminal source pin used for this design: `9b6d4a7e2a94776e6980e3c7a4a722a094431800`  
Paper source: `Mastermind Product Design System — Agentic Lab` → `Company Intelligence · 2026-09-20`  
Paper URL: https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-4-1

## 1. Product outcome

Turn `/analysis?symbol=<ticker>&page=intelligence` and the chart-hosted Company Intelligence surface into a research workspace a first-time reader can understand in seconds without losing the evidence, time, correction, and authority boundaries that make the product trustworthy.

The default page must answer, in this order:

1. What happened?
2. What materially changed versus the prior event?
3. Why does it matter to the business?
4. What are the important risks and unresolved debates?
5. What should I watch next?
6. What source supports each claim, and what does that source not prove?

This remains a context product. It does not rank the company, originate a trade, size a position, or imply a recommendation.

## 2. Constraints and non-goals

- Preserve Terminal's canonical same-origin Company Intelligence BFFs and generation/event identity.
- Preserve the current rule that valid v2 `event_workspace.v1` wins; only canonical v2 `not_found` may fall back to the v1 company-intelligence context. Other v2 failures remain explicit.
- Reuse the existing Transcript reader, Brain, evidence receipts, theme context, institutional context, and publication owners.
- Do not create a second document reader, evidence system, AI assistant, alert plane, data store, ranking engine, or signal authority.
- Do not invent consensus surprise, price reaction, probability, sentiment authority, targets, sizing, or confidence when the qualified upstream input is absent.
- Do not treat metadata/source-family attribution as exact paragraph or line-level citation.
- The redesign must work for companies without bespoke hero artwork. Generated company imagery is enhancement, never a rendering dependency.

## 3. Current product problems

The current default Brief exposes useful material but presents it as an audit-oriented stack rather than a research story. Provenance, warnings, theme crosswalk mechanics, 13F diagnostics, long manager tables, generation identifiers, and receipt machinery compete with the actual company event.

The legacy v1 and current v2 render paths also differ enough that a visual redesign applied to only one path would leave users with two products. Both paths must converge on one presentation architecture while retaining their truthful data differences.

## 4. Visual direction

Mood: **maritime research desk**.

Dark art direction:
- instrument-black / deep navy canvas;
- slate and blue-charcoal surfaces;
- one controlled Mastermind blue interaction accent;
- semantic green/red/amber only for actual state meaning;
- selected surfaces may use very subtle translucency, blur, inner highlights, and ambient blue/green glow;
- no habitual colored left-edge cards, neon framing, heavy gradients, or decorative glow for its own sake.

Typography stays Inter. Large hierarchy comes from scale, weight, spacing, and editorial grouping, not ornament.

## 5. Company visual system

The Brief hero contains a reusable `company visual` slot.

For NVIDIA the Paper reference uses a premium AI-accelerator/chipset image with restrained green/blue circuitry. Future company imagery may be generated per issuer, but the UI contract is:

- hero artwork is optional;
- no text, badge, metric, action, or source meaning may depend on the image;
- missing artwork falls back to a quiet sector/company abstraction or neutral material background;
- image crops must preserve text readability and work at desktop/tablet/mobile;
- company artwork is presentation, not evidence;
- imagery is versioned independently from event generations and must never imply data freshness;
- hero edge treatment is implemented by the shared `CompanyVisual` presentation layer, not baked into generated issuer artwork;
- desktop/tablet use a left-side opacity dissolve into the editorial surface plus transition-only blur; mobile uses a bottom dissolve;
- the focal subject (for NVDA, the chip and NVIDIA mark) remains sharp while only the seam/background softens;
- top/bottom/right vignettes stay subtle and exist only to remove the rectangular-photo seam.

A bulk S&P 500 artwork programme is explicitly separate from the first implementation PR.

## 6. Navigation architecture

The existing desktop research shell repeats essentially the same context across four stacked rows: global app header, Research Workspace selector, Back-to-chart/company breadcrumb, and a 13-item flat company-page tab row. Company Intelligence then adds its own Brief / Results / Transcript / Ownership / Sources controls far from the content they govern.

The proposed Terminal hierarchy is:

1. **Global app chrome** — Mastermind identity, global search, Watchlist / New chat / Saved / account. The separate Back to Dashboard button and Analysis label disappear; the Mastermind identity/home affordance owns app-level return.
2. **Research Workspace context** — compact Back to chart, selected company/ticker, selected event, coverage/freshness, and quote context. Company identity appears once.
3. **Compact research navigation dock** — one matte/glass row that contains both the grouped company-page navigation and the selected page's local views. Primary page families occupy the left side; local subpages sit after a divider; page actions sit at the far right. For Intelligence: Brief, Results & outlook, Transcript, Ownership, Sources.

The dock is the preferred desktop pattern because it preserves the page → subpage hierarchy without spending another full horizontal band. It should sit directly above the research canvas, aligned to the canvas edges, with no duplicate breadcrumb row between it and the content.

Responsive projection keeps the hierarchy while changing the control shape:
- **Desktop 1440** — show the full grouped company-page families plus page-local views in one compact dock.
- **Tablet 820** — collapse the company-page families into a selected page-family selector (for example Intelligence ▾) while keeping the page-local views visible beside it.
- **Mobile 390** — show the selected page family in the compact company context area and project the selected page's local views into bottom navigation. A `More` / page-family control opens a full-width bottom sheet containing Overview / Intelligence / Financials / Earnings / Market / Ownership / Lab, rather than forcing the whole family map into a horizontally scrolling permanent header. For Intelligence the local bottom navigation is Brief / Results / Transcript / Ownership / Sources.

Company switching is a first-class Research Workspace interaction, not another page-level navigation layer. Activating the company identity opens a searchable company switcher with recent companies and direct ticker/company search. Switching company clears event-specific evidence selection and any event-only UI state before the new company context is rendered.

The company-page groups replace the current 13 flat tabs:

- Financials: Statements, Statistics, Revenue, Dividends.
- Earnings: Earnings, Transcripts, Analyst.
- Market: Technicals, Seasonal.
- Ownership: Insider plus current/future institutional-holder surfaces.
- Lab: experimental tools.
- Overview and Intelligence remain first-class direct destinations.

This pattern intentionally preserves the existing global left rail. Do not introduce a second company-research sidebar.

The hierarchy is therefore **Research Workspace → company page → page-local subpage**. It reduces duplicated vertical chrome, moves local controls next to the dashboard they affect, and gives future research pages/subpages room to grow without another horizontal-tab cram problem.

The preferred Paper reference is Company Intelligence · Navigation Preferred · Compact Dock · Dark · 1440. Company Intelligence · Navigation vNext · Dark · 1440 is retained as an earlier exploration. Navigation Interaction · Financials Menu Open · Dark · 1440 shows the grouped-menu behavior, while Navigation Architecture · Research Workspace Hierarchy and Research Workspace · Page Family Map document the hierarchy and expansion model.

## 7. Information architecture

Replace the audit-first inner navigation with five research lenses:

- **Brief** — synthesis-first default.
- **Results & outlook** — reported changes, comparable deltas, guidance, call read-through.
- **Transcript** — searchable call, topics, analyst exchanges, source spans.
- **Ownership** — point-in-time tracked-manager 13F context.
- **Sources** — coverage, receipts, clocks, missingness, method and integrity boundaries.

Event history remains a persistent period selector rather than a full competing lens. Topics become a transcript/call-map capability rather than an isolated page tab. Existing deep functions remain reachable even when their first-frame position changes.

## 8. Brief lens

### 8.1 Company/event control strip

Show only high-value identity and state:
- display name + ticker;
- selected event + date;
- truthful coverage/freshness state;
- Read transcript;
- Sources / Evidence;
- Ask Mastermind.

Generation hashes and low-level authority vocabulary move into Sources/Evidence details. `context_only` remains visible in plain language near the research actions and evidence boundary.

### 8.2 30-second brief

The hero is the dominant editorial object. It includes:
- explicit `30-second brief / synthesis` labeling;
- selected event/date;
- one concise central business change;
- short explanatory paragraph;
- two or three descriptive takeaways;
- optional company artwork.

Source-authored text and Mastermind synthesis must be visually and semantically distinguishable. The Brief must not silently relabel model synthesis as issuer language.

### 8.3 First-frame result strip

Prefer four useful, available company-event facts. NVDA reference:
- revenue growth;
- data-center revenue;
- gross margin;
- OpEx outlook.

Do not spend first-frame real estate on a missing metric when a more useful available deterministic field exists. Null stays null; missing never becomes zero.

### 8.4 What changed / Why it matters / Key risks

`What changed` contains source-backed event changes.

`Why it matters` contains business implications. Any model-authored implication must be explicitly owned by the existing synthesis/analysis layer and cannot become a ranking, recommendation, or trade gate.

`Key risks` contains retained negative facts, constraints, and unresolved conditions. It does not fabricate bearish probability.

### 8.5 What to watch next

Add a compact research-monitor module with categories such as:
- next earnings/event timing when known;
- key debate;
- supply/operational watchpoint;
- policy/regulatory watchpoint.

Unknown future dates render as unknown/pending, not guessed calendar dates.

### 8.6 Context band

Theme and institutional information stay available but become compact context rather than dominant default content.

Theme context shows the primary curated membership/read and a few coverage facts; detailed crosswalk mechanics move behind details.

Institutional context shows current-holder count, tracked value, current filing snapshot, and buyer/trimmer summary. It always carries the 13F filing-lag clock and never claims total ownership.

## 9. Results & outlook lens

The Results lens is not another scorecard. It groups deterministic facts and qualified forward statements:

- at-a-glance current-event metrics;
- comparable current/prior deltas only where the basis matches;
- guidance and management outlook;
- selected management-call read-throughs;
- explicit `Not asserted` treatment for unavailable consensus surprise, event-price reaction, or trade authority.

The page must refuse beat/miss language when basis matching is absent.

## 10. Transcript lens

The Transcript lens uses the existing normalized transcript and existing full reader.

First frame:
- search within the selected event;
- speaker/topic filters;
- call map showing retained topic span counts, explicitly not sentiment/importance;
- analyst Q&A list;
- selected question/answer opens a transcript evidence rail;
- full reader handoff preserves event/transcript identity.

No second transcript renderer is introduced.

## 11. Ownership lens

Ownership is a dedicated lens rather than a giant card inside the default Brief.

First frame:
- reporting set completeness;
- current tracked holders;
- tracked market value;
- filing snapshot clock;
- manager tape with action, filing date, value, book weight, shares/move;
- aligned historical periods;
- direction only when the existing institutional contract allows it.

The evidence rail for Ownership exposes manager filing receipts, filing dates, reporting-set gaps, and the rule that the roster does not equal total ownership.

## 12. Sources & Method lens

Sources becomes the trust center for the selected event/generation.

It shows:
- source-family coverage matrix;
- structured-event availability;
- transcript availability;
- raw issuer material availability;
- source receipts;
- selected event/generation identity;
- `as known at` clock;
- exact-span status;
- typed missingness;
- integrity boundaries such as unjoined consensus or market reaction.

This lens must make absence understandable rather than burying it in warnings.

## 13. Evidence interaction

Evidence is contextual, not the primary visual hierarchy.

Desktop 1440×900:
- the preferred Brief defaults to a full-width focus canvas with Evidence closed;
- an Evidence action in the compact research dock shows the current related-evidence count when available;
- selecting Evidence or a claim opens a fixed right-side overlay drawer without reflowing or narrowing the underlying research canvas;
- selected claim/exchange visible;
- quote/excerpt first;
- source name/material/date second;
- technical receipt/hash details below or progressively disclosed;
- close restores focus to the triggering claim/action.

Tablet 820×1180:
- inspector closed by default;
- opens as a fixed right-side sheet with scrim.

Mobile 390×844:
- opens as full-width bottom sheet;
- focus/escape/close behavior preserved;
- no horizontal document overflow.

Every event/ticker switch clears stale evidence selection so a receipt cannot refer to another event.

## 14. Degraded and partial states

The redesign must treat degraded states as designed product states:

- `partial`: useful available findings remain visible; source-specific gaps appear next to affected content.
- `stale / last verified`: the last verified generation may remain visible, but current freshness is never implied.
- `metadata_only`: clearly distinct from an exact source document/span.
- `not_covered`: concise coverage boundary, not a processing spinner. Keep the shared Research Workspace navigation active, explain that no canonical event workspace/fallback exists, and route the user to truthful available surfaces such as Overview / Financials / ticker-scoped Ask Mastermind instead of presenting a giant empty panel. On mobile, the state replaces unavailable Intelligence-local bottom navigation with truthful available routes (for example Overview / Financials / Ask / More) rather than leaving dead Brief/Results tabs visible.
- upstream error: explicit retryable/unavailable state; do not silently fall back unless the canonical v2 `not_found` rule permits v1.
- institutional incomplete filing set: preserve filing lag and withhold invalid movement assertions.

## 15. Ask Mastermind

Current production behavior is ticker-scoped. The redesign may present an event-scoped future target, but implementation must not claim event/generation scoping until the Brain handoff contract actually carries it.

Preferred implementation outcome:
- pass selected ticker, event identity, and immutable generation identity to Brain when the supported interface is extended;
- retain fallback behavior that safely opens the existing ticker-scoped Brain rather than silently doing nothing.

This contract extension is implementation work, not assumed present state.

## 16. Responsive behavior

One responsive application, one data contract.

Desktop 1440×900:
- main research canvas + evidence rail;
- synthesis, key metrics and key changes above the fold.

Tablet 820×1180:
- full-width canvas;
- evidence closed by default;
- three insight panels can remain side-by-side only if legibility survives; otherwise wrap without changing semantics;
- context modules become a two-column band;
- evidence is right-side sheet.

Mobile 390×844:
- company/event header compresses;
- Brief image becomes a compact full-width visual;
- only the highest-value result cards stay above the fold;
- insights become stacked sections;
- evidence becomes bottom sheet;
- bottom navigation provides direct access to Brief / Results / Transcript / Sources.

## 17. Accessibility and internationalization

- Preserve keyboard roving-tab semantics for research lenses.
- Evidence close restores focus to the triggering claim/action.
- Use real buttons/links for interactions, not styled non-interactive divs.
- Touch targets remain usable on tablet/mobile.
- EN/ZH remain one semantic IA; translation cannot change data/state meaning.
- Long Chinese strings, long company names, and long evidence excerpts must wrap without horizontal overflow.
- Semantic colors are never the sole carrier of status meaning.

## 18. Implementation seams

Primary source seams:

- `terminal/components/fin/CompanyIntelligencePage.tsx`
- `terminal/components/fin/CompanyIntelligenceV2Current.tsx`
- `terminal/app/company-intelligence.css`
- `terminal/components/fin/EvidenceRail.tsx`
- `terminal/components/fin/CompanyThemeContextCard.tsx`
- `terminal/components/fin/CompanyInstitutionalContextCard.tsx`
- `terminal/lib/eventWorkspacePresent.ts`
- existing transcript search/reader components
- existing Brain handoff helper
- `terminal/e2e/company-intelligence.spec.ts`

The preferred implementation shape is a shared presentation layer used by both v1 fallback and v2-current paths rather than duplicating the redesigned DOM twice.

## 19. Implementation sequence

1. Extract/freeze shared presentation primitives and research-lens IA without changing data meaning.
2. Recompose v2 Brief onto the shared presentation architecture.
3. Recompose v1 fallback onto the same presentation architecture, preserving v1-only data differences.
4. Build Results & outlook lens.
5. Build Transcript lens and evidence-span interaction around the existing reader/search owner.
6. Move expanded institutional content into Ownership lens and keep compact context in Brief.
7. Build Sources & Method trust center.
8. Implement responsive evidence rail/sheet behavior and mobile/tablet composition.
9. Implement EN/ZH parity across the dark-mode design.
10. Add/extend event-scoped Brain context only if the Brain contract is formally extended and tested.
11. Add optional company-artwork resolver with graceful fallback; do not block the core redesign on bulk artwork generation.

## 20. Acceptance and proof

Product acceptance requires all of the following:

- approved Paper composition represented faithfully on the real Terminal route;
- v2 current path and canonical v1 fallback both use the redesigned presentation architecture;
- non-`not_found` v2 failures remain explicit;
- ticker and event switches cannot leak prior evidence selection;
- complete / partial / stale / metadata-only / unavailable / not-covered states are honest;
- institutional filing clocks and incomplete-set behavior remain honest;
- Results never fabricates beat/miss, consensus or market reaction;
- full transcript reader remains reachable;
- Sources exposes provenance without taking over the Brief;
- dark mode × EN + ZH;
- 1440×900, 820×1180, 390×844;
- keyboard/focus/escape behavior and zero horizontal overflow;
- focused/unit tests, TypeScript, responsive E2E, and existing Company Intelligence E2E pass;
- exact-head independent semantic/visual review;
- protected merge through current repository controls;
- git-gated production deploy from merged `origin/master`;
- exact deployed revision verified on both standalone Analysis and chart-hosted Intelligence journeys with real served inputs.

CI green, merge, screenshots, and local fixture proof are not production acceptance by themselves.

## 21. Paper design states frozen by this spec

Current Paper page contains these design states:

- Company Intelligence · Dark · Desktop · 1440
- Company Intelligence · Navigation vNext · Dark · 1440
- Company Intelligence · Navigation Preferred · Compact Dock · Dark · 1440
- Company Intelligence · Preferred Focus Canvas · Dark · 1440
- Company Intelligence · Focus Canvas · Evidence Open · Dark · 1440
- Company Intelligence · Not Covered · Dark · 1440
- Navigation Interaction · Financials Menu Open · Dark · 1440
- Navigation Interaction · Company Switcher Open · Dark · 1440
- Company Intelligence · Results & Outlook · Dark · 1440
- Company Intelligence · Transcript & Q&A · Dark · 1440
- Company Intelligence · Ownership · Dark · 1440
- Company Intelligence · Sources & Method · Dark · 1440
- Company Intelligence · Last Verified · Dark · Desktop · 1440
- Company Intelligence · Brief · Dark · Tablet · 820
- Company Intelligence · Navigation Preferred · Tablet · 820
- Company Intelligence · Evidence Sheet · Dark · Tablet · 820
- Company Intelligence · Brief · Dark · Mobile · 390
- Company Intelligence · Navigation Preferred · Mobile · 390
- Navigation Interaction · Mobile Page Families Open · 390
- Company Intelligence · Not Covered · Mobile · 390
- Company Intelligence · Evidence Sheet · Dark · Mobile · 390
- Navigation Architecture · Research Workspace Hierarchy
- Research Workspace · Page Family Map
- Research Workspace · Overview vNext · Dark · 1440
- Implementation Note · Hero Artwork Edge Treatment

Paper is the visual design reference; repository contracts remain the implementation authority for data, source, auth, lifecycle and deployment behavior.
