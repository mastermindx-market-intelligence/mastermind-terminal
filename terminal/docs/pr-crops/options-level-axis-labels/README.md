# Options-level coverage and axis-label browser evidence

Source head: `7acab645544a2ab87329cc722fe049f199aedf1f`

## Outcome under proof

The chart consumes three independent, root-scoped stores:

- `options_hub.gex/v1` remains authoritative for every signed level it actually publishes.
- `options_structure.gex_state/v1` fills only missing `call_wall`, `put_wall`, and `gamma_flip` values.
- `options_hub.moves/v1` remains the only source of `EM+` / `EM−`.

No missing value is fabricated and a payload belonging to another root is rejected. The six-line browser scenario deliberately exercises a no-level GEX payload plus current state fallback, expected moves, and an `ABS γ` strike.

The horizontal lines remain at the exact prices `[192.42, 192.44, 192.46, 192.52, 192.58, 192.60]`. Native canvas badges are suppressed; the shared DOM axis layer fans badges vertically and, when necessary, inward into additional lanes. It also clears the chart legend, visual-context trigger, and fullscreen control. PRE/AH/ON owns the countdown while extended-hours pricing is active; regular hours returns the timer to the current quote.

## Coverage census

`coverage-audit-summary.json` is a compact receipt from a complete public-plane audit of all 662 roots in the current `gex_state` index (index as-of `2026-09-16T16:00:00-04:00`):

- 319 roots had all three signed GEX fields absent but at least one current state level available.
- 24 more roots had a partial signed-level gap fillable from current state.
- 7 were published no-OI GEX shells rescued by state: `BABA`, `GOOG`, `INTC`, `NFLX`, `SPCX`, `UBER`, `WBS`.
- 34 missing fields were absent from both planes and therefore remain absent.
- 349 roots had a valid expected-move band; 313 did not and remain without EM labels.

`TSM` was not present in the audited state universe and had no sampled GEX/moves artifact. This change does **not** claim or invent TSM options levels.

## Browser captures

`manifest.json` binds five local browser captures and their SHA-256 hashes:

- `desktop.png`
- `tablet.png`
- `mobile.png`
- `desktop-left-percentage.png`
- `desktop-compact.png`

Every capture proves six visible option badges, exact native line prices, native axis-label suppression, no label/chrome rectangle overlap, extended-hours timer ownership, and no console/page error. The payloads are intercepted contract fixtures; this is UI/contract proof, not production market-data proof.

Capture command:

```bash
BASE_URL=http://127.0.0.1:35911 node docs/pr-crops/options-level-axis-labels/capture.mjs
```
