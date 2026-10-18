# Portfolio workspace — implementation and research

Status: **implemented source candidate; release held**. Delivery: [draft Terminal PR #1044](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/1044). This report describes the isolated Terminal implementation for the Chairman's Portfolio commission, resumed on 2026-10-18. The editable Paper file has been inspected but has **not** been changed. No production DDL, deployment, trade, or notification was performed.

## Source and review boundaries

The reference is [MASTERMIND PAGES / Portfolio](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1O-0). The implemented workspace uses its Overview, Holdings, Risk, Targets and mobile direction. The separate Research artboard is explicitly a future preview; it is not evidence of an available backend capability.

The candidate branch is `claude/terminal-portfolio-personal-desk-20261018`, based on protected Terminal master `d6515f47232538161af8d3d4c27064165eda40fe`. It integrates the exact source of:

| Dependency | Source identity | Integration |
| --- | --- | --- |
| [Portfolio monetary basis, #866](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/866) | `60fd6d997df52d2d8331de85ab63014446e16ef9` | Merge `38f38115f`; explicit entry units, quote provenance, common-unit totals and cost basis |
| [Portfolio brief retry, #888](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/888) | `7257b308893288568aaa3c9d6c44933fa97622e3` | Merge `c567e9863`; existing retry and cancellation lifecycle retained |

The incumbent branches and shared checkouts were preserved. Integration here does not claim either original PR is merged, its DDL is applied, or its acceptance has transferred.

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

**Targets** reuses the existing target store and writer. Targets are the user's chosen percentages and tolerance bands, compared with the same eligible cost basis as exposure. Switching sections keeps the form mounted, so a pending save or a newer edit survives. A first-target failure retains the entered value and restores usable controls. Clearing a target remains a queued user choice even when a previous save is awaiting readback.

### Visual and interaction treatment

The dark surface uses a quiet canvas, restrained borders, a clear primary value card and positive/negative color only for actual price changes. The Portfolio light treatment uses Paper's cool canvas, white panels, darker text and firmer hairlines. Both retain the same ordering and behavior. Terminal currently publishes a dark-only global shell; the light captures verify Portfolio's scoped light compatibility, not a newly implemented global theme preference.

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

The final machine-readable verification receipt records exact commands, counts, source digests and known scope exclusions. Full-suite results there supersede intermediate failed runs retained during diagnosis.

The performance improvements are structural: the canonical fast path avoids risk fan-out, optional enrichment cannot hold up the book, historical analysis is lazy, table pages are bounded, number formatters are reused, and existing hidden-tab quote polling behavior remains. No production P95 latency, Core Web Vitals, concurrent-load or accessibility certification has been measured. Those are release acceptance tasks, not adjectives attached to a local screenshot.

## 5. Release blockers and exact continuation

### Paper connection

Read access to the exact file works. Paper 0.5.14 exposes 37 tools with catalog digest `1b9afff4c9bcf6f11f5ca2db301bf25ccdc442025344e2ec402459cedcd6a2db`. Protected Mastermind source at `ebe2de8f0d94310241362874ec9262ba572a63d2` already qualifies that catalog with bridge 0.1.5 and runtime v12. The staged bridge has digest `82bc7f2d75aec423711922198b68f317618a83de177bf4934b73d7b418a6ecfb`.

The current ChatGPT4 connection still expects catalog `ac18857df0aa6323646333368e5798e7c28de7b4d5f5dc3cb320276e3535daa9`, so write acceptance is false. Its installed owner status reports `corrupt manifest`. The accepted guarded upgrade in Mastermind #1577 is scoped to ChatGPT2. Staged source qualification is not activation of this ChatGPT4 installation.

The next act is a normally reviewed repair/extension of the ChatGPT4 installer cohort and account-scoped upgrade, preserving the exact source manifest, config seal, tunnel identity and write guard. Then verify the actual running catalog on the same ChatGPT4 connection, bind the requested file/page, apply the design edits and capture post-edit readback. Do not change the expected hash by hand, reuse the ChatGPT2-only grant, restart an unsupported cohort blindly, or switch carriers to bypass the refusal.

### Monetary migration

#866's pending `0032_portfolio_entry_currency.sql` collided with `0032_thesis_proposal_state_qualification.sql`, already merged and applied under #946. Draft #1044 now proposes the forward file `0036_portfolio_entry_currency.sql` and an explicit open reservation, derived from #866 at `60fd6d997df52d2d8331de85ab63014446e16ef9`. The protected #946 reservation and applied SQL remain unchanged, with applied SQL SHA-256 `9e360ed109d0c3d8ff3345e90515a2f8da443a03c22f9015514a1b18a2f23dd3`. A refreshed census at 2026-10-18T06:58:50Z checked 168 open PRs, including all ten paginated file lists whose first page was full. Earlier-opened #778 at `88f2919a5c2222bcf05f452f2549b9af180dcae6` now claims `0035_saved_view_guard.sql`. The prior census had observed its older `122694a1249cc15f563f139aa6ee5e36c7862f12` head without that migration. Portfolio therefore moved its pending proposal from 0035 to 0036; no applied migration or incumbent pending file was renamed.

A forward rename is a **proposal requiring explicit precedence disposition**. The binding namespace ruling favors the earlier-opened PR and permits no new exception without amendment. Preserving applied #946 bytes does not itself resolve #866's earlier claim. The disposition must explicitly state how the pending #866 claim is superseded while the applied #946 migration remains intact. The candidate does not make that ruling.

The SQL has no Investigation or Drawing dependency, but #866's current release contract explicitly requires merged-and-applied #804/0030 and #858/0031. The original [namespace decision](https://github.com/mastermindx-market-intelligence/macro/blob/29438bef07502bec9a410092316012b0dcb5562f/agentos/decisions/DEC-SUPABASE-MIGRATION-NAMESPACE-TERMINAL-LEDGER-2026-09-06.md) also requires preceding numbers to be merged and applied. Later operating notes and the [migration landing decision](https://github.com/mastermindx-market-intelligence/macro/blob/29438bef07502bec9a410092316012b0dcb5562f/agentos/decisions/DEC-TERMINAL-MIGRATION-PR-LANDS-SOLO-WITH-LEDGER-FOLLOWUP.md) describe a different application sequence. A narrowly reviewed amendment must reconcile the currency allocation, its independence from these two predecessors, and the applicable review/apply/merge/ledger-follow-up procedure. Neither renumbering nor technical independence silently waives those conditions.

The current upstream evidence is narrower than the old PR bodies: #804 at `ad80ceff67e9b9f95a131a74e6bf57aa19e97b39` has green required hosted checks and a qualified one-statement migration transport, while remaining draft and unapplied. #858 at `8abe1ff920be0b754f66d918df61f5ca6d7505ef` remains red, with its existing two-file repair proposal not yet adopted. This candidate does not alter either carrier.

The forward proposal now packages the unchanged business DDL in one outer `DO $portfolio_migration$` statement, using the existing application's one-statement pattern. The actual `scripts.supabase_apply.run_apply` pipeline was exercised against isolated PostgreSQL17.11 with a fresh connection for every query. All 27 checks passed: the parser produces exactly one mutation and five catalog readbacks; a deliberately reached exception after trigger creation rolls back columns, constraint, function and trigger together; success and repeat application retain entry-unit behavior, old-writer invalidation, grants and owner policies. SQL SHA-256 is `9c09540e7b4e451e55a39d8229b3a73eb93c997578f3dadfdc3f24b47a7f7f4c`. This qualifies source and the actual runner integration; the HTTP production route, live catalog and production persistence remain unexercised. No DDL has been applied.

### Delivery sequence

1. Review the exact combined source and resolve the namespace disposition.
2. Complete the approved account-scoped Paper repair and edit/readback.
3. Accept the exact migration and its runner qualification, reconcile the explicit dependency conditions, and complete the production preflight.
4. Apply the approved migration with pre/post catalog, RLS and old-writer receipts.
5. Conclude required CI and source review, then use Terminal's existing approved VPS release path. No Vercel route is introduced.
6. Verify authenticated create, edit, close/reopen, delete, target set/clear, refresh and reopen on the deployed build, including a fresh session.
7. Verify live quote/artifact coverage, actual latency and any remaining degraded states; record product acceptance separately.

The continuation record belongs in Macro AgentOS under WS:MARKET-OS. This Terminal report documents implementation and research; it is not a replacement organizational memory or a scheduled background worker.
