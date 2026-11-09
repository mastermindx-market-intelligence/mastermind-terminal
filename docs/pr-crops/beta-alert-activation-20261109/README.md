# Alerts recent-activity keyboard proof — 2026-11-09

This is an independent implementation leaf of `market-os-shared-shell-design-20260924-sol-001` / MARKET-OS, continuing the Chairman's beta UI assignment while the earlier UI pull requests run through protected checks.

## Source and reproduced defect

- Terminal base: `8390cc4ad41b1c0773e979198c80e742852c01dc`.
- Governing Mastermind pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Existing /alerts fixture route and fired-alert/receipt fixtures from `e2e/f08-alerts.spec.ts`.

Recent-activity rows declared role=button and accepted focus, but their custom key handler supported only Enter. The real browser regression failed before the fix: after focusing the NVDA activity row and pressing Space, the existing Alert detail dialog did not appear.

## Change

Activity rows are now native type=button elements and keep their existing onClick handler. Browser-native keyboard behavior supplies Space and Enter activation. A small component-scoped style retains full-width wrapping and dividers, inherits the current typography/colors, adds a quiet hover state and visible focus ring, and sets a 44px minimum target.

The shared `alerts.module.css`, noninteractive WatchingList rows, alert data and detail state owner are unchanged. The empty-timeline guard and delivery labels remain intact. This change does not claim to redesign the separate detail dialog's focus behavior.

## Verification

- Before: targeted browser test failed at Space → Alert detail.
- After: **3 browser cases passed**, on desktop, tablet and a 320×568 mobile viewport.
- The same row opens the existing detail with Space, Enter and pointer activation; the dialog can be closed between each action.
- Actual keyboard Tab/Shift+Tab produces the visible 2px focus ring. Bounds remain within the viewport and height is at least 44px.
- The browser recorded **zero alert mutation requests** while opening and closing detail.
- Existing AlertTimeline unit cases: **3 passed**, including the empty guard and English/Chinese verdict content.
- TypeScript, focused ESLint and diff whitespace checks passed.

```sh
TERMINAL_E2E_PORT=3289 npm run test:e2e:responsive -- e2e/f08-alerts.spec.ts --grep 'recent activity opens detail' --project=desktop --project=tablet --project=mobile --workers=1
```

## Captures

- [Before: Space leaves the activity row without opening detail](before-space-desktop.png)
- [Desktop keyboard focus](keyboard-focus-desktop.png)
- [Tablet keyboard focus](keyboard-focus-tablet.png)
- [320px mobile keyboard focus](keyboard-focus-mobile.png)

These captures use deterministic local alert/receipt reads. They establish the candidate interaction, not a live alert, protected merge or beta deployment.

## Composed-consumer follow-up

A follow-up at `2949bfa5764fd93af81ff3d7276af521c156bb46` reproduced two failures in the existing English/Chinese held-result consumer test: its literal `[role="button"]` selector missed the native button's implicit role. The test now locates the existing recent-activity delivery row through the component's established attributes, then clicks it and retains all evidence-link, source-clock and no-invented-price assertions. Production code is unchanged.

The timeline empty/content guard and three composed alert-consumer suites pass **28 cases across four files**. The existing single `no-explicit-any` lint finding at `heldMaterialConsumer.test.tsx:8` is unchanged from the original source. The sibling #1368 only changes this file's separate dialog lookup to observe its body portal; neither repair removes semantic assertions.

```sh
npx vitest run lib/__tests__/alertTimelineEmptyGuard.test.ts lib/__tests__/alertsCockpitThesisSummary.test.tsx lib/__tests__/alertsCockpitZhParity.test.ts lib/__tests__/heldMaterialConsumer.test.tsx --reporter=dot
```
