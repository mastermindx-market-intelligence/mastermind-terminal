# Prophet early observations in the existing Terminal Intelligence workspace

User outcome: the chart/watchlist user can see a stock's recorded early-turn evidence before slow Oracle confirmation, and can distinguish non-coverage, no recorded event, stale evidence and actual source failure. User explicitly commissioned end-to-end implementation on 2026-10-18. This extends existing architecture, not another dashboard, signal engine, auth owner or notification queue.

Source: mastermind-terminal 367f488e5c67d0871d4a34c2aa7371f327d44c3d. Backend: Macro existing GET /api/prophet/observations/v1, schema prophet.early_observations/v1, with parent coverage/timing additions being implemented on sol/web-prophet-wmko-coverage-20261018. Root prophet-wmko-miss-20261018, existing Macro #6817/#6805, Terminal Intelligence #612. Protected law Mastermind d5cce731a23588ddbf4df806bd9e8dcfa5eecf24. Normal source/review/CI/merge/git-gated deployment permissions apply; no order, new trade policy or subscription change.

## Design decision and scope

Reuse the actual user-supplied Intelligence card (Oracle | Research) and docs/INTELLIGENCE_WORKSPACE.md. Do not change drawer geometry, global navigation, chart width, Oracle interpretation or Research score. Add one compact third full-width source row to SignalButton and one evidence section in the SAME existing OracleDash Summary/Research view. No new tab, new drawer, popup, colored container-edge stripe, large prose block, background daemon or local scoring.

Exact compact markup inside the existing button, after .sources:
`<span className={styles.prophet} data-testid="prophet-observation-launcher"><span className={styles.prophetLabel}>Prophet</span><span className={styles.prophetReading}>[source-derived state]</span><span className={styles.prophetDate}>[source session or concise missing-state]</span></span>`.
Use pick(zh,en,zh) bilingual strings and existing tokens. `.prophet { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:4px 10px; border-top:1px solid var(--line); margin:0 13px; padding:10px 0 12px; text-align:left; min-width:0; }`; label font11px/1.3 var(--font-ui), color var(--muted); reading font11px/1.4 var(--font-ui), color var(--text-2), overflow-wrap:anywhere; date grid-column:1/-1,font10px/1.4,colorvar(--muted). Fresh research evidence may use var(--brand-2), never buy-green merely because a trigger exists. Loading/unavailable keeps fixed concise layout. Whole button remains one interactive control; no nested button/link. Mobile padding8px and readable wrapped dates.

Detailed section in Summary/Research BEFORE researchView: heading 'Prophet early evidence' / 'Prophet 早期迹象', source-state/date, up to four native trigger names with their last_date and blockers, optional source close/reset/off-low and per-row price date. Keep readable 12px+ body and token styles in IntelligenceWorkspace.module.css or a small dedicated module. One concise boundary line 'Watch evidence, not an entry instruction' / '观察依据，非入场指令'. Exact B1 relation/receipts go under accessible details, not at rest. A missing B1 relation does not erase recorded observation. Existing chart-jump is allowed only for an actual supplied date; never infer an entry arrow.

State copy (do not conflate):
- Current native observation with verified current row clock: 'Early evidence — review' / '早期迹象 · 待评估'. Root session alone is not row freshness.
- Observation retained or row clock unavailable: 'Recorded evidence' / '已记录迹象', show recorded date and freshness caveat.
- Source-bound NOT_IN_UNIVERSE: 'Not monitored by this scan' / '未纳入此扫描'. This is not 'No setup'.
- Source-bound IN_UNIVERSE with zero recorded rows: 'No recent recorded turn' / '近期无转向记录'; do not claim detector completed unless owner supplies that fact.
- Empty response without verified membership: 'Coverage not reported' / '未提供覆盖信息'.
- 401: 'Sign in to view' / '登录后查看'; 403: 'Plan access required' / '需相应订阅权限'. Auth infrastructure 5xx is 'Source unavailable' / '数据源不可用', not denial or empty.
- Corrupt schema, false authority violation, wrong ticker, stale asynchronous response: refuse source data, do not retain under new subject.
No 'Buy', 'Candidate accepted', probability, current entry-open or first-alert-delivery claim can originate from this observational projection.

## One source read, existing auth authority

Add a thin GET /api/prophet/observations?ticker=... BFF to the SAME Macro owner; never use public R2, local Flow sidecar, or client-supplied upstream URL. Reuse billingAuthResult from app/api/billing/gateway.ts for actual verified session, and its trusted configured BILLING_BASE (or existing ISSUE_DESK_API_BASE if it is the established private Macro binding). The upstream requires require_site_full_user itself; do not invent a new tier/feature rule or cache entitlement. Forward ONLY the verified server-held token to the fixed owner endpoint, not arbitrary client headers. redirect:'error', cache:'no-store', bounded byte read (max128KiB for single-symbol response), total10s deadline and caller abort. Return private,no-store; Vary Authorization,Cookie; nosniff/noindex. Sanitize errors and validate/re-serialize only consumed native schema fields; no raw upstream HTML/errors, holdings, secrets or unbounded detail.

Allow exactly one canonical ticker query (native US shape bounded to16 ASCII symbol characters; confirm the owner's real ticker rule before implementation), no arbitrary upstream path/asof/snapshot/extra params at this single-symbol endpoint. Fix owner query ticker plus bounded limit50. Validate native root schema, status, literal-false authority, each exact row ticker and essential primitive shapes. Unknown additive fields are ignored, not treated as proof. Preserve all owner receipts and clocks consumed. Optional new coverage/timing fields are graceful until the Macro implementation lands; unsupported fields remain unknown. Parent will reconcile exact final API field names before release.

A useProphetObservation hook lives in the existing TerminalShell identity/active-symbol scope, once per active stock. Pass its read state into both SignalButton and OracleDash; no double fetch, no global cache/store and no localStorage. Use request abort, monotonic response sequencing and a synchronous subject+account fence (before effects). Reuse existing Supabase auth-state notification or shell lifecycle to clear accepted private data immediately at sign-out/account change; do not add another auth plane. Refresh on actual symbol/account/focus/visible change with existing60s freshness discipline, no interval daemon or queued retries. 401/403 and failed refresh cannot keep a current-looking stale indication. Respect unsupported markets as 'Not a US scan', not a fabricated US identity mapping.

## TDD and proof

Write failing tests before code. Unit/route tests must catch signed-out-before-network, auth-provider outage, owner403, HTML/oversized/timeout/redirect, unknown/duplicate query, wrong-ticker payload, literaltrue action flags, null/NaN/nonfinite values, missing optional fields, source-date mismatch, and zero-row noncoverage versus no-recorded-event. Component/hook tests must catch rapid WM→KO response reversal, account change/sign-out, late refresh, keyboard control, no nested interactive elements, and bilingual copy isolation. Existing Oracle/Research tests remain unchanged in meaning.

Run real Next/Vitest tooling from installed package versions; read relevant node_modules/next/dist/docs/ first. Existing test:e2e:responsive covers1440x900,820x1180,390x844; add targeted WM/KO fixture states via the incumbent isolated test lane without changing production auth. Capture real component/route light+dark+ZH states (fixture evidence is not live proof). No invented screenshot/result. Full production API+consumer proof follows exact reviewed merge; authenticated access barriers remain explicit.

Allowed source files: new terminal/lib/prophetObservations.ts decoder+view model; new terminal/lib/prophetObservationsServer.ts; thin terminal/app/api/prophet/observations/route.ts; new terminal/lib/useProphetObservation.ts; small additions to SignalButton.tsx/module.css, TerminalShell.tsx, OracleDash.tsx; optional small ProphetObservationEvidence component/module; focused tests; this plan/evidence doc. No changes to billing/session/entitlement authority, dataCache, existing signal math, globalCSS/navigation, alert subscriptions/evaluator, generatedpricefiles, installed production state or broker. First complete this source-to-existing-consumer slice; actual opt-in alert delivery is a separate existing-alert-owner integration, not simulated by this view.


## Resumed delivery evidence — 2026-10-18

The original dirty patch and test logs were preserved on the original carrier. The shared launcher and OracleDash Summary/Research consume the same active-symbol/account hook. No new navigation, alert or episode authority is introduced.

The backend wire contract now separates zero-row subject coverage from real observations. WM outside frozen v1 renders “Not monitored by this scan”; a proven in-universe absence renders “No recent recorded turn.” Missing proof remains “Coverage not reported.” Prices, reset low/date, percentage above the low and slow confirmation preserve actual row values and unknowns. Missing row asof never borrows the document clock.

Independent source review identified an initial-auth race. The hook now begins unpermitted and sends no request before the browser session matches the server account. A delayed mismatching initial event leaves data empty without fetching; a matching event starts the read. Account/symbol transitions retain synchronous data fencing and abort/sequence invalidation.

Executed before publication:
- Existing full unit/type battery: 743 test files, 12,374 passed tests and 4 todo; Next typegen, TypeScript and unit processes each exited0.
- Additional initial-auth and native-source decoder tests: 22 passed, exit0.
- Existing Intelligence workspace responsive checks: 5 passed and4 intentional viewport skips; separate WM/KO cases first exposed missing symbols in the old market fixture and then an outdated row selector. Neither failed run is counted as passing.
- Corrected real-shell WM/KO responsive test: all3 required viewport projects passed, exit0, 32.1s. KO source facts and EN/ZH copy were read through the actual hook; switching via the symbol picker to WM cleared KO facts and showed verified frozen-v1 noncoverage.
- Crops and hashes: terminal/docs/pr-crops/prophet-wmko-20261018/. These are the existing Terminal dark treatment; no second theme is claimed.
- Native payload fixture: terminal/test-fixtures/prophet_wmko_observations_fixture.json, generated through the real Macro loader/query against committed e190 source/public/reference blobs. Auth and transport in the browser test are explicit local fixtures, not authenticated production proof.

The final integrated-head tests, independent review, CI, normal deployment and authenticated live read remain separate gates. Runtime logs remain preserved in this carrier; filenames are not execution verdicts.
