# CN/HK original-language news proof

Synthetic contract fixtures rendered by the actual Terminal News rail. These images establish layout, original Chinese text, publisher attribution, source links and ticker isolation; they do not establish live feed access or publisher rights.

- Desktop: 1440×900; tablet: 820×1180; mobile: 390×844.
- HK: 0700.HK / SEC:HK-XHKG-00700, Traditional Chinese / 經濟通 fixture.
- Mainland: 600519.SS / SEC:CN-XSHG-600519, Simplified Chinese / 财联社 fixture.
- EN/ZH interface settings both retain the original article language.
- Dark: shipped palette. Light-specimen: existing approved specimen stylesheet, not an assertion that live light mode exists.
- Run: `TERMINAL_E2E_PORT=37127 TERMINAL_CROPS=1 npm run test:e2e:responsive -- e2e/ticker-news.spec.ts --grep 'Chinese and Hong Kong tickers' --workers=1`.
- Result: 3 project tests passed; 24 panel captures; no horizontal page overflow.

Backend source decision and activation guide: `macro/docs/ops/chinese-ticker-news.md`, operation `terminal-cn-hk-news-20261021`.
