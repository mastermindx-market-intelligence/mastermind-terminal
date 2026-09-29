STATUS: COMPLETE
RESULT: PASS

FINDINGS
- None. No actionable correctness regression found in the reviewed candidate scope.

Reviewed contracts:
- Missing, null, non-finite, absent, and axis-omitted selected-grid cells remain unresolved; measured zero is preserved as known but does not itself establish completeness. Complete totals are emitted only when every selected strike × expiry pair is known, while partial totals are shown explicitly as known subtotals. See `terminal/lib/gexLadder.ts:210-264` and `terminal/components/gexdesk/GexDeskView.tsx:635-663`.
- Completeness is limited to the explicit selected display grid and the UI says source completeness is unknown. See `terminal/lib/gexLadder.ts:173-194` and `terminal/components/gexdesk/gexStrings.ts:17-24`.
- Narrow-lens rows return null when any selected pair is unresolved rather than substituting zero or the all-expiry aggregate. See `terminal/lib/gexLadder.ts:283-300`.
- The coupled desk uses `_build_meta.asof_date` as the source session, requires exact session equality for composition, preserves the legacy four-day `matrixSessionsAgree`, and supports independent `source-local` inspection. See `terminal/lib/gexLadder.ts:145-170`, `terminal/lib/gexLadder.ts:195-220`, and `terminal/lib/gexLadder.ts:210-264`.
- Date-only `asof` values render as their UTC calendar date plus “source session” without inventing an ET time; timestamp values retain the existing ET formatting path. See `terminal/components/gexdesk/GexDeskView.tsx:501-534`.
- Duplicate `(strike, expiry)` cells reject the whole payload before expiry-scope selection, and malformed identities/axes, invalid dates, bad scope, and arithmetic overflow are refused. See `terminal/lib/gexLadder.ts:221-243` and `terminal/lib/gexLadder.ts:251-264`.
- Matrix admission rejects wrong-root/schema/session and cell identity failures, sanitizes invalid GEX, nulls incomplete OI/volume pairs, nulls incomplete delta pairs, and preserves unrelated analytics by spreading sanitized fields over the original cells. See `terminal/components/gexdesk/GexDeskView.tsx:271-290` and `terminal/lib/optionsCompanion.ts:45-93`.
- The selected-root render fence and matrix request ordering remain in place; an older internally valid root cannot overwrite a newer selection. See `terminal/components/gexdesk/GexDeskView.tsx:208-224`, `terminal/components/gexdesk/GexDeskView.tsx:292-296`, and `terminal/components/gexdesk/GexDeskView.tsx:334-364`.
- Incomplete selected-grid totals are withheld from the summary and ladder chips; labels distinguish Reported GEX from the all-expiry metric. See `terminal/components/gexdesk/GexSummaryBar.tsx:127-175` and `terminal/components/gexdesk/StrikeLadder.tsx:789-801`.

EVIDENCE
Capsule verification:
- `python3 verify_capsule.py` → `INPUT_HASHES_PASS 12`

Commands actually run (read-only):
- `cat manifest.json`
- `cat candidate.patch`
- `cat identity-592.patch`
- `awk '/^diff --git/{show=($0 ~ /GexDeskView|GexSummaryBar|StrikeLadder|gexStrings/)} show {print NR ":" $0}' candidate.patch`
- `awk '/^diff --git/{show=($0 ~ /__tests__|matrixDoc|dte.ts|gexLadder.ts|optionsCompanion/)} show {print NR ":" $0}' candidate.patch`
- `nl -ba ...` / `sed -n ...` / `rg ...` over every manifest-bound source/test file and the candidate patch
- `tar -tzf input.tgz`
- `shasum -a 256 ...` for all 12 manifest-bound files

Reviewed source hashes (exactly the 12 manifest entries):
- `b0294205e351177fae9be5e5638759c696a15acf5bda5fcb2da4802d3ad188a7  terminal/components/gexdesk/GexDeskView.tsx`
- `b7444c35a505ef4ddb9b6ca9a75ac0cb64ba6e11fbb3aaf7f5d79f1aba05502d  terminal/components/gexdesk/GexSummaryBar.tsx`
- `04b7ffe359e760b56a080f22b9d27e7aa5fea271438c18f09f7d4bb934d4234a  terminal/components/gexdesk/StrikeLadder.tsx`
- `d76c43111c379e73645a53ab67f794b2c9546c6d5001ba1556b43c980f5b4ac0  terminal/components/gexdesk/gexStrings.ts`
- `da3e7c60927e52146589e428d6efa998bdc1ed2d10a215f47c3067232b1c1cf4  terminal/components/gexdesk/matrixDoc.ts`
- `4e983a867956da6c02787a9bbd121ce46aef5d914058576e91ec998b42a76975  terminal/lib/__tests__/gexDeskPartialData.test.tsx`
- `fb5b753788bf216b1555de2ae6d324ada0ff8b52ccfe7bf0ad65977e9f6bd27a  terminal/lib/__tests__/gexDeskStateRace.test.tsx`
- `ce9047dad350becdcd65a5fb6ce43c44f41a6cdb649c9b90a6a0d555d7ae696d  terminal/lib/__tests__/gexLadder.test.ts`
- `e46f285a85c107c7608576104998dc50a39b793c4160efad116e685342d8ee3f  terminal/lib/__tests__/gexLensCompleteness.test.ts`
- `6ba5e5b601d33b504bc2c10aea6ded66f221c10d2c0867cc99763985ff2dfa3b  terminal/lib/dte.ts`
- `40153bf34579d0730dc3f01d08da0a7255835df5cc442671f967d93c79d9e38c  terminal/lib/gexLadder.ts`
- `06342e461b634ee27001b33786d802e75d0baa3948d0370417beb511c23011b0  terminal/lib/optionsCompanion.ts`

GAPS
- No repository tests, typecheck, lint, build, browser check, runtime execution, or the parent-reported full checks were run in this review capsule. The user-reported “130 focused tests PASS” was not independently reproduced.
- This was a bounded source review of the manifest-bound files. It does not independently establish upstream provider methodology, contract/book coverage, release acceptance, visual behavior, localization completeness beyond the reviewed strings, or compatibility with files outside the capsule.
- `identity-592.patch` is zero bytes and carries no reviewable #592-specific delta; #592 defenses were reviewed only where represented in the candidate source and tests.
- Runtime environment probes did not execute the application; source inspection was used for React render-order and async behavior.

DEVIATIONS
- None.
