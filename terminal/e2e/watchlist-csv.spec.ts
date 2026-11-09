import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { E2E_WLS_KEY, e2eWatchlistOwner, isolateWatchlistStore, seedOwnerWatchlists } from "./watchlistStore";

// The watchlist rail is collapsed by default at compact breakpoints. These are native
// file-picker/export-menu tests on the visible desktop rail. Opening the compact rail
// is a separate responsive-navigation contract, not bypassed with force:true here.
test.beforeEach(({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== "desktop",
    "Direct CSV menu acceptance is desktop-scoped; compact rail needs its navigation precondition.");
});

type Language = "en" | "zh";
const seed = {
  lists: {
    Default: [],
    "CSV Safe": [
      { symbol: "AAPL", section: "Core, US" },
      { symbol: "MSFT", section: 'Core "US"' },
      { symbol: "9988.HK", section: "科技" },
      { symbol: "NEM", section: "'Growth" },
    ],
    "CSV Hazard": [
      { symbol: "NVDA", section: "=1+1" },
      { symbol: "SPY", section: "Core" },
    ],
    "CSV Target": [],
    "CSV Sibling": [],
  },
  active: "CSV Safe",
  meta: {},
};

async function boot(page: Page, testInfo: TestInfo, baseURL?: string) {
  const key = await isolateWatchlistStore(page, testInfo, baseURL);
  await seedOwnerWatchlists(page, key, seed);
  await page.goto("/terminal?symbol=AAPL");
  await expect(page.locator(".mm-ptag")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".wl-select")).toContainText("CSV Safe");
  return e2eWatchlistOwner(key);
}

async function language(page: Page, lang: Language) {
  await page.evaluate((value) => {
    document.documentElement.setAttribute("data-lang", value);
    localStorage.setItem("mm.lang", value);
    window.dispatchEvent(new Event("mm:lang"));
  }, lang);
}

async function list(page: Page, name: string) {
  await page.locator(".wl-select").click();
  await page.locator(".wl-lists.show .wl-list-row").filter({ hasText: name }).click();
  await expect(page.locator(".wl-select")).toContainText(name);
}

async function menuAction(page: Page, action: "import" | "export", lang: Language) {
  await page.locator(".wl-select").click();
  const label = action === "import" ? lang === "zh" ? "导入 CSV" : "Import CSV"
    : lang === "zh" ? "导出 CSV" : "Export CSV";
  await page.locator(".wl-lists.show .menu-row").filter({ hasText: label }).click();
}

async function inventory(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/watchlist");
    const body = await response.json();
    return body.lists as { id: string; name: string; symbols: { symbol: string; section: string }[] }[];
  });
}

async function uploadedRows(page: Page, name: string) {
  return (await inventory(page)).find((entry) => entry.name === name)?.symbols ?? [];
}

for (const lang of ["en", "zh"] as const) {
  test(`CSV native export preserves quotes and refuses one hazardous row before URL creation (${lang})`,
    async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      await boot(page, testInfo, baseURL);
      await language(page, lang);
      const [download] = await Promise.all([page.waitForEvent("download"), menuAction(page, "export", lang)]);
      const downloaded = await readFile(await download.path(), "utf8");
      expect(downloaded).toContain('AAPL,"Core, US"');
      expect(downloaded).toContain('MSFT,"Core ""US"""');
      expect(downloaded).toContain("9988.HK,科技");
      expect(downloaded).toContain("NEM,'Growth");

      await list(page, "CSV Hazard");
      const before = await page.locator(".wl-row").evaluateAll((rows) =>
        rows.map((element) => element.getAttribute("data-watchlist-symbol")));
      // A direct browser boundary probe: a blocked export must create no object URL.
      await page.evaluate(() => {
        const global = window as typeof window & { __watchlistCsvUrls?: number };
        global.__watchlistCsvUrls = 0;
        const original = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob) => { global.__watchlistCsvUrls!++; return original(blob); };
      });
      await menuAction(page, "export", lang);
      await expect(page.getByRole("alert").filter({ hasText: lang === "en" ? "CSV export blocked" : "CSV 导出已阻止" })).toBeVisible();
      expect(await page.evaluate(() => (window as typeof window & { __watchlistCsvUrls?: number }).__watchlistCsvUrls)).toBe(0);
      expect(await page.locator(".wl-row").evaluateAll((rows) =>
        rows.map((element) => element.getAttribute("data-watchlist-symbol")))).toEqual(before);

      // One refusal must not poison the next, safe list export.
      await list(page, "CSV Safe");
      const [second] = await Promise.all([page.waitForEvent("download"), menuAction(page, "export", lang)]);
      expect(await readFile(await second.path(), "utf8")).toContain('MSFT,"Core ""US"""');
    });

  test(`native file picker parses logical rows, binds target list and preserves owner-scoped state (${lang})`,
    async ({ page, baseURL }, testInfo) => {
      test.setTimeout(120_000);
      const owner = await boot(page, testInfo, baseURL);
      await language(page, lang);
      await list(page, "CSV Target");
      // Hold the native File.text read while the user switches to a sibling.
      await page.evaluate(() => {
        const global = window as typeof window & { __releaseCsvRead?: () => void };
        const original = File.prototype.text;
        File.prototype.text = function () {
          const read = original.bind(this);
          return new Promise<string>((resolve, reject) => {
            global.__releaseCsvRead = () => { void read().then(resolve, reject); };
          });
        };
      });
      const chooserPromise = page.waitForEvent("filechooser");
      await menuAction(page, "import", lang);
      const chooser = await chooserPromise;
      await chooser.setFiles({
        name: "watchlist.csv",
        mimeType: "text/csv",
        buffer: Buffer.from('\uFEFFsymbol,section\r\nAAPL,"Core, US"\r\naapl,Later\r\nMSFT,"Joe ""Trader"""\r\nQQQ,"Bad\r\nLine"\r\nNVDA,\r\n'),
      });
      await list(page, "CSV Sibling");
      await page.evaluate(() => (window as typeof window & { __releaseCsvRead?: () => void }).__releaseCsvRead?.());
      await expect(page.getByRole("status").filter({ hasText: lang === "en" ? "Imported 3 symbols into CSV Target" : "已向 CSV Target 导入 3 个代码" })).toBeVisible();
      await expect.poll(async () => (await uploadedRows(page, "CSV Target")).map((r) => r.symbol).sort(),
        { timeout: 30_000 }).toEqual(["AAPL", "MSFT", "NVDA"]);
      const server = await uploadedRows(page, "CSV Target");
      expect(Object.fromEntries(server.map((r) => [r.symbol, r.section]))).toEqual({
        AAPL: "Core, US", MSFT: 'Joe "Trader"', NVDA: "",
      });
      expect(await uploadedRows(page, "CSV Sibling")).toEqual([]);
      // The persisted local envelope belongs to the same account as the server payload.
      await expect.poll(async () => page.evaluate(([key, slot]) => {
        const envelope = JSON.parse(localStorage.getItem(key) || "{}");
        return (envelope[slot]?.lists?.["CSV Target"] ?? []).map((r: { symbol: string }) => r.symbol).sort();
      }, [E2E_WLS_KEY, owner] as const)).toEqual(["AAPL", "MSFT", "NVDA"]);
      await expect(page.locator(".wl-select")).toContainText("CSV Sibling");
    });
}

test("failed server sync keeps imported symbols locally and visibly reports failure", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const owner = await boot(page, testInfo, baseURL);
  await list(page, "CSV Target");
  await page.route("**/api/watchlist", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action?: string };
      if (body?.action === "add") { await route.fulfill({ status: 503, body: "{}" }); return; }
    }
    await route.continue();
  });
  const chooserPromise = page.waitForEvent("filechooser");
  await menuAction(page, "import", "en");
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "import.txt", mimeType: "text/plain", buffer: Buffer.from("SPY,Core") });
  await expect(page.getByRole("alert").filter({ hasText: "Watchlist sync failed" })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.evaluate(([key, slot]) => {
    const envelope = JSON.parse(localStorage.getItem(key) || "{}");
    return (envelope[slot]?.lists?.["CSV Target"] ?? []).map((r: { symbol: string }) => r.symbol);
  }, [E2E_WLS_KEY, owner] as const)).toContain("SPY");
});


test("malformed quoting or extra columns do not mutate the destination or send an add", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  await boot(page, testInfo, baseURL);
  await list(page, "CSV Target");
  // The named list is seeded in localStorage first; server migration runs
  // asynchronously. Verify the remote-list precondition before inspecting adds.
  await expect.poll(async () => (await inventory(page)).some((entry) => entry.name === "CSV Target"))
    .toBe(true);
  const targetId = (await inventory(page)).find((entry) => entry.name === "CSV Target")?.id;
  expect(targetId).toBeTruthy();
  const additions: unknown[] = [];
  await page.route("**/api/watchlist", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { action?: string; listId?: string; listName?: string };
      if (body.action === "add" && (body.listId === targetId || body.listName === "CSV Target")) additions.push(body);
    }
    await route.continue();
  });
  for (const file of ['AAPL,"unterminated', "AAPL,Core,Extra"]) {
    const filechooser = page.waitForEvent("filechooser");
    await menuAction(page, "import", "en");
    await (await filechooser).setFiles({
      name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from(file),
    });
    await expect(page.getByRole("alert").filter({ hasText: "CSV import rejected" })).toBeVisible();
    expect(await uploadedRows(page, "CSV Target")).toEqual([]);
    await expect(page.locator(".wl-row")).toHaveCount(0);
  }
  expect(additions).toEqual([]);
});

test("deleting a list while File.text is pending cancels import without resurrecting it", async ({ page, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const owner = await boot(page, testInfo, baseURL);
  await list(page, "CSV Target");
  await expect.poll(async () => (await inventory(page)).some((entry) => entry.name === "CSV Target"))
    .toBe(true);
  await page.evaluate(() => {
    const global = window as typeof window & { __releaseCsvRead?: () => void };
    const original = File.prototype.text;
    File.prototype.text = function () {
      const read = original.bind(this);
      return new Promise<string>((resolve, reject) => {
        global.__releaseCsvRead = () => { void read().then(resolve, reject); };
      });
    };
  });
  const filechooser = page.waitForEvent("filechooser");
  await menuAction(page, "import", "en");
  await (await filechooser).setFiles({
    name: "pending.csv", mimeType: "text/csv", buffer: Buffer.from("NEM,Miners"),
  });
  await page.locator(".wl-select").click();
  page.once("dialog", (dialog) => { void dialog.accept(); });
  await page.locator(".wl-lists.show .wl-list-row").filter({ hasText: "CSV Target" })
    .locator(".wl-list-ic.del").click();
  await expect(page.locator(".wl-lists.show .wl-list-row").filter({ hasText: "CSV Target" })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & { __releaseCsvRead?: () => void }).__releaseCsvRead?.());
  await expect(page.getByRole("alert").filter({ hasText: "CSV import cancelled" })).toBeVisible();
  await expect.poll(async () => (await inventory(page)).some((entry) => entry.name === "CSV Target"))
    .toBe(false);
  expect(await page.evaluate(([key, slot]) => {
    const envelope = JSON.parse(localStorage.getItem(key) || "{}");
    return "CSV Target" in (envelope[slot]?.lists ?? {});
  }, [E2E_WLS_KEY, owner] as const)).toBe(false);
});

test("501 symbol file is stored locally and submitted as 500 + 1 against the same named server list", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A single desktop run covers the transport boundary.");
  test.setTimeout(150_000);
  const owner = await boot(page, testInfo, baseURL);
  await list(page, "CSV Target");
  await expect.poll(async () => (await inventory(page)).find((entry) => entry.name === "CSV Target")?.id,
    { timeout: 30_000 }).toBeTruthy();
  const listId = (await inventory(page)).find((entry) => entry.name === "CSV Target")!.id;
  const submitted: { symbols: string[]; sections: Record<string, string>; listName?: string; listId?: string }[] = [];
  await page.route("**/api/watchlist", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        action?: string; symbols?: string[]; sections?: Record<string, string>; listName?: string; listId?: string;
      };
      if (body.action === "add" && Array.isArray(body.symbols)
        && (body.listName === "CSV Target" || body.listId === listId)) {
        submitted.push({ symbols: body.symbols, sections: body.sections ?? {}, listName: body.listName, listId: body.listId });
      }
    }
    await route.continue();
  });
  const content = "symbol,section\n" + Array.from({ length: 501 }, (_, i) => `STOCK${i},Sector${i % 4}`).join("\n");
  const filechooser = page.waitForEvent("filechooser");
  await menuAction(page, "import", "en");
  await (await filechooser).setFiles({
    name: "bulk.csv", mimeType: "text/csv", buffer: Buffer.from(content),
  });
  await expect(page.getByRole("status").filter({ hasText: "Imported 501 symbols into CSV Target" })).toBeVisible();
  await expect.poll(() => submitted.map((item) => item.symbols.length), { timeout: 30_000 })
    .toEqual([500, 1]);
  expect(submitted.every((item) => item.symbols.every((symbol) => item.sections[symbol] === `Sector${Number(symbol.slice(5)) % 4}`)))
    .toBe(true);
  await expect.poll(async () => (await uploadedRows(page, "CSV Target")).length, { timeout: 30_000 })
    .toBe(501);
  await expect.poll(async () => page.evaluate(([key, slot]) => {
    const envelope = JSON.parse(localStorage.getItem(key) || "{}");
    return (envelope[slot]?.lists?.["CSV Target"] ?? []).length;
  }, [E2E_WLS_KEY, owner] as const)).toBe(501);
});
