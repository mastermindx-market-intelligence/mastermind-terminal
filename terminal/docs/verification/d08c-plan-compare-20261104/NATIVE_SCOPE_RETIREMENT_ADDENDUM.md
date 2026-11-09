# D08C native-scope retirement repair — additive integration qualification

**Boundary:** Terminal Draft #1296, original operation `d08c-plan-compare-20261104-c3`. Before this repair the exact published implementation was `e0d10f7d8bd35a4a7e4c3be48242552c343b08ab`. The D23 native source remains separate, held Draft #804 at `27df56d997df0ae94a17b6b8e2d14867431bb394`. This addendum does not amend the original source/visual snapshot manifests or retroactively attribute them to the repaired source.

## Reproduced failure

Read-only source composition of the published D08C panel with native #804 was conflict-free and passed TSX parsing. That was not an account-lifetime proof. A subsequent **temporary, reversible** exact-source composition with the original native `isScopeCurrent()` guard and a new component regression produced one failed test: after a baseline had been pinned, the native guard refused another request when the account/selection lifetime expired, but the D08C `plan-baseline-pending` element remained visible. Existing guard protected the async API, but not the new separately owned comparison presentation. Both modified test and composed panel were restored byte-for-byte afterward; #804 was not touched.

## Scoped fix, no new lifecycle owner

- `OptionsPlanComparePanel` receives an optional **existing native** `isScopeCurrent` callback. A false value hides all saved baseline/candidate comparison presentation. The native owner guarantees a retired lifetime cannot be reactivated without a fresh scope-key remount, so repeated stale rerenders stay hidden.
- `OptionsPlanPayoffPanel` forwards that incumbent callback and checks it before pinning a new baseline. This adds no polling, account/store, Save, watch, order, pricing, entitlement, or identity mechanism. Without an owner-provided guard the existing keyed `scopeKey` lifetime continues.
- Native #804's actual `isScopeCurrent` checks before/after async boundaries, native `OptionsPlanResearchBridge`, full Save/receipt/readback semantics and retirement host remain the original owner. Do not replace native code with the protected-base panel.

## Verification and limits

- **RED:** dedicated D08C mounted-panel test saw 1 fail / 6 pass before the guard (stale comparison remained visible).
- **GREEN:** D08C standalone suite of **27 focused tests** passed after fix.
- After aligning the optional callback declaration and default with the native signature, the three-way source composition of exact base `f528a219cc5d73e94e058575e3df83d689632bf9`, D08C repair and held native `27df56d9` was conflict-free; composed bytes SHA-256 `77bde70076dc24dfdf707e7104a283e3264bc87b29ff0a7fa369ca8ada9e5fc7`.
- Reversible **actual composed React unit test** ran native guard with a pinned baseline, expired it, observed no second request and no stale comparison; **18 tests passed / 0 failed** across two focused files. The host files were restored byte-for-byte afterward.
- Historical full-unit 18,453 PASS, previous 36 mounted browser cases, original 50 source-bound visual evidence cases and build receipts bind **the previous e0d10f7d candidate only**, not this change. Do not relabel those historical artifacts as current-head qualification. Current-head CI / actual native installation / authenticated Save/watch/revisit remain separate.

## Integration and release

Consume the repaired comparison into the existing D23 native host without changing its own release hold, T03k effect, exact-0030 migration admission or research/alert persistence. The D23 native guard is mandatory for end-to-end account isolation; the new local visibility fence is only the comparison consumer of its synchronous result. Keep original Paper boards intact.

No #804 edit, merge, Ready/un-draft, enqueue, held relabel, service restart, SQL, production Save/watch or deployment was performed. The formerly refused Restore-baseline/risk extension remains unapplied. Source-only readiness is not live product acceptance.
