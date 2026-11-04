import { expect, test, type Page } from "@playwright/test";
import { reportedGammaBook } from "../lib/__tests__/fixtures/reportedGammaBooks";

// Exercise the incumbent EventSource owner, including its retained-data failure state.
// No mock replaces useFlowStream, the host source gate, memory owner, or comparison panel.
test.setTimeout(120_000);

async function installReads(page: Page, archivedLadder = false) {
  const reads: string[] = [];
  await page.context().addCookies([{ name: "mm_e2e_rs30", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(() => localStorage.setItem("mm.lang", "en"));
  await page.route("**/api/flow?*", async route => {
    const feed = new URL(route.request().url()).searchParams.get("f");
    if (feed) reads.push(feed);
    if (feed === "matrix:SPY") return route.fulfill({ json: { schema: "options_structure.matrix/v1", root: "SPY", session: "2026-10-19", cells: [{ strike: 100, expiry: "2026-10-23", call_vol: 243, call_oi: 110, put_vol: 9, put_oi: 2 }] } });
    if (feed === "gex:SPY") return route.fulfill({ json: reportedGammaBook("2026-10-19") });
    if (feed === "gex_dates:SPY") return route.fulfill({ json: { root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" } });
    if (feed === "gex_at:SPY:2026-10-16") return route.fulfill({ json: {
      ...reportedGammaBook("2026-10-16", 2),
      ...(archivedLadder ? { by_strike: [{ strike: 100, gamma_net: 2, gamma_call: 3, gamma_put: -1 }] } : {}),
    } });
    return route.fallback();
  });
  return reads;
}

for (const status of ["unavailable", "absent"] as const) {
  test("Research Lab withdraws a retained " + status + " source and restores the exact pin on recovery", async ({ page }, info) => {
    const reads = await installReads(page);
    let releaseFailure!: () => void, releaseRecovery!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    const recoveryGate = new Promise<void>(resolve => { releaseRecovery = resolve; });
    let connections = 0, failureDelivered = false;
    await page.route("**/api/flow/stream?*", async route => {
      if (new URL(route.request().url()).searchParams.get("f") !== "gex:SPY") return route.fallback();
      const connection = ++connections;
      if (connection === 1) return route.fulfill({ contentType: "text/event-stream", body: "retry: 250\n\ndata: " + JSON.stringify(reportedGammaBook("2026-10-19")) + "\n\n" });
      if (connection === 2) {
        await failureGate;
        await route.fulfill({ contentType: "text/event-stream", body: "retry: 250\n\nevent: status\ndata: " + JSON.stringify({ status }) + "\n\n" });
        failureDelivered = true;
        return;
      }
      await recoveryGate;
      return route.fulfill({ contentType: "text/event-stream", body: "retry: 60000\n\ndata: " + JSON.stringify(reportedGammaBook("2026-10-19", 3)) + "\n\n" });
    });
    try {
      await page.goto("/options?tab=gex&view=research");
      const lab = page.getByRole("region", { name: "3D Research Lab", exact: true });
      await expect(lab).toBeVisible({ timeout: 45_000 });
      await lab.getByRole("button", { name: "100 Call · 2026-10-23", exact: true }).click();
      await lab.getByRole("button", { name: "Replay & change", exact: true }).click();
      const panel = lab.getByTestId("research-reported-gamma");
      await expect(panel).toHaveAttribute("data-comparison-state", "data");
      await expect(panel).toContainText("+20K → +10K");
      await expect(panel.getByTestId("research-reported-gamma-pin")).toHaveAttribute("data-pin-state", "pinned");
      const liveReads = reads.filter(x => x === "gex:SPY").length;
      const archiveReads = reads.filter(x => x === "gex_at:SPY:2026-10-16").length;
      releaseFailure();
      await expect.poll(() => failureDelivered).toBe(true);
      await expect(panel).toHaveCount(0);
      await expect(lab).toContainText("No current all-expiry GEX source is supplied");
      expect(reads.filter(x => x === "gex:SPY")).toHaveLength(liveReads);
      expect(reads.filter(x => x === "gex_at:SPY:2026-10-16")).toHaveLength(archiveReads);
      await lab.screenshot({ path: info.outputPath(status + "-withdrawn.png") });
      releaseRecovery();
      await expect(panel).toHaveAttribute("data-comparison-state", "data");
      await expect(panel).toContainText("+20K → +30K");
      await expect(panel.getByTestId("research-reported-gamma-pin")).toHaveAttribute("data-pin-state", "pinned");
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await panel.screenshot({ path: info.outputPath(status + "-recovered.png") });
    } finally {
      releaseFailure();
      releaseRecovery();
    }
  });
}

test("Research Lab admits a valid current read before the stream supplies a frame", async ({ page }, info) => {
  await installReads(page);
  await page.route("**/api/flow/stream?*", async route => {
    if (new URL(route.request().url()).searchParams.get("f") !== "gex:SPY") return route.fallback();
    return route.fulfill({ contentType: "text/event-stream", body: "retry: 60000\n\n" });
  });
  await page.goto("/options?tab=gex&view=research");
  const lab = page.getByRole("region", { name: "3D Research Lab", exact: true });
  await expect(lab).toBeVisible({ timeout: 45_000 });
  await lab.getByRole("button", { name: "100 Call · 2026-10-23", exact: true }).click();
  await lab.getByRole("button", { name: "Replay & change", exact: true }).click();
  const panel = lab.getByTestId("research-reported-gamma");
  await expect(panel).toHaveAttribute("data-comparison-state", "data");
  await expect(panel).toContainText("+20K → +10K");
  await expect(panel.getByTestId("research-reported-gamma-pin")).toHaveAttribute("data-pin-state", "pinned");
  await panel.screenshot({ path: info.outputPath("current-read-before-stream.png") });
});

test("Research Lab preserves the selected archive without substituting an available live book", async ({ page }, info) => {
  const reads = await installReads(page, true);
  await page.route("**/api/flow/stream?*", async route => {
    if (new URL(route.request().url()).searchParams.get("f") !== "gex:SPY") return route.fallback();
    return route.fulfill({ contentType: "text/event-stream", body: "retry: 60000\n\ndata: " + JSON.stringify(reportedGammaBook("2026-10-19")) + "\n\n" });
  });
  await page.goto("/options?tab=gex&view=research");
  const lab = page.getByRole("region", { name: "3D Research Lab", exact: true });
  await expect(lab).toBeVisible({ timeout: 45_000 });
  await lab.getByRole("button", { name: "Replay & change", exact: true }).click();
  await expect(lab.getByTestId("research-reported-gamma")).toContainText("+20K → +10K");
  await lab.getByRole("button", { name: "Back to Exposure", exact: true }).click();

  const picker = page.getByRole("combobox", { name: "Archived session", exact: true });
  await expect(picker).toBeVisible();
  await picker.selectOption("2026-10-16");
  await expect(page.getByTestId("gex-archived-chip")).toContainText("2026-10-16");
  await expect(page.locator('[data-tut="gex-ladder"] [data-strike="100"]')).toHaveCount(1);
  await expect(page.getByTestId("gex-archived-missing")).toHaveCount(0);
  await expect(page.getByTestId("gex-archived-error")).toHaveCount(0);

  const feeds = ["gex:SPY", "matrix:SPY", "gex_dates:SPY", "gex_at:SPY:2026-10-16"];
  const counts = Object.fromEntries(feeds.map(feed => [feed, reads.filter(x => x === feed).length]));
  await page.getByRole("button", { name: "3D Research Lab", exact: true }).click();
  await expect(lab).toBeVisible();
  await expect(lab.getByRole("heading", { name: "Matrix unavailable", exact: true })).toBeVisible();
  await expect(lab.locator("table tbody tr")).toHaveCount(0);
  await lab.getByRole("button", { name: "Replay & change", exact: true }).click();
  await expect(lab.getByTestId("research-reported-gamma")).toHaveCount(0);
  await expect(lab.locator("[data-memory-status]")).toHaveCount(0);
  await expect(lab).toContainText("No current all-expiry GEX source is supplied for this session");
  for (const feed of feeds) expect(reads.filter(x => x === feed)).toHaveLength(counts[feed]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await lab.screenshot({ path: info.outputPath("archived-no-live-fallback.png") });

  await lab.getByRole("button", { name: "Back to Exposure", exact: true }).click();
  await expect(page.getByTestId("gex-archived-chip")).toContainText("2026-10-16");
  await expect(picker).toHaveValue("2026-10-16");
});
