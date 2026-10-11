# Terminal account/settings — Paper-to-native evidence

Paper: https://app.paper.design/file/01M2WGNCX9475G79JRKJTCM08P/p-1C-0
Desktop `61ON-0`; mobile full-scroll study `61TU-0`. Native rendered source is commit `fe1b5da159071050279ef2591ae18c98f81a3a76`. The later evidence commit changes tests/captures, not the rendered settings components or styles.

## What to inspect

`terminal-dashboard-settings.png` shows the actual `/terminal?symbol=NVDA` consumer opening its real settings pane. Other screenshots mount the same `SettingsPanel` and real sections through the existing production-gated `/dev/settings` fixture. All account names, balances, teams and market data here are fixture context, not production verification. Desktop EN/ZH, tablet EN, mobile EN/ZH, and scrolled mobile chart defaults are included; `screenshots.json` binds every image by SHA-256. Reduced motion is verified by a real media-query assertion before capture.

The shared shell uses Terminal tokens, removes the aurora and heavy blur, groups the same thirteen destinations, keeps the dashboard visible behind a restrained scrim, and supplies a native narrow-screen section selector with a fixed close/sign-out header. The Terminal section uses one six-market list, the canonical eighteen timeframes, and two labeled candle-color conventions. Existing stores, home-market lock, delivery/retry, account ownership, and current-chart behavior remain unchanged.

## Verification

- Full Vitest: **543 files, 8,914 tests passed**, four existing todos.
- Focused Chromium: **14 tests passed**; the suite owns its viewport matrix and runs once in the canonical desktop shard, not once for every device project.
- Existing real Terminal responsive journey: **desktop, tablet and mobile all passed**.
- TypeScript and `next build`: **passed** with the established local fixture environment. This is a local production build, not deployment.
- Nine existing account/settings capture tools: **106 refreshed screenshots**, with their existing source hashes and measurement locks updated by the tools. Password/delete/role/invite/API-key actions remain local mocked capture states; no live account action occurred.

One existing ESLint finding in SettingsPanel's unchanged team-reader effect also reproduces on the base. Other changed TypeScript files lint clean. Five unrelated screenshot packs depend on the global LEX file; all **2,435 existing entries remain byte-identical** and the eleven new keys are consumed exclusively by the two settings components. Those five dependency hashes have explicit nonvisual-update comments and retain their original capture heads. They are **not recaptured or newly accepted**; see `lex-addition-proof.json`.

## Commands

```sh
cd terminal
npm test -- --maxWorkers=2 --minWorkers=1
npx tsc --noEmit
npx playwright test --config=playwright.settings.config.ts
TERMINAL_E2E_PORT=3197 npx playwright test responsive.spec.ts \
  -g 'the canonical Terminal shell works at its supported responsive widths' \
  --project=desktop --project=tablet --project=mobile --workers=1
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key npm run build
```

Keep raw command logs outside `terminal/`: its existing password-boundary absence test deliberately scans every extension beneath the app, including ignored log files. No source guard was weakened to accommodate test artifacts.

Release remains the existing protected GitHub CI → merge-on-green → git-gated deployment → live verification path. Creation, local verification, merge and production acceptance are separate states.
