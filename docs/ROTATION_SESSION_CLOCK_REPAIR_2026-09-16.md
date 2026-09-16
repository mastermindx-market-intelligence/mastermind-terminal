# Rotation programme: actual-close Terminal candle repair

State: BUILT_NOT_PROVEN. Owner: Sol. Operation: rotation-session-close-20260916-sol-001.
Current Chairman direction: advance independent capabilities while other sessions restore PC CI; leave Macro W1 PR7174 held and unchanged.
Procedure: Mastermind f590c068880dbb848bda90b80b73dbcb6688d6fc, Skillpack1.0.1.
Source base: mastermind-terminal 702d81bb35f2c900a5aa1215437bf968aa9e6d93.

## Capability and ownership

The existing regular-session filter and resampler now use the date's actual close. A bar starting at13:00 on a13:00 close cannot contaminate the final candle. Existing live-source and stored-history callers consume the repaired helper. Direct resampling enforces the boundary too, including one-minute calls.
The immutable projection comes from Macro's existing lib.nyse_calendar and engine.session_digest.session_window_et. The exporter verifies four source files against Macro112eba2036fd1186e67b914e194f4fa541cfc4df before and after generation. Runtime imports no Macro checkout, filesystem or provider. No holiday arithmetic is copied into TypeScript.
Coverage2016-01-01 through2028-12-31 has3267 session rows. Absent dates within coverage are closed; unsupported dates, invalid epochs or malformed projection metadata yield US_SESSION_CLOCK_UNAVAILABLE instead of an assumed16:00 close. Future unannounced closures are not known: owner corrections require regeneration and normal release.
Projection SHA256:d803dc85fcf3318bc78392e1d645b7063881b86eec95cf06f51192e1d836de98. The exporter --check replay reproduced the exact bytes.

## Executed proof and limits

119 real-module tests passed across new clock tests and existing session/source/route/math suites. Coverage includes boundary-price/volume sentinels, early and full closures, DST, direct-resampler enforcement, all3267 projected-session volume/anchor checks, input immutability, unsupported coverage and unchanged extended behavior. The new suite first produced10 failures and15 passes before the shared-code repair.
Full TypeScript checking passed after restoring four exact omitted tracked fixtures and needed source directories; no fixture bytes changed. ESLint passed on the changed TypeScript and test files.
Forty production API responses were captured for five symbols across four dates at5m/4h, with no provider credential. Each early-close5m response still contains43 rows; the canonical owner admits42. Raw captures are private local proof input, not committed corpora.
The actual local Next.js GET /api/intraday returned a repaired XOM4h bar from these stored inputs and printed store-only freshness. Complete20-case repaired HTTP parity and production/browser acceptance remain owed. Captures and unit tests are not that proof or a trading backtest.

## Scope, refusals and continuation

Macro #7094 retains the combined Daily/Weekly/4H scientific HOLD. This disjoint development does not admit W3 or waive predecessor/release acceptance. Macro #7180 owns plan-origination/source-clock changes, so those paths were not edited. The complete15-open-PR Terminal census had no overlap with the four intraday source/route paths at pickup.
Extended04:00-20:00 policy, provider-hour fallback, quote hub, feed rights, price basis, indicators, ranking, plan admission and PC runners are unchanged. Whole-universe09:30 parity and point-in-time/correction/basis qualification remain open.
Builder submission was refused before execution; no log or operation lease existed, so Sol implemented directly. An additional malformed-projection test append and custom replay-script preparation were refused; neither is credited or repeated through another tool. The existing product HTTP path remains a separate real-consumer proof surface.
Release requires independent exact-source review, required CI/current-base compatibility, TOI owner acceptance, normal git-gated deployment and real consumer proof. Do not call this a delivered adaptive strategy. Exact next task: finish source review and real-path acceptance, then continue the existing source-basis and episode/publication work without creating another calendar, store, feed or trading authority.
