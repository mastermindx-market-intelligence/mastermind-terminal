# Portfolio workspace — implementation and research

Status: **implemented and independently reviewed; production release in progress**. Delivery: [Terminal PR #1044](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044). The five original Paper screens have been edited and visually checked. This report covers the Portfolio implementation, financial-data research, reviewed integration and release evidence through 2026-10-19. Production migration, deployment and authenticated live acceptance remain pending at this checkpoint.

## Source and review boundaries

The reference is [MASTERMIND PAGES / Portfolio](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1O-0). The implemented workspace uses its Overview, Holdings, Risk, Targets and mobile direction. The separate Research artboard is explicitly a future preview; it is not evidence of an available backend capability.

The candidate branch is `claude/terminal-portfolio-personal-desk-20261018`, based on protected Terminal master `d6515f47232538161af8d3d4c27064165eda40fe`. It integrates the exact source of:

| Dependency | Source identity | Integration |
| --- | --- | --- |
| [Portfolio monetary basis, #866](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/866) | `60fd6d997df52d2d8331de85ab63014446e16ef9` | Merge `38f38115f`; explicit entry units, quote provenance, common-unit totals and cost basis |
| [Portfolio brief retry, #888](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/888) | `7257b308893288568aaa3c9d6c44933fa97622e3` | Merge `c567e9863`; existing retry and cancellation lifecycle retained |

The incumbent branches and shared checkouts were preserved. Integration here does not claim either original PR is merged, its DDL is applied, or its acceptance has transferred.

The current application source is `b8d3a2a5f0b13a7abac7d612118db8aeee04b20b`, incorporating protected master `3e0be25bfc1393d75684a9ebb97dacf2fbf2c5d9`. Independent review accepted the repaired Portfolio application and the bounded master integration. The original findings involved target drafts appearing saved, actionable errors hidden by the editor, and inaccurate currency-gap explanations. A later integration review also repaired native dialog ownership of the new chart palette shortcut. All are covered by executed focused verification. The current published candidate still needs its own complete hosted checks.

The actual Paper reference capture is [portfolio_personal_desk_paper_20261018.jpg](../design_refs/portfolio_personal_desk_paper_20261018.jpg). Implemented browser captures are in [verification/portfolio-workspace](verification/portfolio-workspace/). These captures use explicitly fictional test holdings and controlled prices, not a live user's portfolio.

## 1. What changed in the design

The design should help a user answer four immediate questions: what do I own, what changed in price, what is missing from my records, and where am I concentrated? Each answer now has a distinct place. The overview no longer competes with the entire record editor, methodology, research feed and target form.

| Design problem | Implemented treatment | Reason |
| --- | --- | --- |
| Too much information competing above the fold | Three primary measures, a compact holdings preview, a repair list and concentration | Establish an obvious reading order |
| Repeated headings and standing explanatory paragraphs | Short section introduction; methodology in native disclosures | Preserve the explanation without making every visit a reading task |
| Research copy that could imply current holdings analysis | “From the desk” disclosure with the producer's population and coverage inside | Keep the producer's actual scope visible |
| Duplicate ticker rows difficult to distinguish | Every record retains its own ID; the inspector opens the selected record's quantity, price, date and notes | A security may legitimately have several records |
| Dense inline edit/close/delete controls | One “Review record” action, then a focused inspector | Make the row easy to scan and intentional actions easy to reach |
| Legacy mobile column rules hid entry and quote fields | One table becomes stacked records at narrow widths; all financial fields remain visible | A responsive layout must preserve the information needed to act |
| Unknown data represented like an empty book or zero | Separate unreadable, empty, stale, unsized and missing-coverage states | The distinction changes what a user can safely conclude |
| A failed mutation message behind an open dialog | Failure appears inside the active record inspector or editor | Feedback must be visible where the action happened |
| An interrupted form lost work | Dirty dismissal asks whether to keep editing; failed confirmation retains the draft | Protect user effort |
| Rapid target edits could show the wrong “Saved” state | Separate draft generation, pending state, canonical target confirmation and queued clears | A save indicator must refer to the user's latest intent |

### Four sections

**Overview** shows priced value, day change and since-entry price change. Each measure states its population or basis. Coverage and calculation details contain missing prices, missing entry prices, unit limitations and the exclusion of cash flows, income and fees. “Review next” points to concrete missing record fields or unavailable price coverage. It is a repair list, not a security ranking.

**Holdings** supports open/closed status, symbol/company/notes search, entry-detail and price-coverage filters, and pages of 25 records. A preview shows five records on Overview. Search preserves separate records in a repeated ticker; it never replaces record identity with a ticker key.

**Risk & exposure** reuses the existing deterministic concentration, industry and size calculations. Unavailable analyses are explicit. History is requested only when this section is first opened. The history explanation states that it models today's cost-weighted holdings through past prices; it does not report the user's actual account return.

**Targets** reuses the existing target store and writer. Targets are the user's chosen percentages and tolerance bands, compared with the same eligible cost basis as exposure. Switching sections keeps the form mounted, so a pending save or a newer edit survives. A first-target failure retains the entered value and restores usable controls. Clearing a target remains a queued user choice even when a previous save is awaiting readback. Explicit nonnumeric target or band text now remains an invalid draft and cannot produce a request or a Saved indicator. Saved requires a complete match between the latest visible target/band and canonical confirmation. Currency unknown, currency mismatch and amount overflow each receive one accurate book-level explanation; an existing book is never described as empty merely because its costs cannot be compared.

### Visual and interaction treatment

The dark surface uses a quiet canvas, restrained borders, a clear primary value card and positive/negative color only for actual price changes. The header now keeps the title, useful record/freshness information and actions, removing repeated privacy and marketing lines. Selected tabs use a neutral fill and stronger text. The new workspace follows the current [container and navigation rule](https://github.com/mastermindx-market-intelligence/macro/blob/f3fefce7e893755dcec18cbfe06f421c2c4d2db8/docs/DESIGN_DOCTRINE.md#L106): neutral even borders, no decorative colored edge stripes, preserved quantitative marks and full keyboard focus outlines. The Portfolio light treatment uses Paper's cool canvas, white panels, darker text and firmer hairlines. Both retain the same ordering and behavior. Terminal currently publishes a dark-only global shell; the light captures verify Portfolio's scoped light compatibility, not a newly implemented global theme preference.

Core interactive controls have a 44 CSS pixel height floor. Tabs support arrow keys, Home and End with the proper selected state and panel relationships. Native dialogs provide modal focus handling; closing an inspector restores its originating control, with the active tab as a fallback. Destructive deletion is confirmed inside the inspector. Motion uses short transitions and respects reduced-motion preferences.

These choices follow the [W3C tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) and [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). The touch target and reduced-motion decisions are informed by [target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) and [animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). The implementation has not been certified for comprehensive WCAG or assistive-technology conformance.

## 2. Backend construction implemented

### One canonical holdings owner

`portfolio_positions` remains the canonical position store, and `lib/portfolio.ts` remains its service. The workspace adds no parallel portfolio database, watchlist mirror, general ledger or authority plane.

The existing authenticated route resolves the owner, uses the existing Supabase client and RLS, and explicitly scopes position reads and writes to the user ID. The design is consistent with [Supabase's RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security): owner checks belong in database policy as well as the application boundary. Fixture tests do not substitute for deployed RLS proof.

### Separate the essential read from optional analysis

| Endpoint | Result | Contract |
| --- | --- | --- |
| `GET /api/portfolio?view=positions` | Canonical positions and `bookKey` | Returns before per-security risk artifact fan-out |
| `GET /api/portfolio` | Existing positions and risk, plus `bookKey` | Backward-compatible default path |
| `GET /api/portfolio/targets` | Existing target summary plus `bookKey` | Key comes from the holdings used for that summary |
| `GET /api/portfolio/risk-history` | Existing historical model plus `bookKey` | Read-only; no snapshot insert |
| `POST /api/portfolio` | Existing create/update/close/reopen/delete receipts | Optional create intent ID added |
| `POST /api/portfolio/targets` | Existing set/clear operations | Same writer; exact canonical target readback required |

Read responses use private, no-store caching. The client validates complete HTTP position payloads before accepting them, including duplicate IDs, finite/null numeric values, currency shape and status. Malformed optional risk, target, history or brief payloads cannot be consumed as successful analysis.

The deeper pre-existing database row decoder still omits rows missing their ID or ticker. The new HTTP guard is not a claim that every possible database corruption now causes a whole-book refusal. The existing service read limit is 2,000 positions; production scale work must address that limit explicitly before supporting larger accounts.

### Bind optional results to the book they describe

The server hashes a sorted canonical representation of all returned records: ID, ticker, shares, entry price, entry currency, entry date, notes, status and creation timestamp. This `bookKey` is an ephemeral content binding.

The client accepts optional results only when their key matches the displayed holdings **and** their request belongs to the current read generation. Both are necessary: an old response may have the same holdings key, while targets, coverage or other analysis inputs changed. A content match alone is not a freshness guarantee.

A new canonical holdings read publishes immediately. It invalidates old risk and history while fresh enrichment is pending. Saved target values may remain visible, but current weights and drift are withheld until a matching read arrives. A failed refresh keeps the last successfully read book with an explicit stale message. An initial unreadable book does not claim zero records or enable entry against an unknown population.

The displayed “Holdings checked” time refers to that canonical read. It is not the quote timestamp, artifact timestamp or market-data freshness.

### Confirm mutations against intent and authoritative state

A successful HTTP status is insufficient. The shared `portfolioMutation.ts` predicate checks the normalized expected user intent, the returned receipt and the canonical reread. Create/update compare the fields using the service's own normalizers. Close/reopen require the expected status. Delete requires the intended ID's absence.

PortfolioView and chart Add-to-Portfolio retain their own request lifecycles and use this shared predicate. A valid receipt cannot replace canonical readback. An unconfirmed outcome keeps the form and explains that the change could not be confirmed; it does not assert that the server definitely saved nothing.

Known position refusals use an exact allowlist of HTTP status and machine reason. The active editor translates them in English or Chinese, preserves every entered field and the original create-intent UUID, and focuses a field when the reason identifies one. Arbitrary or malformed server text and unexpected statuses use the generic unconfirmed message. Target confirmation failures also describe uncertainty without claiming that the server made no change.

Position and target writes are serialized within the page. A manual refresh can supersede a mutation's display read without erasing that mutation's owned confirmation. A target confirmation canceled by display refresh gets one separate canonical target read; its old computed weights cannot paint into the newer display generation.

### Protect create retries without a second ledger

PositionModal creates a UUID for a mounted add intent and retains it through retry. The existing primary key stores that ID. On the database's specific unique-violation response, the service rereads that ID under the same owner and compares the normalized payload. Identical intent returns the existing record. A changed or foreign-owned intent returns a conflict, without updating the row or disclosing another owner's data.

This does not promise permanent exactly-once execution. An older client omitting the optional ID retains its existing behavior. Closing the form creates a new intent next time. Hard deletion removes the identity used for reconciliation, so replay after deletion can create again. These limits are characterized in tests and must remain visible in any future API guarantee.

## 3. Research conclusions for useful intelligence

### Establish valid financial meaning before adding more numbers

The current store is a set of position records. It is not a transaction, cash, income, fee or account valuation ledger. Therefore “since entry” can describe comparable price change on recorded quantities; it cannot accurately stand in for a complete investment return.

The [GIPS handbook for asset owners](https://www.gipsstandards.org/standards/gips-standards-for-asset-owners/gips-standards-handbook-for-asset-owners/) distinguishes time-weighted returns from money-weighted returns and explains the role of external cash flows and valuations. The product implication is architectural: an actual return feature needs dated external flows, account valuations and an explicit method. A richer chart alone cannot supply those missing facts. This is research guidance, not a claim that Terminal is GIPS compliant.

A future accounting layer should distinguish purchases, sales, deposits, withdrawals, dividends, interest, fees, withholding, splits, transfers and corrections. Each imported event needs a source ID, account/owner identity, native unit, effective time, ingestion time and reconciliation status. Corrections need an auditable relationship to the original event. Holdings and valuation views should be deterministic projections of that history. The existing snapshot API remains a useful manual-record interface, but must not be silently relabeled as a transaction book.

### Currency is part of the observation

A quote amount and its currency must come from the same selected observation. The current quote must not be assigned the entry currency, and an unknown legacy entry currency must not be inferred from today's listing.

The integrated monetary dependency records entry currency with a basis tied to ticker and entry price. An older writer changing either invalidates the unit receipt; changing the price back cannot resurrect a stale currency. Current monetary totals require a common explicit unit across the eligible cohort, or withhold the aggregate. No FX conversion is guessed.

A future base-currency view requires dated FX observations, explicit quote direction and source provenance. Transaction conversion, current valuation conversion and performance translation are different operations and should be specified separately.

### Concentration needs more than ticker count

[FINRA's concentration guidance](https://www.finra.org/investors/insights/concentration-risk) identifies concentration through correlated industries, regions and security types, and through overlapping fund holdings. Consequently, a count of securities or a largest-position percentage cannot represent all portfolio risk.

The current release candidate reports descriptive cost concentration and coverage. Useful later additions include fund look-through, issuer concentration across listings, geographic revenue exposure, currency exposure, liquidity measures and scenario sensitivities. Each requires licensed input coverage, a declared denominator and an appropriate unavailable state. None should be compressed into an unexplained “health score.”

Long, short, leveraged and derivative positions also need gross/net exposure and contract-specific treatment. Positive cost-basis concentration is not a complete exposure model for those books.

### Stable identity must precede cross-listing intelligence

Ticker text is a display and lookup key, not a sufficient long-term identity. [OpenFIGI's mapping documentation](https://www.openfigi.com/api/documentation) illustrates separate instrument, composite and share-class identifiers, alongside exchange and security-type information.

Our design inference is to preserve listing, security, share class, issuer and account record as separate concepts. This supports corporate actions, ticker changes, delistings and fund look-through without collapsing distinct instruments. Adoption of any identifier feed still needs an existing-provider and rights assessment; this research does not commission a new feed.

### Intelligence should explain evidence and help the user act

The existing Market Ontology, Company Intelligence, Thesis and Monitor surfaces should remain the owners of their respective facts and workflows. Portfolio should compose their relevant outputs around the user's held securities.

| User question | Useful product behavior | Required evidence |
| --- | --- | --- |
| “What needs my attention?” | Prioritize missing entry fields, unavailable prices and coverage changes | Canonical record and capability-specific gaps |
| “What changed around what I own?” | Show material developments joined to held securities | Dated source, entity match, materiality and coverage |
| “Where am I exposed to the same story?” | Explain common industry, issuer, theme or underlying fund exposure | Stable identity and declared aggregation basis |
| “Why does this matter?” | Link the development to a company's relevant exposure with a concise explanation | Traceable company and event evidence |
| “What should I investigate next?” | Open existing company research, an Investigation, Thesis or Monitor workflow | User-controlled context and the existing workflow owner |
| “What if this assumption changes?” | Compute a labeled scenario from explicit inputs | Sensitivity method, inputs, units and limitations |

Active Market Ontology states can be projected into the personal workspace through their existing definitions. Dormant themes must not be presented as active transmission. Portfolio holdings do not become an input to the product's signal, score, ranker or alert authority. A personal explanatory composition must not create a competing truth, ranking or notification plane.

The implemented candidate already supports the first question, precise record review, descriptive exposure, target comparison, company research links and the existing desk/event consumers. The broader event-to-exposure intelligence and transaction accounting described above remain planned capabilities, not shipped claims.

### Evaluate utility and numerical correctness separately

Financial calculations need exact fixtures for units, missingness, corporate actions and cash flows. Intelligence needs dated evidence and evaluation of whether explanations help users complete real tasks. Useful measures include correct source attribution, entity-match precision, unsupported-claim rate, unresolved coverage, time to correct a record and successful research follow-through.

[The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) explains why repeated selection over historical results can make an attractive backtest misleading. A credible research process should retain attempted hypotheses, use point-in-time inputs, separate development and evaluation periods, account for selection, and include prospective utility checks. The candidate introduces no forecast score or backtested performance promise.

## 4. Verification and performance evidence

The browser acceptance uses the real Next routes and an isolated account-shaped fixture transport. Controlled quote and optional-analysis responses make the mathematical cases reproducible. This proves source behavior, not deployed Supabase or live feed acceptance.

Completed evidence includes:

- 87 Portfolio browser checks across desktop 1440, tablet 820 and mobile 390: currency round trips, exact-record CRUD, watchlist separation, zero-row and contradictory receipts, target persistence, stale/unreadable recovery, keyboard navigation and layout.
- English/Chinese and dark/light Portfolio captures for Overview, Holdings, inspector, Risk and Targets; additional edit, saved target, unreadable and empty states.
- Canonical fast-read contract tests proving optional artifact fan-out does not delay holdings.
- Request-generation and content-key tests, including late responses, a refreshed book during mutation confirmation and canceled target confirmation.
- Create retry tests covering response loss, concurrent identical attempts, payload conflicts, owner separation, reconciliation failures and the hard-delete boundary.
- Shared mutation intent/receipt/readback tests and the retained earlier page and Settings ordering tests.
- TypeScript and scoped lint checks. The large pre-existing TerminalShell lint baseline is measured separately; no whole-repository lint-clean claim is made.

Hosted CI on the initial source head also passed all 12,396 unit tests and TypeScript. Its remaining findings were the migration collision and four copy-ratchet findings. The follow-up centralizes pagination and currency-example translations and corrects a ratchet false positive: a machine-only `data-status` attribute inside a mapped JSX child must not inherit the ancestor's visible-text classification. Five positive/negative controls retain detection of real child, accessible-label, and conditional-fallback text. The matcher enumerates each terminal raw-property suffix so a preceding machine attribute cannot hide a later visible fallback. The follow-up passes 92 scoped unit tests, all six guard self-checks, the full candidate's plain-language diff with zero blockers or waivers, TypeScript and the changed-copy lint scope. Its namespace/runner suite passes 189 Python tests.

The review-repair source at `bfecb7029c16185f5fdf9b9b55616f2bff85853e` additionally passes **191 focused tests in seven files**, covering status/reason mapping, actual editor focus and accessible errors, retained create identity, target generations and band validation, and real currency-gap producers in English and Chinese. The focused browser run passes **16 checks with two expected skips** for a desktop-only chart picker case on tablet/mobile. It exercises both Portfolio and chart entry, visible field/conflict feedback, stable identity across four attempts, lost-response reconciliation, contradictory receipts and responsive error layouts. Six new editor-validation captures bring the committed screenshot set to 78. The full TypeScript check, changed-module lint (zero errors or warnings) and the plain-language ratchet (zero blockers or waivers) also pass.

A final review found one remaining acknowledgement edge: an externally cleared target could leave a blank untargeted row labeled Saved. Source `58c9860f3f8207af58362c3c7fa5b228cff56ac5` removes Saved from untargeted rows, with two additional controller regressions. The resulting controller/view run passes **54 tests**. The neutral surface and state pass completes **27 browser checks**, followed by **12 final-layout checks** after header compaction, covering all four sections and the inspector in both languages/themes at all three viewport sizes. The final source commit refreshes 70 captures. TypeScript and both changed-component lint runs pass; the receipt identifies the header-only edit that followed the typecheck.

The next integration at `b8d3a2a5f0b13a7abac7d612118db8aeee04b20b` preserves upstream command-palette behavior and the watchlist write-failure fixture. Hosted run `39124393087` on prior head `ea57ad23691df6f848cce65fe814b6cd97f9cfa6` passed typecheck and every browser shard, but three Settings assertions still expected the older fixture/copy contract. The correction makes a genuinely populated cost fixture explicitly USD, retains an unweighable null-cost fixture, and tests the current unconfirmed-failure copy without weakening request-order or retained-draft assertions. Both Settings files pass **61 tests**. After master integration, the combined run passes **116 tests in five files**, including the actual native dialog and actual palette guard: button focus blocks the shortcut, actual cancellation unmounts the dialog, and opener focus and shortcut availability return. **Two desktop browser scenarios** pass against the real routes: exact record edit/readback with dirty dismissal, and the signed-in single-list chart picker. TypeScript and the four changed-file lint scope pass. Independent integration acceptance reports no remaining P1/P2 in that reviewed scope.

The machine-readable receipt records exact commands, counts, source digests, log hashes and scope exclusions. Historical full-suite results remain bound to their original source heads; focused follow-up results do not imply that an unrun full suite or production acceptance passed on the newer head. All hosted checks on prior published head `5cff531c3a5311596b0469acfdf915d08c4d1cfd` passed; the final published candidate must obtain its own required checks.

The performance improvements are structural: the canonical fast path avoids risk fan-out, optional enrichment cannot hold up the book, historical analysis is lazy, table pages are bounded, number formatters are reused, and existing hidden-tab quote polling behavior remains. No production P95 latency, Core Web Vitals, concurrent-load or accessibility certification has been measured. Those are release acceptance tasks, not adjectives attached to a local screenshot.

## 5. Release status and remaining acceptance

### Original Paper screens completed

The exact requested file and page have been edited through the intended Studio C4 Paper adapter. Ten guarded operations returned observed application receipts, including the final release of working indicators. The [refinement receipt](verification/portfolio-workspace/paper-refinement-receipt.json) records exact node updates and the five final rendered captures. Overview, Holdings, Risk, Targets and Mobile now use shorter copy, neutral selection surfaces, direct mobile access to all four sections, and clearer financial labels. The position editor has separate entry-price and entry-currency fields, 44px primary controls, preserved focus outlines, and a content-sized page that keeps its lower actions visible. The dated examples and source-population warnings remain explicit. The future Research artboard and separate builder-reference page were preserved.

The adapter prerequisite was completed through [Mastermind #1611](https://github.com/mastermindx-market-intelligence/Mastermind/pull/1611), normally merged at `b92743765aa356a9e918054056ae92f704141723`. The protected installer bytes received independent acceptance, including the inherited Fabric delta. Installer SHA-256 is `461126dad0905962cdc7df51674edbde29896ab3e5d61e10018bdd6d08f4f07a`. The existing independent RDC operator performed the C4 stop/select/start sequence after quiescence. The first stop reply was uncertain after bootout; the same operator positively observed service absence, refused readyz connection and no listener before proceeding. The stop was not replayed. Selection reported APPLIED and start reported true. The new gateway generation was `04560d87-7698-4b7d-8e08-b42f9476026a`.

The intended Studio C4 connection then observed Paper 0.5.14 and the compatible 37-tool catalog `1b9afff4c9bcf6f11f5ca2db301bf25ccdc442025344e2ec402459cedcd6a2db` with write acceptance true. Exact-file preparation succeeded before edits. The [runtime qualification receipt](verification/portfolio-workspace/paper-runtime-qualification.json) records positive lifecycle readbacks, selected hashes and original-log hashes. These are completed runtime and editable-design facts; they do not substitute for deployed Terminal acceptance.

### Monetary migration

#866's pending `0032_portfolio_entry_currency.sql` collided with `0032_thesis_proposal_state_qualification.sql`, already merged and applied under #946. The owned proposal is `0036_portfolio_entry_currency.sql`, preserving applied #946 bytes and the earlier pending #778 `0035_saved_view_guard.sql` claim. Applied #946 SQL SHA-256 is `9e360ed109d0c3d8ff3345e90515a2f8da443a03c22f9015514a1b18a2f23dd3`; Portfolio SQL SHA-256 is `9c09540e7b4e451e55a39d8229b3a73eb93c997578f3dadfdc3f24b47a7f7f4c`.

The initial allocation census examined 168 open PRs. The latest bounded delta, completed at 23:50:23 UTC on October 18, inspected all 808 filenames in ten other updated PRs and found no competing `0036` claim. Integrated master `3e0be25bfc1393d75684a9ebb97dacf2fbf2c5d9` has no `0036` SQL or reservation. #778 remains at `88f2919a5c2222bcf05f452f2549b9af180dcae6`. The current upstream `0033` note clarification was preserved during integration. Namespace evidence is not production apply authority.

[Macro #9593](https://github.com/mastermindx-market-intelligence/macro/pull/9593) contains the narrow forward-disposition decision and reciprocal amendment. Its owned records received independent ACCEPT at `92ce47d25d38fb09bd32da6add26f851660a2d45`. The canonical controller refreshed the branch to `2104a8af14d64fd0b15b900da67d206005878925` after main changed check definitions; all three owned records remain byte-identical. The normal controller merged the accepted decision at 00:14:35 UTC on October 19, with actual merge SHA `97261c2a319e62faec05690c04e6fae180540235`. The disposition is now canonical; its current-source, CI, namespace and runtime gates still precede the production effect. The decision preserves applied #946 and pending #778, supersedes only the pending #866 allocation for this delivery, and requires source, namespace, catalog and RLS gates. It neither invents a new Chairman approval nor changes unrelated migration custody.

The SQL uses one outer `DO $portfolio_migration$` statement around unchanged business DDL. The actual `scripts.supabase_apply.run_apply` pipeline passed all 27 isolated PostgreSQL17.11 checks with fresh connections: one mutation and five readbacks, complete rollback after an intentionally reached post-trigger exception, and preserved behavior, grants and owner policies on success and replay. The existing applier's dry run passes without a network call. A [read-only production preflight](verification/portfolio-workspace/production-catalog-preflight.json) at 11:35:53 UTC on October 18 used only the documented credential pair and existing CurlRunner for six SELECT requests. The table exists, RLS is enabled, force-RLS is false, and eight existing owner policies are captured for comparison. The new currency objects are absent. No production DDL has been sent at this checkpoint.

### Remaining delivery sequence

1. Obtain complete hosted checks on the current Terminal candidate, under the now-canonical currency decision.
2. Refresh namespace and production prerequisites, apply the exact qualified SQL through the existing owner, and interpret its catalog and unchanged ACL/RLS readbacks.
3. Record the actual applied receipt while the Terminal reservation remains open, land this migration-bearing PR alone through the normal release procedure, and immediately complete the ledger follow-up.
4. Deploy the accepted revision through Terminal's existing VPS build owner and verify the served revision.
5. Verify authenticated create, edit, close/reopen, delete, target set/clear, refresh and reopening on the deployed build. Record live quote/artifact coverage and measured latency separately from fixture evidence.

The continuation record belongs in Macro AgentOS under WS:MARKET-OS. This Terminal report documents implementation and research; it is not a replacement organizational memory or a scheduled background worker.
