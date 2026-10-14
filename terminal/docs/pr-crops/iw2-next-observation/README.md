# Saved next observation: display and explicit authoring

The existing optional `continuation.next_observation` can now be read from the exact saved revision and edited through the existing Save research action. Editing stays local until Save. Clearing removes only this optional field; duplicating creates a separate record and leaves the original revision intact. No new schema, endpoint, owner or research lifecycle was introduced.

The consumer source is `5306268377affb03331bb32ded947284bf89380f`; the authoring source is `065815a36922dd7478d4e2280932c74546e10ebe`. The manifest preserves each capture's original source, rather than attributing earlier pixels to a later tree. All 28 original PNGs were reviewed directly.

- Consumer: six English/Chinese desktop, tablet and mobile cases, plus one English 390 px Light case using pinned external Firefox native textZoom 2 / fullZoom 1. Exact historical revisions, absent observations and denied readback are discriminated, with no owner writes.
- Authoring: the same six standard configurations plus one English 390 px Light native text-only case. Cancel makes no request; explicit edit, clear and duplicate each produce one original-carrier Save. Exact old revision and new-copy readback remain distinct. The native case does not claim a complete keyboard journey.
- Unit coverage: 142 consumer-affected cases passed; authoring then passed 147 affected cases and one newly added over-limit control. TypeScript passed. The workspace's one lint error and three warnings are identical inherited findings; the new component and tests are clean.

The standard browser recipes are `e2e/investigation-next-observation.spec.ts` and `e2e/investigation-next-observation-authoring.spec.ts`. Original native recipes and exact owner receipts are retained alongside the pixels. Existing matrix images, recipes and before images were reused unchanged.

These are isolated authenticated fixture/API browser proofs, not production persistence, a real-principal cross-device test, complete accessibility acceptance or full H2 research closure. Release, schema, rights and live acceptance holds remain in place.

## Character-limit feedback

Source `afc6210ed3305813220104e8dd8089a193ddf8c2` adds a precise status message when the observation exceeds the existing 4000-codepoint limit. The draft is not truncated. Six new EN/ZH D/T/M cases reject 4001 codepoints without a write, then explicitly save 4000 codepoints (8000 UTF-16 units) and reopen the untouched old revision. The original mounted and browser message failures are retained externally, separately from an earlier local route/cache 404. All six new message captures were reviewed. 148 affected unit cases and TypeScript passed; lint findings remain identical inherited findings. Earlier 28 captures retain their original source pins; they were not recaptured or relabelled.

## Bilingual heading routing

The plain-language CI gate rejected the inline bilingual heading at the previous source. The heading now uses the repository’s local `LEX` pair pattern. Its exact rendered HTML is unchanged across eight English/Chinese empty, missing, literal and markup cases; the six existing SSR checks, guard self-check, forward-only guard, TypeScript and focused lint all pass. Earlier pixel evidence is reused at its original source; no guard or acceptance requirement was weakened.
