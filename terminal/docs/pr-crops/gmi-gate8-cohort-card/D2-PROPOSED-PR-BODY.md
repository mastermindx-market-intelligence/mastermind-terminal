## D2 — Shared themes masthead tile + popover (seat ruling)

### What shipped

- **Desktop (>1180px):** the gate #8 cohort projection appears as a fifth **masthead stat tile** (“Shared themes”) with a **non-modal popover** for full context (counts only; no theme names).
- **Tablet/mobile (≤1180px):** the same projection stays an **in-flow card** below the Prophet grid — unchanged read path, different chrome.
- **Fixture hygiene:** `ready.json` lives under `terminal/lib/__tests__/fixtures/selection_cohort/`; **`terminal/public/data` is untouched** (no runtime fixture file).
- **Single fetch:** one shared `useSelectionCohort()` hook backs both surfaces; dev Strict Mode dedupes the initial request.

### Evidence

- Dark-only crops + `EVIDENCE.yml` layoutFile locks under `terminal/docs/pr-crops/gmi-gate8-cohort-card/`.
- Rebuild: `cd terminal && node e2e/tools/capture_gmi_gate8_cohort_card.cjs`

### Verification

- `npx playwright test e2e/selection-cohort-tile.spec.ts e2e/selection-cohort-card.spec.ts e2e/prophet-responsive.spec.ts e2e/prophet-origination.spec.ts --project=desktop --project=tablet --project=mobile`
- Vitest: `SelectionCohortCard`, `selectionCohort`, `nwRoute`
- Plain-language guard: `node scripts/check_plain_language.mjs --since origin/master` (round 1)

### Non-goals (this slice)

- No changes to `prophet-responsive.spec.ts` or `observatory.css`.
- No ranking, sorting, sizing, or authority beyond the macro projection contract.
