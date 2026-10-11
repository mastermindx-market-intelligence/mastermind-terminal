import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type Request } from "@playwright/test";
import { CHART_CAPTURE_PNG_KEYWORD, CHART_CAPTURE_SCHEMA, readPngText, type ChartCaptureManifest } from "../lib/chartCapture";
import { isPhoneViewport } from "./phoneChrome";
import { expectTapTarget } from "./tapTarget";

// Review capture (E19): the image and its description come from ONE scene, private drawings stay
// out unless the viewer includes them, and nothing leaves the device. The falsifier is driven
// through the dev-only `__mmCaptureMidHook` seam, which runs between the chart raster and the end
// of the composite — the window in which a moving chart would otherwise be described wrongly.

declare global {
  interface Window {
    __mmCaptureMidHook?: () => unknown;
    __mmCaptureReady?: boolean;
    __e19FontsAtRequest?: boolean[];
  }
}

const PRIVATE_NOTE = "PRIVATE-NOTE-E19";
const DRAWINGS = [
  { id: "e19-note", kind: "text", source: "user", points: [{ t: "2026-06-15", p: 204 }], color: "#4d82ff", text: PRIVATE_NOTE, fontSize: 16 },
  { id: "e19-line", kind: "hline", source: "user", points: [{ t: "2026-06-12", p: 198 }], color: "#26c281", width: 2, dash: "solid" },
];

type Uploads = { snapshotApi: string[]; pngBodies: string[] };

async function openTerminal(page: Page): Promise<Uploads> {
  const uploads: Uploads = { snapshotApi: [], pngBodies: [] };
  page.on("request", (request: Request) => {
    if (new URL(request.url()).pathname.startsWith("/api/snapshot")) uploads.snapshotApi.push(request.url());
    const body = request.postDataBuffer();
    if (body && (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      || body.includes(Buffer.from(CHART_CAPTURE_PNG_KEYWORD)) || body.includes(Buffer.from(PRIVATE_NOTE)))) {
      uploads.pngBodies.push(request.url());
    }
  });
  await page.route("**/api/drawings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ drawings: DRAWINGS }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem("mm.lang", "en");
    window.__mmCaptureReady = false;
    window.addEventListener("mm:terminal-visual-ready", () => { window.__mmCaptureReady = true; }, { once: true });
    // Canvas text never waits for a web font. Record, at each review request, whether every face the
    // chart header and provenance strip are painted with had finished loading. This reads the faces
    // themselves rather than document.fonts.check(): next/font declares a local() size-adjusted
    // fallback face beside Inter, that face errors wherever the local font is absent (the Linux CI
    // runners), and check() then answers false for ever. Only faces whose unicode-range covers the
    // Latin text the strip paints count: Inter ships one face per script subset and the other
    // subsets legitimately never load. A counted face the browser cannot use paints nothing, so it
    // is left out; a counted face still unloaded or loading at the request is the defect.
    window.__e19FontsAtRequest = [];
    window.addEventListener("mm:snapshot", (event) => {
      if ((event as CustomEvent).detail?.action !== "review") return;
      const root = getComputedStyle(document.documentElement);
      const plain = (family: string) => family.trim().replace(/^["']|["']$/g, "").toLowerCase();
      const wanted = new Set<string>();
      for (const name of ["--font-ui", "--font-num"]) {
        for (const family of root.getPropertyValue(name).split(",")) if (plain(family)) wanted.add(plain(family));
      }
      // "A" (U+0041): the header and the provenance strip are basic Latin letters, digits and punctuation.
      const coversLatin = (face: FontFace) => face.unicodeRange.split(",").some((part) => {
        const m = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
        if (!m) return false;
        const lo = parseInt(m[1].replace(/\?/g, "0"), 16);
        const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, "F"), 16);
        return lo <= 0x41 && 0x41 <= hi;
      });
      const faces: FontFace[] = [];
      document.fonts.forEach((face) => { if (wanted.has(plain(face.family)) && coversLatin(face)) faces.push(face); });
      const usable = faces.filter((face) => face.status !== "error");
      window.__e19FontsAtRequest!.push(usable.length > 0 && usable.every((face) => face.status === "loaded"));
    });
  });
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(window.__mmCaptureReady)), {
    message: "the interactive Terminal should finish hydrating", timeout: 20_000,
  }).toBe(true);
  return uploads;
}

async function openToolbarMenu(page: Page) {
  const menu = page.locator(".toolbar-overflow-pop.show");
  if (!(await menu.isVisible())) await page.getByTestId("toolbar-more").click({ timeout: 2_000 });
  await expect(menu).toBeVisible({ timeout: 2_000 });
  const back = menu.locator(".toolbar-overflow-back");
  if (await back.isVisible()) await back.click({ timeout: 2_000 });
  return menu;
}

/** Open the review from whichever entry the viewport shows: the snapshot menu, the toolbar's
 * overflow menu (the adaptive toolbar may remeasure after fonts load), or the phone hub. */
async function openReview(page: Page): Promise<Locator> {
  const dialog = page.getByTestId("chart-capture-dialog");
  if (isPhoneViewport(page)) {
    await page.getByTestId("roller-more").click();
    await page.getByTestId("hub-tile-capture").click();
    await expect(dialog).toBeVisible();
    return dialog;
  }
  const snapshotButton = page.locator('[data-toolbar-action="snapshot"] > button');
  await expect.poll(async () => {
    if (await dialog.isVisible()) return true;
    try {
      if (await snapshotButton.isVisible()) {
        await snapshotButton.click({ timeout: 2_000 });
        await page.locator('[data-snapshot-action="review"]').click({ timeout: 2_000 });
      } else {
        const menu = await openToolbarMenu(page);
        await menu.locator('[data-toolbar-menu-action="snapshot"]').click({ timeout: 2_000 });
        await menu.locator('[data-toolbar-menu-action="snapshot-review"]').click({ timeout: 2_000 });
      }
    } catch { /* the toolbar remeasured mid-attempt — the next poll takes the other path */ }
    return dialog.isVisible();
  }, { timeout: 25_000, intervals: [150, 250, 400, 600, 1000], message: "could not open the capture review" }).toBe(true);
  return dialog;
}

async function waitForState(dialog: Locator, state: "ready" | "withheld" | "no_data" | "unavailable") {
  await expect(dialog).toHaveAttribute("data-capture-state", state, { timeout: 20_000 });
}

function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function saveAndRead(page: Page, dialog: Locator) {
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByTestId("chart-capture-save-image").click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = new Uint8Array(readFileSync(path!));
  const text = readPngText(bytes, CHART_CAPTURE_PNG_KEYWORD);
  expect(text, "the saved PNG carries its own description").not.toBeNull();
  return { filename: download.suggestedFilename(), bytes, text: text!, manifest: JSON.parse(text!) as ChartCaptureManifest };
}

test.describe("chart capture review", () => {
  test.describe.configure({ timeout: 90_000 });

  test("the saved image and its description describe one scene, drawings stay out by default, nothing is uploaded", async ({ page }) => {
    const uploads = await openTerminal(page);
    const dialog = await openReview(page);
    await waitForState(dialog, "ready");

    await expect(dialog.getByText("Files stay on this device. Nothing is uploaded.")).toBeVisible();
    await expect(dialog.getByTestId("chart-capture-preview")).toBeVisible();

    // Private drawings are counted, offered, and left out until the viewer includes them.
    const include = dialog.getByTestId("chart-capture-include-drawings");
    await expect(include).not.toBeChecked();
    await expect(include).toBeEnabled();
    await expect(dialog.getByText(`Include my drawings (${DRAWINGS.length})`)).toBeVisible();

    await expect(dialog.getByTestId("chart-capture-published")).toHaveText("Not provided by the data source");
    const fontsAtRequest = await page.evaluate(() => window.__e19FontsAtRequest ?? []);
    expect(fontsAtRequest.length, "the review asked the chart for at least one capture").toBeGreaterThan(0);
    expect(fontsAtRequest, "every capture is painted only after its fonts have loaded").not.toContain(false);

    const saved = await saveAndRead(page, dialog);
    await expect(dialog.getByTestId("chart-capture-notice")).toHaveText("Image download started.");
    const { manifest } = saved;
    expect(manifest.schema).toBe(CHART_CAPTURE_SCHEMA);
    expect(manifest.instrument.symbol).toBe("NVDA");
    const header = await page.evaluate(() => (window as unknown as { __mmSnapshotHeader?: { symbol: string; timeframe: string } }).__mmSnapshotHeader);
    expect(manifest.instrument.timeframe).toBe(header?.timeframe);
    expect(saved.filename).toMatch(/^NVDA_/);
    expect(saved.filename).toMatch(/\.png$/);
    expect(pngSize(saved.bytes)).toEqual({ width: manifest.image.width, height: manifest.image.height });
    expect(manifest.data.bars).toBeGreaterThan(0);
    expect(manifest.viewport.cssWidth).toBeGreaterThan(0);
    expect(manifest.viewport.from).not.toBeNull();

    // Three different clocks, never merged.
    expect(Number.isFinite(Date.parse(manifest.times.capturedAt))).toBe(true);
    expect(manifest.times.capturedClock).toBe("device");
    expect(manifest.times.sourcePublishedAt).toBeNull();
    expect(manifest.times.sourcePublished).toBe("not_provided_by_source");
    expect(manifest.times.marketObservedAt).not.toBeNull();

    // Drawings: excluded and counted, and their content never enters the description.
    expect(manifest.layers.included).not.toContain("annotations");
    expect(manifest.layers.excluded).toEqual([{ layer: "annotations", count: DRAWINGS.length }]);
    expect(saved.text).not.toContain(PRIVATE_NOTE);
    expect(saved.text).not.toMatch(/owner|account|email|user_?id|token/i);

    // Including them is an explicit choice and recaptures; the description still holds a count only.
    await include.check();
    await waitForState(dialog, "ready");
    await expect(include).toBeChecked();
    await expect(dialog.getByTestId("chart-capture-layers")).toContainText("My drawings");
    const withDrawings = await saveAndRead(page, dialog);
    expect(withDrawings.manifest.layers.included).toContain("annotations");
    expect(withDrawings.manifest.layers.excluded).toEqual([]);
    expect(withDrawings.text).not.toContain(PRIVATE_NOTE);

    // The details file is the same description plus the image fingerprint.
    const detailsPromise = page.waitForEvent("download");
    await dialog.getByTestId("chart-capture-save-details").click();
    const details = await detailsPromise;
    expect(details.suggestedFilename()).toMatch(/^NVDA_.*\.json$/);
    const detailsJson = JSON.parse(readFileSync((await details.path())!, "utf8"));
    expect(detailsJson.instrument).toEqual(withDrawings.manifest.instrument);
    expect(detailsJson.image.sha256).toMatch(/^[0-9a-f]{64}$/);

    // A failed copy never reports sharing.
    await page.evaluate(() => {
      const clipboard = navigator.clipboard ?? ({} as Clipboard);
      Object.defineProperty(clipboard, "write", { configurable: true, value: () => Promise.reject(new Error("denied")) });
      if (!navigator.clipboard) Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard });
      if (typeof (window as unknown as { ClipboardItem?: unknown }).ClipboardItem === "undefined") {
        (window as unknown as { ClipboardItem: unknown }).ClipboardItem = class { constructor(public items: unknown) {} };
      }
    });
    await dialog.getByTestId("chart-capture-copy").click();
    const notice = dialog.getByTestId("chart-capture-notice");
    await expect(notice).toHaveText("Copy failed. Nothing was shared.");
    await expect(notice).toHaveAttribute("data-tone", "warn");

    expect(uploads.snapshotApi, "the review never calls the share-link upload").toEqual([]);
    expect(uploads.pngBodies, "no request body carries the image or its description").toEqual([]);

    // Escape closes the dialog and focus returns to a visible control rather than the page body.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && !!document.activeElement)).toBe(true);
  });

  test("a chart that moves during the composite is withheld, and a one-off move retries to the settled scene", async ({ page }) => {
    await openTerminal(page);
    const dialog = await openReview(page);
    await waitForState(dialog, "ready");
    const { manifest: settled } = await saveAndRead(page, dialog);
    const first = settled.data.firstBar!;
    const last = settled.data.lastBar!;
    expect(first).not.toBeNull();
    expect(last).not.toBeNull();
    // Every review attempt is one `mm:snapshot` request; count them.
    await page.evaluate(() => {
      const w = window as unknown as { __e19Attempts: number };
      w.__e19Attempts = 0;
      window.addEventListener("mm:snapshot", () => { w.__e19Attempts += 1; });
    });
    const attempts = async () => {
      const value = await page.evaluate(() => (window as unknown as { __e19Attempts: number }).__e19Attempts);
      await page.evaluate(() => { (window as unknown as { __e19Attempts: number }).__e19Attempts = 0; });
      return value;
    };
    const jump = (ts: string) => page.evaluate((target) => {
      window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { sym: "NVDA", ts: target } }));
    }, ts);

    // Persistent move: every attempt sees the visible range jump between raster and composite.
    await page.evaluate(({ from, to }) => {
      let flip = false;
      window.__mmCaptureMidHook = () => {
        flip = !flip;
        window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { sym: "NVDA", ts: flip ? from : to } }));
      };
    }, { from: first, to: last });
    await dialog.getByTestId("chart-capture-again").click();
    await waitForState(dialog, "withheld");
    await expect(dialog.getByTestId("chart-capture-state")).toHaveText(
      "The chart changed while it was being captured, so nothing was saved. Capture again.",
    );
    await expect(dialog.getByTestId("chart-capture-preview")).toHaveCount(0);
    await expect(dialog.getByTestId("chart-capture-save-image")).toBeDisabled();
    await expect(dialog.getByTestId("chart-capture-save-details")).toBeDisabled();
    await expect(dialog.getByTestId("chart-capture-copy")).toBeDisabled();
    expect(await attempts(), "a moving chart is retried, then withheld").toBe(5);

    // One-off move: park the chart at the start, then move it to the end once, mid-composite. The
    // first attempt is refused; the retry describes the scene it painted (the end), not the start.
    await page.evaluate(() => { window.__mmCaptureMidHook = undefined; });
    await jump(first);
    await page.evaluate((to) => {
      window.__mmCaptureMidHook = () => {
        window.__mmCaptureMidHook = undefined;
        window.dispatchEvent(new CustomEvent("mm:chart-jump", { detail: { sym: "NVDA", ts: to } }));
      };
    }, last);
    await attempts();
    await dialog.getByTestId("chart-capture-again").click();
    await waitForState(dialog, "ready");
    expect(await attempts(), "the moved attempt is refused and retried once").toBe(2);
    const retried = await saveAndRead(page, dialog);
    // Parked at the start, the view begins at the first bar; the moved view ends at (or, with
    // forward-projected studies, past) the last bar and begins well after the first.
    expect(retried.manifest.viewport.from! > first).toBe(true);
    expect(retried.manifest.viewport.to! >= last).toBe(true);
  });

  test("the review fits the viewport with full-size controls", async ({ page }) => {
    await openTerminal(page);
    const dialog = await openReview(page);
    await waitForState(dialog, "ready");
    const viewport = page.viewportSize()!;
    const sheet = dialog.locator(":scope > div").first();
    const box = await sheet.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await expectTapTarget(dialog.getByRole("button", { name: "Close" }), { width: 44, height: 44 });
    await expectTapTarget(dialog.locator("label").filter({ has: page.getByTestId("chart-capture-include-drawings") }), { height: 44 });
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    for (const id of ["chart-capture-again", "chart-capture-copy", "chart-capture-save-details", "chart-capture-save-image"]) {
      const control = dialog.getByTestId(id);
      await expect(control).toBeInViewport();
      await expectTapTarget(control, { height: coarse ? 44 : 40 });
    }
    // The preview is the saved image, legible at this size, and shown WHOLE: its frame never crops it.
    const previewImg = dialog.getByTestId("chart-capture-preview");
    const preview = await previewImg.boundingBox();
    expect(preview!.width).toBeGreaterThan(Math.min(300, viewport.width - 64));
    const fit = await previewImg.evaluate((img) => {
      const own = img.getBoundingClientRect();
      const frame = (img.parentElement as HTMLElement).getBoundingClientRect();
      return { top: own.top - frame.top, bottom: frame.bottom - own.bottom };
    });
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeGreaterThanOrEqual(0);
  });
});
