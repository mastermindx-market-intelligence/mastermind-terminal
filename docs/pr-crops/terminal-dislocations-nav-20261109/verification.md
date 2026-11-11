# Dislocations navigation verification

## Exact source

- Product commit: `6351543b3006cfc95b5c060fb28048ee5df5cdff`.
- Base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Procedure pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- AppNav blob: `707947993080a3540cfd495be1e4332220a49bfc`.
- MobileNav blob: `e7fd059b4a324595955ca6acf37a80eaada40f1a`.
- Existing navigation browser suite blob: `6af68de9056fb29ba94e18f9f1a7b9786c32592d`.

The independently owned GitHub-native branch changes the existing glyph table and public mobile active-route mapping. The isolated no-git browser tree restored the previous Search and Tip slices to their exact base blobs before applying this candidate. Git blob hashes were verified before execution.

## Observed and corrected

Public navigation listed Dislocations without a glyph definition, creating an empty SVG. Its mobile route resolver also fell through to Chart. Both surfaces now show the original divergence glyph, and only Dislocations is marked as the current page on that route.

## Qualification

| Check | Result |
| --- | --- |
| Existing symbol propagation and investor navigation regressions | 44 passed |
| Changed-file lint | 0 errors; 1 unchanged MobileNav unused-variable warning (`_isTerminal` is present in the exact preimage) |
| Full TypeScript | Product blobs included in passing combined integration check, exit 0 |
| Real-route browser proof | 3 passed, no retries, 27.4 seconds |

Desktop (1440×900), tablet (820×1180), and phone (390×844) each travel from Discover to Dislocations using the actual public navigation. Each verifies two nonempty, painted SVG paths, a visible icon, exactly one `aria-current="page"` link and the correct Dislocations destination. Desktop and phone screenshots were inspected. The fixture's destination can report missing delayed data; this proof establishes navigation behavior, not market-data availability.

## Ownership reconciliation

Held #654 changes separate AppNav intent/prefetch hunks. #1230 does not change AppNav, MobileNav or sharedShellNavigation. #1244 replaces the Shared Shell rail/drawer primary list and related imports; its exact patches do not change this glyph entry or the public mobile route resolver. Preserve all of those source owners, candidates and holds. This diff does not change Shared Shell's information architecture, symbol handling, destinations, or release controls.

## Delivery

Evidence-only commits leave the product blobs unchanged. PR #1380 records Ready and native exact-head auto-merge enrollment separately. Qualification does not establish merge, deployment or live product acceptance.

[Desktop capture](desktop.png) · [Phone capture](phone.png).
