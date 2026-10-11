# Extended quote provenance evidence — 2026-10-11

Protected base: `292357daa86525d6c488fb2042340f782cf91e60`.

The Next.js extended-quote route discarded the incumbent Quote Hub's source and
price basis. The repair preserves a valid source identifier and the existing
LIVE / DELAYED_15M / UNOFFICIAL vocabulary, with missing or unrecognized basis
omitted. It does not activate a Tiingo feed, replace a quote authority, or infer
LIVE from a provider name. The existing timeout and unavailable response remain.

Actual tests:

- `route-red.log`: 2 regressions failed and 9 tests passed before the repair.
- `route-green.log`: 33 tests passed across extQuoteRoute, liveCandle,
  quoteDisplay and quoteRouteView after the repair.
- From `terminal/`, `./node_modules/.bin/tsc --noEmit --incremental false`
  completed with exit 0.

The logs contain actual test output with trailing whitespace removed for Git
hygiene; no assertion or result was altered. Mock Tiingo provenance is a contract
test, not a live Tiingo receipt or production browser acceptance.

Hosted CI run 38161624995 completed successfully at exact head
7506ef1539c8646e7bf52b65b697a102fd549942, including the aggregate and
all responsive shards. The independently commissioned native reasoning review
returned bounded source PASS at that head, with no actionable defects; see
`independent-review.txt`. It ran no tests, provider effects, merge or deployment.

The original Fabric request failed before lease/launch, and was left untouched.
After the user expressly authorized an already permitted alternative, the native
review completed. `fabric-reservation-diagnosis.md` records the filesystem-grant
cause and why a log-only redirect would break adapter status/result/acceptance.
No grant, adapter, lease or original reservation fence changed.

Protected master 2957bd64eec9ac3246a52789acb0f7de55400144 was then
merged into this carrier. It changes Alerts, SQL transitions and CI configuration,
with no intervening change to either reviewed quote file. Fresh integrated-head
CI, protected merge, existing VPS release and live acceptance remain obligations.
The review is not formal GitHub approval, visible provenance disclosure, BOATS
provider qualification or whole-programme acceptance.

Programme source: Macro PR #8698. This Terminal carrier owns only the consumer
metadata repair. Raw Tiingo data and capture remain with the existing Macro
collector and external archive.

The integrated-head hosted ingest job 114557307545 on run 38168953009
failed one migration-namespace guard (1 failed, 1723 passed, 31 skipped):
master's migration 0032 was present, but its #946 reservation still said open.
GitHub confirms #946 merged at 2026-10-11T19:02:37Z as protected master
2957bd64eec9ac3246a52789acb0f7de55400144. Only that row's pr_state
was corrected to merged; SQL and all application-state metadata are unchanged.
The SQL SHA256 is 819cd6f0228c3b3d3ed8ea6c9aac0ac0e7db5b233afbb82977c12636e9994411.
The live merge proof and actual local red/green logs are retained here.
The guard was reproduced in GITHUB_EVENT_NAME=pull_request / PR_NUMBER=945
mode and the complete affected namespace suite then passed. This is source
merge-state evidence, not a claim that #946's SQL was applied to production.

That one-field repair and its SQL hash describe head
df468209483cf215b17b5d0f5d891736b1fcc6ab. Protected master then
advanced to 200786b34d03f454717068512c32fabdb469eda7 via owner PR #947,
which records #946's actual production application. The carrier consumed the
incumbent RESERVATIONS.json byte-for-byte to resolve the adjacent-field conflict;
the SQL and migration README also match that protected base. The final PR has
no migration-source delta. The initiating Tiingo session applied no SQL and
inherits, rather than re-adjudicates, the owner's application receipt.
The namespace suite passed again with that current record in PR #945 mode.
