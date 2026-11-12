# Terminal Tactical D0 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for this direct bounded implementation. Preserve the existing carrier and source custody.

**Goal:** Make existing intraday history inspectable and prevent future/unfinished/unknown-availability observations from entering a decision-time view.

**Architecture:** A pure qualification module reads the existing Terminal store and Macro-derived session projection. A standalone CLI consumes it and produces evidence, without provider calls or new persistence authorities.

**Tech Stack:** Python standard library; existing pytest job; existing JSON session projection.

**Spec:** docs/research/TERMINAL_TACTICAL_D0_CONTRACT.md; approved parent #598.

## Global constraints
No new dependencies, provider credentials/calls, synthetic finer bars, holiday calendar, store, runtime/evaluator, signal promotion, order routing, frontend changes or modifications to #595. All source work is in the isolated claude/terminal-tactical-d0-20260917-sol-002 branch. Data copies and generated reports stay uncommitted; raw source identities are preserved.

## Task 1: clock-qualified file consumer and pure cutoff view
Files: create ingest/intraday_qualification.py; tests/test_intraday_qualification.py.
Consumes: existing six-value stores and terminal/lib/usEquitySessionProjection.json.
Produces: CalendarProjection.load(path), decode_display_epoch(seconds), Observation, cutoff_view(observations, cutoff_utc, mode), qualify_store(path, symbol, timeframe, calendar, start_date, end_date, cutoff_utc, mode).

- [x] Write failing behavioral tests before implementation. Essential assertions:
```python
assert decode_display_epoch(epoch('2026-03-06T09:30:00Z')) == epoch('2026-03-06T14:30:00Z')
assert decode_display_epoch(epoch('2026-03-09T09:30:00Z')) == epoch('2026-03-09T13:30:00Z')
assert cutoff_view((bar,), bar.event_end_utc - 1, 'corrected_history') == ()
assert cutoff_view((bar,), bar.event_end_utc, 'as_observed') == ()
```
- [x] Run `python3 -m pytest tests/test_intraday_qualification.py -q`; record the missing-capability failure.
- [x] Implement strict bytes/identity/OHLCV checks, existing-calendar classification and nominal-grid accounting. Return diagnostics for malformed inputs instead of accepting them. Preserve unknown availability and adjustment.
- [x] Implement the pure cutoff predicate and reject duplicate revision identities. Re-run the focused tests.

## Task 2: pilot report CLI
Files: create config/tactical_research_pilot.json; scripts/qualify_intraday_research.py; tests/test_intraday_qualification_cli.py.
Consumes: qualify_store plus the fixed-current pilot; accepts explicit input directory, calendar, date bounds, cutoff and mode.
Produces: machine JSON and a compact Markdown projection with every requested symbol/grain cell.

- [x] Write failing subprocess tests for outside-repo invocation, no credentials, missing pilot cells, malformed pilot config, and create-only output protection.
- [x] Run `python3 -m pytest tests/test_intraday_qualification_cli.py -q` and record RED.
- [x] Implement argparse entrypoint with repo-root import bootstrap, JSON/Markdown output and explicit admission warnings. Never import or run the network backfill producer.
- [x] Run both new suites and `tests/test_ohlc_ingest_guard.py`; run compileall and git diff --check.
- [x] Inspect available existing archival input through the CLI; preserve original bytes/digests and classify missing metadata rather than silently filling it. Capture a machine report and a human projection, without raw inputs in Git.

## Task 3: review and continuity
- [x] Self-review no-lookahead, whole-file diagnostic versus cutoff distinctions, boundary math, denominator and file-write safety.
- [x] Run the existing full Python suite and distinguish pre-existing/environment failures from new failures.
- [ ] Commit/push only explicit source paths; open one PR linked to #598. Required checks and independent review remain release gates.
- [ ] Record approval, exact source/reports, capability state, no-effect/held operations and next action in the existing GitHub and Agent OS homes. Do not claim the parent product or live scanner complete.
