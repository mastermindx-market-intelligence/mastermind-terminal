# Beta shell access and workflow UI proof — 2026-11-09

## Scope and design reference

This is an implementation leaf of `market-os-shared-shell-design-20260924-sol-001` (MARKET-OS), assigned by the Chairman to find, fix and publish beta UI improvements while protected checks run.

- Source base: Terminal `e4329a7d265e1d2405cad4e87ead9b7797d60e61`.
- Governing source pin: Mastermind `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Design input: [Shared Shell · Integration reference · R1](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0), especially Today desktop and access/recovery states.
- Existing application tokens provide the neutral panels, text, borders and focus color. This patch does not promote the separate F01 candidate.

## Reproduced defects and changes

On the original /today guest route, Sign in measured 16.67px high. At 568×320, focusing it moved document scrollY to 52px and pushed the shell header above the viewport.

Guest and recovery cards now scroll inside the available content row; cards center only when they fit. Primary, secondary and retry actions are at least 44px tall. Light/Chinese and dark/English views retain the existing copy and use semantic theme tokens. Decorative feature marks use restrained monoline checks.

The account dialog also retained its first mode while mounted but hidden. Create account → dismiss → Sign in incorrectly reopened signup. The sheet now observes a changed entry mode/visibility before rendering children, preserving wizard fields and step state. Internal mode controls remain local.

Discover's three focused workflow links have a 44px minimum target, a quiet hover fill and the incumbent full focus outline. Their destination hrefs are unchanged.

## Verification

Local Next development server: loopback port 3287, Shared Shell explicitly enabled, incumbent test fixtures. No live account, purchase, entitlement or private-data writes were made.

- Responsive Playwright: **13 passed, 2 intentional skips**. The desktop project owns the explicit 568×320, 844×390 and 320×568 loop; tablet/mobile skip that duplicate loop.
- Covered keyboard activation, signup → signin → signup, retained typed first name, EN/dark and ZH/light, recovery retry, shell/header stability, 44px targets and Discover focus at 320px.
- A malformed loopback-only session exercises the real standalone account-service-unavailable route without mounting guest chrome. Its retry is reachable and at least 44px tall.
- TypeScript: `npx tsc --noEmit --pretty false` passed.
- Focused lint for changed gates and the new browser spec passed. OnboardingSheet's lint baseline has 41 existing findings; the candidate has the same 41, with no new rule/message findings.
- Existing focused session, claims/member and onboarding tests: 70 passed across seven files.
- Diff whitespace check passed.

Reproduce browser coverage:

```sh
MMX_SHARED_SHELL=1 TERMINAL_E2E_PORT=3287 npm run test:e2e:responsive -- e2e/shared-shell-access.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
```

## Inspected captures

| Capture | Evidence |
| --- | --- |
| [guest-desktop-dark.png](guest-desktop-dark.png) | Neutral access panel and visible keyboard focus |
| [guest-mobile-light-zh.png](guest-mobile-light-zh.png) | Light theme, Chinese copy and full-width actions |
| [guest-short-scrolled.png](guest-short-scrolled.png) | Fixed shell header while the access content scrolls |
| [discover-320-focus.png](discover-320-focus.png) | Focused workflow link at the narrow edge case |
| [account-unavailable-mobile.png](account-unavailable-mobile.png) | Standalone account failure presentation |

These captures prove the local candidate, not a protected merge or live beta rollout. Hosted required checks, native queue acceptance and the existing beta release owner's deployment receipt remain separate evidence.
