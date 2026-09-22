import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

test("a cached symbol picker stays usable during refresh and receives the corrected company", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one real client-navigation regression; cache semantics are viewport-independent");
  const result = await page.request.get("/data/manifest.json");
  expect(result.ok()).toBe(true);
  const current = await result.json();
  expect(current.symbols.NVDA).toBeTruthy();
  const cached = structuredClone(current);
  cached.symbols.NVDA.name = "Cached NVIDIA company";
  current.symbols.NVDA.name = "Refreshed NVIDIA company";
  // Seed the actual existing disk cache before opening the product; no new application seam.
  await page.route("**/__warm_cache_seed", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Cache precondition</title>" }));
  await page.goto("/__warm_cache_seed");
  await page.evaluate(async (manifest) => {
    localStorage.setItem("mm.lang", "en");
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("mm-data-cache", 1);
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore("json", { keyPath: "url" });
        store.createIndex("ts", "ts", { unique: false });
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result, tx = db.transaction("json", "readwrite");
        tx.objectStore("json").put({ url: "/data/manifest.json", data: manifest, ts: Date.now() - 90_000 });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }, cached);
  let release!: () => void, refreshes = 0;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/data/manifest.json", async (route) => { refreshes++; await held; await route.fulfill({ json: current }); });
  try {
    await page.goto("/terminal?symbol=NVDA");
    await expect(page.locator(".chart-wrap canvas").first()).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => refreshes).toBe(1);
    // A real SPA navigation preserves the same in-flight cache request.
    await page.locator('a[href^="/analysis"]').first().click();
    await expect(page).toHaveURL(/\/analysis/);
    await page.locator("button.sym-pick").click();
    const dialog = page.locator(".smodal");
    await dialog.getByRole("textbox").first().fill("NVDA");
    await expect(dialog).toContainText("Cached NVIDIA company");
    expect(refreshes).toBe(1);
    mkdirSync("docs/pr-crops/warm-symbol-picker-20260921", { recursive: true });
    await page.screenshot({ path: "docs/pr-crops/warm-symbol-picker-20260921/cached-while-refreshing.png" });
    release();
    await expect(dialog).toContainText("Refreshed NVIDIA company");
    await expect(dialog).not.toContainText("Cached NVIDIA company");
    expect(refreshes).toBe(1);
    await page.screenshot({ path: "docs/pr-crops/warm-symbol-picker-20260921/corrected-after-refresh.png" });
  } finally { release(); }
});
