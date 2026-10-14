# Saved next observation: display and explicit authoring

The existing optional `continuation.next_observation` can now be read from the exact saved revision and edited through the existing Save research action. Editing stays local until Save. Clearing removes only this optional field; duplicating creates a separate record and leaves the original revision intact. No new schema, endpoint, owner or research lifecycle was introduced.

The consumer source is `5306268377affb03331bb32ded947284bf89380f`; the authoring source is `065815a36922dd7478d4e2280932c74546e10ebe`. The manifest preserves each capture's original source, rather than attributing earlier pixels to a later tree. All 28 original PNGs were reviewed directly.

- Consumer: six English/Chinese desktop, tablet and mobile cases, plus one English 390 px Light case using pinned external Firefox native textZoom 2 / fullZoom 1. Exact historical revisions, absent observations and denied readback are discriminated, with no owner writes.
- Authoring: the same six standard configurations plus one English 390 px Light native text-only case. Cancel makes no request; explicit edit, clear and duplicate each produce one original-carrier Save. Exact old revision and new-copy readback remain distinct. The native case does not claim a complete keyboard journey.
- Unit coverage: 142 consumer-affected cases passed; authoring then passed 147 affected cases and one newly added over-limit control. TypeScript passed. The workspace's one lint error and three warnings are identical inherited findings; the new component and tests are clean.

The standard browser recipes are `e2e/investigation-next-observation.spec.ts` and `e2e/investigation-next-observation-authoring.spec.ts`. Original native recipes and exact owner receipts are retained alongside the pixels. Existing matrix images, recipes and before images were reused unchanged.

These are isolated authenticated fixture/API browser proofs, not production persistence, a real-principal cross-device test, complete accessibility acceptance or full H2 research closure. Release, schema, rights and live acceptance holds remain in place.
