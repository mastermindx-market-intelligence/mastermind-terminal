# Portfolio Targets feedback hardening — 2026-10-22

Settings discarded the route's safe target and band validation codes, so a rejected value produced generic uncertainty instead of the actionable localized message. The shared Targets cards displayed errors without alert semantics or a programmatic link to the relevant field. A failed Clear could also reuse an earlier validation message.

## Resulting behavior

Settings preserves only the four established public refusal codes. HTTP409 still selects the terminal owner-mismatch path before any response-body parsing, and the existing owner, lifetime, serialized-write and canonical-readback guards remain in place. Unknown response details never become displayed text.

The shared cards and first-target rows announce errors with `role="alert"` and use an instance-specific React ID for field descriptions. A field is marked invalid only while its current draft actually fails the existing normalizer. A restored valid canonical value therefore remains valid even when the preceding attempt was rejected. Correction clears the prior association; Clear resets prior feedback before it starts.

## Executed verification

| Check | Actual result |
| --- | --- |
| Two extended regression files against original component source | 19 failed, 88 passed; exit1 |
| Five focused suites after the repair | 189 passed; exit0 |
| Final source, full project TypeScript | exit0 |
| Responsive feedback matrix, final harness | 12 passed, 0 failed/skipped/flaky; retries0 |
| Changed-file ESLint | Five existing lifecycle errors, reproduced identically on the base; no new diagnostics |
| Final responsive test file ESLint | exit0 |

The 19 expected failures include eight extended existing band tests and eleven added cases; they are not 19 new tests. The focused suite includes unchanged owner-refusal, summary-validation and ordered-readback coverage. Test counts overlap and must not be added as unique cases.

Local checks used Node v26.5.0. The host's node@22 shim resolves to that binary; this is not represented as a Node22 run. Dependencies were copied from the prior managed workspace only after byte-identical package-lock verification. Hosted CI has its own pinned runtime and remains a separate release gate.

The matrix exercises Portfolio and Settings in EN/ZH at 1440×900, 820×1180 and 390×844. Each case verifies a real400 range refusal, canonical rollback, correct accessible description, local nonnumeric band validation, retained focus, successful correction and canonical target80/band7 readback, without page errors or horizontal overflow. Settings uses the existing signed-in chart fixture route; the non-chart fixture shell has its own guest identity. This adds no production authentication bypass.

### Browser-attempt provenance

1. The first invocation could not start Turbopack because node_modules was a symlink outside the workspace root. No UI test executed. A copy-on-write clone of the same verified dependencies repaired the environment.
2. The first executing matrix selected an off-screen duplicate Settings button: two Portfolio cases passed, one Settings case failed, one was interrupted, and eight did not run.
3. The header-scoped attempt exposed the guest identity of the non-chart fixture shell, opening onboarding instead of Settings: two passed, one failed, one was interrupted, and eight did not run.
4. The final matrix follows the established Settings fixture route and passes all12 cases with retries0.

The two interrupted runs were stopped after their distinct causes were established. Their logs, reports, source diffs, stop receipts and failure artifacts are retained. Failed attempts are not relabeled as passing or omitted from the result.

### Visual evidence

The24 crops cover both surfaces, locales and all three viewports with the document root requesting dark and light. **The filename's light/dark suffix describes that root attribute.** Portfolio responds with both palettes. Settings intentionally scopes its existing dark-only palette (`app/settings.css`), so its two root-theme variants both remain dark. These are rendered fixture states, not proof of a new Settings light theme or saved theme preference.

## Separate production acceptance

`production-acceptance-187bf958.json` records the earlier authenticated seven-write disposable QA sequence on deployed187bf958: create, edit notes, set target, close, clear retained orphan target, reopen and delete. Each action received a deliberate persistence readback. The same fictional record was removed, leaving zero open positions, zero closed positions and no targets. Account identifiers and the private record ID are omitted.

That acceptance predates this hardening patch. It proves those production operations at its stated deployed SHA and does not establish this patch's deployment.

## Source and release boundaries

The local test base is187bf9582b3deba2de49b597e29ccce6356333d3. `validation.json` binds the five changed source/test files and the retained artifacts by hash. The route, database schema, SQL0036 application receipt, allocation mathematics and Treasury producer are unchanged by this patch.

Independent source review, current-master integration, whole hosted workflow, protected merge, incumbent deployment and live verification are separately adjudicated release gates. This packet does not establish positive Treasury-history metrics, full screen-reader acceptance, measured production render performance or completion of the entire Portfolio mission.
