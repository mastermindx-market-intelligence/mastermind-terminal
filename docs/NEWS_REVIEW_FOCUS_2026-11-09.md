# News review: keep the keyboard reading position

## User outcome

When a user marks a story reviewed, they can continue from the same part of News. The action must not leave keyboard focus on a removed review button or an unusable bulk control. Filters and the user's reviewed-story record keep their existing meaning.

Source comparison: Terminal `6da72ccd43fd12168887243d708634ccc05d6763`. Governance: Mastermind `5c3d3885234358aefb97ecdbc59be0864df14f8b`. The shared design doctrine and product design system were read at accepted Macro `b5674d8ef898e503d6164922654f5ff89be9981c`.

## Observed gap

The per-story review button disappears when its classification becomes Reviewed. In New or Updated, the article itself disappears. Mark shown stays mounted but becomes disabled when no shown stories remain unread. The inspected source did not assign a replacement focus target. A polite status announcement does not itself move focus.

With the new regression cases applied to unchanged source, seven cases fail. This is local component/DOM evidence; it is not an observation of the deployed browser.

## Interaction contract

| Initiating action | Result after the review commit |
| --- | --- |
| Mark one in All | Focus the same story headline when its review button disappears. |
| Mark one in New or Updated | Focus the next surviving story from the prior visible order. If none follows, use the nearest surviving prior story. |
| Mark the last visible unread story | Focus the still-selected review filter. Preserve the empty filtered result. |
| Mark shown becomes disabled | Focus the still-selected review filter. Preserve the source filter and review filter. |
| Trigger remains enabled | Keep its existing focus. |
| Activation from an unfocused control | Perform the review action without assigning focus. |
| Another control gained focus before the commit | Preserve that newer focus choice. |
| Account, subject, view, filter, ready state or feed snapshot changed | Retire the old handoff. |
| A background refresh or another tab updates review state | No focus handoff is armed. |

An unlinked headline remains plain text and receives `tabIndex={-1}` so it can be a programmatic reading target without adding a tab stop. Both linked and plain headlines use the existing brand focus outline. Native focus scrolling makes the target visible; no smooth motion or unconditional scroll suppression is added.

The next/previous choice is limited to the user's pre-action visible order. The code resolves story IDs by DOM attribute equality, without interpolating untrusted story text into a CSS selector. It never chooses a newly arrived story as the destination of an old action.

## Builder ownership and lifecycle

`TickerNewsPanel` owns one ephemeral focus intent. `NewsCatchupBar` and `NewsMarkReviewed` expose their actual initiating button through their click event; neither performs persistence.

The Panel captures an intent only if that button is focused. It invokes the existing synchronous review callback, then ensures one local React commit. Its layout effect consumes the intent before checking context or moving focus. Consumption is required even when the review callback makes no state change: a dormant intent must never attach to a later storage event. A thrown review callback retires the intent immediately.

The existing `useNewsCatchup` / `newsReviewState` owners still decide what can be marked, merge the latest local record, preserve the captured evidence basis and handle session-only fallback. The patch changes no review format, owner key, receipt, report count, request, stream, route, source permission or feed calculation. It creates no timer, global focus service or persistent store.

## Qualification

- The original 15 component tests and 14 new cases run against the actual News components: **29/29 pass** on the candidate. The identical expanded suite on the unchanged implementation passes 22 and fails seven focus cases.
- Cases include same-story focus, no source link, forward/backward continuation, the last Updated story in Chinese, bulk review under All/New with a source filter, unfocused activation, a newer focus choice, passive storage updates, no-op consumption, account/filter cancellation, and accepted session-only review.
- Focused TypeScript qualification passes for the exact module and test closure. Primary dependency versions come from the repository lockfile. This isolated check does not replace full application CI, lint or a Next build.
- Two keyboard journeys extend the existing `terminal/e2e/news-catchup.spec.ts` real-shell fixture. They use Enter and Tab, assert actual focused elements, preserve selected filters, check the visible focus outline and retain focused-state screenshots in the normal Playwright output. They have been authored; browser execution remains owed.
- Full exact-head CI, required browser results, merge controls, git-gated deployment and live proof remain separate delivery steps. This document grants none of them.

The package remains a draft until the interactive change has its required browser evidence. Existing News layout proposals #1207 and #1210 were inspected for overlapping work; they contain no equivalent focus repair. This change neither incorporates those proposals nor removes their release holds.

## Sources

- [Pinned Panel](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/6da72ccd43fd12168887243d708634ccc05d6763/terminal/components/news/TickerNewsPanel.tsx)
- [Pinned review owner](https://github.com/mastermindx-market-intelligence/mastermind-terminal/blob/6da72ccd43fd12168887243d708634ccc05d6763/terminal/components/news/useNewsCatchup.ts)
- [React commit-time effects](https://react.dev/reference/react/useLayoutEffect)
- [Next client boundary](https://nextjs.org/docs/app/api-reference/directives/use-client)

The installed Next documentation is absent from this isolated module closure. Official framework documentation was checked for the existing client-component boundary; no Next API or framework boundary is changed.
