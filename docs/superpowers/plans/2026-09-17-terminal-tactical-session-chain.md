# Session-chain qualification implementation plan

Goal: the existing D0 consumer must answer which archived decision dates have the prior regular session, prior after-hours session and current premarket needed for the approved research.

Architecture: extend the existing read-once qualification report; reuse its immutable Observation and cutoff_view plus the Macro calendar projection. No new data fetch, writer, registry, strategy, evaluator, scheduler or event store. One implementation carrier remains Terminal #601. This is pre-open input qualification, not scientific registration or a trading result.

Source: Terminal #601 at 773b16f8e825ab4b39ce3c7a5fa5caf32868d55f. Procedure: protected Mastermind b731149296a9d837d426730813f68d5acc6133ac, compatible 1.0.1. Current Chairman continuation authorizes this bounded extension. Existing independent-review request is unassigned; no worker was started or displaced. Review must cover the changed head, not reuse a verdict on old bytes.

## Task 1: causal session-chain inventory
Files: ingest/intraday_qualification.py; tests/test_intraday_session_chain.py.

Expose session_chain_inventory(observations, calendar, start_date, end_date, timeframe, mode, input_status). Return one entry per expected trading decision date. Select the previous scheduled session, never the previous observed date or calendar day. Fix the decision cutoff at the current regular-session opening. The three legs are prior RTH, prior AH, and current PRE. Both pre-open source windows end by that cutoff.

A leg whose date precedes the requested window is outside_requested_window, not missing-provider data. An unknown previous session at the calendar coverage boundary stays unknown. Early-close prior AH remains schedule_unqualified. Hourly chains are unsupported; do not split straddling bars. 1m, 5m and 15m may report nominal occupancy, never feed completeness. Missing, malformed, invalid or unreadable source reports remain unqualified. As-observed mode must apply the existing availability check; no legacy availability is invented.

Write RED tests for Monday/Friday, holiday/preceding session, DST, early close, first-window boundary, hourly refusal, missing/invalid input, incomplete legs, unknown availability and future-current-session mutation. Run tests; implement; rerun.

## Task 2: existing consumer and real-input proof
Files: scripts/qualify_intraday_research.py; tests/test_intraday_qualification_cli.py.

Add session_chains to each existing file report, built from the same parsed bytes. Markdown adds a compact chain-count table with explicit archived/pre-open/non-trading meaning. Reports preserve all expected decision dates, including dates with no observations. No sorting by performance, forecast, signal label or backtest is introduced.

Write RED real-CLI test for a two-session synthetic file. It must show one complete nominal chain and one first-window boundary, and no raw price data. Then wire the consumer and rerun all focused tests.

Run the extended consumer on the already captured non-INTC 5m archives over their common observed date range; retain missing dates and disclose the fixed-current survivor population. Do not refetch static files or the blocked Intel API. Compare corrected-history and as-observed qualification. Save derived counts/hashes only in source evidence; raw bars stay private.

## Acceptance / stop
Run focused tests, the existing Python suite, compileall and git diff --check. Commit and push on #601 only. Persist revised evidence and current head in the existing Macro #7262 records. Independent review remains held on authenticated Fabric access; do not self-approve. R1 scientific source-read hold is unchanged. No strategy outcomes, thresholds, accuracy or production execution are part of this extension.
