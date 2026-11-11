# PR #668: calendar and source-date consistency

The existing v1 normalizer accepted nonexistent dates and source freshness receipts that disagreed with its admitted plan rows. Those source dates are shown to users as the ledger as-of and latest close. This recovery rejects inconsistent input before rendering it, while preserving every admitted wire value.

## Scope and source

The parent is `3192ddaec5f2a60ba4884306b57dc6f653d5edb9`, which already contains the accepted row-count repair. Only `terminal/components/prophet/prophetPerfTypes.ts` and its existing `terminal/lib/__tests__/prophetPerf.test.ts` change. The rest of that source tree, including the earlier repair and proof, is preserved.

This adopts the calendar and same-field maximum guards from the previously unapplied [normalizer reference5760132200](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/668#issuecomment-5760132200), under the current backlog takeover assignment. Its full text and digest are retained for provenance. Its old reference/producer test counts are historical and are not claimed as execution in this repair. The full Packet A proposal remains only partially adopted.

Every present row date and source clock must be an exact valid `YYYY-MM-DD` Gregorian calendar date, with years0001 through9999. Explicitly unavailable signal/entry dates retain their existing null/reason contract. An exact ten-character check additionally refuses a trailing newline that JavaScript's regular-expression end anchor would otherwise tolerate.

Each source freshness clock must equal the maximum of its corresponding admitted row field. The two clocks may come from different rows. No dates are inferred or rewritten; no cross-field chronology, current-time restriction, provenance requirement, new schema, or new producer contract is introduced. Stale payloads and future-but-consistent dates retain their existing admission behavior.

## Executed verification

- The existing21 cases remain unchanged. The added27 cases cover20 negative discriminators and7 positive controls.
- On the parent parser, the enlarged suite gives28 passing and20 expected failing cases. With this repair, all48 cases pass.
- Calendar controls include impossible days/months, the Gregorian century exception, malformed formats, whitespace/newlines, every row date field, valid leap days and allowed year boundaries.
- Source controls reject both earlier and later false clocks, admit maxima from different rows in reversed row order, and retain explicit nulls, stale and consistent future values. Existing empty and partial-return cases still pass.
- Strict TypeScript covers both changed files and their imported closure; scoped ESLint and whitespace checks pass.
- The actual unchanged browser spec's two literal empty/partial payloads were extracted through the TypeScript AST and applied to the compiled current parser. Both are admitted without changing source, summary, rows or input. No browser, request or producer execution occurred.

The original Draft/BUILT_NOT_PROVEN state, current-master conflicts, live #1460 ProphetView custody, Macro#7399 deployment/private-endpoint obligations, and screen/light-theme release holds remain. No denied screen refinement, release mutation, deployment, migration, backend write or browser action was replayed. Current hosted and product acceptance remain separate obligations.
