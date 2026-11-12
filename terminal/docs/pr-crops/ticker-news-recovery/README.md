# Ticker news recovery evidence

Captured on 2026-10-21 from the managed `sol/web-ticker-news-retry-control-20261021-c3` candidate, based on `ab5beab6b0c2362414a1da17745587d490e923e8`.

## Behavior under test

A failed initial snapshot leaves the rail unavailable. The localized **Retry / 重试** button starts a fresh read through the existing refresh path, shows the loading state, and restores verified articles without navigating or reloading the document.

The test holds the recovery response to inspect the intermediate state. It checks one additional snapshot request, the same ticker and news view, hidden stale headlines and review actions during loading, preserved unreviewed state after recovery, and no horizontal document overflow. Keyboard focus is visibly outlined; Enter activates the button, whose height is at least 44 pixels.

Unit coverage separately verifies the selected Company mentions and Broader coverage views, rejects a mismatched server acknowledgement, fences a late retry after a view change, hides recovery controls for restricted states, and retains the existing no-automatic-retry contract.

## Reproduce

Run from `terminal/` using an available loopback port:

```bash
TERMINAL_E2E_PORT=3187 TERMINAL_CROPS=1 npm run test:e2e:responsive -- \
  e2e/ticker-news.spec.ts --grep "unavailable snapshot retries" \
  --project=desktop --project=tablet --project=mobile --workers=1
```

Result: **3 passed** in 97.36 seconds, with all 12 matrix cells and 36 crops produced. The test uses deterministic local route fixtures. Light captures apply the existing approved `docs/specimens/news-flow.light.css`; they are specimen verification, not a claim that production exposes a light-theme switch.

## Complete capture matrix

| Viewport | Language | Theme | Failure | Retrying | Restored feed |
|---|---|---|---|---|---|
| desktop | EN | Dark | [Unavailable](desktop-en-dark-unavailable.png) | [Loading](desktop-en-dark-loading.png) | [Recovered](desktop-en-dark-recovered.png) |
| desktop | EN | Light specimen | [Unavailable](desktop-en-light-specimen-unavailable.png) | [Loading](desktop-en-light-specimen-loading.png) | [Recovered](desktop-en-light-specimen-recovered.png) |
| desktop | ZH | Dark | [Unavailable](desktop-zh-dark-unavailable.png) | [Loading](desktop-zh-dark-loading.png) | [Recovered](desktop-zh-dark-recovered.png) |
| desktop | ZH | Light specimen | [Unavailable](desktop-zh-light-specimen-unavailable.png) | [Loading](desktop-zh-light-specimen-loading.png) | [Recovered](desktop-zh-light-specimen-recovered.png) |
| tablet | EN | Dark | [Unavailable](tablet-en-dark-unavailable.png) | [Loading](tablet-en-dark-loading.png) | [Recovered](tablet-en-dark-recovered.png) |
| tablet | EN | Light specimen | [Unavailable](tablet-en-light-specimen-unavailable.png) | [Loading](tablet-en-light-specimen-loading.png) | [Recovered](tablet-en-light-specimen-recovered.png) |
| tablet | ZH | Dark | [Unavailable](tablet-zh-dark-unavailable.png) | [Loading](tablet-zh-dark-loading.png) | [Recovered](tablet-zh-dark-recovered.png) |
| tablet | ZH | Light specimen | [Unavailable](tablet-zh-light-specimen-unavailable.png) | [Loading](tablet-zh-light-specimen-loading.png) | [Recovered](tablet-zh-light-specimen-recovered.png) |
| mobile | EN | Dark | [Unavailable](mobile-en-dark-unavailable.png) | [Loading](mobile-en-dark-loading.png) | [Recovered](mobile-en-dark-recovered.png) |
| mobile | EN | Light specimen | [Unavailable](mobile-en-light-specimen-unavailable.png) | [Loading](mobile-en-light-specimen-loading.png) | [Recovered](mobile-en-light-specimen-recovered.png) |
| mobile | ZH | Dark | [Unavailable](mobile-zh-dark-unavailable.png) | [Loading](mobile-zh-dark-loading.png) | [Recovered](mobile-zh-dark-recovered.png) |
| mobile | ZH | Light specimen | [Unavailable](mobile-zh-light-specimen-unavailable.png) | [Loading](mobile-zh-light-specimen-loading.png) | [Recovered](mobile-zh-light-specimen-recovered.png) |

Viewport sizes: desktop 1440 × 900, tablet 820 × 1180, mobile 390 × 844. Images crop the actual news panel, so their dimensions vary with the responsive rail.

## Scope and limits

This change supplies a manual recovery action for a temporary snapshot failure. It does not change provider eligibility, rights, view acknowledgements, automatic retry policy, proxy behavior, or streaming behavior. The earlier production HTTP 524 remains an unresolved, separately recorded reliability finding; successful fixture recovery does not establish that its cause or frequency has been fixed.
