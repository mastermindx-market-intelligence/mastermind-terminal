# Terminal served appearance implementation — source freeze

This append-only packet belongs to PR #796's sole admitted appearance operation. The source remains uncommitted at HEAD `48ab22b5d429bf4f95a3ac924c765246ae4a1976`, tree `76c69fd492b00d89d83db018f7582aba22561169`; root owns source admission, independent review, commit, CI, merge and deployment.

The exact admission is preserved in [admission-current.json](admission-current.json), comment5977917720 updated2026-10-04T08:28:31Z. The source manifest and deterministic unified patch bind seven production paths and four new tests: [source-final.json](source-final.json), [source-final.patch](source-final.patch). Patch SHA256 `4e4028a0188b75c6ebcf4a6577c017893169ad7a13c2c061ea6028d90bf1d033`, 60,894 bytes. Source-manifest SHA256 `97ed75fefc92ace4efd8b05b487d5576ca14105948db63501762f73abe9d749c`.

## Actual implementation

| Path | Actual change and boundary |
|---|---|
| terminal/lib/terminalAppearance.ts | Closed light/dark/auto resolution; local07:00–19:00; incumbent theme/themeAuto device cache; guarded prepaint; event only for changed resolved mode. No account writer. |
| terminal/app/terminal-appearance-light.css | Pinned Macro818d and incumbent embed token ancestry; real shared shell and Company Intelligence token layer, three existing literal adapters and one precisely scoped brand rectangle adapter. No geometry or markup change. |
| terminal/app/layout.tsx | Imports the light layer after incumbent sheets; existing inline prepaint consumes the matching resolver contract. Locale/startup preserved. |
| terminal/components/settings/SettingsProvider.tsx | Actual identity-bound account store subscriber with owner-generation guard; signed-out device-only display consumer; one cancellable local Auto timer and focus/visibility resume. No new auth/read/write plane. |
| terminal/components/settings/SectionPreferences.tsx | Real existing buttons apply appearance immediately and serialize via the incumbent preference owner; stale UUID/generation cannot apply or write. |
| terminal/lib/i18n.tsx | Only the existing acsAppearNote EN/ZH tuple now describes Terminal + Macro and local-time Auto. |
| terminal/components/ChartPanel.tsx | Exactly p3 chart-label token fallback plus mm:theme registration/cleanup in two incumbent palette handlers. Existing mm:updown, custom styles, Effect5 and indicator recoloring unchanged. |

Six aging source/test files, two parser files,104 committed prior proof files and all other tracked paths remain outside this operation. #735 shared layout/styles/spec and peer sources are untouched. Root's exact ChartPanel custody ruling preserves #757's locked Sol carrier and #723's carrier; selected token/two-hook seams are disjoint. This is not a lease transfer or adoption.

## Fourth literal adapter: actual brand binding

The immutable incumbent source is terminal/components/BrandMark.tsx: outer rectangle x3/y3/34×34/rx8 with fill url(#mbT), inner highlight rectangle, and white M path. The served header contains header.topbar .brand > svg; mobile contains .mobilebar .m-brand > svg. The fourth adapter selects only each first direct SVG rectangle in light mode and sets fill var(--brand), whose admitted light value is #2962ff. It does not select other icons, SVGs, paths, charts, geometry or dark mode.

The actual served pre-repair computed fill was url("#mbT"); the light crop visibly lacked a readable backing. Three repeated gradient IDs were observed in responsive chrome; no causal browser-engine diagnosis is claimed. The source remains unchanged and the direct fill establishes the required visible backing. [brand-red.log](brand-red.log) preserves the failed independent computed-fill assertion. Current served tests compare actual dark geometry/computed appearance before/after a real settings cycle and capture readable light EN and ZH mobile marks. [appearance-integration-first.log](appearance-integration-first.log) binds12 passed actual brand/Auto/chart cases at desktop/mobile, PID7011 exit0,128.76s.

The chart proof inspects actual canvas RGBA samples and token-derived candle/label colors while the same canvas stays connected, with one chart engine, across both modes and west/east conventions. The source-contract test executes exact private source functions/effects through TypeScript AST with React and chart API boundary doubles; it is not a source-text assertion.

## Test provenance and commands

All final tests use the retained Node20.20.2 executable in .claude/evidence/cte-aging/node20-runtime/node_modules/node/bin/node; no runtime installation/provider change. [runtime-final.log](runtime-final.log) records the version. Vitest2.1.9 owning run [appearance-owning-final.log](appearance-owning-final.log) and full [typecheck-final.log](typecheck-final.log) completed in combined PID27150 exit0.

```sh
cd terminal
../.claude/evidence/cte-aging/node20-runtime/node_modules/node/bin/node node_modules/vitest/vitest.mjs run lib/__tests__/terminalAppearance.test.ts lib/__tests__/terminalAppearanceSync.test.tsx lib/__tests__/chartAppearanceContract.test.tsx lib/__tests__/companyThemeExposureSuccessor.test.ts lib/__tests__/companyThemeExposure.test.ts lib/__tests__/companyThemeExposureRoute.test.ts lib/__tests__/companyThemeContextCardAging.test.tsx lib/__tests__/accountPrefs.test.ts lib/__tests__/marketPrefsOwner.test.ts
../.claude/evidence/cte-aging/node20-runtime/node_modules/node/bin/node node_modules/typescript/bin/tsc --noEmit
```

203 passing cases in9files = new appearance17+real provider/control9+chart source6; incumbent parser64+client21+actual route8+mounted card11; accountPrefs35+marketPrefsOwner32.

Meaningful REDs are [sync-red.log](sync-red.log), six actual provider/control failures before implementation; [chart-red.log](chart-red.log),3failed/3passed before selected seam edits; [device-auto-red.log](device-auto-red.log),1failed/8passed before sign-out Auto continuation repair; [brand-red.log](brand-red.log), actual served light-fill failure before the fourth adapter. [sync-harness-node26-failure.log](sync-harness-node26-failure.log) is an unsupported Node26 jsdom harness failure, and adapter-red.log is missing-module bootstrap with no executed tests. Neither is misrepresented as behavior RED. Cold first-run failures are preserved in cold-control-first.log/raw; they revealed the incumbent guest/hidden avatar boundaries and were corrected in the owning test by using the actual existing Terminal settings host.

Whole-file focused ESLint is not green: lint-exact-base.json and lint-current.json attribute the same9react-hooks/refs errors (SectionPreferences5, SettingsProvider4) to exact48ab. The current new files/other affected files have no errors or warnings; zero new warnings remain. No blanket waiver or unrelated owner-seam fix is claimed.

## Actual served proof boundary

The full command is:
```sh
cd terminal
PATH=../.claude/evidence/cte-aging/node20-runtime/node_modules/node/bin:$PATH CI=1 TERMINAL_E2E_PORT=33296 ../.claude/evidence/cte-aging/node20-runtime/node_modules/node/bin/node node_modules/@playwright/test/cli.js test e2e/company-intelligence-appearance.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --output=../docs/verification/cte-appearance-implementation-2026-10-04/appearance-final-raw --reporter=line
```

CI=1 prohibits reuse of an existing web server. Each test begins with a new Playwright context; explicit cold-context cases transfer only the actual clicked browser storage state, with no reload repair. The fixture identity seam already present on /terminal supplies the real account-bound Settings host; /analysis's incumbent local preview is guest. Tests open the actual responsive avatar, Preferences tab and Light/Dark/Auto buttons, then navigate to the mounted Company Intelligence card. They never inject theme CSS, html attributes, or a fixture-only mode switch. Locale cache and synthetic business responses are controlled; actual saved-account delivery is not accepted from the local fixture.

Clock is synthetic2026-08-01T12:00:01Z for degraded states; expiry transition starts2026-08-06T23:00:00Z and crosses2026-08-07T00:00:00Z without reload/fetch; Auto crosses local19:00 and resumes at08:00. The owning E2E timezone is UTC for deterministic local-time tests. The existing five-UTC-calendar-day CTE policy and immutable bytes are unchanged.

The matrix has56cases per viewport,168 total:48mode×language card/semantic-state cases,2cold controls,2brand,2Auto,2chart. States include fresh→expired→historical, source-stale, missing, invalid, actual future partial wire, future generation unavailable, last-good, mixed, unmapped-only, valid-empty, parent-refresh quarantine and unavailable. Viewports are desktop1440×900, tablet820×1180 and mobile390×844. Final outcome and path/hash map will be bound after sole live process24617 concludes.

The prior static reference packet remains immutable and is design evidence only. New served controlled screenshots do not prove natural Company Intelligence/R2 publication, publication age, rights expiry, predictive use, premium/private/service/tier delivery, production deployment or whole-v2 completion. Existing one producer/publisher/API/receipt/card remains; the separate incumbent private-delivery/tier owner gate is unsatisfied.

Final broader focused ESLint (PID38278 exit1) includes ChartPanel:273errors/24warnings across10files. Exact48ab stdin baselines (PID40835 exit0 comparison process) prove ChartPanel264errors/24warnings plus the same SectionPreferences5 and SettingsProvider4 errors. The initial message-counter comparison included changed code-frame line numbers; [lint-final-comparison-mapped.json](lint-final-comparison-mapped.json) maps unchanged source lines and columns and compares rule/severity/diagnostic heading, finding zero added or removed diagnostics. Raw current [lint-final.json](lint-final.json) and exact baseline [lint-final-base.json](lint-final-base.json) preserve complete provenance. Every other affected TS/TSX file has zero errors/warnings. This remains a whole-file lint failure with exact inherited attribution, not a green lint claim or waiver.

Independent review raised DeviceAppearance's same-route guest explicit→Auto path. Source has no guest preference-store subscription or device-intent re-arm event: it follows cached Auto on mount and focus/visibility. Standard guest avatars open signup, and production /analysis requires claims.sub before the sole alternate ThesisWorkspace→ClaimAuthoringForm ledger settings caller renders. Therefore no normal production guest-control path was demonstrated under coherent auth claims. The existing nonproduction ANALYSIS_LOCAL_PREVIEW can reach guest thesis→Claim→ledger→Preferences; standalone /dev/settings guest controls are also production-gated and omit SettingsProvider. The same-route developer guest Auto gap is preserved and disclosed; actual served account→guest-navigation Auto proof does not cover it. Reviewer classified it as bounded nonblocking residue for production-authenticated scope, subject to root's disposition. [guest-reachability-source.json](guest-reachability-source.json) binds six unchanged source paths and exact hashes/Git objects. No auth gate or source correction was made during frozen-source verification.

The final volatile device-intent repair and its source-bound verification supersede the original source-final candidate for delivery. Current patch is source-final-accepted-candidate.patch (e0d8cbade534779fdd8a7090999ef7a559cbf5e51959a9c8c4dbd2c7838117d4); current eleven-file manifest is78577ad07af65b8e82a51cc6c02b407ab20ffc985b8665ded9e8b4d16f2226e6. Final owning207units+tsc, desktop112repeated cases and targetedwidth16repeated controls completed. Earlier/failed/partial evidence remains attributed to its original source. Read README.md and DEVICE-INTENT-REPAIR.md for final results and current product/release limits.
