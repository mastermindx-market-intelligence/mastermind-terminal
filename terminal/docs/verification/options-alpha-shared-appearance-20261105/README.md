# P18.T2 Shared Shell Alpha appearance

The actual Shared Shell theme control works. Bare `data-theme=light` on the ordinary legacy shell does not invoke the shared appearance owner. Existing `SharedShellPresentation.tsx` owns the `data-mmx-shared-shell=1` marker and public theme/language controls; `shared-shell.css` scopes its palette to that marker. The ordinary chart shell retains its incumbent dark presentation. No new theme mechanism or activation is added.

## Demonstrated repair

The formed candidate retained its translucent dark-mode material under the supported light palette. The 10px frozen-context note used rgb(105,118,138) over screenshot rgb(248,248,250), giving 4.342748:1, below the 4.5:1 normal-text floor. One light/shared-only candidate rule now consumes existing `--panel` and `--line`. The note measures 4.606253:1 against the rendered white material in all six light language/viewport states.

[Original light RED](before-desktop-en-light.png) · [Original measurement receipt](before-receipt.json) · [Accepted measurements](receipt.json) · [Reproducible local browser harness](qualify.cjs)

## Real control journey

The local fixture harness uses the actual Light theme and Chinese language buttons, in order EN dark → EN light → ZH light → ZH dark, at 1440x900, 820x1180 and 390x844. All12 states pass: source IDs and clocks retained, same route, technical disclosure opens/closes, no document or card overflow, and screenshot-backed light note contrast ≥4.5. Captures show the rendered candidate context; fixed workspace chrome can overlay its upper heading during locator capture. Source identity is independently retained in the receipt.

| Viewport | EN dark | EN light | ZH light | ZH dark |
|---|---|---|---|---|
| 1440x900 | [Shot](desktop-en-dark.png) | [Shot](desktop-en-light.png) | [Shot](desktop-zh-light.png) | [Shot](desktop-zh-dark.png) |
| 820x1180 | [Shot](tablet-en-dark.png) | [Shot](tablet-en-light.png) | [Shot](tablet-zh-light.png) | [Shot](tablet-zh-dark.png) |
| 390x844 | [Shot](mobile-en-dark.png) | [Shot](mobile-en-light.png) | [Shot](mobile-zh-light.png) | [Shot](mobile-zh-dark.png) |

Baseline/repaired dark palette, card/note computed styles, source IDs, clocks and overflow metrics are equal. No pixel-identity claim: fixed chrome positions differ between captures. The conditional stylesheet rule is absent from dark and ordinary-shell presentation. CSS parse and `git diff --check` pass; no JS/TS or backend changes, no duplicate component-suite run.

Run from `terminal/` with a local fixture server at127.0.0.1:3276, existing `MMX_SHARED_SHELL=1`, `FLOW_FIXTURE=1` and `TERMINAL_E2E_FIXTURE=1` only in that dev process:

```sh
node docs/verification/options-alpha-shared-appearance-20261105/qualify.cjs <new-output-directory>
```

Every browser context is fresh. External network is blocked and non-Flow APIs are unavailable fixtures; the server uses its existing Flow fixture plane. No provider acquisition, real auth, account metadata write, production activation or browser acceptance. Shared presentation requests write only their existing local preference cache. Base50713efda7cbd06c60b6dce2f88b31cea5c005a2 does not contain PR1303; its chart action was not copied into this branch. Existing1303 queue/CI, Lab1287 and Exposure scopes were untouched.

Fabric `options-alpha-appearance-p18t2-20261105-r1` supplied the one-line patch under the original root/assigning parent; retained manifest export and local checks were consumed before deterministic acceptance. Protected delivery/install/production proof remain separate.
