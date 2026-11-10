# Drawing control readiness — PR #654

The shell already rejects drawing activation until the current owner and active-symbol cache are ready. Its desktop buttons previously reflected only Replay/multi-chart restrictions, so an enabled button could silently refuse a click during initial publication or owner transition.

The repair derives a control-only loading reason from the existing drawingsReadyFor(active) predicate. It does not change cache ownership, the load effect, activation, save/merge logic, tool retirement or ChartPane restrictions. The initial account placeholder still enables creation before the held cloud GET settles. The existing loading translation is reused.

## Actual regression

The new test extracts the production state/ref assignment, complete owner/load effects, admission block and actual Sidebar JSX prop expressions. It mounts the real Sidebar and Tip with real React commits. A read-only layout observer sees the first DOM commit before passive effects; the actual load effect then publishes its empty cache while fetch stays unresolved.

The initial baseline produced four expected failures and two passes: disabled state was absent for missing cache, current load failure, old-owner transition and an open flyout. Final coverage also hydrates the real favorites UI and uses its actual favorite toggle. All eighteen focused cases across four files pass, as does the full TypeScript check. The probe checks one-click activation before GET completion, stale-owner rejection, current-owner failure, restrictions, flyout/favorite refusal and pin prevention. Successful cloud/save helpers are asserted unused.

The existing full E2E drawing cases are unchanged and remain the required proof for strokes, union merge, saves and recovery. No local browser or denied viewport operation was run. Natural CI must qualify the new published head. D7, VPS key, build/production and signed-in iOS/WebKit/performance boundaries remain intact.
