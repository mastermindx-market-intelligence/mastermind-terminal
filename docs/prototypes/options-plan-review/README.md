# Options Plan / Scenario / Watch / Review interaction prototype

This review build turns the N04–N07 Paper designs into an interactive, deliberately synthetic example. Change midpoint/natural/custom debit, spread quantity, price shock, elapsed sessions and IV assumptions; inspect the expiry payoff; open the model requirements; export an explicitly unsaved example; then compare the fixed D1/D2 review snapshots.

**Capability: BUILT_NOT_PROVEN.** This is not mounted in the Terminal app. There is no account connection, live chain, saved research case, pre-expiry model, alert evaluation, notification or order. The overall Options mission and production acceptance remain incomplete.

## Reproduce

From the repository root, with the existing Terminal lockfile dependencies installed:

```sh
cd terminal
npm ci --ignore-scripts --no-audit --no-fund
npm test -- lib/__tests__/optionsPlanReference.test.ts
npx tsc --noEmit --incremental false
cd ..
terminal/node_modules/.bin/tsc --noEmit -p docs/prototypes/options-plan-review/tsconfig.json
node docs/prototypes/options-plan-review/build.mjs
node docs/prototypes/options-plan-review/verify.mjs
```

Open `dist/index.html` in a browser. The bundle uses no network services. The browser check requires Playwright's Chromium; its report and screenshots go to the ignored `browser-evidence/` directory. `dist/` is generated, not a second application entry point. Build scripts do not modify shared tokens, account state or production routes.

## Source and design identity

- Terminal base: `b9828842d2c2129d1dbefa8213296001a3139eef`.
- Protected procedure: Mastermind `7aa27814c65983932f466d7b79e293e24f5a69c7`, Skillpack 1.0.1 / bootstrap major 1.
- [Paper Options page](https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-U-0); N07 desktop `2WCX-0`, N04 light desktop `2Y0A-0`, N93 contract atlas `2XO0-0`.
- The completed 54-board design increment remains intact. The host strip and step buttons are prototype review tools, not a proposed replacement global navigation.
- `tokens.css` is a generated **review-only snapshot** of custom-property declarations from Macro [`templates/theme.css` at `d7001c51dc93b968544cb66b6b7e82c4f1390ead`](https://github.com/mastermindx-market-intelligence/macro/blob/d7001c51dc93b968544cb66b6b7e82c4f1390ead/templates/theme.css). It does not establish a new production token authority. Terminal currently documents dark-only chrome. Product light-theme support must be integrated through its canonical theme owner; this prototype does not prove that work.
- The payoff chart uses Terminal's existing `svgChart` measurement, domain and tick helpers.

## Design treatment and actual scope

Dark uses a quiet low-luminance canvas, outlined panels and a higher-luminance unavailable-state panel. Light uses the canonical cool canvas, white panels, hairline edges, a shallow card shadow and deeper semantic ink. Both preserve the same content, controls, order and missingness. EN/ZH are paired strings; the prototype never draws a second language beside the selected one.

At phone width, risk and continuation come first; selected legs and the two fixture chain rows follow. Wide chain rows become labelled phone cells. Scenario controls precede the result. Native buttons, labels, focus indicators and a native modal dialog support keyboard use. This is a limited interaction implementation, not full Paper feature parity: contract identity is fixed to the selected 185/190 example; the full chain/expiry chooser, editable watch specification, account save, alert lifecycle and original Terminal shell are not implemented here.

## Calculation boundary

`terminal/lib/optionsPlanReference.ts` is a pure exact-decimal **expiry reference**, using scaled BigInt arithmetic. It has no provider, pricing-model, persistence or alert dependencies. Scope is equal/opposite integer quantities of standard USD American physically settled calls with a 100-share multiplier, a common underlying and expiry date, and increasing strikes. Contract dates are labels, not resolved expiry instants. Input bounds: 1–10,000 spreads; prices/fees up to 1,000,000; at most four decimal places for quotes, strikes, debit and fees, six for an expiry spot. Missing/crossed quotes, unsupported identities and a debit outside `(0, spread width)` fail explicitly.

Midpoint is a reference; natural entry uses long ask minus short bid. Neither is a fill. Total fees are supplied once for the entire spread, or remain `null`. Net break-even remains unavailable when it cannot be expressed exactly at the supported precision or fees exceed maximum gross gain. There is no early-exercise, assignment, dividend, financing, quote-freshness or entitlement qualification here. A production consumer must establish those facts through the existing owners before presenting an actionable expression.

The golden case retains: midpoint debit $200 / natural $210; gross expiry maximum gains $300 / $290; break-even 187 / 187.10. A +2% move from 182.40 is exactly 186.048 and implies **expiry** gross P/L −95.20 / −105.20. Adding five IV percentage points gives 40.8% / 39.8%. Time/IV changes do not invent a pre-expiry value or change the expiry reference.

## Current owner reconciliation

The implementation review resolved the prior ambiguous “campaign/save schema” dependency:

| Existing owner | What current source actually supports | Consequence |
|---|---|---|
| Options Alpha (`optionsAlphaTypes.ts`) | `options.prophet_shadow/v1`, display-only research, execution withheld | A producer campaign is not an account-owned saved plan |
| `/api/theses` + `lib/theses.ts` | Authenticated Thesis Objects, immutable revisions, expected-version conflicts, idempotent `clientRequestId`; RPC `apply_thesis_version_v1` | Reuse this owner for user research lifecycle |
| `ThesisContent` v1 | Exact allowed prose/list fields; `normalizeThesisContent` rejects additional fields | A typed multi-leg snapshot cannot currently be saved through this schema |
| `/api/watchlist` + `lib/watchlists.ts` | Symbol/list membership | Not a strategy snapshot store |
| Existing Alerts | Existing typed conditions and lifecycle | Do not treat the proposed completed-bar close-and-session-VWAP condition as registered or armed |
| Workbench PRs #640 / #661 | Conditional GEX/VEX/CEX exposure fields and future overlay primitives, both held drafts | Not a pre-expiry valuation engine for this selected spread |

The saved-case gap must not be hidden inside `statement`, a new Options-only table, browser localStorage, or Alpha producer-campaign records. A downloadable synthetic example is explicitly not a saved case or authoritative receipt.

Incumbent [#603 ownership ruling](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/603#issuecomment-5740890947), [#599 shadow-interface ruling](https://github.com/mastermindx-market-intelligence/mastermind-terminal/issues/599#issuecomment-5829178476), and draft [#575 Thesis notebook](https://github.com/mastermindx-market-intelligence/mastermind-terminal/pull/575) retain their own scope. This prototype takes no incumbent PR, source lease or release gate.

## Verification and remaining acceptance

The bounded core suite passes **31 tests**. Terminal `tsc --noEmit --incremental false` and the separate prototype TypeScript project both pass. The prototype browser suite passes **160 assertions** and captures **64 states**: four screens × 1440/820/768/390 × dark/light × EN/ZH. Checks include the numerical interactions, invalid debit, custom price precision, quantity, additive IV shifts, missing model values, modal Escape/focus restoration, inert account save/alert controls, unsaved JSON export, fixed review evidence, fresh reload, 44px targets, no document overflow, 200% CSS-zoom overflow and no external requests or uncaught browser errors.

These are local synthetic browser checks. They are not the full Terminal responsive suite, real browser-zoom accessibility certification, screen-reader acceptance, contrast measurement, authentication/RLS proof, live data freshness, server receipt persistence, deployment, or empirical ranking/model qualification. Representative screenshots were visually inspected; the 64-state capture count is not an assertion that every image received independent visual approval. The predecessor's 38-test Python suite was not supplied here and is not counted as rerun.

## Exact next implementation unit

Extend the existing Thesis version-content contract to carry a validated, immutable options research snapshot, with parity between TypeScript normalization and the incumbent database RPC/migration. Include canonical contract/quote/source identities, availability cutoff, pricing basis, unknown fees, evidence references and an independently versioned watch draft. Preserve authenticated ownership, original request reconciliation, two-tab expected-version conflicts and read-back receipts. Reconcile the current Thesis owner and open migrations before changing these shared paths. Once that contract is accepted, wire the approved Plan/Watch/Review panes into the current Options composition; pre-expiry valuation and alert activation stay independently unavailable until their real owner contracts qualify.

No background continuation or unattended release is claimed by this prototype.
