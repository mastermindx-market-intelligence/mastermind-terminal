# Finviz Discover integration

Implementation scope: the existing Sector Intelligence Discover route, with one source-qualified population feeding Heatmap, Bubbles, categorical Clusters, Matrix and Table. Selection, axes, sizing, timeframe and visibility filters belong to the existing SectorState URL/history owner. Company drill-through uses the existing /analysis route.

## Source and acceptance boundary

- Recovery source: Macro `7eef450b8feb65f677bc78c078633dd8eb1bf125`.
- Existing owner: `site/marketdata/themes_heatmap.json`, `source=finviz-themes`, `map_type=themes`, `size_basis=count`.
- Observed population: 40 themes, 268 subthemes, 2,339 member appearances, 924 distinct tickers; market date 2026-10-07. Payload SHA-256 `4c663a4b63dfc5e144d08cebd31c9c89f0bc7e6bd714092972d6183fd5214b07`.
- Membership receipt: `data/themes_heatmap/tree_refresh_receipts/20260815T020134Z.json`; parser `finviz_tree_refresh.v1`, membership asof 2026-08-15, tree digest `1d597c44c8ce0ffba6ce548a08d090c8c702199356830fd7b02739f09f1dba45`.
- The consumer checks source identity, parents, duplicate rows, member identities and owner-reported counts. It does not mint another taxonomy, membership store or analytical score. Missing axes withhold only plotted points.
- The current public owner payload does not carry the complete membership-vintage/correction/unresolved-member manifest. The parallel source-hardening carrier has not been located in the bounded GitHub recovery. Final source acceptance remains OPEN; this legacy owner integration must be reconciled against that accepted contract before claiming the full commission complete.
- `config/theme_sources.yml` at this Macro revision retains `finviz_themes=internal_only` (#8509). The gateway requires both its existing authenticated shared session and `isAdminRequest()` before upstream access. Ordinary customers receive an access refusal. No rights registry or grandfathered-surface exemption is changed. Vendor descriptions are stripped; no vendor assets/code/styles are imported.

## Donor and design

Macro #7283 at `f23aaba0481ac63c566e4d5835a8584751153d5f` supplies the interaction pattern: shared visibility filters, selectable bubble axes, member/equal sizing, null withholding, and a mobile value list. The obsolete house population and page-local router are not carried forward. Terminal's shared SVG helpers replace the donor's fixed viewBox geometry.

Reference: `docs/pr-crops/sector-intelligence-native-20260926/01-intelligence-desktop-light.png`, the current SectorCentralDiscovery components and shared SectorIntelligenceWorkspace tokens.

Dark treatment: layered instrument panels, restrained tonal performance fills, selected-tile inset illumination. Light treatment: white research material, hairline tile boundaries and quiet panel shadows. Hierarchy, semantic colors and density are shared; material depth is independently treated. Missingness is a dash plus population accounting in both. At phone widths the scatterplot gives way to its equivalent accessible value list; matrix/table rows reflow into labelled cells. Theme labels supplied in Chinese are used; untranslated source-local names remain explicitly source labels.

Required verification matrix: desktop 1440x900, tablet 820x1180, mobile 390x844; Chromium and WebKit; EN/light and ZH/dark plus complementary art-direction snapshots. Real owner bytes can be supplied to `e2e/finviz-discovery.spec.ts` with `FINVIZ_PROOF_PAYLOAD`; its default fixture is synthetic. Neither fixture tests nor local real-data rendering proves authenticated production access.

## Delegation identity

Parent/root: `01a118ef-abf3-7ba3-9c57-d4c9c4633816`. Protected Skillpack: Mastermind `c7e47c859eb2925c5626931fd511800773ba09ac`, v1.0.1. Sol integration request `finviz-01a118ef-sol-contract` was refused before launch (unknown explicit model, then provider-default preflight found no eligible mode). No Sol child started. Normal Fabric adapter leaf: `finviz-01a118ef-adapter`, source adapter and tests only; acceptance remains separate from process exit. Parent owns product integration and final acceptance.
