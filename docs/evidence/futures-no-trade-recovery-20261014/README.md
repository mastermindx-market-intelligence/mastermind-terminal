# Captured-window chronology and review recovery

Recovered source: 54bf1bc931832655b7c0ca4de24e26fbab598d11, original PR #964.
The source/API and renderer now retain book-only intervals rather than deriving the
time axis only from trades. No-captured-trade intervals carry explicit markers,
null OHLC and empty cells, not copied-forward prices. Their independently observed
resting liquidity stays visible; missing depth stays a gap. Cumulative known-side
delta carries through, while earlier unknown-side executions keep full CVD null.

595 full Hub tests and 232 focused futures tests pass. Six browser cases cover an
entire book-only window and an isolated empty interval on desktop/tablet/mobile,
English/Chinese, without invented candles, timeline compression or page errors.
Typecheck and scoped lint pass. All six published images are synthetic tests.
EVIDENCE.json binds the exact source and image bytes. Whole-candidate qualification
will be recorded separately; earlier compiled proof is not relabeled for this delta.

Two retained external aggregation/gamma review results were reproduced against the
actual modules and mounted polling hook. Their suggested changes were rejected by
specific counterexamples: fractional depth means must not be integer-truncated;
covered sparse gamma zero differs from selected null and uncovered strikes; genuine
zero gamma is valid; observed POC is independent; the first successful live response
already schedules the next request at 5s, not the transient-error 15s fallback.
Those review returns are now ACCEPTED/deterministic, not blanket release approval.
Exact input/return hashes and adjudications remain in ../futures-independent-review-20261014/.

The atomic-book replacement dispatch was stopped by a platform safety check before
a run existed (NOT_FOUND, no dispatch output). It is held, not retried through
another actor. A separate event-adapter review reached a terminal prelaunch refusal
(rc 75, ROUTING_CRITICAL_POLICY_MISMATCH); no review was executed and no support
policy was changed. All earlier reviews are terminal, no worker is left pending.
Source activation, a complete release disposition and actual live proof remain
unestablished. No credential, paid feed, entitlement or production setting changed.
