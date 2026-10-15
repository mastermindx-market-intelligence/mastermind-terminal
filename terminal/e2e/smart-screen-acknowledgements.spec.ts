import { expect, test } from "@playwright/test";
import { dataRows, openPanel, openScreener, prepare, routeManifest } from "./smartScreensFixture";

test.setTimeout(150_000);

test("unrelated and stale write answers retain the original request through reload and explicit retry", async ({ page, baseURL }, testInfo) => {
  await prepare(page.context(), baseURL!, `screen-ack-${testInfo.project.name}-${Date.now()}`, testInfo.project.name === "tablet");
  await routeManifest(page, () => "g1");
  await openScreener(page, 5);
  let p = await openPanel(page);
  await expect(p).toHaveAttribute("data-ss-status", "ready");
  const requests: unknown[] = [];
  let substitute = true;
  let firstRecord: Record<string, unknown> | undefined;
  await page.route("**/api/smart-screens", async route => {
    if (route.request().method() !== "PUT") return route.fallback();
    const command = route.request().postDataJSON();
    requests.push(command);
    // The real route writes to its isolated fixture database. Only the returned answer changes.
    const response = await route.fetch();
    const body = await response.json();
    if (substitute) {
      if (command.action === "create") {
        firstRecord = structuredClone(body.record);
        body.record.id = "f".repeat(32);
      } else if (command.action === "update") {
        body.record = firstRecord;
      } else {
        body.deleted = "f".repeat(32);
      }
    }
    await route.fulfill({ response, json: body });
  });

  const recover = async (requestIndex: number) => {
    await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-pending", "failed");
    await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-error", "unavailable");
    await expect(p).toHaveAttribute("data-ss-status", "stale");
    await expect(p.locator("[data-ss-sync]")).toContainText(testInfo.project.name === "tablet" ? "尚未确认" : "not confirmed");
    await expect(p.locator("[data-ss-pending-help]")).toContainText(testInfo.project.name === "tablet" ? "不会撤销" : "does not undo");
    await expect(p.locator("[data-ss-pending-count]")).toContainText(testInfo.project.name === "tablet" ? "待处理" : "pending");
    if (requestIndex === 0) {
      await expect(p.locator("[data-ss-empty]")).toContainText(testInfo.project.name === "tablet" ? "上次读取" : "last account copy");
      await p.screenshot({ path: testInfo.outputPath("uncertain-account.png") });
    }
    const count = requests.length;
    await p.locator("[data-ss-retry-read]").click();
    await expect(p).toHaveAttribute("data-ss-status", "ready");
    await expect(p.locator("[data-ss-pending]")).toHaveCount(1);
    expect(requests).toHaveLength(count); // Refresh only reads; it never settles/resends the request.
    await page.reload();
    await expect(dataRows(page)).toHaveCount(5, { timeout: 45_000 });
    p = await openPanel(page);
    await expect(p).toHaveAttribute("data-ss-status", "ready");
    await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-pending", "failed");
    expect(requests).toHaveLength(count); // Readback never silently resends the pending write.
    await expect(p.locator('[data-ss-screen="ffffffffffffffffffffffffffffffff"]')).toHaveCount(0);
    substitute = false;
    await p.locator("[data-ss-retry]").click();
    await expect(p.locator("[data-ss-pending]")).toHaveCount(0);
    expect(requests).toHaveLength(count + 1);
    expect(requests[count]).toEqual(requests[requestIndex]);
    substitute = true;
  };

  await p.locator("[data-ss-name-input]").fill("Recover original screen");
  await p.locator("[data-ss-save-button]").click();
  await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-error", "unavailable");
  await expect(p.locator("[data-ss-screen]")).toHaveCount(0);
  await recover(0);
  const id = firstRecord!.id as string;
  await expect(p.locator("[data-ss-screen]")).toHaveCount(1);
  await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-screen", id);
  await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-rev", "1");

  await p.locator("[data-ss-review]").click();
  await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-error", "unavailable");
  await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-rev", "1");
  await recover(2);
  await expect(p.locator("[data-ss-screen]")).toHaveAttribute("data-ss-rev", "2");
  await expect(p.locator("[data-ss-reviewed]")).toHaveAttribute("data-ss-reviewed", "2026-10-09");
  await p.screenshot({ path: testInfo.outputPath("recovered-original.png") });

  await p.locator("[data-ss-delete]").click();
  await p.locator("[data-ss-confirm-delete]").click();
  await expect(p.locator("[data-ss-pending]")).toHaveAttribute("data-ss-error", "unavailable");
  await expect(p.locator("[data-ss-screen]")).toHaveCount(1);
  await recover(4);
  await expect(p.locator("[data-ss-screen]")).toHaveCount(0);
  const account = await (await page.request.get("/api/smart-screens")).json();
  expect(account.screens).toEqual([]);
  expect(requests).toHaveLength(6);
});
