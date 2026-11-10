# Exposure CI reconciliation — 2026-11-05

## Verified change

The actual pull-request run [41965639438](https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/41965639438), attempt 1 at published head `0182a45abccb9c0e77b2c8e4626431e89635b35f`, exposed one unit failure. A historical successful-test title inside a committed plain-text log was included by the account-boundary source inventory. The guard itself and runtime implementation are unchanged.

The original 336,251 log bytes are now retained losslessly in `integration-20261104/logs/full-unit-postwait-20261104.log.gz`. Its original and archive SHA-256 values, prior Git blob and compression settings are recorded in `integration-20261104/historical-log-archive.json`. Decompression exactly reproduces the original. The old package index also had an already-published README digest mismatch; that index entry was corrected without changing the README.

## Verification

- The exact account-boundary suite passes **28/28** after archival.
- Current Exposure GEX/EOD evidence and whole-fingerprint selection checks pass **32/32**.
- Focused evidence-reader lint passes.
- The earlier real PR unit run reported **18,741 passing, one failing, 50 skipped and four todo tests**. These are the earlier run's results, not a claim about a successor commit.
- Raw diagnostic and local verification outputs are preserved as lossless compressed artifacts, with original and archive hashes in `qualification.json`.

## Shared native proof reader

The reader now admits one complete source fingerprint for the original Exposure profile or the joint Options profile. The joint profile requires the fixed 303-path contract, actual original/peer before-and-after maps, stable whole-source snapshots, the exact offline font input and producer script, and all 114 GEX or 126 EOD image hashes. It cannot assemble a candidate from separate per-file captures or choose an ambiguous matching capture.

Options incorporates the accepted Exposure workspace dependency after six real phone Retry failures in the older layout. Its new capture and preserved Options history remain owned by that original branch. Exposure retains its original immutable history and separately qualified Lab boundary. A combined root requires both histories. The native Strike/rail scenarios do not qualify the unselected Chart view; the two precise Map source identities remain explicitly recorded outside those scenes.

This commit changes evidence selection and packaging. It does not claim a new runtime deployment, merged ancestry, production proof or user acceptance. The six accepted Paper boards and their implementation evidence remain preserved.
