# Prospective immutable visual evidence

The two incumbent `EVIDENCE.yml` files and their images remain legacy evidence. Their
existing readers retain their original checks when no composition is selected.

New captures require an explicit operation ID. Each writes only a new directory in
its own existing packet's `operations/` namespace. An existing ID, symlink, unsafe
path, failed capture, incomplete record, changed source, or conflicting case is a
refusal. There is no resume, latest pointer, sibling update, or legacy restamp.
A partial directory remains retained but cannot be selected as a completed record.

From `terminal/`, capture actual fixture execution with:

```
TERMINAL_PL6_EVIDENCE_OPERATION_ID=<explicit-id> TERMINAL_CROP_PORT=<port> node e2e/tools/capture_pl6_batch1.cjs
node e2e/tools/capture_visual_evidence.cjs --id <different-explicit-id> --port <port>
```

`CAPTURE_ONLY` and the Visual Intelligence `--grep` option remain scoped captures.
Two actual cases supply two cases; they cannot supply the full current matrix.
The prospective Visual Intelligence wrapper runs the unchanged incumbent tests and
redirects only artifact destinations. Its report records the actual executed file,
title, project, status, retry and observation attachment. Each selected PNG is
hashed, decoded and dimension-checked; its presence is never execution authority.

Use the exported `writeComposition` function in `e2e/tools/visualEvidence.cjs` to
write an explicit, exclusive `<id>.composition.json` in either existing packet.
Supply exact operation manifest paths/hashes and explicit operation/case selections.
Both readers consume that **same file** via `TERMINAL_EVIDENCE_COMPOSITION`.
A valid selection contains all 20 incumbent PL6 cases and all 30 distinct Visual
Intelligence cases, including mobile crosshair. It is a composition of actual
records, not a claim that one capture executed all cases. Duplicate or ambiguous
selections, missing cases, incompatible profiles, and stale source locks fail.
An invalid explicit selection never falls back to legacy mode.

The source lock preserves the complete incumbent union and additionally binds
fixture sources, build configuration, entrypoints, readers, artifact code and e2e
source membership. Runtime build flags are explicit (`MMX_SHARED_SHELL` and
`MMX_INVESTOR_SHELL_PREVIEW`); the reader's expected profile must match. A changed
shared shell or `next.config.ts` invalidates affected current proof. No historical
record or image is silently upgraded to a new source/profile.

Files are installed exclusively through bounded descriptor-relative I/O, without
following symlinks. Complete directories are sealed. Readback verifies immutable
manifest/report/image/observation bindings with per-member and total byte bounds.
These protections do not claim a durable operation journal, automatic recovery,
live authenticated journey, or performance improvement. A new source change needs
its own truthful compatible evidence; old failed or uncertain captures are not
replayed by this tooling.
