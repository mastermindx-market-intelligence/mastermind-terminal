# Event-edge popover containment — 2026-11-09

Independent continuation of the beta UI mission, root `market-os-shared-shell-design-20260924-sol-001` / MARKET-OS.

- Terminal base: `1377853d02fdb0295c0848d7127fdee4ca36714b`.
- Mastermind law pin: `ff6d5ab67c3535056d69f603fac0d95c058baad8`.
- Shared design doctrine pin: Macro `536ab7d78c2fbcab8a7c8a3cdc8d09fbe2bff136`.
- Paper: [Shared Shell integration reference](https://app.paper.design/file/01M6Y2GT8S3YP4TK052PPESZEC/p-2-0), SS06 node `20V-0`. Preserve the existing chart/research context and disclosure depth. This is a usability repair in the retained Terminal consumer, not a claim that every design board is implemented.

## Reproduction and change

On the actual `/terminal?symbol=SPY` route, the trust badge opened a 320px popup at x=8 on a 320px phone: its right edge was **328px**. A separate actual browser journey reproduced the popup staying outside the usable viewport after resizing an already-open desktop popup to 568×320.

The popup now measures its rendered height after setting its bounded width. It prefers below/above the existing anchor, then clamps the full border box into the visual viewport with 8px margins. Resize/content observers use a scheduled frame and are removed on unmount. Long driver values wrap instead of disappearing behind horizontal clipping.

The existing nonmodal dialog is a normal Tab stop, allowing End to reach its final content. Escape restores the opener when focus was left in the removed popup/body; a different focused outside action keeps its focus. Existing pointer-outside dismissal and all trust/earnings data remain intact. No body portal, modal focus trap, new state owner, StockAnalysis change or global stylesheet edit was introduced.

## Proof

- Baseline actual-route failures: 320px horizontal overflow; an open popup stranded by resize.
- Final browser matrix: **7 passed**, with two intentionally skipped duplicate resize-loop executions.
- Desktop, tablet and 320×568 phone; English/dark and Chinese/light. Tests assert the actual document language/theme supplied through the existing presentation owner.
- Explicit open-popup resizes to 568×320, 320×568 and 844×390.
- Keyboard Enter/Space opening, Tab into reader, End to the final driver/footer, Escape return, outside-click dismissal and preservation of a separately focused outside action.
- Full long driver values fit their own boxes; top/center/bottom hit tests establish unobstructed popup paint.
- TypeScript, focused ESLint and diff whitespace checks passed.
- Controlled local intel response extends the repository's existing SPY fixture. No live market or account data is changed.

```sh
TERMINAL_E2E_PORT=3295 npm run test:e2e:responsive -- e2e/event-edge-popover.spec.ts --project=desktop --project=tablet --project=mobile --workers=1
npx tsc --noEmit --pretty false
npx eslint components/fin/EventEdgePop.tsx e2e/event-edge-popover.spec.ts
```

## Captures

- [Before: 320px overflow](before-320.png). This initial capture includes the existing entrance animation; opacity is not part of this repair.
- [Before: resize leaves popup outside the short viewport](before-resize-568x320.png)
- [After: desktop English](after-desktop-en.png)
- [After: 320px Chinese/light](after-320-zh-light.png)
- [After: keyboard reaches the complete final content](after-320-keyboard-end.png)
- [After: open popup resized to 568×320](after-resize-568x320.png)

These are local consumer/browser receipts. Protected merge, beta accepted build and live browser acceptance remain separate.
