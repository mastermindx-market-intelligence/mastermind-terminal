# Batch 3 capture history

The current root `EVIDENCE.yml` describes the complete D06 capture on 2026-11-11: five surfaces, EN/ZH, 1440 and390 viewports,20 actual images. Its16 locked inputs include product sources, the repaired producer, incumbent capture owner, Next configuration and Heatmap fixture. The actual checkout is7875b0277067efad82f8eb1a159295dd60b3c040 with the source hashes recorded in the manifest. See [the D06 repair packet](../../../../docs/verification/pr1270-batch3-crop-20261111/README.md) for the full receipt, preserved failures, consumer tests and limits.

The preceding2026-11-09 renewal remains historical evidence; its source identity is not relabeled as this capture.

The original PR and protected-root evidence are preserved byte for byte in [the renewal packet](../../verification/pr898-evidence-renewal-20261109/README.md):

- [Prior PR root](../../verification/pr898-evidence-renewal-20261109/prior-pr/) and [its inventory](../../verification/pr898-evidence-renewal-20261109/prior-pr-inventory.json): 21 files from `d5dcb1452778d4fd289ec9d6d056d9f28809177d`.
- [Prior protected root](../../verification/pr898-evidence-renewal-20261109/prior-protected/) and [its inventory](../../verification/pr898-evidence-renewal-20261109/prior-protected-inventory.json): 37 files from `f34b0deb0bb2a0b2f57ba82256b9e87886ad76e0`.
- [Prior renewal capture receipt](../../verification/pr898-evidence-renewal-20261109/capture-execution.json), with exact file identities, hashes, dimensions, stable source maps, real supervision and server closure.

The 18 additional FlowDesk detection/enriched/inspector PNGs remain unchanged in this directory. They are historical additions, not members of the fresh 20-image declaration. The prior `priorScopedDetectionCapture` and `signedActivityCapture` appendices remain verbatim in the archived protected manifest. The older scoped appendix already contained hashes superseded by the later signed-activity capture; this archive does not claim every older appendix hash matches the latest protected PNG with that name. No older frame or appendix is relabeled as freshly captured.
