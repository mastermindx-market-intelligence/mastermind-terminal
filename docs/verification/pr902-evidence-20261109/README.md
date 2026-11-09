# Alert and Portfolio targets evidence recovery — PR #902

## Actual replacement packet qualified

The complete replacement packet contains 56 real browser images:16 Alert delivery,32 Portfolio targets and8 Settings targets. All19 evidence tests in the three affected suites passed. Every image was visually inspected, with exact file/SHA/size/PNG dimensions retained in capture-inventory.json. All56 hashes are unique. The original59 files (56 images and3 manifests) remain byte-exact under each packet's history/before-integration-696f3c50; prior-packets.json binds their original source paths and Git blobs.

## Source and execution attribution

Alert and Settings were captured from published source5983026f1643e053a40bdc8ca66a61d08a12d66d. Portfolio was captured from2064cc9ed0588d4a27ba40a0b3e150bc76cc0d84 after its producer-only readiness correction. All current product-source bindings match the manifests. Neither capture is relabelled as the final evidence commit.

The first Portfolio attempt failed on its fourth cell after a single Targets click left aria-selected=false. Three partial images remained unpromoted. Its actual log, result and failure image are preserved. The bounded correction waits for the native client position-read timestamp and attached target readout before the same single click; no forced/repeated click, product state injection or weakened assertion was used. The complete second attempt passed all32 cells.

Source-phase Node checks and full TypeScript pass remain attributed to their original source phase. The changed producer additionally passed Node syntax and scoped diff checks at2064cc9. The historical19-test run's10 failures and9 passes remain as expected stale-evidence rejection; they are separate from the final19 passing tests.

## Native state and geometry

Portfolio and Settings use isolated fixture books, real native create/set/close/Clear APIs and matching bookKey readbacks. Priced positions specify USD. Settings empty sums are null; its populated state has current100%, target60%, drift+40pp and sum offset-40pp. Portfolio covers inside/outside-band, orphaned targets with populated/empty books, unweighable positions, real cleared confirmation and deliberately unavailable reads. Native readbacks remain alongside their corresponding packets.

Every Portfolio crop uses an unmodified native document clip, source/image hashes, measured section/final-control containment, before/after state and geometry equality, and PNG dimension checks. Two mobile unweighable cells needed native height expansion; maximum capture viewport height1317px. Initial viewport width and height, actual capture viewport and every adjustment are retained in CROP_GEOMETRY.json. These are complete section crops, not assertions that all content fits the nominal phone viewport.

Alert and Settings retain their native fixed desktop/mobile settings-card capture contract. Alert's English mobile field-error view includes normal internal scrolling; its error state is visible while the last quiet-hours control extends below the first viewport. No DOM/CSS hiding, stitching, mask or artificial layout change was applied. No Next development indicator appears in the inspected images.

## Ownership and validation

One managed workspace was acquired at the actual H1 source. The two self-owning producers reuse startLegacyServer/waitLegacyServer/settleLegacyServer. Settings uses the same incumbent owner in the retained caller wrapper. All producer processes completed; all original servers settled and ports3602/3603/3604 were absent after capture. The fast-forward to2064cc9 preserved the completed24 Alert/Settings files by hash.

Raw install, capture, failure, server-owner and evidence-gate logs/results are retained. The root visual inspection covers all56 images through14 labelled contact sheets; sheets are temporary inspection aids, while the original image bytes are the authoritative packet. This is source/fixture qualification, not a production or live-account acceptance claim. Required current-head and merge-group CI still govern integration.
