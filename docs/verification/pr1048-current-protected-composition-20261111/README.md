# PR #1048: integrate current source and retain all capture owners

The pacing repair was published at `6b57fe90b7606e414b28dae4e4c736a50618341b`, but current-master conflicts prevented normal PR CI from running. This composition advances the original branch onto protected `74c007125129090cc762f2bc4b1b152123326444` without dropping the original contribution.

## Source composition

103 of the original 108 postimages are byte-preserved, including the paced-queue repair, all migration/reservation bytes and historical proof. ChartPane, ChartPanel and TerminalShell merge cleanly with current protected changes. Only the shared capture exporter and its tests require explicit conflict resolution.

The exporter retains the full incumbent control flow, immutable PL6/VI composition, current Batch 3/native owners, and the PR's Claims, Research, Proposals and Conductor producers. Six legacy packets contain 96 images: Pine 30, Batch 3 20, Claims 12, Research 20, Proposals 8 and Conductor 6. Those 96 are separate from the immutable 50-case PL6/VI composition. Pine retains its 12-minute child budget; each other legacy packet retains eight minutes under the unchanged overall capture deadline.

The tests preserve Batch-3-only drift, fixture drift and packet-specific failures, exercise the six-packet union, and retain Conductor's historical BEFORE.yml corruption check as its own case. It cannot silently run only Pine/Batch 3 and miss the historical Conductor requirement.

## Qualification

269 capture-orchestration/planner contracts and 503 affected product tests across 27 files passed. Full TypeScript passed with zero diagnostics. The full candidate plain-language scan covered 498 source files with zero blocking or waived findings (five existing findings disclosed). The pacing spec has no lint findings. The two legacy CommonJS files retain 22 default require-style lint errors and four unused-variable warnings on lines already present in the source parents; no rule was disabled. Full raw logs and the precise disposition are retained.

All three inherited planner manifests remain byte-identical to protected source. The actual candidate's unchanged planner reports `capture=true`, `reason=fail-closed`, `error=conflicting evidence source locks`, and zero attributable drifted paths. This inherited condition was not manufactured or altered: the existing PR workflow orders full capture and preserves the merge-group backstop. It provides the normal CI route to genuine current-source PL6/VI and Batch 3 proof.

## Remaining acceptance

Natural exact-head CI must run the paced browser test and the existing shared exporter. Retain and qualify the actual checkout, source maps, complete 50-case composition, 20-image Batch 3 return and settled lifecycle. Successful capture does not by itself update every checked-in legacy lock: genuine source/image/report bytes and historical packet membership must be preserved when committing successor evidence. Other current-source evidence failures, if any, remain real gates to repair.

No local browser launch, old M2 cleanup retry, manual CI dispatch, gate relocation, label clearing, approval, direct merge or deployment is performed. SQL0050, paired Macro/provider, merge-blocked and production holds remain in force.
