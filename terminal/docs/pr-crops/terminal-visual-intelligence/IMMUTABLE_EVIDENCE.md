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

## Explicit current source selection

The two evidence readers explicitly select
`terminal/docs/pr-crops/b-pl-6-batch-1/p1t9-hub-596e.composition.json`
unless an explicit composition is supplied by the caller. This is a fixed source
selection, not a latest pointer; source drift still refuses. The prior legacy
packet bytes and their historical qualifications remain unchanged. The selected
records bind both `useHubDiscovery.ts` and `mobile/RollerStrip.tsx`, which jointly
own committed classification and the rendered More badge.

This recapture uses synthetic loopback fixtures in new ephemeral browser contexts,
with no saved browser profile or real principal. A process-inherited macOS sandbox
allows outbound connections only to the two owned capture ports, 33961 and 33962;
remote providers and the operational Quote Hub on 3100 are unavailable. The child
process receives a scrubbed environment and fixture-only Supabase configuration.
This qualifies local rendered evidence, not live data, authentication, hosted CI
or the historical mobile failure's scheduling cause.

The new records explicitly declare `compiler: webpack`; the installed Next16
`--webpack` development path uses IPC pipes rather than Turbopack's dynamic TCP
compiler callback. Set `TERMINAL_EVIDENCE_COMPILER=webpack` for both capture
commands. Source hashes also bind the launch arguments. Unlabelled historical
profiles keep their original shape and cannot be composed with this compiler.
Normal responsive runs with the variable absent retain their existing compiler.
The initial restricted Turbopack attempt retained only its start record and zero
cases; it is ineligible and excluded from the new selection. The sandbox is
unchanged for the distinct compiler operation. PL6 now bounds each server fetch
inside its existing absolute180-second startup budget, including pending headers.

### Retained intended font fixture

Eligible new records also declare `fonts: retained-fonts-34fb`. The receipt in
`e2e/fixtures/retained-fonts-34fb/receipt.json` binds generated font CSS/source-map
content and13 actual WOFF2 buffers from existing Terminal source34fb2ea. Its
Inter and JetBrains Mono constructor options and Next16.2.9 match this source.
Subset comments, weight/style/display, Unicode ranges and preload metadata are
retained; only the font-file transport URLs are localized through installed
Next's `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` test seam. This is retained generated
font evidence, not a claim to possess original Google HTTP response bytes.

Before each capture, the browser awaits both intended FontFace loads, verifies
actual served font-buffer hashes/lengths against the receipt, and records loaded
faces plus the computed Inter-first/tabular family where visible numeric content
is present. The compositor refuses missing/fallback/nonloaded or wrong-hash font
observations under this profile. No system-installed lookalike is substituted.
The earlier20-case fallback-font record remains unselected; it cannot satisfy
intended typography. The first intended-font attempt also remains incomplete and
ineligible because its PL6 writer omitted the font observation; its emitted
images are not upgraded. The corrected writer has a direct actual-statement
transport regression before the new operation.
