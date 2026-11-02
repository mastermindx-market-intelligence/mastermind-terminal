import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { fixtureAuthSetup } from "./fixtures/investigation-auth";
import { isolateWatchlistStore } from "./watchlistStore";

// Outer input dimensions hide clipping inside Chromium's native date editor.
async function nativeDateGeometry(page: Page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: 'input[type="datetime-local"]' });
    const { node } = await session.send("DOM.describeNode", { nodeId, depth: -1, pierce: true });
    type NativeNode = { backendNodeId: number; attributes?: string[]; children?: NativeNode[]; shadowRoots?: NativeNode[] };
    const find = (entry: NativeNode): NativeNode | undefined => {
      if (entry.attributes?.includes("-webkit-datetime-edit")) return entry;
      for (const child of [...(entry.children ?? []), ...(entry.shadowRoots ?? [])]) {
        const found = find(child);
        if (found) return found;
      }
    };
    const editor = find(node);
    expect(editor, "native date editor must be measurable").toBeTruthy();
    const { object } = await session.send("DOM.resolveNode", { backendNodeId: editor!.backendNodeId });
    const { result } = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function() {
        const box = this.getBoundingClientRect();
        return { client: this.clientWidth, scroll: this.scrollWidth, scrollLeft: this.scrollLeft,
          left: box.left, right: box.right,
          segments: [...this.querySelectorAll('[role="spinbutton"]')].map(segment => {
            const rect = segment.getBoundingClientRect();
            return { text: segment.textContent, left: rect.left, right: rect.right };
          }) };
      }`,
      returnByValue: true,
    });
    return result.value as { client: number; scroll: number; scrollLeft: number; left: number; right: number; segments: { text: string; left: number; right: number }[] };
  } finally {
    await session.detach();
  }
}

for (const zh of [false, true]) {
  test(`effective date stays fully readable after keyboard traversal (${zh ? "zh" : "en"})`, async ({ page, baseURL }, info) => {
    test.setTimeout(120_000);
    await isolateWatchlistStore(page, info, baseURL);
    await fixtureAuthSetup(page, baseURL!);
    await page.addInitScript(lang => localStorage.setItem("mm.lang", lang), zh ? "zh" : "en");
    await page.route("**/api/brain/me", route => route.fulfill({ json: { tier: "guest", quotas: { fast: { remaining: 0, limit: 0, period: "day" }, pro: { remaining: 0, limit: 0, period: "day" } } } }));
    const created = await page.request.post("/api/theses", { data: {
      action: "create", clientRequestId: randomUUID(),
      subject: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "terminal.analysis_symbol", key: "AAPL", identityState: "listing_scoped", listing: { symbol: "AAPL", mic: null, securityId: null }, companyId: null, display: "AAPL · listing scoped" },
      content: { schema: "mastermind.thesis-content/v1", title: "Date precision", statement: "Preserve the whole effective date.", catalysts: [], falsifiers: [], risks: [], horizon: "quarters", effectiveAt: "2026-10-01T09:30:00.123Z", revisionNote: "Keep the original instant and milliseconds." },
    } });
    expect(created.status()).toBe(201);
    const { thesisId } = await created.json();
    const readOwner = async () => {
      const response = await page.request.get(`/api/theses?id=${thesisId}`);
      expect(response.ok()).toBe(true);
      return (await response.json()).thesis;
    };
    const original = await readOwner();
    const writes: string[] = [];
    page.on("request", request => {
      if (request.method() !== "GET" && new URL(request.url()).pathname === "/api/theses") writes.push(request.method());
    });
    await page.goto(`/analysis?view=theses&thesis=${thesisId}`);
    const input = page.locator('input[type="datetime-local"]');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute("step", "0.001");
    const value = await input.inputValue();
    expect(value).toMatch(/\.123$/);
    // 720px exercises the two-column layout exposed by native 200% zoom on a
    // 1440px desktop. Actual browser zoom is qualified separately.
    const viewport = page.viewportSize()!;
    const widths = info.project.name === "desktop" ? [viewport.width, 720]
      : info.project.name === "mobile" ? [viewport.width, 320] : [viewport.width];
    for (const width of widths) {
      await page.setViewportSize({ width, height: viewport.height });
      await input.focus();
      let tabs = 0;
      while (tabs < 12 && await input.evaluate(element => element === document.activeElement)) {
        await page.keyboard.press("Tab");
        tabs += 1;
      }
      expect(tabs).toBeLessThan(12);
      const geometry = await nativeDateGeometry(page);
      await info.attach(`date-${width}`, { body: JSON.stringify(geometry), contentType: "application/json" });
      expect(geometry.segments.length).toBeGreaterThanOrEqual(6);
      expect(geometry.scroll, "whole native date must fit without internal scrolling").toBeLessThanOrEqual(geometry.client);
      expect(geometry.scrollLeft).toBe(0);
      for (const segment of geometry.segments) {
        expect(segment.left, segment.text).toBeGreaterThanOrEqual(geometry.left - 1);
        expect(segment.right, segment.text).toBeLessThanOrEqual(geometry.right + 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(input).toHaveValue(value);
    }
    expect(await readOwner()).toEqual(original);
    expect(writes).toEqual([]);
  });
}
