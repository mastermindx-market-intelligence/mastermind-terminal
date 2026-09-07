import { expect, type Locator, type Page } from "@playwright/test";
import { settled } from "../settle";

// Shared settled-interaction helpers. Not a spec file — Playwright's default testMatch only
// collects *.spec.ts, so this module is imported, never run.
//
// `settled` itself lives in e2e/settle.ts (the repo's existing helper). Re-export it so
// crosshair-price-label.spec.ts can switch import path without duplicating the poller or
// changing #533's behaviour.

export { settled };

type Box = { x: number; y: number; width: number; height: number };

function isBox(value: Box | null): value is Box {
  return value != null && value.width > 0 && value.height > 0;
}

/** Re-resolve a locator and wait until it is attached with a box that repeats. */
export async function waitForAttachedStableBox(
  locator: Locator,
  message = "the interaction target should stay attached with a stable box",
): Promise<Box> {
  await locator.waitFor({ state: "attached" });
  const box = await settled({
    read: async () => {
      if ((await locator.count()) === 0) return null;
      const connected = await locator.evaluate((el) => el.isConnected).catch(() => false);
      if (!connected) return null;
      return locator.boundingBox();
    },
    ok: isBox,
    same: (prev, next) => isBox(prev) && isBox(next)
      && Math.round(prev.x) === Math.round(next.x)
      && Math.round(prev.y) === Math.round(next.y)
      && Math.round(prev.width) === Math.round(next.width)
      && Math.round(prev.height) === Math.round(next.height),
    message,
  });
  expect(box, message).not.toBeNull();
  return box as Box;
}

function chartPanOffset(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const state = (window as Window & {
      __mmChartAxisOpts?: () => {
        visibleRange?: { from: number; to: number } | null;
        lastBarX?: number | null;
      } | null;
    }).__mmChartAxisOpts?.();
    const from = state?.visibleRange?.from;
    if (typeof from === "number" && Number.isFinite(from)) return from;
    const x = state?.lastBarX;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  });
}

async function frames(page: Page, count = 2): Promise<void> {
  await page.evaluate((n) => new Promise<void>((resolve) => {
    const tick = (left: number) => {
      if (left <= 0) { resolve(); return; }
      requestAnimationFrame(() => tick(left - 1));
    };
    tick(n);
  }), count);
}

/**
 * One chart drag. A drag is not idempotent — unlike #533's More-menu click it
 * cannot be re-issued through `settled.drive` without stacking pans.
 *
 * Sequence: attached stable box → down → two frames (LWC binds its document
 * pressed-move listener in mousedown) → first move → poll until the pan offset
 * changes → remaining move → up. Hosted shards applied only ~60–70% of a
 * one-shot `mouse.move({ steps: 15 })` (`marker-tooltip` :388 on job
 * 101657271576; `indicator-prim-tooltip` :310 on job 101553532995) when the
 * first events landed before that listener existed.
 */
export async function settledChartDrag(
  page: Page,
  opts: {
    locator: Locator;
    from: { x: number; y: number };
    to: { x: number; y: number };
    readOffset?: () => Promise<number | null>;
    message?: string;
  },
): Promise<void> {
  const { locator, from, to } = opts;
  const readOffset = async () => {
    const extra = opts.readOffset ? await opts.readOffset() : null;
    if (extra != null && Number.isFinite(extra)) return extra;
    return chartPanOffset(page);
  };

  await waitForAttachedStableBox(locator);
  const start = await readOffset();
  expect(start, "a pan offset should be readable before the drag starts").not.toBeNull();

  const sign = Math.sign(to.x - from.x) || 1;
  const distance = Math.abs(to.x - from.x);
  const first = Math.min(40, Math.max(8, distance));

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await frames(page, 2);
  try {
    await page.mouse.move(from.x + sign * first, from.y, { steps: 3 });
    await expect.poll(async () => {
      const now = await readOffset();
      if (start == null || now == null) return 0;
      return Math.abs(now - start);
    }, {
      timeout: 8_000,
      intervals: [40, 60, 80, 120],
      message: opts.message ?? "the chart should acknowledge the first drag move",
    }).toBeGreaterThan(8);
    if (first < distance || from.y !== to.y) {
      await page.mouse.move(to.x, to.y, { steps: 10 });
    }
  } finally {
    await page.mouse.up();
  }
}
