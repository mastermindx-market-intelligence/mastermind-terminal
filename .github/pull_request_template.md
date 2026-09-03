Workstream: REQUIRED
Linear: REQUIRED
Portfolio-Mode: REQUIRED
Wave: REQUIRED
Authority: REQUIRED
Completion: REQUIRED

<!--
MAS28-V1-CONTRACT-SHA256: 9c57ad499fa34ee32f0ffeb9f2f5928f0515dba1609f984e5a20ce6576e7f75e
MAS28-V1-RULESET-SHA256: 2e97ad7acd0aec77ef18dbd76a1b3f2bbf8b7d4585e938498615de1917aa71aa

Replace every REQUIRED value before opening this PR. The six fields must remain
contiguous, column-zero, ordered exactly as shown, and use one ASCII colon plus
one ASCII space. Do not add a second copy of a canonical field above the first
top-level ## heading.

Allowed values:
- Workstream: WS:<KEY> or NONE. A concrete key is uppercase and uses only A-Z,
  0-9, and hyphen-separated segments.
- Linear: MAS-<positive non-zero integer without leading zeroes> or NONE.
- Portfolio-Mode: tracked | maintenance_exception | creates_workstream |
  architecture_candidate.
- Wave: a bounded 1-64 character identifier matching
  [A-Za-z0-9][A-Za-z0-9._-]{0,63}.
- Authority: implementation | records | research | maintenance | proof | deploy |
  architecture_candidate.
- Completion: merge-is-done | built-not-proven | proof-required |
  acceptance-required | records-only.

Native relationship law: relationship hints are visible, whole-line declarations
such as `Fixes MAS-28`, `Relates to MAS-28`, or `Skip MAS-28`; body text is not
proof of GitHub or Linear native linkage. Use a completion-bearing relationship
only when this PR is permitted to complete that exact issue. built-not-proven,
proof-required, and acceptance-required prohibit a completion-capable native
relationship to the declared issue. merge-is-done requires one. Do not use a
relation-only or suppression line to imply completion.
-->

## Summary

<!-- What changes, why it is bounded, and any material user or runtime impact. -->

## Verification

<!-- List exact tests, checks, and real-path proof performed. -->

## Risks and rollback

<!-- State residual risk and a concrete rollback/recovery path, or NONE. -->
