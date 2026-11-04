# J1: reopen the saved thesis before optional assistant authoring

P19.T1.S1. Source base f528a219cc5d73e94e058575e3df83d689632bf9.

The joined local browser journey visits Company Intelligence, follows Your theses,
creates A via the UI, inspects a different-company saved B, returns through the
actual browser history entry to A, reloads A, and clicks its exact source-return
link. Assertions preserve the saved thesis ID, NVDA anchor, context revision 3
and focus context-node. Only one UI save is sent; navigation adds no writes and
mo_* does not enter the mutation. The Macro return request is intercepted locally;
this does not claim live Macro data or authenticated product acceptance.

Observed gap: optional blank Assistant notes preceded the saved title/statement
on mobile. The repair moves the unchanged edit form ahead of that optional panel.
No schema, request, lifecycle, pending recovery, CSS or proposal behavior changed.
Terminal's existing dark-only shell law applies; no light-mode parity is claimed.

Validation: joined journey PASS at 1440x900, 820x1180, 390x844;
57 context/proposal component tests PASS; 4 recaptured layout-evidence tests PASS;
TypeScript noEmit PASS. Eight EN/ZH proposal captures regenerated with the
existing capture producer. Screenshot inspection: saved reasoning now appears
before assistant authoring; no horizontal clipping in inspected mobile screen;
existing neutral surfaces, labels and focus controls retained.

Initial test incorrectly compared URL query ordering. Canonical serialization
reorders keys without changing meaning. Corrected test checks the same thesis ID,
symbol, all context values, and exact clicked return URL. No product defect or
repair is attributed to the original assertion failure.

Product release, real-account Save/reopen, recipient sharing, and complete Paper
parity remain separate obligations. This is bounded local joined-path evidence.

CI repair, 2026-11-04: original run 41773394695, unit job 126388066655,
tested merge f89dbe3bd7cb069754869e76911e723503826f53, reported exactly two
stale ThesisWorkspace layout hashes (claim authoring and research views).
The existing capture producers were executed: 12 claim-authoring and 20
research-view EN/ZH crops, with fresh source locks. No hashes were updated in
place without capture. Representative mobile crops were visually inspected.

The fresh research capture exposed a second, local validator defect: it required
historical LEX projection metadata even when the recorded full-file SHA-256
matched the current source exactly. The helper now accepts that stronger exact
match; differing bytes still require the unchanged, narrowly scoped historical
projection. A new case failed before the repair and passes afterward, including
negative checks for changed bytes without projection provenance.

The affected validation group passed 21 tests. The wider helper-consumer check
passed 86/88; its two failures are unchanged shell-layout/AppNav raw-capture locks
normally composed by CI, not the LEX helper or this thesis change. They remain
reported, not waived or rewritten. Hosted successor qualification is required.
