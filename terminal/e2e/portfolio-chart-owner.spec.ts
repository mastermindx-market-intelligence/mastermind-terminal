import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { portfolioCopy } from "../lib/portfolioWorkspace";

// The chart's "Add to → Portfolio" form, bound to the account that OPENED it.
//
// ── The fixture accounts ───────────────────────────────────────────────────────────────────────
//
// The `mm_e2e_wl` cookie IS the fixture account: its value is the store key, and the key derives
// the auth uuid that BOTH the server render (`app/terminal/page.tsx`) and the portfolio route
// (`app/api/portfolio/route.ts`) resolve as "who is asking" — `fixtureUserId(key)` in
// `lib/watchlistsFixtureDb.ts`. Every fixture account also signs in at the SAME address
// (`TERMINAL_E2E_EMAIL` is process-wide), so two keys differ in exactly the dimension ownership
// is drawn on: the immutable id, never the address.
//
// The `database::actor` form (`<db>::<actor>`) puts two accounts over ONE physical store, so a
// row written by one is visible to the other only through an ownership leak. This spec uses it so
// "the store holds zero rows" is a statement about the STORE, not about one account's view of it.
//
// ── The defect this proves ──────────────────────────────────────────────────────────────────────
//
// The form is opened by A. The session then moves to B — a cookie change, with NO server-component
// refresh, so the rendered page still names A. The form is submitted anyway.
//
// Before the repair the create carried no owner at all, so the server could not refuse it: A's
// draft became a valid B create. After the repair the form names the owner that opened it, and
// the route's existing owner precondition refuses the write BEFORE any mutation.

const MANIFEST = {
  symbols: {
    NVDA: { name: "NVIDIA", zh: "英伟达", col: "#76b900", last: 175, chg: 1.2, currency: "USD" },
    AAPL: { name: "Apple", zh: "苹果", col: "#8e8e93", last: 228.1, chg: -0.4, currency: "USD" },
  },
};

type Accounts = { database: string; actorA: string; actorB: string };

/** Two accounts over one physical store. */
function accounts(): Accounts {
  const database = `chart-owner-${Math.random().toString(36).slice(2, 10)}`;
  return { database, actorA: `${database}::a`, actorB: `${database}::b` };
}

async function useAccount(page: Page, baseURL: string | undefined, key: string) {
  await page.context().addCookies([{ name: "mm_e2e_wl", value: key, url: baseURL ?? "http://127.0.0.1:3108" }]);
}

/** The positions the given account can see, read through the REAL route. */
async function readBook(page: Page) {
  const response = await page.request.get("/api/portfolio");
  expect(response.ok()).toBe(true);
  return (await response.json()).positions as { id: string; ticker: string; userId?: string }[];
}

/** Open the chart's position form for a symbol, through the real search → picker path. */
async function openChartPositionForm(page: Page, symbol: string) {
  // The search trigger depends on the LAYOUT, not on the viewport project name: at 820px the
  // shell already uses the mobile symbol bar, so the project name is not the discriminator.
  const drawer = await page.locator(".mobilebar").first().isVisible();
  await (drawer ? page.locator(".m-symbar").first() : page.locator(".pair").first()).click();
  // The search surface is the phone sheet or the desktop panel — whichever is on screen.
  const surface = page.locator(".msheet-search:visible, .smodal:visible").first();
  await expect(surface).toBeVisible({ timeout: 30_000 });
  await surface.locator(".sh input").click();
  await page.keyboard.type(symbol);
  const row = surface.locator(".sres .r", { hasText: symbol }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator(".r-act .add").click();
  const destination = page.getByTestId("add-to-portfolio");
  await expect(destination).toBeVisible({ timeout: 15_000 });
  await destination.click();
  const form = page.getByRole("dialog").filter({ has: page.locator("input[name='ticker']") });
  await expect(form).toBeVisible({ timeout: 15_000 });
  return form;
}

async function fillAndSubmit(page: Page, form: Locator, symbol: string) {
  await form.locator("input[name='ticker']").fill(symbol);
  await form.locator("input[name='shares']").fill("10");
  await form.locator("input[name='entryPrice']").fill("100");
  await form.locator("input[name='entryCurrency']").fill("USD");
  const post = page.waitForResponse(
    response => response.url().includes("/api/portfolio") && response.request().method() === "POST",
    { timeout: 30_000 },
  );
  await form.locator("button[type='submit']").click();
  return post;
}

/** Routes + language, installed before any navigation. */
async function prepare(page: Page, testInfo: TestInfo, baseURL: string | undefined, opts: { zh?: boolean } = {}) {
  await page.addInitScript((useZh) => {
    localStorage.setItem("mm.lang", useZh ? "zh" : "en");
    const setDocumentLanguage = () => {
      const root = document.documentElement;
      if (!root) return;
      root.setAttribute("data-lang", useZh ? "zh" : "en");
      root.setAttribute("lang", useZh ? "zh-CN" : "en");
    };
    if (document.documentElement) setDocumentLanguage();
    else document.addEventListener("DOMContentLoaded", setDocumentLanguage, { once: true });
  }, !!opts.zh);
  await page.route("**/data/manifest.json", route => route.fulfill({ json: MANIFEST }));
}

for (const lang of ["en", "zh"] as const) {
test.describe(`chart position entry — the account that opened the form (${lang})`, () => {
  test("a stale A form against a B session is refused by the route, and creates nothing", async ({ page, baseURL }, testInfo) => {
    const { actorA, actorB } = accounts();
    await prepare(page, testInfo, baseURL, { zh: lang === "zh" });
    // The page renders as A.
    await useAccount(page, baseURL, actorA);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

    const form = await openChartPositionForm(page, "NVDA");
    await expect(form.locator("input[name='ticker']")).toHaveValue("NVDA");

    // The session moves to B. A cookie change does NOT refresh the server component, so the page
    // still names A — the form's captured owner is still A, and that is what it must send.
    await useAccount(page, baseURL, actorB);

    const post = await fillAndSubmit(page, form, "NVDA");
    const response = await post;
    expect(response.status()).toBe(409);
    expect(await response.json()).toMatchObject({ error: "owner mismatch" });

    // The refusal is visible, in the form's own language.
    const refusal = form.locator("[role='alert']");
    await expect(refusal).toContainText(portfolioCopy(lang)("ownerChanged"));
  });

  test("the refused write leaves the shared store with zero rows", async ({ page, baseURL }, testInfo) => {
    const { actorA, actorB } = accounts();
    await prepare(page, testInfo, baseURL, { zh: lang === "zh" });
    await useAccount(page, baseURL, actorA);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

    const form = await openChartPositionForm(page, "NVDA");
    await useAccount(page, baseURL, actorB);
    const post = await fillAndSubmit(page, form, "NVDA");
    expect((await post).status()).toBe(409);

    // B's own book is empty…
    expect(await readBook(page)).toEqual([]);
    // …and so is A's: the refusal happened BEFORE any mutation, so nothing was written at all.
    await useAccount(page, baseURL, actorA);
    expect(await readBook(page)).toEqual([]);
  });

  test("the same account still creates, and the canonical read confirms it", async ({ page, baseURL }, testInfo) => {
    const { actorA } = accounts();
    await prepare(page, testInfo, baseURL, { zh: lang === "zh" });
    await useAccount(page, baseURL, actorA);
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });

    const form = await openChartPositionForm(page, "NVDA");
    const post = await fillAndSubmit(page, form, "NVDA");
    const response = await post;
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, position: { ticker: "NVDA", shares: 10, entryCurrency: "USD" } });

    // The form closes only after the CANONICAL read confirms the record.
    await expect(form).toBeHidden({ timeout: 15_000 });
    const book = await readBook(page);
    expect(book).toHaveLength(1);
    expect(book[0]).toMatchObject({ ticker: "NVDA", shares: 10, entryCurrency: "USD" });
  });
});
}
