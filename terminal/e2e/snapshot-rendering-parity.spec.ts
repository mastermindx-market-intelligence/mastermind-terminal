import { expect, test, type Page } from "@playwright/test";

type Rgb = [number, number, number];
type SnapshotAction = "download" | "copy";

type SnapshotFrame = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
};

type SnapshotTextCall = {
  text: string;
  fillStyle: string;
  font: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type VisualReadyDetail = {
  symbol: string;
  timeframe: string;
  generation: number;
  state: "data" | "empty";
};

declare global {
  interface Window {
    __mmSnapshotFrames: SnapshotFrame[];
    __mmSnapshotTextCalls: SnapshotTextCall[];
    __mmSnapshotParityReady: VisualReadyDetail | null;
  }
}

function rgbFromCss(value: string): Rgb | null {
  const hex = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [
      Number.parseInt(hex[1].slice(0, 2), 16),
      Number.parseInt(hex[1].slice(2, 4), 16),
      Number.parseInt(hex[1].slice(4, 6), 16),
    ];
  }
  const rgb = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/i);
  return rgb ? [Math.round(Number(rgb[1])), Math.round(Number(rgb[2])), Math.round(Number(rgb[3]))] : null;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t)) as Rgb;
}

function colorDistance(a: Rgb | undefined, b: Rgb): number {
  if (!a) return Number.POSITIVE_INFINITY;
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])));
}

async function installSnapshotProbe(
  page: Page,
  options: { indicators?: string[]; settings?: Record<string, unknown> | null } = {},
): Promise<void> {
  await page.addInitScript(({ indicators, settings }) => {
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    const nativeFillText = CanvasRenderingContext2D.prototype.fillText;

    localStorage.setItem("mm.inds", JSON.stringify(indicators));
    localStorage.setItem("mm.startTf", JSON.stringify("D"));
    if (settings == null) localStorage.removeItem("mm.chartSettings");
    else localStorage.setItem("mm.chartSettings", JSON.stringify(settings));

    window.__mmSnapshotFrames = [];
    window.__mmSnapshotTextCalls = [];
    window.__mmSnapshotParityReady = null;

    // The product path still constructs ClipboardItem + calls clipboard.write. Make copy capture
    // deterministic in headless Chromium without changing the compositor or swallowing its blob.
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async () => undefined, writeText: async () => undefined },
    });
    if (!("ClipboardItem" in window)) {
      Object.defineProperty(window, "ClipboardItem", {
        configurable: true,
        value: class ClipboardItemFixture {
          constructor(public readonly items: Record<string, Blob>) {}
        },
      });
    }

    window.addEventListener("mm:terminal-visual-ready", (event) => {
      const detail = (event as CustomEvent<VisualReadyDetail>).detail;
      if (detail?.symbol === "NVDA" && detail.timeframe === "D" && detail.state === "data") {
        window.__mmSnapshotParityReady = detail;
      }
    });

    CanvasRenderingContext2D.prototype.fillText = function patchedFillText(text, x, y, maxWidth) {
      if (this.canvas.width >= 1_500 && this.canvas.height >= 900) {
        window.__mmSnapshotTextCalls.push({
          text: String(text),
          fillStyle: String(this.fillStyle),
          font: String(this.font),
          x,
          y,
          width: this.canvas.width,
          height: this.canvas.height,
        });
      }
      return maxWidth === undefined
        ? nativeFillText.call(this, text, x, y)
        : nativeFillText.call(this, text, x, y, maxWidth);
    };

    HTMLCanvasElement.prototype.toBlob = function patchedToBlob(callback, type, quality) {
      if (this.width >= 1_500 && this.height >= 900) {
        const context = this.getContext("2d");
        if (context) {
          window.__mmSnapshotFrames.push({
            width: this.width,
            height: this.height,
            pixels: new Uint8ClampedArray(context.getImageData(0, 0, this.width, this.height).data),
          });
        }
      }
      return nativeToBlob.call(this, callback, type, quality);
    };
  }, {
    indicators: options.indicators ?? ["ema"],
    settings: options.settings ?? null,
  });
}

async function waitForChart(page: Page): Promise<void> {
  await page.goto("/terminal?symbol=NVDA");
  await expect(page.locator(".workspace")).toBeVisible();
  await expect(page.locator(".chart-wrap canvas").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__mmSnapshotParityReady)).not.toBeNull();
}

async function takeSnapshot(page: Page, action: SnapshotAction): Promise<void> {
  const before = await page.evaluate(() => window.__mmSnapshotFrames.length);
  const downloadPromise = action === "download" ? page.waitForEvent("download") : null;
  await page.evaluate((captureAction) => {
    window.__mmSnapshotTextCalls = [];
    window.dispatchEvent(new CustomEvent("mm:snapshot", { detail: { action: captureAction } }));
  }, action);
  if (downloadPromise) await downloadPromise;
  await expect.poll(() => page.evaluate(() => window.__mmSnapshotFrames.length)).toBeGreaterThan(before);
}

async function readSnapshotProbe(page: Page, label: string): Promise<{
  dominant: Rgb | undefined;
  textCall: SnapshotTextCall | undefined;
}> {
  return page.evaluate(({ label: wanted }) => {
    const frame = window.__mmSnapshotFrames.at(-1);
    if (!frame) throw new Error("missing snapshot frame");

    const headerHeight = 104; // 52 CSS px × compositor scale 2
    const counts = new Map<string, number>();
    for (let y = headerHeight + 48; y < frame.height - 90; y += 6) {
      for (let x = 140; x < frame.width - 220; x += 6) {
        const index = (y * frame.width + x) * 4;
        const key = `${frame.pixels[index]},${frame.pixels[index + 1]},${frame.pixels[index + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      .split(",")
      .map(Number) as Rgb | undefined;
    const textCall = window.__mmSnapshotTextCalls.find((call) => call.text === wanted && call.y > headerHeight);
    return { dominant, textCall };
  }, { label });
}

test("download and copy inherit the live chart surface and indicator-title typography", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "One stable 2x canvas proves the shared compositor.");
  test.setTimeout(90_000);

  await installSnapshotProbe(page);
  await waitForChart(page);

  const liveName = page.locator(".lg-name:visible").first();
  await expect(liveName).toBeVisible();
  const live = await liveName.evaluate((name) => {
    const nameStyle = getComputedStyle(name);
    const pane = name.closest(".pane") as HTMLElement | null;
    const paneStyle = pane ? getComputedStyle(pane) : null;
    const root = getComputedStyle(document.documentElement);
    return {
      text: name.textContent?.trim() ?? "",
      color: nameStyle.color,
      fontSize: Number.parseFloat(nameStyle.fontSize),
      paneBackground: paneStyle?.backgroundColor ?? "",
      chartBackground: root.getPropertyValue("--chart-bg").trim(),
      pageBackground: root.getPropertyValue("--bg").trim(),
      brand: root.getPropertyValue("--brand-2").trim(),
    };
  });
  expect(live.text).not.toBe("");

  await takeSnapshot(page, "download");
  const downloaded = await readSnapshotProbe(page, live.text);

  const expectedSurface = rgbFromCss(live.paneBackground) ?? rgbFromCss(live.chartBackground);
  const pageBackground = rgbFromCss(live.pageBackground);
  const downloadedText = rgbFromCss(downloaded.textCall?.fillStyle ?? "");
  const liveText = rgbFromCss(live.color);
  const brand = rgbFromCss(live.brand);
  const downloadedFontSize = Number.parseFloat(downloaded.textCall?.font.match(/([\d.]+)px/)?.[1] ?? "NaN");

  expect(downloaded.dominant).toEqual(expectedSurface);
  expect(downloaded.dominant).not.toEqual(pageBackground);
  expect(downloadedText).toEqual(liveText);
  expect(downloadedText).not.toEqual(brand);
  expect(downloadedFontSize).toBeCloseTo(live.fontSize * 2, 0);

  await takeSnapshot(page, "copy");
  const copied = await readSnapshotProbe(page, live.text);
  expect(copied.dominant).toEqual(downloaded.dominant);
  expect(rgbFromCss(copied.textCall?.fillStyle ?? "")).toEqual(downloadedText);
  expect(copied.textCall?.font).toBe(downloaded.textCall?.font);
});

test("explicit chart gradients survive export and the header remains part of the same surface", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "One stable 2x canvas proves the shared compositor.");
  test.setTimeout(90_000);

  const topHex = "#25364a";
  const bottomHex = "#111827";
  await installSnapshotProbe(page, {
    indicators: [],
    settings: {
      backgroundType: "gradient",
      backgroundTop: topHex,
      backgroundBottom: bottomHex,
    },
  });
  await waitForChart(page);
  await takeSnapshot(page, "download");

  const sampled = await page.evaluate(() => {
    const frame = window.__mmSnapshotFrames.at(-1);
    if (!frame) throw new Error("missing snapshot frame");
    const modeAt = (y: number): Rgb | undefined => {
      const counts = new Map<string, number>();
      for (let x = 140; x < frame.width - 220; x += 3) {
        const index = (Math.round(y) * frame.width + x) * 4;
        const key = `${frame.pixels[index]},${frame.pixels[index + 1]},${frame.pixels[index + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0].split(",").map(Number) as Rgb | undefined;
    };
    const headerHeight = 104;
    return {
      width: frame.width,
      height: frame.height,
      header: modeAt(headerHeight / 2),
      bodyTop: modeAt(headerHeight + 30),
      bodyBottom: modeAt(frame.height - 90),
    };
  });

  const top = rgbFromCss(topHex)!;
  const bottom = rgbFromCss(bottomHex)!;
  const bodyHeight = sampled.height - 104;
  const expectedTop = mixRgb(top, bottom, 30 / bodyHeight);
  const expectedBottom = mixRgb(top, bottom, (bodyHeight - 90) / bodyHeight);
  const expectedHeader = mixRgb(top, [4, 7, 13], 0.16);

  expect(colorDistance(sampled.bodyTop, expectedTop)).toBeLessThanOrEqual(4);
  expect(colorDistance(sampled.bodyBottom, expectedBottom)).toBeLessThanOrEqual(4);
  expect(colorDistance(sampled.header, expectedHeader)).toBeLessThanOrEqual(4);
  expect(sampled.header).not.toEqual(rgbFromCss("#0a0b0e"));
});
