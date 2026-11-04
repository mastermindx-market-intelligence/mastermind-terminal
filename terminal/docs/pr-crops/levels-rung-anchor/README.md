# Levels exact-price ticks under a crowded payload — PR evidence

Each crop is the `.levels-column` of `/options?tab=levels` (dark, the only theme), taken from a
FLOW_FIXTURE `levels:SPY` payload crowded the way `e2e/responsive.spec.ts` crowds it: the call
wall moves to 775.50 and the 770 cluster to 775.25, beside the 775 keystone. Deconfliction must
then move three labels off their exact prices.

| folder | `LevelsView.tsx` captured | exact-price marks | moved rungs | marks crossing label text |
|---|---|---|---|---|
| `before/` | `b7a3357b0` (master before this PR; #693's full-width anchor under every rung) | 8 | 3 | 21 |
| `option-a/` | rejected approach (a): the full-width anchor, drawn only for moved rungs | 3 | 3 | 6 |
| `after/` | this PR: a short tick in the stage's left margin, drawn only for moved rungs | 3 | 3 | 0 |

The counts are the same at 1440×900, 820×1180 and 390×844, in en and zh. Each folder's
`EVIDENCE.yml` pins the sha256 of the `LevelsView.tsx` its crops show and the counts measured
from the DOM of each crop.

Option (a) still crosses text because the moved prices lie inside the Ceiling label — that
crowding is why they moved — so a full-width bar at their exact price strikes the Ceiling through.

## Reproduce

From `terminal/`:

```bash
node e2e/tools/capture_levels_rung_anchor.cjs

git show b7a3357b0:terminal/components/levels/LevelsView.tsx > components/levels/LevelsView.tsx
CROP_LABEL=before node e2e/tools/capture_levels_rung_anchor.cjs
git checkout -- components/levels/LevelsView.tsx
```

`option-a/` is this PR's file with the patch below applied (`git apply`), captured with
`CROP_LABEL=option-a`, then restored with `git checkout -- components/levels/LevelsView.tsx`:

```diff
--- a/terminal/components/levels/LevelsView.tsx
+++ b/terminal/components/levels/LevelsView.tsx
@@ -567,8 +567,11 @@
                           data-strike={fmtStrike(n.strike)}
                           style={{
                             ...RUNG_ANCHOR,
+                            left: 0,
                             top: `${rawY * 100}%`,
-                            background: `rgba(${rgb},${0.72 + b * 0.24})`,
+                            width: `${w}%`,
+                            background: `linear-gradient(90deg, rgba(${rgb},${0.64 + b * 0.28}) 0%, rgba(${rgb},0.16) 100%)`,
+                            borderLeft: `2px solid rgba(${rgb},${0.72 + b * 0.24})`,
                           }}
                         />
                       </>
```

These crops are PR evidence, not a gate: no test reads this folder. If `LevelsView.tsx` changes,
they show the file their `EVIDENCE.yml` pins, not the new one — recapture rather than restamp.
