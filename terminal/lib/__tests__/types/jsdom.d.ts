// Minimal ambient typing for the `jsdom` package (no `@types/jsdom` in this repo's
// dependency tree — adding one is a bigger footprint than this test needs). Only the
// surface `appShellAnalysisZIndex.test.ts` actually calls: construct a JSDOM instance from
// an HTML string and read its parsed `window.document.styleSheets`. Everything else is
// intentionally untyped (`any`) rather than re-declaring jsdom's real API.
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    window: Window & typeof globalThis;
  }
}
