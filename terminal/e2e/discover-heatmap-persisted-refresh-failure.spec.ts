import { expect, test, type Page, type Route } from "@playwright/test";
import { makeHeatmapT } from "@/lib/heatmapStrings";
import { expectTapTarget } from "./tapTarget";

/**
 * Failure-state truth on the Heatmap when the board is painted from the PERSISTED manifest.
 *
 * A real browser almost always holds /data/manifest.json in IndexedDB: dataCache writes every
 * successful read through to disk, and the shell, Screener and Alerts all read it. On the next
 * visit the cache answers the Heatmap from that copy — older than its 60s TTL, so served stale —
 * and asks the network again in the background. When every source then fails, the tiles on
 * screen are an earlier session's prices and the board must say so ("Could not refresh — showing
 * the last read."). Before the fix the stale serve was a bare `data` outcome, the failed refresh
 * never reached the board, and the label could not appear for this copy at all.
 *
 * The record is written by the app's own write-through on a healthy first visit, then aged to an
 * earlier session's timestamp with the browser's own IndexedDB — no mocked cache layer.
 *
 * The flow layer's static copy (/data/flow_idx.json) is a persisted read of the same kind and is
 * held to the same rule ("Could not refresh the flow layer — showing the last read.").
 */

test.setTimeout(120_000);

/** A JSON reply serves that body with a 200, so a source with no file in dev can still answer. */
type Reply = "503" | "abort" | "pass" | { json: unknown };

const PRIMARY = "flow:manifest";
const STATIC = "/data/manifest.json";
const FLOW_PRIMARY = "flow:flow_idx";
const FLOW_STATIC = "/data/flow_idx.json";
const SIX_HOURS = 6 * 60 * 60_000;

async function installManifestReplies(page: Page, replies: Record<string, Reply>) {
  const keyOf = (url: URL) => (url.pathname === "/api/flow" ? `flow:${url.searchParams.get("f") ?? ""}` : url.pathname);
  await page.route(
    (url) => (replies[keyOf(url)] ?? "pass") !== "pass",
    async (route: Route) => {
      const reply = replies[keyOf(new URL(route.request().url()))];
      if (typeof reply === "object") return route.fulfill({ status: 200, json: reply.json });
      switch (reply) {
        case "503": return route.fulfill({ status: 503, json: { error: "feed unavailable" } });
        case "abort": return route.abort("failed");
        default: return route.fallback();
      }
    },
  );
}

async function setLang(page: Page, lang: "en" | "zh") {
  await page.addInitScript((l) => {
    localStorage.setItem("mm.lang", l);
    document.documentElement.setAttribute("data-lang", l);
  }, lang);
}

async function expectNoPageOverflow(page: Page) {
  const doc = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client + 1);
}

/** The persisted record's timestamp in the cache's own database, or null when there is none. */
function persistedTs(page: Page, key = STATIC): Promise<number | null> {
  return page.evaluate((url) => new Promise<number | null>((resolve) => {
    const open = indexedDB.open("mm-data-cache");
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("json")) { db.close(); resolve(null); return; }
      const get = db.transaction("json", "readonly").objectStore("json").get(url);
      get.onsuccess = () => { db.close(); resolve(get.result ? (get.result.ts as number) : null); };
      get.onerror = () => { db.close(); resolve(null); };
    };
  }), key);
}

/** Re-stamp the persisted record as an earlier session's read, `ageMs` old. */
function agePersisted(page: Page, ageMs: number, key = STATIC): Promise<boolean> {
  return page.evaluate(({ url, ageMs }) => new Promise<boolean>((resolve) => {
    const open = indexedDB.open("mm-data-cache");
    open.onerror = () => resolve(false);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("json", "readwrite");
      const store = tx.objectStore("json");
      const get = store.get(url);
      get.onsuccess = () => { if (get.result) store.put({ ...get.result, ts: Date.now() - ageMs }); };
      tx.oncomplete = () => { db.close(); resolve(Boolean(get.result)); };
      tx.onerror = () => { db.close(); resolve(false); };
    };
  }), { url: key, ageMs });
}

for (const failure of ["503", "abort"] as const) {
  test(`tiles painted from the persisted manifest are labelled as the last read when every refresh fails (${failure})`, async ({ page }, testInfo) => {
    const lang = testInfo.project.name === "tablet" ? "zh" : "en";
    const t = makeHeatmapT(lang);
    await setLang(page, lang);
    // First visit: the route is down for a guest, so the board reads — and persists — the static copy.
    const replies: Record<string, Reply> = { [PRIMARY]: "503", [STATIC]: "pass" };
    await installManifestReplies(page, replies);
    let staticRequests = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === STATIC) staticRequests += 1; });

    await page.goto("/discover?tab=heatmap");
    const breadth = page.getByTestId("heatmap-breadth");
    await expect(breadth).toContainText(/\(\d+%\)/, { timeout: 45_000 });
    await expect.poll(() => persistedTs(page), { timeout: 20_000 }).not.toBeNull();
    expect(await agePersisted(page, SIX_HOURS)).toBe(true);
    expect(Date.now() - ((await persistedTs(page)) ?? Date.now())).toBeGreaterThanOrEqual(SIX_HOURS);

    // The next visit: every source is down. The disk copy paints, and its refresh fails.
    replies[PRIMARY] = failure;
    replies[STATIC] = failure;
    staticRequests = 0;
    await page.reload();

    const stale = page.getByTestId("heatmap-refresh-failed");
    await expect(stale).toBeVisible({ timeout: 45_000 });
    await expect(stale).toContainText(t("refreshFailed"));
    await expect(breadth).toContainText(/\(\d+%\)/);                               // the tiles stay
    await expect(page.getByTestId("heatmap-load-error")).toHaveCount(0);
    await expect(page.getByText(t("noData"), { exact: true })).toHaveCount(0);
    expect(staticRequests).toBeGreaterThanOrEqual(1);                               // a real refresh was tried
    expect(await persistedTs(page)).not.toBeNull();                                 // and left the copy on disk
    const retry = stale.getByRole("button", { name: t("retry"), exact: true });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
    await expectNoPageOverflow(page);

    // Retry into healthy sources: the same document recovers, and the label goes with the failure.
    await page.evaluate(() => { (window as unknown as { __heatmapSameDocument?: boolean }).__heatmapSameDocument = true; });
    replies[PRIMARY] = "pass";
    replies[STATIC] = "pass";
    await retry.click({ timeout: 20_000 });
    await expect(stale).toHaveCount(0, { timeout: 20_000 });
    await expect(breadth).toContainText(/\(\d+%\)/, { timeout: 20_000 });
    await expect(page.getByTestId("heatmap-load-error")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __heatmapSameDocument?: boolean }).__heatmapSameDocument)).toBe(true);
  });
}

// Negative control: the label is a statement about a FAILED refresh, not about a disk read.
test("tiles painted from the persisted manifest are not labelled when the refresh succeeds", async ({ page }, testInfo) => {
  const lang = testInfo.project.name === "tablet" ? "zh" : "en";
  const t = makeHeatmapT(lang);
  await setLang(page, lang);
  const replies: Record<string, Reply> = { [PRIMARY]: "503", [STATIC]: "pass" };
  await installManifestReplies(page, replies);
  let staticResponses = 0;
  page.on("response", (response) => { if (new URL(response.url()).pathname === STATIC && response.ok()) staticResponses += 1; });

  await page.goto("/discover?tab=heatmap");
  const breadth = page.getByTestId("heatmap-breadth");
  await expect(breadth).toContainText(/\(\d+%\)/, { timeout: 45_000 });
  await expect.poll(() => persistedTs(page), { timeout: 20_000 }).not.toBeNull();
  expect(await agePersisted(page, SIX_HOURS)).toBe(true);

  staticResponses = 0;
  await page.reload();
  await expect(breadth).toContainText(/\(\d+%\)/, { timeout: 45_000 });
  await expect.poll(() => staticResponses, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  // The successful refresh re-stamps the disk copy as current.
  await expect.poll(async () => Date.now() - ((await persistedTs(page)) ?? 0), { timeout: 20_000 }).toBeLessThan(SIX_HOURS);
  await expect(page.getByTestId("heatmap-refresh-failed")).toHaveCount(0);
  await expect(page.getByText(t("refreshFailed"))).toHaveCount(0);
});

for (const failure of ["503", "abort"] as const) {
  test(`flow tiles painted from the persisted flow index are labelled as the last read when every refresh fails (${failure})`, async ({ page }, testInfo) => {
    const lang = testInfo.project.name === "tablet" ? "zh" : "en";
    const t = makeHeatmapT(lang);
    await setLang(page, lang);
    // The flow index the route serves in this environment, replayed as the static copy below.
    const live = await page.request.get("/api/flow?f=flow_idx");
    expect(live.ok()).toBe(true);
    const flowIdx: unknown = await live.json();

    // First visit: the route is down, so the board reads — and persists — the static flow copy.
    const replies: Record<string, Reply> = { [FLOW_PRIMARY]: "503", [FLOW_STATIC]: { json: flowIdx } };
    await installManifestReplies(page, replies);
    let staticRequests = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname === FLOW_STATIC) staticRequests += 1; });

    const flowButton = page.getByRole("button", { name: t("layerFlow"), exact: true }).first();
    const toneNote = page.getByText(t("toneSoftNote"));
    await page.goto("/discover?tab=heatmap");
    await expect(page.getByTestId("heatmap-breadth")).toContainText(/\(\d+%\)/, { timeout: 45_000 });
    await flowButton.click({ timeout: 20_000 });
    await expect(toneNote).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => persistedTs(page, FLOW_STATIC), { timeout: 20_000 }).not.toBeNull();
    expect(await agePersisted(page, SIX_HOURS, FLOW_STATIC)).toBe(true);

    // The next visit: both flow sources are down. The disk copy paints, and its refresh fails.
    replies[FLOW_PRIMARY] = failure;
    replies[FLOW_STATIC] = failure;
    staticRequests = 0;
    await page.reload();
    await expect(page.getByTestId("heatmap-breadth")).toContainText(/\(\d+%\)/, { timeout: 45_000 });
    await flowButton.click({ timeout: 20_000 });

    const stale = page.getByTestId("heatmap-flow-refresh-failed");
    await expect(stale).toBeVisible({ timeout: 20_000 });
    await expect(stale).toContainText(t("flowRefreshFailed"));
    await expect(toneNote).toBeVisible();                                          // the flow tiles stay
    await expect(page.getByTestId("heatmap-flow-load-error")).toHaveCount(0);
    await expect(page.getByText(t("noFlowData"))).toHaveCount(0);
    await expect(page.getByTestId("heatmap-refresh-failed")).toHaveCount(0);       // the price read is fine
    expect(staticRequests).toBeGreaterThanOrEqual(1);                               // a real refresh was tried
    expect(await persistedTs(page, FLOW_STATIC)).not.toBeNull();                    // and left the copy on disk
    const retry = stale.getByRole("button", { name: t("retry"), exact: true });
    await expect(retry).toBeVisible();
    if (testInfo.project.name !== "desktop") await expectTapTarget(retry, { height: 44 });
    await expectNoPageOverflow(page);

    // Retry into a healthy route: the same document recovers, and the label goes with the failure.
    await page.evaluate(() => { (window as unknown as { __flowSameDocument?: boolean }).__flowSameDocument = true; });
    replies[FLOW_PRIMARY] = "pass";
    await retry.click({ timeout: 20_000 });
    await expect(stale).toHaveCount(0, { timeout: 20_000 });
    await expect(toneNote).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("heatmap-flow-load-error")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __flowSameDocument?: boolean }).__flowSameDocument)).toBe(true);
  });
}
