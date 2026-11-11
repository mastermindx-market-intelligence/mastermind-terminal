# PR #668: bind source attribution and benchmark authority to v1

The current normalizer accepted any nonempty ledger path and a populated benchmark object with `available:true`. The panel displays both fields. The actual v1 producer emits one canonical source path and explicitly supplies no benchmark-return evidence, so those alternative inputs could misstate source attribution or unsupported performance figures.

## Exact contract and repair

The primary producer is Macro#7399 at `41ca935449b6668c60e0b5ba2a0863703e072d8c`, `app/hub.py` Git blob`ea33b1221f04b24a8b7571d899fca79985371d52`. The retrieved bytes match that Git blob. AST inspection of the actual projection's return confirms `source.path = data/prophet/ledger.jsonl` and an unavailable benchmark object with null return/excess figures. The immutable source identity and inspected literals are recorded in `producer-contract-binding.json`. This is source inspection, not producer or route execution.

The two-file Terminal repair requires that exact path and `benchmark.available === false`. Both figures must remain null and the existing nonempty reason rule is preserved. No new reason vocabulary, wire schema, provenance field, UI, transport or producer contract is introduced. Valid input and emitted wire values remain unchanged. Earlier count/date/source-clock repairs are preserved.

## Executed checks

The existing48 cases remain unchanged. Seven new negative cases demonstrate the actual defects: four substituted source paths and three populated unsupported benchmark claims, including zero figures. One positive case checks exact source and unavailable benchmark preservation. The parent gives49 passing and7 expected failures; the repaired suite passes all56 cases.

Strict TypeScript for both changed files and their imported closure, scoped ESLint and whitespace checks pass. Both exact authored empty/partial browser-literal payloads still pass the compiled parser with source, summary, rows and inputs unchanged. No browser or request was run. All original source entries outside the two changed files remain exact.

## Remaining boundaries

Raw-statistic arithmetic validation is still incomplete. The native implementation uses Python `math.fsum`, `statistics.median` and four-decimal `round` on finite values with no magnitude or decimal-place bound. The retained JavaScript approximation has not been shown compatible across that domain, so it is not adopted. This repair does not claim that an arbitrary supplied mean/median/min/max is correct.

The Macro R5/R6 repair remains fenced by [grant6684228755](https://github.com/mastermindx-market-intelligence/macro/pull/7399#issuecomment-6684228755) and [refusal6684580395](https://github.com/mastermindx-market-intelligence/macro/pull/7399#issuecomment-6684580395). That original paid worker requested Macro-only composition, mandatory-ledger/read-identity checks and reconstruction provenance. It prohibited Terminal writes and has no authorized retry. None of its execution, source repair, publication or producer acceptance is replayed here. These Terminal guards validate two fields of an already-defined received v1 payload; they do not implement R5/R6.

Draft/BUILT_NOT_PROVEN, current-protected conflicts, live ProphetView custody, producer/deploy-safe/private-endpoint and screen/light-theme holds remain. Full Packet A, provenance/cohorts, dated-NO_ENTRY presentation and numeric-statistic validation remain separate work. No migration, backend write, release action, approval, merge or deployment occurred.
