import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { validateSovereignAuctionContext, type AuctionContext } from "../lib/sovereignAuctionContext";

/**
 * Browser layout/composition proof against the REAL /terminal route in next dev.
 * The /api/nw replies and loopback browser session are fixtures. This does not
 * exercise the real proxy upstream, host entitlement, CSP, or production auth.
 * Every test gets a fresh BrowserContext. No reload is used to recover a state.
 */
const ROOT = join(__dirname, "..");
const NOW = Date.parse("2026-10-08T22:55:00Z");
const WRAPPER_SHA = "c3019af2c6439d954886744a4261b8ec84b98f33ebb32ee8aecfa6dcfa98c268";
const FULL_SHA = "e363d46c7082b8c997d3385af3faf5ebab0eb9c07be9a89912c4d215a8cb32b3";
const wrapperBytes = readFileSync(join(ROOT, "lib/__tests__/fixtures/sovereign_auction_context_w1.json"));
const fullBytes = readFileSync(join(__dirname, "fixtures/sovereign_auction_context_full_capture.json"));
if (createHash("sha256").update(wrapperBytes).digest("hex") !== WRAPPER_SHA) throw new Error("Authoritative W1 wrapper fixture changed");
if (createHash("sha256").update(fullBytes).digest("hex") !== FULL_SHA) throw new Error("Actual full-capture projection changed");
function requireContext(value: unknown): AuctionContext {
  const result = validateSovereignAuctionContext(value, NOW);
  if (!result.ok) throw new Error(`Invalid pinned browser fixture: ${result.reason}`);
  return result.context;
}
const BASELINE = requireContext(JSON.parse(wrapperBytes.toString("utf8")).sovereign_auction_context);
const FULL = requireContext(JSON.parse(fullBytes.toString("utf8")));

type Lang = "en" | "zh";
type ThemeCase = "dark" | "light-attribute-diagnostic";
type Reply = { status: number; body: unknown };
const COPY = {
  en: { title: "Sovereign auctions — observed context", notScored: "Not scored", unknownFreshness: "Freshness unassessed", noResult: "Results not observed", observedResult: "Results observed", unavailable: "Auction context unavailable", denied: "Subscription access required", signin: "Sign in required", degraded: "Source coverage degraded", showMore: "Show up to 24 episodes", empty: "No episodes in the observed set; coverage is not a complete universe" },
  zh: { title: "主权债拍卖 — 已观测背景", notScored: "未评分", unknownFreshness: "时效性未评估", noResult: "尚未观测到结果", observedResult: "已观测到结果", unavailable: "拍卖背景不可用", denied: "需要订阅权限", signin: "需要登录", degraded: "来源覆盖降级", showMore: "显示最多 24 个拍卖事件", empty: "已观测集合中没有拍卖事件；覆盖不代表完整范围" },
};
const FAKE_USER = {
  id: "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22", aud: "authenticated", role: "authenticated",
  email: "sovereign-browser-fixture@example.com", app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {}, created_at: "2026-02-14T09:12:00.000Z",
};

// This repeats the existing dev capture harness's documented cookie encoding.
// It is a fake session on 127.0.0.1, never a real credential or a product bypass.
const FAKE_SESSION = `base64-${Buffer.from(JSON.stringify({
  access_token: "fixture-sovereign-auction-access-token", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(NOW / 1000) + 3600, refresh_token: "fixture-sovereign-auction-refresh-token", user: FAKE_USER,
})).toString("base64url")}`;

function assertLoopback(baseURL: string | undefined): URL {
  if (!baseURL) throw new Error("A dedicated local Playwright baseURL is required");
  const url = new URL(baseURL);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.port === "54321") {
    throw new Error("This fixture spec is restricted to an isolated 127.0.0.1 Next dev server");
  }
  return url;
}

async function prepare(page: Page, baseURL: string | undefined, lang: Lang) {
  const base = assertLoopback(baseURL);
  let reply: Reply = { status: 200, body: BASELINE };
  const report = { fixtureSessionOnly: true, browserClock: new Date(NOW).toISOString(), auctionRequests: 0, incumbentFeedRequests: [] as string[], blockedHttpOrigins: [] as string[], blockedSocketOrigins: [] as string[], externalResponses: [] as string[], pageErrors: [] as string[] };
  page.on("pageerror", error => report.pageErrors.push(error.message));
  page.on("response", response => {
    const u = new URL(response.url());
    if (/^https?:$/.test(u.protocol) && u.origin !== base.origin && u.origin !== "http://127.0.0.1:54321") report.externalResponses.push(u.origin);
  });
  // Browser networking is contained. Next server dependencies are governed by the
  // existing E2E config/fixtures; this is not a server-process network sandbox.
  await page.context().route("**/*", async route => {
    const u = new URL(route.request().url());
    if (u.origin === base.origin || ["data:", "blob:"].includes(u.protocol)) return route.continue();
    if (u.origin === "http://127.0.0.1:54321" && u.pathname === "/auth/v1/user") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FAKE_USER) });
    }
    // Other loopback Supabase operations are refused; no real service is contacted.
    if (u.origin === "http://127.0.0.1:54321") return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"local_browser_fixture_only"}' });
    report.blockedHttpOrigins.push(u.origin);
    return route.abort("blockedbyclient");
  });
  await page.context().routeWebSocket("**/*", socket => {
    const u = new URL(socket.url());
    if (u.hostname === base.hostname && u.port === base.port) { socket.connectToServer(); return; }
    report.blockedSocketOrigins.push(u.origin);
    void socket.close({ code: 1008, reason: "Local browser verification only" });
  });
  await page.route(url => url.origin === base.origin && url.pathname === "/api/nw", async route => {
    const feed = new URL(route.request().url()).searchParams.get("f") ?? "market_plane";
    if (feed !== "sovereign_auction_context") {
      report.incumbentFeedRequests.push(feed);
      return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"dormant_incumbent_feed"}' });
    }
    report.auctionRequests++;
    const current = structuredClone(reply);
    return route.fulfill({ status: current.status, contentType: "application/json", headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }, body: JSON.stringify(current.body) });
  });
  // Fixed Date preserves PIT fixture acceptance and stable warning text while
  // timers/animation frames keep running normally (Playwright clock.setFixedTime).
  await page.clock.setFixedTime(NOW);
  await page.addInitScript(({ lang, fakeSession }) => {
    if (location.hostname !== "127.0.0.1") return; // Never seed about:blank or a foreign frame.
    localStorage.setItem("mm.lang", lang);
    localStorage.setItem("theme", "dark");
    // Seed after the initial document request. The real Next middleware never
    // receives a fake session on this first navigation; the browser SDK reads it.
    document.cookie = `sb-127-auth-token.0=${fakeSession}; Path=/; SameSite=Lax`;
    const win = window as Window & { __auctionVisualReady?: boolean };
    win.__auctionVisualReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { win.__auctionVisualReady = true; }, { once: true });
  }, { lang, fakeSession: FAKE_SESSION });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean((window as Window & { __auctionVisualReady?: boolean }).__auctionVisualReady)), { timeout: 30_000, message: "Real Terminal must finish its existing visual-ready handoff" }).toBe(true);
  const card = page.getByTestId("sovereign-auction-context");
  // A dormant component must FAIL here; this spec never injects a fake DOM mount.
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await expect(card.locator("summary")).toContainText(COPY[lang].title);
  await expect(card.locator("summary")).toContainText("3");
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
  await expect(card.locator("li")).toHaveCount(3);
  const signal = page.locator(".sig-btn");
  await expect(signal).toHaveCount(1);
  const existingSignalText = await signal.innerText();
  expect(existingSignalText.trim().length).toBeGreaterThan(0);
  return {
    card, report, existingSignalText,
    async reply(next: Reply) {
      reply = next;
      const before = report.auctionRequests;
      // Exercise the actual focus refresh listener; never reload to recover.
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => report.auctionRequests).toBeGreaterThan(before);
    },
  };
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="sovereign-auction-context"]') as HTMLElement | null;
    if (!el) throw new Error("Auction card not mounted");
    const summary = el.querySelector("summary") as HTMLElement;
    const scroll = el.querySelector(":scope > div") as HTMLElement;
    const rect = el.getBoundingClientRect(), sr = summary.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      card: { left: rect.left, right: rect.right, width: rect.width }, summaryHeight: sr.height,
      contentWidth: scroll.clientWidth, contentScrollWidth: scroll.scrollWidth,
      nativeDisclosureOpen: (el as HTMLDetailsElement).open,
      themeAttribute: document.documentElement.getAttribute("data-theme"),
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      cardForeground: getComputedStyle(el).color, nestedAnchors: el.querySelectorAll("a a").length,
      visibleCodes: Array.from(el.querySelectorAll("li code")).map(code => code.textContent),
    };
  });
}
async function assertGeometry(page: Page) {
  const m = await geometry(page);
  expect(m.documentWidth).toBeLessThanOrEqual(m.viewport.width + 1);
  expect(m.card.left).toBeGreaterThanOrEqual(-1); expect(m.card.right).toBeLessThanOrEqual(m.viewport.width + 1);
  expect(m.contentScrollWidth).toBeLessThanOrEqual(m.contentWidth + 1);
  expect(m.summaryHeight).toBeGreaterThanOrEqual(36);
  expect(m.nestedAnchors).toBe(0); expect(m.nativeDisclosureOpen).toBe(true);
  return m;
}
async function record(page: Page, info: TestInfo, name: string, report: unknown) {
  await page.getByTestId("sovereign-auction-context").scrollIntoViewIfNeeded();
  const metrics = await assertGeometry(page);
  const screenshot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: false });
  await info.attach(`${name}-screenshot`, { path: screenshot, contentType: "image/png" });
  await info.attach(`${name}-measurements`, { body: JSON.stringify({ metrics, report }, null, 2), contentType: "application/json" });
}
async function assertIncumbentUnchanged(page: Page, initialSignal: string, report: { incumbentFeedRequests: string[]; externalResponses: string[] }) {
  expect(await page.locator(".sig-btn").innerText()).toBe(initialSignal);
  // Source census proves NeuralWebStrip is dormant. The new direct mount must
  // not revive it or its market-plane fetch in the active /terminal route.
  await expect(page.locator(".nw-strip")).toHaveCount(0);
  expect(report.incumbentFeedRequests).toEqual([]);
  expect(report.externalResponses).toEqual([]);
}

// Existing local capture harness needs CSP bypass only for intercepted loopback
// Supabase. This is diagnostic browser setup, not a production CSP change/test.
test.use({ bypassCSP: true, serviceWorkers: "block" });
test.describe("Sovereign auctions in the active Terminal detail surface", () => {
  test.describe.configure({ timeout: 90_000 });
  for (const lang of ["en", "zh"] as const) {
    for (const theme of ["dark", "light-attribute-diagnostic"] as const satisfies readonly ThemeCase[]) {
      test(`${lang} ${theme}: exact shared producer fixture, bounded layout and invariant incumbent`, async ({ page, baseURL }, info) => {
        const h = await prepare(page, baseURL, lang);
        if (theme === "light-attribute-diagnostic") {
          info.annotations.push({ type: "diagnostic", description: "Terminal is dark-only; data-theme=light is an attribute robustness probe, not an implemented light-theme claim" });
          await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
        }
        await expect(h.card).toContainText("auction:912797SU2:2026-10-13");
        await expect(h.card).toContainText("95000000000 USD");
        await expect(h.card).toContainText("2026-10-13T17:00:00+00:00");
        await expect(h.card).toContainText("2026-10-08T22:12:22.414829+00:00");
        await expect(h.card).toContainText("2026-10-08T22:15:00+00:00");
        await expect(h.card).toContainText(COPY[lang].notScored);
        await expect(h.card).toContainText(COPY[lang].noResult);
        await expect(h.card).toContainText(COPY[lang].unknownFreshness);
        await expect(h.card).not.toContainText(COPY[lang === "en" ? "zh" : "en"].title);
        await assertIncumbentUnchanged(page, h.existingSignalText, h.report);
        await record(page, info, `${info.project.name}-${lang}-${theme}-shared-fixture`, h.report);
        const bill = h.card.locator("li").filter({ hasText: "auction:912797SU2:2026-10-13" });
        await bill.scrollIntoViewIfNeeded(); await expect(bill).toBeVisible();
        const reach = await bill.evaluate(el => {
          const r = el.getBoundingClientRect();
          const scroller = el.closest("ol")?.parentElement;
          if (!scroller) throw new Error("Auction scroll container absent");
          const s = scroller.getBoundingClientRect();
          return { rowHeight: r.height, regionHeight: Math.min(s.bottom, innerHeight) - Math.max(s.top, 0), visibleHeight: Math.max(0, Math.min(r.bottom, s.bottom, innerHeight) - Math.max(r.top, s.top, 0)) };
        });
        expect(reach.visibleHeight).toBeGreaterThanOrEqual(Math.min(reach.rowHeight, reach.regionHeight) - 2);
        await record(page, info, `${info.project.name}-${lang}-${theme}-bill-amount-deadline`, h.report);
        expect(h.report.pageErrors).toEqual([]);
      });
    }
    test(`${lang} dark: expansion, result order, degraded source, unavailable and entitlement loss`, async ({ page, baseURL }, info) => {
      const h = await prepare(page, baseURL, lang);
      await h.reply({ status: 200, body: FULL });
      await expect(h.card.locator("li")).toHaveCount(6);
      const more = h.card.getByRole("button", { name: COPY[lang].showMore, exact: true });
      await more.scrollIntoViewIfNeeded(); await more.click();
      await expect(h.card.locator("li")).toHaveCount(24);
      await expect(h.card).toContainText("24 / 74");
      const displayed = await h.card.locator("li code").allTextContents();
      const indexed = new Map(FULL.events.map(row => [row.episode_id, row]));
      for (let i = 0; i < displayed.length; i++) {
        const row = indexed.get(displayed[i]); expect(row).toBeDefined();
        if (i) {
          const prior = indexed.get(displayed[i - 1])!;
          expect(Number(prior.result !== null)).toBeLessThanOrEqual(Number(row!.result !== null));
          if ((prior.result === null) === (row!.result === null)) expect(prior.auction_date <= row!.auction_date).toBe(true);
        }
      }
      await assertIncumbentUnchanged(page, h.existingSignalText, h.report);
      await record(page, info, `${info.project.name}-${lang}-expanded-24-of-74`, h.report);

      // Genuine result row plus the three genuine announced Bills: the result
      // sorts last despite its earlier auction date. No result values are made up.
      const resultRow = FULL.events.find(row => row.result !== null)!;
      const announced = FULL.events.filter(row => row.source_state === "ANNOUNCED");
      const mixedRows = [resultRow, ...announced];
      const mixed = requireContext({ ...FULL, events: mixedRows, episodes: mixedRows });
      await h.reply({ status: 200, body: mixed });
      await expect(h.card.locator("li")).toHaveCount(mixedRows.length);
      await expect(h.card.locator("li code").last()).toHaveText(resultRow.episode_id);
      await expect(h.card).toContainText(COPY[lang].observedResult);
      await record(page, info, `${info.project.name}-${lang}-observed-result-last`, h.report);

      const degraded = structuredClone(BASELINE);
      degraded.status = "degraded";
      Object.assign(degraded.source_health[0], { latest_attempt_at: degraded.decision_cutoff_utc, latest_attempt_status: "unavailable", latest_attempt_states: ["unavailable"], latest_failure_at: degraded.decision_cutoff_utc, latest_failure_reasons: ["fixture_transport_failure"] });
      await h.reply({ status: 200, body: requireContext(degraded) });
      await expect(h.card).toContainText(COPY[lang].degraded);
      await expect(h.card).toContainText("fixture_transport_failure");
      await expect(h.card).toContainText(BASELINE.source_observed_at!);
      await expect(h.card).toContainText(COPY[lang].unknownFreshness);
      await record(page, info, `${info.project.name}-${lang}-source-degraded`, h.report);

      for (const [status, label] of [[503, COPY[lang].unavailable], [401, COPY[lang].signin], [403, COPY[lang].denied]] as const) {
        await h.reply({ status, body: { error: `fixture_status_${status}` } });
        await expect(h.card.locator("li")).toHaveCount(0);
        await expect(h.card).not.toContainText("912797SU2");
        await expect(h.card).toContainText(label);
        await assertIncumbentUnchanged(page, h.existingSignalText, h.report);
        await record(page, info, `${info.project.name}-${lang}-status-${status}`, h.report);
      }
      await h.reply({ status: 200, body: { ...BASELINE, probabilities: 0.5 } });
      await expect(h.card.locator("li")).toHaveCount(0); await expect(h.card).toContainText(COPY[lang].unavailable);
      await record(page, info, `${info.project.name}-${lang}-invalid-authority`, h.report);

      const empty = requireContext({ ...BASELINE, events: [], episodes: [] });
      await h.reply({ status: 200, body: empty });
      await expect(h.card.locator("li")).toHaveCount(0); await expect(h.card).toContainText(COPY[lang].empty);
      await assertIncumbentUnchanged(page, h.existingSignalText, h.report);
      await record(page, info, `${info.project.name}-${lang}-valid-observed-empty`, h.report);
      expect(h.report.pageErrors).toEqual([]);
    });
  }
});
