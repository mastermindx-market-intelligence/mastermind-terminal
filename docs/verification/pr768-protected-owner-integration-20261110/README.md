# PR768 — integrate the protected EOD/GEX owner composition

This proof is bound to PR head `20c16787dac0655dc874990e7823e5cba2cef9e6` merged with protected master `33f9224f2b1e68512e38fab33d32c64a0bef6096`. The resolved source tree before adding this packet is `4a1f3c9161596f8fb520b4acad626315b204d64a`.

## Why this integration is needed

PR650 merged through the protected queue at 2026-11-10 04:05:14 UTC. Its older EOD-only controller and the paired Options successor in PR768 conflict in nine files. Resolving only the marked hunks also retains obsolete synchronous EOD code outside those markers: references to the removed `eodBefore` variable, a second capture/qualification route, and a test fake calling removed `writeEod()`.

The coherent resolution preserves the complete qualified PR768 postimages for the paired native controller, its tests, strict Options reader, type declaration/bridge, reader tests, planner and planner tests, plus the EOD Options successor declaration. Protected UI-copy history remains in that successor's original lineage. Clean protected changes, including accepted chart keyboard and Today workspace work, remain integrated.

The workflow is byte-identical on both parents, blob `e1d79d2211acb2a29fc1e79dd9a195df96da280d`. Its 85-minute step and the owner's shared 84-minute deadline are unchanged. There is one EOD/GEX capture owner and no duplicate runtime.

## Actual verification

- 250 existing Node assertions passed across the capture controller, visual-evidence controller, planner, safe reporter and native-boundary cases.
- 105 native reader/owner assertions passed across six existing Vitest files.
- Next route type generation and full TypeScript checking passed.
- 231 existing Python CI-contract assertions passed.
- Nine existing browser cases passed, with no retries, flakes, failures or skips. Three cases ran at desktop, tablet and mobile: corrected-book rejection, synthetic exposure surface journey, and saved-theme cold return.
- The qualification observed 2,008 source entries; the browser supplement observed 2,027. Each before/after source map remained identical.
- The owned browser server and port 47468 were stopped and its stale-lock lifecycle reconciled.
- All 32 EOD, 29 GEX and 71 browser declared inputs remain unchanged. The original 126 EOD images, 114 GEX images, six browser specifications and 144-case qualification retain their original identities; they were not recaptured or restamped.

The browser supplement uses the existing fixture profile, shared shell 0 and investor preview 0, with the witness and appearance overrides absent. It retains 99 browser artifacts, including six saved-theme PNGs. Principal visual inspection covered the desktop and mobile reloaded chart and the tablet returned investigation. The light preference, exposure-reference actions and selected-strike state were visible. This is scoped local consumer proof, not authenticated production, the separate chart-settings-modal test or whole-product acceptance.

The resolved source files pass the focused diff check. Historical raw test-log whitespace in protected chart-keyboard evidence and the already published PR768 evidence is preserved rather than rewriting execution records.

## Source, carrier and outstanding acceptance

The original GitHub-native PR publication remains the carrier. This finite validation used the separately acquired operation `terminal-pr-duty-20261110-768-owner-merge`; the original review workspaces remain untouched.

During validation, protected master advanced to `26c800c265d2cc627098955d186ddc8ef2886960` via independently owned PR1409. Its sole changed path is `DEPLOY.md`; it does not alter this source composition or its declared inputs. New-head CI and the protected merge group remain responsible for current-base acceptance. No ancestry-only refresh is used.

The existing auto-merge request is retained. No direct merge, self-approval, enforcement bypass, new runner, deployment or production acceptance is claimed. PR650's missing Actions CodeQL coverage and denied retry remain a separately recorded limitation.

Procedure pin: Mastermind@`5257967eb23d10418dc2326bb7a7b31f7e6a5915`. The principal is the single source/publication integrator; native agents supplied read-only source and conflict reasoning. Prior refused/unknown worker actions, original publisher effects, installation, R2 conditional-CAS, authenticated execution, Observe and trading-admission fences remain intact.
