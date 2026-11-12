# PR #1048: original CI active-inbox packet import

The published head `4ffab199156516d94a5a3a2d7e860fa342813eb2` carried a stale active-inbox driver binding. The unchanged strict reader reproduces that failure: recorded driver `856da74c...`, actual driver `8ccd2435...`. This repair imports the already-returned original CI artifact; it does not recapture or rewrite capture identity.

## Exact source and artifact

- Original workflow: https://github.com/mastermindx-market-intelligence/mastermind-terminal/actions/runs/43088893028 (attempt 1).
- Artifact `unit-evidence-43088893028-1`, ID `13890390476`; zip SHA-256 `c9877931c8fc22a7bd87e3bbf9e1e54ee7fa8be0e1586f17ff1109e9fc9fcf56`.
- Actual producer checkout `0d86ec458ae5589a02257305842f37d5b8584d6c`, tree `01143905d2933d5d4504bb5060033db74f1fd14d`, captured `2026-11-11T19:41:37.944Z`. The immutable GitHub readback confirms parents `568fa505afb068900424fe4db0da67587d46a114` and `4ffab199156516d94a5a3a2d7e860fa342813eb2`.
- Exact manifest SHA-256 `ccb6a5f19cb6498016ca986555488dc9a988896b5f3e6abcbd18fdab32013b04`. Raw checkout, producer proof and producer manifest are preserved under `original-ci-artifact/`.

## Qualification

The existing `readInboxPacket` rejects the prior selected packet, accepts the staged original artifact, and accepts the installed packet after the eight PNGs are copied and `capture.json` is copied last. All 15 source bindings, all eight full PNG decodes, exact image digests, crop geometry, versions and cleanup receipts pass. The existing `f11_7RecurringBriefsEvidence.test.ts` passes all six tests unchanged. All 13 historical mixed-packet files and the existing explicit scope file remain byte-identical. The prior selected active packet is retained under `historical-active-inbox/`.

The principal inspected all eight actual original screenshots: list and empty states at desktop/mobile in English/Chinese. The review is limited to the returned dark crops; no tablet, light, full-page, independent font witness, cold-reader or production acceptance is asserted.

The first staging check used macOS `/tmp`, which resolves to `/private/tmp`; the strict no-symlink directory assertion rejected that spelling before any packet import. The failed raw log is retained. Reading the same bytes at the real canonical directory path passes without weakening the reader.

## Scope and retained obligations

Only the selected packet and additive proof change. No application, capture driver, reader, test, SQL, model target, producer or release control changes. SQL0050, Macro #9601/provider, model target/ACK/persistence, authenticated and production/release acceptance remain open. No merge or auto-merge is requested. Current protected-source composition is a separate next phase; this proof remains bound to the exact source above and is reused only where all inputs remain equal.
