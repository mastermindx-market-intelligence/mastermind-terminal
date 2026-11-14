# Prophet Setup — Trough read evidence

## Scope and release boundary

Lead amendment 1, 2026-11-14: named headline is the default, with its method directly underneath in the collapsed card. Count copy remains selectable in source. The study record is independently held behind `TROUGH_RECORD_ENABLED = false`. `NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED` must equal `1`; it is unset/off by default. Only the dedicated Playwright fixture server enables it. No member release, producer, deployment or Sector Intelligence change is included.

Amendment 2 aligns named copy with read-only Paper boards `2A6G-0` (390) and `2A9B-0` (1440): English lists use a final “and” and “; not on”; Chinese uses “；{rest}未处于低位”. Named disclosure says “this headline only lists them”; count retains “only counts”. Collapsed method is unchanged. A reproducible 390 English B fold failure (856.67px against 844px) was repaired with local summary spacing only; the unchanged fold assertion and 44px controls pass afterward. Refreshed 34 affected crops; unavailable crops and desktop none-collapsed crops are preserved.

Amendment 3 removes the former study record from both languages and variants; only empty `record: ""` placeholders remain with the record flag false. English timeframe names use U+2011 and nowrap spans; relevant Chinese names are nowrap in headlines, rows and definitions. The EN/ZH turn definition now describes the producer's completed 3-day-only reading. All 157 affected/neighboring tests and all 24 responsive cases pass; browser assertions verify one-line timeframe names, no overflow and unchanged dash-only non-3D turn cells. Refreshed 32 affected crops, preserving unavailable and no-washout collapsed crops. Source scan found no removed record copy in shipped Trough code.

## Source and design pins

- Terminal base: `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
- Accepted Macro design doctrine and product design system: `d0c39a1eaa9af580e1c2f5a2c926278cb52f3b79`.
- Mastermind procedure pin: `199fd4f91ecc426b1d974eb3bf47f5162476cf24`.
- Paper file `01M3NT5Y3G5HTJHVR0K5W2MDJM`, page `p-D-0`: read-only JSX inspection of `29F0-0` and `29PF-0`; no canvas mutations.
- Requested REV 1.1 contract hash: `4ed9589889e93ed8436596ce5f81474d5c5dfdac9a3f8a32891e80146cd38384`. The supplied file now hashes to `bce1f5d8bd1334c074c1b85fa8ee5481980258f73613d103efa398cf7d8a809d` and includes REV 1.2. This consumer implements the explicit amendment and REV 1.1 fields only; it does not claim producer/event-set parity.

Reading order: title → named timeframe assessment → method/limitation → kind → group → disclosure. Record copy is not rendered. Analytical depth remains in the disclosure; definitions precede measurements on mobile and sit right on desktop. Setup-only mounting preserves company selection and tab return.

## Contract and access limits

Client singleton: `/api/prophet/trough-read`. The BFF uses the same verified billing session and Macro base as beta evaluation, a bounded 160 KiB / 10-second read, no redirects, private/no-store headers and one closed decoder for fixture/live paths. Its intended Macro singleton is `/api/prophet/trough-read/v1`, analogous to beta evaluation, serving Macro's `site/prophet/trough_read.json`. **This upstream endpoint has not been verified against a producer.** Missing publication stays unavailable; no direct public-data fetch remains.

REV 1.1 parses known timestamp, engine reference, per-timeframe D/components and 3D-only turns without rendering raw fields. Only available completed bars count. Only 3D supplies the suffix and turn column. Kind null shows unavailable without a scale marker; non-null kind remains tested. History uses ATRc magnitudes and the specified inclusive percentile boundaries. Null provenance is omitted.

Synthetic test fixtures live under the test directory, not the public data tree. The existing production-proof fixture gate prevents selecting them in production. The rollout flag is presentation control, not authorization. Closed validation rejects unknown nested fields rather than rehosting arbitrary producer data.

## Verification

- TypeScript `tsc --noEmit`: pass.
- Focused ESLint on all amended TypeScript files: pass.
- Five affected/neighboring Vitest files: **157 passed**, including **92 trough tests** and 65 existing setup/rotation tests.
- Dedicated Playwright matrix: **24 passed**, no retries. EN/ZH A–E at 390/1440 and A/D at 320. Preserves initial 390 fold with unavailable RotationRead, zero horizontal overflow, 44px rows/controls, keyboard disclosure/focus return, selection/tab preservation, definitions order, collapsed method, hidden record, null kind and 3D-only turn cells.
- Existing desktop company-case suite: **7 passed**, no retries, default-off server.
- Earlier full repository lint attempt failed: **1,995 errors / 351 warnings** in unrelated existing files. No assertions or lint rules were weakened. Focused lint remains green.
- `git diff --check`: pass.
- `SELF_REVIEWED`, not independent review or human cold-reader evidence.

## PNG index

42 regenerated PNGs: `{state}-{language}-{width}-collapsed.png` captures the viewport; `*-expanded.png` captures the expanded block for A/B/C/E. A turning, B not yet turned, C no washout, D unavailable, E unavailable 2-week leg. EN/ZH pairs cover changed copy.

- [390 turning, collapsed](A-en-390-collapsed.png)
- [390 turning, expanded](A-en-390-expanded.png)
- [390 not yet turned](B-en-390-collapsed.png)
- [390 not washed out](C-en-390-collapsed.png)
- [390 unavailable](D-en-390-collapsed.png)
- [320 turning](A-en-320-collapsed.png)
- [320 unavailable](D-en-320-collapsed.png)
- [1440 disclosure](A-en-1440-expanded.png)

Not performed: producer endpoint integration/parity, production enablement, deployment/live-member verification, human cold-reader testing, merge or release enrollment. The lead retains release authority.
