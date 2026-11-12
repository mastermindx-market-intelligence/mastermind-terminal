# PR1243: observe dev-indicator absence before native capture

The published integration at483554457f302a90305f03c360636ca97ed75fb3 exposed a producer-integrity gap: both native producers removed nextjs-portal before checking its indicator, and checked only after writing the accepted screenshot. Auto-merge was paused before this successor.

Both producers now inspect the unmodified DOM immediately before every accepted screenshot, including the GEX pick-absent direct screenshot. They refuse the screenshot if the indicator is mounted or inspection fails. Crop geometry, fixtures, case names and product source are unchanged.

## Actual native proof

The full114-case GEX and126-case EOD executions each passed once, with all1,626 observed source files unchanged and both server ports/Next locks closed. Their actual logs, manifests, source maps, per-image hashes and execution records are pinned by the two successor descriptors. All earlier successful and unsuccessful native artifacts remain byte-identical under master-integration-20261109; the reader verifies the earlier successful images as historical evidence. Root protected images are retained; the root declaration selects only the current successor.

## Browser applicability

The separate123-case browser execution is retained without modification. Its66 inputs have exactly two changes: the native producer files. None of its five specs, configuration, setup or warmup imports or executes those producers. A literal reviewed projection requires both old producer hashes, both successor hashes, the exact66-key set and all64 unchanged inputs. Unknown, swapped, partial or unrelated changes are rejected. This is source applicability for existing browser proof, not a new browser run.

## Validation

-91 evidence-reader/consumer assertions passed across five files.
-13 producer/scoped assertions passed, including six new pre-image indicator tests.
-Full TypeScript checking and focused TypeScript lint passed.
-Actual native images gex-pick-absent-390-zh.png and eod-darkpool-absent-390-zh.png were visually inspected.

Execution logs and reports remain exact. Node was26.5.0 on the owned native host. No production deployment or live-provider acceptance is claimed. Natural CI and native release controls remain required for the published successor.

Qualification SHA-256: `ac316cd565867f25552ec88c2d9910db3d1d7f3ccb290604db3c7fe325ebe6f9`.
