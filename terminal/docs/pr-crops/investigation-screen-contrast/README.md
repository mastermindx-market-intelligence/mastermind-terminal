# Retained-screen metadata contrast

The actual mounted Saved Research reader exposed 13px metadata at **3.7015:1** on its dark card. The existing secondary-text token now measures **6.2937:1 dark / 6.7274:1 light**, scoped to the shared screen picker/reader. The accepted Thesis rule retains the same declaration. No global token, screen definition, owner API, or persistence change.

- Original mounted desktop dark check: **1 FAIL**, preserved in `original-dark-contrast.json`.
- English/Chinese at 1440×900, 820×1180 and 390×844: **6 accepted cases / 18 states** through supported account metadata (Light, Auto noon, Auto 22:00). HTML remained dark; no DOM theme override. Twelve unique crops viewed; the six explicit-Light crops matched Auto-day bytes and are reused.
- The exact retained definition A, revision, timestamp, fingerprint and nested conditions remained readable despite current owner B. Complete owner readback and manifest stayed unchanged; zero browser owner reads, owner writes, Investigation writes or auth writes during these reader observations.
- Existing picker → explicit Save → reader → newer owner/deletion → unavailable journey: **6 PASS**, with contrast assertions in both picker and reader. Its intended local fixture Save is separate from zero implicit owner writes.
- Seven existing screen component tests pass; TypeScript and whitespace checks pass. Changed screen files/helper lint clean; the Thesis spec retains its three existing lint errors and one warning, with zero added.

The initial candidate had four passing cases and two Chinese failures solely on an unsupported exact-three-GET harness assumption. Both had passed their actual contrast and identity checks; one extra same-revision GET was retained. The corrected harness requires each theme to read the exact revision and still forbids owner reads/writes. Only those two cases reran and passed (three/four reads). This is not a product read-deduplication repair.

`results.json` binds the tested file bytes and measured states. The shared contrast helper is extracted unchanged from the accepted Thesis test apart from its fallback diagnostic label; previous Thesis proof is reused. These are local Chromium fixtures and scoped visual checks, not native text enlargement, complete accessibility, disposable-database requalification, authenticated live use, or release acceptance. All release holds remain.
