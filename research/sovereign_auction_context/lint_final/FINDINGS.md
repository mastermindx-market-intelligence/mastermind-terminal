# Terminal final lint differential — read-only adjudication

## Decision

**No introduced lint diagnostic is present in the exact supplied lint snapshots.** The current and baseline TerminalShell each contain 54 errors and 14 warnings. After mapping source locations, including locations embedded in message text and UTF-16 suggestion ranges, their complete 68-diagnostic multisets are identical.

**The whole TerminalShell lint remains red.** This receipt establishes absence of an introduced diagnostic; it does not turn inherited errors into a whole-file or repository lint pass.

The existing `lint-differential-receipt.json` is preserved without modification. Its `diagnostics_match_original_source_locations: false` result is superseded for these same input hashes by the complete comparison below. No broad lint command was rerun.

## Why a position-only comparison stayed false

There are 12 raw message-text differences:

| Rule | Baseline line | Current line | Column | Actual difference |
|---|---:|---:|---:|---|
| `react-hooks/set-state-in-effect` | 1079 | 1080 | 5 | Source pointer and printed code-frame line labels shift by one |
| `react-hooks/set-state-in-effect` | 1424 | 1425 | 5 | Same |
| `react-hooks/set-state-in-effect` | 1531 | 1532 | 5 | Same |
| `react-hooks/set-state-in-effect` | 1555 | 1556 | 27 | Same |
| `react-hooks/set-state-in-effect` | 1841 | 1842 | 5 | Same |
| `react-hooks/set-state-in-effect` | 2423 | 2424 | 5 | Same |
| `react-hooks/set-state-in-effect` | 2763 | 2764 | 26 | Same |
| `react-hooks/set-state-in-effect` | 2785 | 2786 | 104 | Same |
| `react-hooks/set-state-in-effect` | 2869 | 2870 | 27 | Same |
| `react-hooks/exhaustive-deps` | 3263 | 3264 | 9 | Warning prose points to `useMemo` at line 3291 instead of 3290 |
| `react-hooks/set-state-in-effect` | 4115 | 4116 | 5 | Source pointer and printed code-frame line labels shift by one |
| `react-hooks/set-state-in-effect` | 4147 | 4148 | 22 | Same |

Normalizing only the printed code-frame/source-pointer locations resolves the 11 errors but leaves the `activeLegs` warning unmatched. Its source-line reference is embedded in prose: `(at line 3290)` in the baseline and `(at line 3291)` in current. Mapping that explicit reference resolves the remaining message difference.

**No message contains newly added `SovereignAuctionContext` code.** This is source-location movement in existing diagnostics, not a new warning caused by the mount or added code appearing inside an existing failure frame. Rule prose, code-frame source text, severity, columns, node/message IDs and suggestion text remain unchanged.

## Source evidence and method

The `source` fields already embedded in the two lint logs differ by exactly two inserted lines:

1. Import the leaf at current line 25.
2. Mount the leaf in the existing padded wrapper after `.sa-btn-group`, current line 6029.

No current repository source file was read or changed during this audit. The baseline logged source independently hashes to Git blob `417cd453fcf1d4ea444d12321ea37ad8a4f25888`, matching the previously inspected pinned TerminalShell source. Its SHA256 is `870c21f4f8a45c5388feeac63bff920631ce8baabbe7b5392aad5968da652b64`. The current logged source SHA256 is `7e96d08385d921fd1ca624c3481271ac94ae297034f7126284836cd6429a1e5b`.

The audit derives an exact line map from equal source lines, preserving insertion boundaries. It then compares diagnostic multisets after mapping start/end lines, explicit filename/line pointers, printed code-frame line labels, the explicit `at line` prose reference, and suggestion/fix ranges expressed in ESLint's UTF-16 offsets. It does not strip rule descriptions, code text, literals, columns, severities or suggestion content.

| Comparison stage | Unmatched |
|---|---:|
| Diagnostic anchors: rule, severity, node/message ID, mapped start/end location | 0 |
| Full message after source-pointer/code-frame mapping only | 1 |
| Full message after every explicit source-location mapping | 0 |
| Complete diagnostic records, including mapped UTF-16 suggestion ranges | 0 |
| Diagnostics attached to either inserted line | 0 |

The independently canonicalized baseline and current diagnostic multisets have the same SHA256:

`d0bd60a8efaf68d8b8743c34506118d637414c9766a4cef3775d2e2e78a61d5f`

The four non-Shell files present in the supplied current log—`app/api/nw/route.ts`, `components/SovereignAuctionContext.tsx`, `lib/i18n.tsx`, and `lib/sovereignAuctionContext.ts`—each report zero errors and zero warnings. This receipt makes no claim about files omitted from that lint command.

## Exact inputs

| Existing log | SHA256 |
|---|---|
| `lint-current.json` | `ed09faa20b6614ada831719461db6690a3faa0d6acf9f921fd78ef3f73a06043` |
| `lint-shell-baseline.json` | `f8e0c07504585e0f6fcc8c51b14ba74ba68b23de8267c2d6e4bfca5fce4f8441` |
| `lint-differential-receipt.json` | `d063d50e9b728a5d53cb1e841cb8da4040ee8fdd2c89ac84f2a0d57d429fa631` |

The source diff, all 12 changed messages, stage counts, log hashes, canonical hashes and original receipt are in `FINAL_LINT_DIFFERENTIAL_RECEIPT.json`. `audit_existing_lint.py` reproduces the comparison using only an existing log directory:

```sh
python3 audit_existing_lint.py /path/to/sovereign-auction-verification
```

The root-owned browser process PID 91719 was neither inspected nor interrupted. No source file, existing log or remote repository was written. Only this read-only log analysis ran on the Mac; its results and reproduction script are persisted in scratch for root's durable owner.

Root separately reported the `auctionDisplayRows` row-unwrapping fix, the corrected unknown-body-clock fixture and the successful native tests/typecheck. Those reports are outside this lint-log adjudication. Earlier candidate and browser-fixture manifests remain historical and must not be represented as final deployed-source manifests.
