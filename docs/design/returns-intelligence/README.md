# Returns Intelligence — Paper design record

Design file: https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-15-0

All four R3 boards were applied on page `p-15-0`, visually inspected in Paper,
exported through `get_jsx` with inline styles and without node IDs, and marked
finished on 2026-10-18. Original boards remain. The exports in this directory are
design references; the live implementation uses Terminal components and tokens.

| Board | Node | Export | Intended decision |
|---|---|---|---|
| Continuous stock path | `6B6R-1` | [paper-stock.jsx](paper-stock.jsx) | Is the stock rising, and is its pace strengthening or fading? |
| Group participation | `6EA0-1` | [paper-group.jsx](paper-group.jsx) | Is the group's path supported by broad member participation? |
| Calendar and evidence | `6EA1-1` | [paper-calendar.jsx](paper-calendar.jsx) | Which session changed the path, and what dated evidence is available? |
| Mobile continuous path | `6EA2-1` | [paper-mobile.jsx](paper-mobile.jsx) | Preserve the same decision hierarchy on a narrow screen. |

These use explicit synthetic fixtures, not market quotes or validated forecasts.
NVDA's illustrative 21-session return is +3.16%, with positive pace that has slowed
relative to the immediately prior window. The group is today's three-member
reconstruction with daily equal weights. Its participation is 3/3, not a historical
sector index membership claim. Options evidence remains conditional and forecast
probabilities remain withheld.

## Relation to the implementation

- `terminal/components/fin/ReturnsPage.tsx` coordinates symbol, horizon, group,
  calendar and evidence state inside Analysis → Market → Returns.
- `terminal/components/fin/returns/ReturnPathChart.tsx` renders continuous paths,
  relative wealth, drawdown and actual missing-session breaks with a measured SVG.
- `SessionCalendar.tsx` synchronizes keyboard-accessible session inspection.
- `ReturnsEvidencePanel.tsx` preserves dated GEX/flow boundaries and forecast
  abstention.
- `terminal/lib/returnsIntelligence.ts` owns the versioned descriptive calculations;
  `returnsEvidence.ts` rejects unqualified or future-available forecast evidence.

The actual responsive layout can differ from a static board as controls wrap and
content scrolls. Browser fixtures passed all 15 scenarios at 1440×900, 820×1180 and
390×844. Captures and their metadata are in
[`terminal/docs/pr-crops/returns-intelligence`](../../../terminal/docs/pr-crops/returns-intelligence).
The stock, group and calendar captures, including tablet Chinese and mobile
calendar views, were visually inspected. This is local fixture proof, not proof
that a production user has received the feature.

## Mutation and export boundary

The accepted same-app schema digest was
`1b9afff4c9bcf6f11f5ca2db301bf25ccdc442025344e2ec402459cedcd6a2db`.
All four main board mutations and their completion markers returned applied
outcomes. A later optional group SVG benchmark-overlay mutation
(`returns-r3-20261018-basket-benchmark`, target `6EJR-1`) timed out with an unknown
transport outcome. It was not replayed. Same-owner readback and the exported group
board showed the original basket-only SVG; no applied benchmark overlay is claimed
for Paper. The implemented browser group chart independently includes SPY.

`manifest.json` records the exact exported file hashes. It is an evidence inventory,
not a price-source attestation, model admission or new design authority.
