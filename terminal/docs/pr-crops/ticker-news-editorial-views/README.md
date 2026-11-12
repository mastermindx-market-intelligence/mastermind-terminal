# Ticker-news editorial views: visual verification

Captured from the actual Terminal News rail using the isolated Playwright fixture context.

- Three contract viewports: desktop 1440×900, tablet 820×1180, mobile 390×844.
- Two interface languages: EN and ZH. Publisher headlines remain their original language.
- Three views: News & announcements, Company mentions and Broader coverage.
- Dark is the shipped theme. Light files are explicitly approved-palette specimens under the existing D-W1 ruling; they do not claim a production light-theme feature.
- The 36 view-matrix images are supplemented by four desktop/mobile EN/ZH unavailable-state images.
- The same eight-case responsive run exercises grouped details, held requests across ticker changes, all three view transitions, 44px mobile controls and no horizontal document overflow. Seven duplicate/project cases are intentionally skipped.
- Screenshots demonstrate fixture presentation, not production authentication, licensed source availability or news accuracy.

Reproduce from `terminal/` with an unused, owned port:

```sh
TERMINAL_E2E_PORT=3357 TERMINAL_CROPS=1 npm run test:e2e:responsive -- ticker-news.spec.ts --workers=1
```

| Viewport | News & announcements | Company mentions | Broader coverage |
| --- | --- | --- | --- |
| Desktop EN dark | [news](desktop-en-dark-news.png) | [company](desktop-en-dark-company.png) | [broader](desktop-en-dark-all.png) |
| Tablet EN dark | [news](tablet-en-dark-news.png) | [company](tablet-en-dark-company.png) | [broader](tablet-en-dark-all.png) |
| Mobile EN dark | [news](mobile-en-dark-news.png) | [company](mobile-en-dark-company.png) | [broader](mobile-en-dark-all.png) |
| Desktop ZH dark | [news](desktop-zh-dark-news.png) | [company](desktop-zh-dark-company.png) | [broader](desktop-zh-dark-all.png) |
| Tablet ZH dark | [news](tablet-zh-dark-news.png) | [company](tablet-zh-dark-company.png) | [broader](tablet-zh-dark-all.png) |
| Mobile ZH dark | [news](mobile-zh-dark-news.png) | [company](mobile-zh-dark-company.png) | [broader](mobile-zh-dark-all.png) |

The corresponding `*-light-specimen-*.png` files cover the same 18 viewport/language/view combinations. The `unavailable-*.png` files cover unavailable-state copy.
