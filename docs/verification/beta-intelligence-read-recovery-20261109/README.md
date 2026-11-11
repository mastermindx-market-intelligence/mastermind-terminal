# Company Intelligence read recovery

The standard Company Intelligence page could wait forever for either browser response/body. Repeated Retry also used the wall clock as an identity, so an unchanged timestamp could produce no new attempt. The mounted old component failed six of ten targeted cases.

## Repair

Bound the current two-reader effect to 15 seconds, cancel pending transport, settle only unresolved results with existing typed failures and preserve already verified results or explicit nonretryable errors. The original ticker/attempt check and controller fence reject late work after timeout, new selection or unmount. Retry now increments the existing component nonce independently of clock resolution. No new fetch/cache/identity owner, authority, API, source fallback, authentication or data is added.

## Verified

- 116 unit/reader/retained-context tests across five suites pass, including 12 new cases. Both actual browser reader functions are exercised with stalled response bodies.
- 12 beta and 12 ordinary-shell browser cases pass in English/Chinese at desktop 1440x900, tablet 820x1180 and phone 390x844, no retries and no skips. The real page shows Retry after a stalled current read, rejects late results, loads the exact fixture event/generation after explicit retry, preserves the selected URL and switches the actual Results tab. Two Retry clicks work while wall time remains fixed.
- Final route type generation and `tsc --noEmit` pass. Diff whitespace passes.
- New tests have no lint diagnostics. The component retains exactly the original four set-state-in-effect errors; strict component lint is not claimed green.
- The 24 unedited screenshots were viewed through mode/language contact sheets. Source and image hashes are bound in manifest.json. Controlled AAPL fixture data is not live verified company data.

## Reproducible commands

Run from terminal/ with the installed Node 26 compatibility option `NODE_OPTIONS=--no-experimental-webstorage` (not a product config change).

Units: `npx vitest run lib/__tests__/CompanyIntelligenceLoadRecovery.test.tsx lib/__tests__/SharedShellCompanyIntelligence.test.tsx lib/__tests__/CompanyIntelligenceNativeResults.test.tsx lib/__tests__/companyIntelligence.test.ts lib/__tests__/eventWorkspace.test.ts`.

Browsers: `CI=1 TERMINAL_E2E_PORT=3207 MMX_SHARED_SHELL=1 TERMINAL_E2E_CLOSED_CANONICAL_TRANSPORT=intl-fixture-v1 npx playwright test e2e/company-intelligence-load-recovery.spec.ts --project=desktop --project=tablet --project=mobile --workers=1 --retries=0 --reporter=line`; ordinary-shell proof uses MMX_SHARED_SHELL unset and port 3208. Output directories are distinct and retained.

Types: `npx next typegen && npx tsc --noEmit`, after test servers end.

## Qualification corrections and limits

The first browser fixture assumed one network request per mount. Development Strict Mode produced duplicate initial reads, so its count assertions failed. The corrected fixture binds the application's actual retry query nonce, not raw request count. Product assertions were not weakened. The initial failed logs remain hashed separately.

One generated `.next/dev/types/validator.ts` contained trailing malformed bytes after the test servers ended. Its original bytes/digest were preserved; only this phase's inactive generated dev type cache was removed, followed by fresh route type generation and a full successful tsc. No source exclusion or compiler setting was weakened.

The deliberately closed Investigation baseline remains closed; absent native NVDA current-event coverage is not manufactured. A published PR and green local checks do not prove merge, beta deployment or authenticated live acceptance. Follow the ordinary protected release owner and verify the actual merged revision.
