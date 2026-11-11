import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import captured from "../lib/__tests__/fixtures/sector_generation.captured.preview.v1.json";
import { sectorFixture } from "./fixtures/sector-company-v3";
import { isolateWatchlistStore } from "./watchlistStore";

// The same actual Macro API bytes used by the real gateway qualification.
// Population/authentication are controlled; this is not production acceptance.
const ownerWire = readFileSync("lib/__tests__/fixtures/sector_generation.captured.preview.v1.json", "utf8").trimEnd();
const ownerWireHash = createHash("sha256").update(ownerWire).digest("hex");
const nativePath = "/api/sector-generation?audience=preview";
const cohort = captured.projection.data.core.sectors.map(row => row.id);
const subject = (page: Page) => page.getByTestId("sector-intelligence");
const exact = (page: Page) => page.getByTestId("sector-exact-window-returns");

async function prepare(page: Page, language = "en") {
  expect(ownerWireHash).toBe("3e275fc69d22e990f81261c8a803576a832be9332484c7a99b2dddd165a5d425");
  const state = { wire: structuredClone(captured), denied: false, initial: true, gate: null as Promise<void> | null };
  await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), language);
  await page.route("**/api/sector-intelligence?**", async route => {
    const source = new URL(route.request().url()).searchParams.get("source");
    if (source === "sector") return route.fulfill({ json: {
      data: { as_of: captured.source_session, sectors: [{ id: "xlk", ticker: "XLK", name: "Legacy Technology", kind: "sector" }] },
      receipt: { source, status: "ready", path: "/sectordata/sector_central.json", asOf: captured.source_session,
        observedAt: captured.published_at, contentHash: "independent-legacy", stale: false },
    } });
    if (source !== "generation") return sectorFixture(route);
    if (state.gate) await state.gate;
    return route.fulfill({ status: state.denied ? 401 : 200, json: {
      data: state.denied ? null : state.wire,
      receipt: { source, status: state.denied ? "access" : "ready", path: nativePath,
        asOf: state.denied ? null : state.wire.source_session, observedAt: captured.published_at,
        contentHash: state.denied ? null : state.initial ? ownerWireHash
          : createHash("sha256").update(JSON.stringify(state.wire)).digest("hex"),
        stale: state.wire.qualification === "stale" },
    } });
  });
  await page.route("**/api/quote?**", route => route.fulfill({ json: { quotes: {} } }));
  return state;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const language of ["en", "zh"]) for (const theme of ["dark", "light"]) {
  test("captured generation keeps all eleven selections and exact returns: " + language + " " + theme, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await prepare(page, language);
    await page.goto("/discover?tab=sectors&sectorWorkspace=detail&sector=xlk&sectorTheme=" + theme);
    const select = subject(page).getByRole("combobox", { name: language === "zh" ? "板块" : "Sector", exact: true });
    await expect(select.locator("option")).toHaveCount(11);
    expect(await select.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(cohort);
    await select.selectOption("xlu");
    await expect(page.getByTestId("sector-leadership-dossier")).toContainText("XLU");
    await expect(exact(page)).toContainText("XLU");
    // Frozen XLU source values rounded only for display; the three windows stay distinct.
    for (const [window, absolute, relative] of [["5", "+0.04%", "+0.00%"], ["20", "+0.17%", "+0.00%"], ["63", "+0.53%", "+0.01%"]]) {
      const cell = exact(page).locator('[data-testid="sector-exact-window"][data-window="' + window + '"]');
      await expect(cell.getByTestId("sector-exact-absolute")).toHaveText(absolute);
      await expect(cell.getByTestId("sector-exact-relative")).toHaveText(relative);
    }
    await expect(subject(page).getByTestId("sector-view-in-portfolio")).toHaveAttribute("data-sector-etf", "XLU");
    await expect(subject(page).getByTestId("sector-view-in-portfolio")).toHaveAttribute("href", /sector=XLU/);
    await noOverflow(page);
    await exact(page).scrollIntoViewIfNeeded();
    await info.attach("native-exact-" + language + "-" + theme, { body: await page.screenshot(), contentType: "image/png" });
    await page.setViewportSize({ width: 320, height: 800 });
    await noOverflow(page);
    await exact(page).scrollIntoViewIfNeeded();
    await info.attach("native-exact-320-" + language + "-" + theme, { body: await page.screenshot(), contentType: "image/png" });
    expect(errors).toEqual([]);
  });
}

test("a same-session generation replacement resets the real history cursor and access refusal withdraws it", async ({ page }) => {
  const state = await prepare(page);
  await page.goto("/discover?tab=sectors&sectorWorkspace=rotation&sector=xlk&sectorDiscoveryMode=table");
  const history = page.getByTestId("rotation-history"), cursor = history.getByRole("slider");
  await expect(cursor).toBeVisible();
  const tail = await cursor.getAttribute("max");
  expect(Number(tail)).toBeGreaterThan(0);
  await cursor.focus(); await cursor.press("Home");
  await expect(cursor).toHaveValue("0");
  // Explicit synthetic replacement control: the captured measurements/clocks stay unchanged.
  state.initial = false; state.wire.projection.receipt.generation_id = "captured-sector-replacement";
  let release!: () => void;
  state.gate = new Promise<void>(resolve => { release = resolve; });
  const nextRead = page.waitForRequest(request => request.url().includes("/api/sector-intelligence?source=generation"));
  // Resume uses the existing read lifetime; a manual Refresh would remount the
  // data and reset the cursor even without the same-session generation key.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await nextRead;
  await expect(cursor).toHaveValue("0");
  state.gate = null; release();
  await expect(cursor).toHaveValue(tail!);
  await expect(history.locator("time").first()).toHaveAttribute("datetime", captured.source_session);
  state.denied = true;
  await subject(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(cursor).toHaveCount(0);
  await subject(page).getByRole("button", { name: "Discover", exact: true }).click();
  await expect(subject(page)).toContainText("Legacy Technology");
  await noOverflow(page);
});

test("the native owner verdict remains visible when stale becomes degraded", async ({ page }) => {
  const state = await prepare(page);
  state.initial = false;
  state.wire.qualification = state.wire.projection.receipt.qualification = "stale";
  await page.goto("/discover?tab=sectors&sectorWorkspace=detail&sector=xlk");
  await expect(page.getByTestId("sector-generation-qualification")).toHaveAttribute("data-qualification", "stale");
  await expect(exact(page)).toBeVisible();
  state.wire.qualification = state.wire.projection.receipt.qualification = "degraded";
  await subject(page).getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByTestId("sector-generation-qualification")).toHaveAttribute("data-qualification", "degraded");
  await expect(exact(page)).toBeVisible();
});

test("a native-only sector keeps its generation through Portfolio and returns to the original workspace", async ({ page, baseURL }, info) => {
  await isolateWatchlistStore(page, info, baseURL);
  await prepare(page);
  await page.goto("/discover?tab=sectors&sectorWorkspace=rotation&sector=xlu");
  await page.getByTestId("sector-rotation").getByRole("button", { name: /^Open sector research/ }).click();
  await expect(exact(page)).toContainText("XLU");
  await page.getByTestId("sector-view-in-portfolio").click();
  const portfolio = page.getByTestId("portfolio-sector-context");
  await expect(portfolio).toHaveAttribute("data-etf", "XLU");
  await expect(exact(page)).toContainText("XLU");
  const source = page.getByTestId("sector-generation-source");
  await source.locator("summary").click();
  await expect(source).toContainText(captured.projection.receipt.generation_id);
  await expect(source).toContainText(captured.projection.receipt.content_sha256);
  await noOverflow(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await source.scrollIntoViewIfNeeded();
  await info.attach("native-portfolio-source-320", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByTestId("portfolio-sector-context-return").click();
  await expect(subject(page)).toHaveAttribute("data-sector-workspace", "rotation");
  expect(new URL(page.url()).searchParams.get("sector")).toBe("xlu");
});
