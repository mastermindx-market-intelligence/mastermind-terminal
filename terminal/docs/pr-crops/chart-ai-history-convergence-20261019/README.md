# Chart-upgrade qualification: thesis history convergence

## Failure and repair

Terminal CI run [39182232110](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/39182232110), desktop-2 job [117837222731](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/jobs/117837222731), failed the existing rapid Back/Forward case on all three attempts. Initial selection and reload succeeded. The final URL named the saved thesis, but the settled UI showed a blank “New thesis” form and no new detail request was issued.

The navigation owner and existing browser test were unchanged from joined master at candidate `70959d4603e3eb1df2cb41ec69febb69bc683522`. This establishes provenance, not a passing base execution. A normal local run and eight normal repetitions passed; controlled CPU throttling then reproduced the same missing-read/composer state.

Runtime repair is frozen at **`33e75932da674fdc9445b7926de4278552c68607`**:

1. Workspace history arguments preserve custom fields and the workspace position but omit Next's private markers. The installed Next 16.2.9 wrapper adds its own internals; passing its marker back skips its public URL synchronization.
2. The existing guarded reconciliation effect also observes the primitive serialized search from `useSearchParams`. It still reads the actual browser URL and preserves the existing ID mismatch, pending-action, dirty-draft and active-microtask guards. Request generations, owner keys, discard policy and the original browser assertion are unchanged.

The private-marker correction alone did not repair the browser race. Instrumentation of that intermediate stage observed Back's handler, a missed Forward handler, a framework commit of the Back URL, workspace reconciliation at that intermediate URL, and a later framework commit of the Forward URL without another workspace signal. The final search subscription supplies that signal. Both transitions occurred in the same document; this was not a bfcache restoration.

## Executed proof

| Check | Observed result |
|---|---|
| Original CPU reproduction, 4×/8× execution throttling | 1 passed, 2 failed; 5 not run after the explicit two-failure stop |
| Final identical CPU reproduction | **8 passed**, 0 skipped, 0 failures, 0 retries/flakes; 38.889 seconds |
| New mounted public-history-boundary regression before correction | Failed because Next's observed URL had no selected thesis |
| New mounted committed-route regression before subscription | Failed because the required second detail read never started |
| Final workspace selection | **207 passed across seven suites** |
| Unchanged complete MarketOntology browser spec | **19 passed**, 0 skipped, failed or flaky; 37.230 seconds |
| Source-bound owner captures and evidence guards | **40 PNGs actually captured; 14 assertions passed** |
| Route types / TypeScript | Successful generation; `tsc --noEmit` exit 0 |
| Targeted ESLint | Exit 0; one existing dependency warning in the unchanged initial-context effect |

The final mounted tests also hold the restored detail response, require its context to stay withheld until confirmation, ensure an unchanged search creates no extra read, and verify a late framework commit cannot overwrite an unsaved draft.

The CPU reports retain their actual timestamps. The positive browser run used the runtime bytes subsequently frozen in the source checkpoint; it is not a capture relabeled with a future execution time. The main chart drawing/indicator source and its existing `c41f357…` evidence closure are unaffected by this navigation-only repair.

## Retained artifacts

`manifest.json` records the exact source and artifact hashes. This packet contains compressed raw before/after Playwright reports, both negative traces, all eight positive traces, the actual CPU harness, the intermediate event timeline, and the relevant unit/type/lint logs. The original unarchived passing trace from the negative run is not included; its pass remains recorded in the raw report. Absolute paths inside raw reports identify the original local execution.

The CPU harness was temporary and has been removed from `e2e/` after its tested bytes were archived as `cpu-reproduction.spec.ts.txt`. The permanent regression cases are in `lib/__tests__/thesisOntologyReopen.test.tsx`; the original `e2e/market-ontology-context.spec.ts` remains unchanged.

To reproduce in an isolated checkout, restore the archived harness to `terminal/e2e/chart-ai-history-diagnostic.spec.ts` beside its existing `watchlistStore` helper, then run from `terminal/`:

```bash
CI=1 TERMINAL_E2E_PORT=3590 PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/chart-ai-history-cpu.json ./node_modules/.bin/playwright test e2e/chart-ai-history-diagnostic.spec.ts --project=desktop --workers=1 --retries=0 --repeat-each=4 --max-failures=2 --trace=on --reporter=line,json
```

All three capture owners whose source locks include `ThesisWorkspace.tsx` executed their complete dark EN/ZH desktop/mobile matrices against this frozen source: research views (20 PNGs), thesis proposals (8) and claim form (12). All **40 PNGs were actually recaptured**; 31 retained identical bytes. Their 14 evidence-guard assertions passed. The manifest records each actual capture time, source head, manifest hash and image hash. The existing proposal-seeding/read-adapter and claim-form rendering limits remain unchanged.

The unchanged complete `market-ontology-context.spec.ts` subsequently passed **19 of 19 browser cases**, with zero skipped, failed, retried or flaky cases, in 37.230 seconds (actual start `2026-10-19T02:08:00.951Z`). Its raw report and log are retained here. It also regenerated the 12 existing MarketOntology proof images, including all six EN/ZH thesis-reopening cells; the B-J1 manifest records this actual source and execution. Root inspected all four changed mobile/tablet reopening images.

This packet proves an existing navigation failure and its local repair. It does not establish hosted CI completion, ordinary-model chart selection, analytical quality, or a production deployment. The chart/gateway pair remains subject to its normal release gates.
