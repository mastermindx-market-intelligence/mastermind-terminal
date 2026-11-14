# Prophet Setup — Trough read evidence

## Scope and release boundary

CEO partial go, 2026-11-14: consumer plumbing, states, disclosure and responsive layouts only. Headline and record wording remain held. `NEXT_PUBLIC_PROPHET_TROUGH_READ_ENABLED` must equal `1`; it is unset/off by default. This change sets it only on the dedicated Playwright fixture server. No member release, producer, deployment or Sector Intelligence change is included.

`TROUGH_HEADLINE_VARIANT` in `components/prophet/setup/setupStrings.ts` is the sole count/named copy switch, initially `count`. Both language variants and their method/record lines live in `TROUGH_STRINGS`.

## Source and design pins

- Terminal base: `c67a68ee1ff340a2bf9b2e0b4abdc0476fdf3d40`.
- Accepted Macro design doctrine and product design system: `d0c39a1eaa9af580e1c2f5a2c926278cb52f3b79`.
- Mastermind procedure pin: `199fd4f91ecc426b1d974eb3bf47f5162476cf24`.
- Paper file `01M3NT5Y3G5HTJHVR0K5W2MDJM`, page `p-D-0`: `29F0-0`, `29HI-0`, `29JU-0`, `29M3-0`, `29MR-0`, `29OW-0`, `29PF-0`. Read-only JSX inspection of `29F0-0` and `29PF-0`; no canvas mutations. The current commission overrides the example-only group figures with an unavailable line and puts definitions first on mobile.

Reading order is title → headline → kind → group → study limitation → disclosure. All mechanics and analytical depth stay behind the disclosure. Desktop places definitions on the right; mobile places them first above the four rows. Setup is the only mount; Context/Evidence, selected company and existing return behavior are preserved.

## Contract and access limits

Single same-origin file seam: `/data/prophet/trough_read.json`, schema `prophet.trough_read/v1`. The parser validates the four ordered timeframes, nullable attributes, group state, dates and finite positions/depths. HTTP failure (including 401/403), malformed body/schema, stale/unavailable publication and absent ticker all stay quiet. No local fallbacks or fixture publications are shipped. Completed, available bars alone contribute to the unweighted headline.

The existing company-case membership surface remains the surrounding access boundary. The rollout flag is presentation control, not authorization. A future Macro publication must retain its own data/access policy; this PR does not claim that a public static file is a member authorization mechanism.

## Verification

- TypeScript `tsc --noEmit`: pass.
- Focused ESLint on all changed TypeScript files: pass.
- Five affected/neighboring Vitest files: **135 passed**, including **58 new trough tests** and 77 existing setup/rotation tests.
- Dedicated Playwright matrix: **24 passed**, no retries needed. EN and ZH: A–E at 390 and 1440; A/D at 320. Asserts the 390 initial fold with the existing unavailable RotationRead, document overflow, placement, definitions-first mobile/right-panel desktop, four 44px rows, both 44px controls, keyboard opening/closing, focus return and company/tab preservation.
- Existing desktop `prophet-company-case.spec.ts`: **7 passed**, no retries needed; default-off server.
- Full repository lint was attempted and **failed: 1,995 errors / 351 warnings** in existing unrelated files. Examples include `useWorkspaceContextConsumer.ts`, `useWorkspaceSource.ts`, `userScripts.ts` and existing scripts. No assertions or lint rules were weakened; all changed TypeScript files pass focused lint.
- Self-review classification: `SELF_REVIEWED`, not independent review or human comprehension evidence.

## PNG index

42 PNGs: `{state}-{language}-{width}-collapsed.png` contains the viewport and existing header; `*-expanded.png` contains the expanded block (populated A/B/C/E only). Synthetic states are test-only: A turning, B not yet turned, C no washout, D unavailable, E unavailable 2-week leg. EN/ZH pairs cover all changed localized copy. Examples:

- [390 turning, collapsed](A-en-390-collapsed.png)
- [390 turning, expanded](A-en-390-expanded.png)
- [390 not yet turned](B-en-390-collapsed.png)
- [390 not washed out](C-en-390-collapsed.png)
- [390 unavailable](D-en-390-collapsed.png)
- [320 turning](A-en-320-collapsed.png)
- [320 unavailable](D-en-320-collapsed.png)
- [1440 disclosure](A-en-1440-expanded.png)

Not performed: producer integration (producer not built), production enablement, deployment/live-member verification, human cold-reader testing, merge or release enrollment. Those are outside this builder's authorization.
