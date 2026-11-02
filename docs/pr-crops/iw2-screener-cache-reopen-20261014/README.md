# Screener scan survives a malformed refresh and reopening

A parseable HTTP200 `{"symbols":[]}` response previously replaced the last usable scan in IndexedDB before Screener could reject its shape. Reopening then lost the old rows. The original native-browser regression failed; its503 control passed.

The shared `/data/manifest.json` cache now checks the same object/symbol-map contract used by Screener before committing a network answer. Invalid records left by older clients are skipped on normal reads and prefetch. Empty maps and thin rows remain valid. Other URLs retain generic JSON handling; absence, TTL, invalidation and ownership behavior are unchanged. This does not reconstruct a good record that an older client has already overwritten.

Validation: original14failed/2passed cache regressions become16passed, followed by two additional prefetch/joiner controls passing (18new checks,133 affected checks total with115 unchanged results reused). Six desktop/tablet/mobile native-IndexedDB reopening cases pass, as do18 English/Chinese refresh cases and9 existing cold/absence/empty cases. Typecheck passes. New tests have no lint errors; existing files retain the same56 errors and10 warnings with none added. Two success fixtures gained a valid empty `symbols` map; their original callback and exception-isolation assertions remain.

The12 reopening screenshots contain4 distinct images, all inspected;8 identical copies reuse those inspections. The cached111.00 value, original2026-10-12 date and failure/Retry state survive full-page reopening. There are no owner writes in these routed fixtures. Analytics is not an owner write. These are local fixture checks, separate from hosted CI, release and live acceptance. Prior403 images and their manifests/recipes are unchanged.

The original bounded Fabric design review was consumed and accepted by the assigning parent. It supports a stable URL contract rather than per-caller validators. Parent validation adds the actual patch, persisted-record controls and browser evidence; the worker did not execute those browsers.
