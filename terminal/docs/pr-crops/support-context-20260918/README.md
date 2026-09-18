# Support Context — evidence record

Operation: `TERMINAL-SUPPORT-CONTEXT-20260918-SOL-001`

Recovery base: `02e082b3603f7be03e93918051f2c924003e6a10`.

The original local carrier was swept before push. Its two local-only SHAs were reconciled as absent from GitHub and the available branch archives before this same operation was recovered on the same MacBook/canonical path. The recovered worktree is locked while active.

## TDD

Fresh recovery RED:
- `terminal/lib/__tests__/supportContext.test.ts`
- `terminal/lib/__tests__/shellFixtureIdentity.test.tsx`
- result: 16 failed / 2 passed because the new context projection, S/R alert catalog entries, bilingual event name owner, Chinese failure semantics, and fixture-shell identity path did not exist.

Fresh targeted GREEN:
- result: 18 / 18 passed.
- TypeScript `--noEmit`: exit 0.
- `git diff --check`: clean.

## Browser journey

`terminal/e2e/support-context.spec.ts` exercises real mounted product consumers:
- chart render + Support Context;
- recent source marker;
- Alert Center single `sr_hold` creation;
- Alert Center `sr_hold → BOS` sequence creation;
- EN + 中文;
- 1440×900, 820×1180, and 390×844;
- component-cell overflow and document horizontal overflow assertions.Fresh recovery result: **12 / 12 passed** with `--retries=0`.

The test uses deterministic synthetic NVDA OHLC and mocks alert-row persistence at the network boundary. It proves UI/consumer behavior; it is not a production-backend or notification-delivery receipt.

## Real input / computation proof

Fresh production-published `INTC.json` was fetched from `app.mastermind-x.com` on 2026-09-18:
- 11,722 daily bars;
- last date 2026-09-18;
- `src=yahoo`;
- `bar_quality=real_ohlc`;
- SHA-256 `df6d61948864b09b85a87e791ed53c10054fdfb3aba90308159076881872498a`.

The existing suite-alert sidecar was bundled from the candidate and run in `--demo` mode against that file with no Supabase credentials. It completed successfully. There was no fresh `sr_hold` / `sr_break` in the last three published bars; that negative result is preserved rather than fabricated into a demo signal.

A separate pure module probe found current native Structure geometry:
- Premium/Discount: discount 85.14–91.605; GP 92.6825–93.3721; EQ 95.915; OTE 89.7517; premium 100.225–106.69.
- FVG: active/recent zones including 92.37–100.35, 100.48–104.70, 104.42–106.40.
- Market Structure: nearby marks including 89.59 BOS, 98.33 CHoCH, 102.40 CHoCH, 106.69 CHoCH.
- Smart S/R default: strongest displayed intact support 32.73, so it is explicitly **not** treated as the vendor Gold Zone.## Screenshots

The PNGs in this directory are fixture-driven local browser captures. Their source type is synthetic by design and must never be represented as production market-data proof.

A manifest is generated with file hashes so recapture drift is visible.

## Commands

From `terminal/`:

```bash
npm test -- lib/__tests__/supportContext.test.ts lib/__tests__/shellFixtureIdentity.test.tsx --maxWorkers=1 --minWorkers=1
npx tsc --noEmit --pretty false
TERMINAL_E2E_PORT=3197 npx playwright test e2e/support-context.spec.ts \
  --project=desktop --project=tablet --project=mobile --workers=1 --retries=0
```

Full repository verification and protected CI remain separately required before release.
