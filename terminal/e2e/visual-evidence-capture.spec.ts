// Prospective entrypoint: unchanged incumbent assertions, isolated artifact destinations.
// Ordinary responsive runs register no duplicate cases from this wrapper.
import { test, type Page, type TestInfo } from "@playwright/test";
import { createRequire } from "node:module";
const localRequire = createRequire(__filename);
const evidence = localRequire("./tools/visualEvidence.cjs");
const operation = process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION === undefined ? null : JSON.parse(process.env.TERMINAL_VISUAL_EVIDENCE_OPERATION);
const captured = new Map<string, { bytes: Buffer; observed: { lang: string; theme: string | null }; fonts?: unknown }>();
const keyFor = (info: TestInfo) => `${info.project.name}:${info.title}:${info.retry}`;
const legacyPath = /^(?:\.\/)?docs\/pr-crops\/terminal-visual-intelligence\/(desktop|tablet|mobile)-context(-zh)?\.png$/;
async function observed(page: Page) {
  return page.evaluate(() => ({ lang: document.documentElement.lang.startsWith("zh") ? "zh" : document.documentElement.lang === "en" ? "en" : "unknown", theme: document.documentElement.getAttribute("data-theme") }));
}
if (operation) {
  test.beforeEach(async ({ page }, info) => {
    if (process.env.TERMINAL_EVIDENCE_FONTS) evidence.fonts.track(page);
    await page.addInitScript(() => { localStorage.setItem("theme", "dark"); localStorage.setItem("theme_auto", "0"); document.documentElement?.setAttribute("data-theme", "dark"); });
    const screenshot = page.screenshot.bind(page), attach = info.attach.bind(info);
    // Public artifact methods are redirected; test logic and actual browser bytes are unchanged.
    page.screenshot = async (options = {}) => {
      if (!options.path) return screenshot(options);
      const match = String(options.path).replaceAll("\\", "/").match(legacyPath);
      const locale = info.title === evidence.TITLES[9] ? "zh" : "en";
      if (!match || match[1] !== info.project.name || Boolean(match[2]) !== (locale === "zh")) throw new Error("UNEXPECTED_LEGACY_CAPTURE_TARGET");
      const { path: ignoredPath, ...withoutPath } = options;
      void ignoredPath;
      const fonts = process.env.TERMINAL_EVIDENCE_FONTS ? await evidence.fonts.observe(page) : undefined;
      const bytes = await screenshot(withoutPath);
      captured.set(keyFor(info), { bytes, observed: await observed(page), fonts });
      return bytes;
    };
    info.attach = async (name, options = {}) => {
      if (!options.path) return attach(name, options);
      if (!legacyPath.test(String(options.path).replaceAll("\\", "/"))) return attach(name, options);
      const actual = captured.get(keyFor(info)); if (!actual) throw new Error("NO_ACTUAL_LEGACY_CAPTURE");
      return attach(name, { body: actual.bytes, contentType: options.contentType || "image/png" });
    };
  });
  test.afterEach(async ({ page }, info) => {
    if (info.status !== "passed" || info.expectedStatus !== "passed") return;
    const prior = captured.get(keyFor(info));
    const fonts = prior?.fonts || (process.env.TERMINAL_EVIDENCE_FONTS ? await evidence.fonts.observe(page) : undefined);
    const bytes = prior?.bytes || await page.screenshot({ animations: "disabled" });
    const actual = prior?.observed || await observed(page);
    const locale = info.title === evidence.TITLES[9] ? "zh" : "en";
    const spec = { key: evidence.key("vi", info.project.name, info.title, locale), packet: "vi", file: "visual-intelligence.spec.ts", title: info.title, project: info.project.name, locale, viewport: page.viewportSize() };
    const result = evidence.writeCase(operation, spec, bytes, { ...actual, ...(fonts ? { fonts } : {}), viewport: page.viewportSize() });
    await info.attach(`visual-evidence:${result.observationName}`, { body: Buffer.from(evidence.canonical(result.row)), contentType: "application/json" });
    captured.delete(keyFor(info));
  });
  // Require executes the original test definitions, whose source remains byte-identical.
  localRequire("./visual-intelligence.spec.ts");
}
