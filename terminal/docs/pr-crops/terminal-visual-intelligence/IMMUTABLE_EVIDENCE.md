# Prospective immutable visual evidence

The two incumbent `EVIDENCE.yml` files and their images remain legacy evidence. Their
existing readers retain their original checks when no composition is selected.

New captures require an explicit operation ID. Prospective v2 writes flat regular
files in its own existing trusted packet directory: `<id>--start.json`,
`<id>--case-<key-hash>.png` and `.json`, `<id>--report.json`, and
`<id>--operation.json`. Logical member names cannot contain `--` or use the
composition-file suffix, so operation IDs (including IDs containing `--`) remain
disjoint. Existing IDs/orphaned prefixes, symlinks, unsafe paths, failed captures,
incomplete records, changed sources, or conflicting cases refuse. There is no
resume, latest pointer, sibling update, or legacy restamp. Partial files remain
retained but cannot be selected as a completed record.

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
New compositions use v2 and require only v2 operation records. Existing v1
compositions/operation directories remain explicitly readable under their original
validation; no v1 write, conversion, or restamp is supported. Mixed/unknown formats
refuse, as does an invalid explicit selection; there is no downgrade to legacy.
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
following symlinks. The start payload is prepared before effects; one native
`O_CREAT|O_EXCL|O_NOFOLLOW` call returns the actual writable regular-file descriptor.
Only that descriptor is written and read back, then the named file, original
start, trusted parent, hash and fsync checks must succeed. Later members use the
same exclusive-file rule and original start binding. No new directory is created
or adopted. Files use mode0400; substitution/partial publication/response loss
retain their files and refuse eligibility or successful return. Prefix inspection
is bounded at16384 existing packet entries and refuses overflow.

This guarantee is exclusive creation/non-overwrite/no foreign descriptor adoption
under the existing trusted-parent boundary. It does not establish authenticity or
immutable storage against a malicious same-UID process; advisory locks, random
paths and ownership labels are not asserted as isolation. Readback verifies
manifest/report/image/observation bindings with per-member and total byte bounds.
These protections do not claim a durable operation journal, automatic recovery,
live authenticated journey, or performance improvement. A new source change needs
its own truthful compatible evidence; old failed or uncertain captures are not
replayed by this tooling.
