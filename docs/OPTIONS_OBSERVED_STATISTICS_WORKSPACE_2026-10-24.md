# Observed Options Statistics workspace

The Statistics destination now answers how observed trading is distributed for one symbol, using the existing shared `meta` stream and the exact decoder from #1177. It does not derive a market denominator from filtered Tape highlights. Source publication is the separately reviewed, default-off Macro #10173 contract.

The screen shows observed print counts and contract volume, calls/puts, eight execution-location groups, original venue codes, qualified premium subtotals and coverage. Null premium remains unavailable. Execution location does not establish participant intent; reported venue counts are not market share. Missing, invalid and unobserved inputs withhold values rather than showing invented zeros. Retained observations remain visible with distinct age, transport-cache and source-acquisition status. Observation time and source print time remain separate.

This is a display-only composition of the existing `/options?tab=statistics` route. The root selector reads the same received metadata; it does not acquire new symbols. The 30-second clock updates display age only. No producer, source acquisition, schedule, credentials, private references or runtime activation changes.

## Design and checks

The existing Paper Options workspace anatomy (Terminal file `01M3NSZGE8JWN2EZCSF0DT05RM`, Exposure board `BPN-0`) informed the neutral surfaces, hierarchy and evidence disclosure. No dedicated Options Statistics board was established, so this is not an exact Statistics mockup-parity claim. Existing Terminal tokens remain authoritative. A `data-theme=light` compatibility probe still rendered the currently active dark token set; it is not qualified production light-mode evidence.

Validation: 38 decoder tests, whole-project TypeScript, targeted ESLint, 24 query/deeplink/navigation browser cases, nine Statistics browser cases across English/Chinese and desktop/tablet/mobile, plus three existing category IA cases. The final layout adjustment reran all nine Statistics cases successfully. Source fixtures are synthetic and explicitly do not establish live source or authenticated production acceptance.

Paper reads and local browser qualification did not alter production. A shared dependency symlink initially prevented Turbopack startup; an APFS clone of the same dependencies into the external-SSD worktree resolved that local setup failure, without changing dependencies.

## Release boundary

Original consumer #1177 retains its carrier. Compose its actual merged source before marking this UI carrier ready for normal protected delivery. Macro #10173 source merge, qualified original Flow installation/activation and genuine published observations remain distinct obligations. Until an acceptable snapshot arrives, the deployed UI must show its honest unavailable state. Follow the existing git-gated Terminal deployment and authenticated consumer verification; no provider retry or new observer is authorized by this UI change.
