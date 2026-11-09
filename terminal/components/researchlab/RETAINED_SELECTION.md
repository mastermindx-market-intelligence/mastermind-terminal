# Supplied retained Options selection

This consumer implements `options.retained_selection.wire/v1` from Exposure
`c668f16682d245bd831b44ed97c5cb0deb399235`, whose contract is
`docs/OPTIONS_RETAINED_SELECTION.md`. It does not acquire or authenticate captures.
The two checked-in golden fixtures are byte-identical to the producer's qualified
`wire-v1/matrix-wire.json` and `events-wire.json` outputs.

## Existing mount and ownership

An already-admitted caller may supply `retainedSelection` to `GexDeskView`:

```ts
{ wire: originalWireString, root, session, ownerKey }
```

The explicit supplied-input seam remains available for an already-admitted caller.
GexDesk forwards it only in its non-archived, root-compatible Lab view.
The default source caller now uses the qualified request path described below;
source composition is not evidence of a production installation. `AdmittedOptionsResearchLab` retains
its existing entitlement/identity subscription and sets the actual owner key;
the caller cannot override it. `OptionsResearchLab` compares supplied context
with that owner and the current available Matrix root/session. Missing or failed
Matrix input, a different root/session/account, lost entitlement, withdrawal, or
malformed wire removes the retained view. No archived fallback is activated.

The decoder validates original byte digest/length, tagged source projection,
selected rows, clock bounds and event prefix receipts. It retains the complete
original wire (including metadata, all original clocks, normalized clocks and
receipt bytes) in the detached result. Exact decimals never enter `Number` for
identity, counts or value rendering. Bounded calendar/structural integers are
separate. The NY session check uses calendar milliseconds only; nanosecond clock
ordering and microsecond floor/ceiling comparisons use BigInt. No current time
is consulted. Producer market-calendar/domain qualification remains upstream;
this is not a second full FS5 validator or proof of authenticated capture.

The strict local JSON tokenizer is necessary because native `JSON.parse` loses
source numeric precision; the incumbent canonical-pair tokenizer is server-only
and rejects original JSON whitespace/order. Source numeric lexemes are tagged
before conversion. Numeric-looking strings and objects containing `decimal`
remain distinct source values. Bounds follow the wire/source contract (64 MiB
wire, 16 MiB capture, depth/node/decimal limits). The browser additionally limits
total prefix-hash input to 64 MiB per decode, failing unavailable beyond that
work budget; WebCrypto has no incremental hash state. No extra crypto package,
reader, cache, store or clock owner is added.

Each async validation result is bound to its exact wire and expected context
object. Render-time comparison withdraws previous data immediately; effect
cleanup suppresses late completion. Returning A -> withdrawn -> A requires a
new result, while language-only changes retain the same qualified result.

## Display and limits

The existing Sources/table/toolbar styles render a collapsed EN/ZH disclosure,
50 rows per page, using exact decimal text. Zero, explicit null and missing keys
remain different. Matrix selection is one supplied snapshot, not an ordered
history. Events are individual aggregates, not reconstructed packages. Snapshot
availability/history/corrections/coverage remain explicitly unknown. Original
availability spelling is shown separately from event/observation/decision times.
Retained rows have no pin, question, Plan, valuation or Save action.

Dark/light reuse the existing neutral source disclosure and exact-table tokens;
no parallel CSS, palette or runtime stylesheet is added. Local React/jsdom tests
are supplied-fixture evidence only. They do not establish visual/viewport taste,
real account admission, production acquisition, historical playback or customer
acceptance. Actual production qualification and authenticated behavior remain unproven.
The source caller below uses the incumbent Matrix read owner; it does not install
server dependencies or grant access to a capture.


## Registered request composition (source scope)

The default GexDesk Lab mount notifies its existing Matrix request owner from
Lab's existing exact coordinate, expiry and side controls. Initial all-expiry,
missing/stale source identity, missing principal, incompatible session or
withdrawn entitlement remains unavailable. There is no primary/first-expiry
fallback. The existing source marker is only an untrusted expected immutable
reference; the client never hashes a reserialized Matrix to manufacture one.

`flowGetResult(..., { retained: request })` uses the same `/api/flow` reader but
never the ordinary URL-only SWR cache or shared in-flight promise. The existing
server route obtains principal and token from `billingPrincipalAuthResult`, the
same exact-token verifier used by billing. The browser's expected principal is
only an assertion; neither it nor an incoming bearer is credential authority.
The existing `flowSource` maps the exact seven-field query to registered Macro
`GET /api/hub/matrix/{root}` at supplier source
`c6c38001d0a7bec4cc3663696df0cd52b6ab4ec3`. That supplier independently performs
fresh Auth/product and full-capture **export** source-use qualification around
its immutable read. Absent runtime dependency bindings remain unavailable.
Fixture mode, R2, generic TTL, failed reads and ordinary display entitlement
cannot substitute for this result. Qualified responses are private/no-store.

The coupled response must match exact root/session/ref/hash/length, selector,
selection-byte digest and owner. Its original wire is decoded by the incumbent
validator; the supplied display projection must equal the projection of those
same captured bytes. The wire string is never regenerated. Only this complete
pair enters the request-local mounted result, not the global ordinary cache.
The ordinary Matrix continues to supply expected identity and ordinary display;
it never receives private wire or authority metadata.

Lab scope transitions create a new object epoch, including A -> null -> A.
GexDesk fences pending results with that epoch and its existing Matrix request
generation; Lab also checks epoch identity at render time. A changed selector,
source/session, principal, admission or lens withdraws the retained disclosure.
Unchanged language-only rendering preserves it. Explicit supplied-input mode
and the default qualified mode are mutually exclusive; an unavailable qualified
read never falls back to a prior supplied wire or generic cached display pair.

Qualification here is local source/testing only: actual GexDesk -> admitted Lab
-> client reader -> Terminal route -> registered backend URL is exercised with
inert external I/O. It is not authenticated production/browser acceptance,
installed server dependencies, a new raw-export authorization, or Save proof.
The original runtime, browser, source-use, review and unknown-effect holds remain.


## Joined-frame review corrections

A verified response pair alone does not certify the visible ordinary Matrix.
Before mounting retained values, the Lab compares the entire ordinary projection
with the qualified display, excluding **only** the incumbent expected-identity
marker. A same-marker change to cells, coverage or other source fields withholds
the wire; it never joins it to a different visible book. Expected identity remains
separate, so verification does not replace its own request seed or cause a loop.

Each ordinary Matrix read records its existing request generation, even if it
returns byte-identical data. Loading withdraws the prior private pair, and a
successful completed generation permits one fresh current qualification through
the same reader. An old private flight cannot win after ordinary Retry. Private
response completion does not increment the ordinary generation. Visibility's
existing GEX-only refresh is not claimed as an additional Matrix refresh.

The chart's incumbent `ResearchRow.strike` remains a JavaScript number; this
change does not claim lossless caller selection for every possible decimal strike.
The capture decoder still preserves the exact original decimal. After decoding,
the request primary/comparisons must match exact captured decimal coordinates;
a rounded selector cannot qualify another coordinate. Unsupported large-decimal
selection therefore remains unavailable, while already-proven large OI and wire
precision remain intact. No generic chart math, wire schema or producer identity
rule is changed.
