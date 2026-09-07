import { expect, type Locator, type Page } from "@playwright/test";
import { settled } from "../settle";
import { panSampleOk, type PanSample } from "./panTravel";

export { panSampleOk, panSampleSame, panTravelError, panTravelOk, type PanSample } from "./panTravel";

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

export type HoverLabelSample = {
  visible: boolean;
  text: string;
  box: Box | null;
};

/**
 * Hosted Shape A (job 101689653547 retry 1): `.mm-hovertag` exists with leftover
 * price text (`192.74`) but `display:none`. The previous settle accepted
 * `!!textContent` and then `toBeVisible()` / boundingBox failed. Leftover text
 * on a hidden tag is not a laid-out label.
 */
export function hoverLabelOk(sample: HoverLabelSample): boolean {
  return sample.visible && sample.text.trim() !== "" && isBox(sample.box);
}

export function hoverLabelSame(prev: HoverLabelSample, next: HoverLabelSample): boolean {
  if (!hoverLabelOk(prev) || !hoverLabelOk(next) || prev.box == null || next.box == null) return false;
  return Math.round(prev.box.x) === Math.round(next.box.x)
    && Math.round(prev.box.y) === Math.round(next.box.y)
    && Math.round(prev.box.width) === Math.round(next.box.width)
    && Math.round(prev.box.height) === Math.round(next.box.height)
    && prev.text === next.text;
}

/**
 * Re-issue a pointer move until `.mm-hovertag` is visible with a stable box.
 * Always drives — a late crosshair-leave can hide the tag after leftover text
 * was written (ChartPanel.tsx refreshHoverTag keeps textContent on display:none).
 */
export async function settledHoverLabel(
  page: Page,
  opts: {
    move: () => Promise<void>;
    locator?: Locator;
    message?: string;
  },
): Promise<HoverLabelSample> {
  const locator = opts.locator ?? page.locator(".mm-hovertag");
  return settled({
    // Do not poke a label that already passed — a two-step or late move can
    // hide it again before the next `same` sample (local 4× throttle).
    drive: async (last) => { if (last && hoverLabelOk(last)) return; await opts.move(); },
    read: async () => {
      const visible = await locator.isVisible().catch(() => false);
      const text = (await locator.textContent().catch(() => "")) ?? "";
      if (!visible) return { visible: false, text, box: null };
      return { visible, text, box: await locator.boundingBox() };
    },
    ok: hoverLabelOk,
    same: hoverLabelSame,
    timeout: 45_000,
    message: opts.message ?? "the hover label should stay visible with a stable box",
  });
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

/**
 * Wait until one overlay sample is inside slack and lockstep, and return THAT
 * sample. Do not re-read afterwards — that is the settle.ts:8-14 anti-pattern
 * (poll `> dx * 0.5`, then one-shot `|moved - dx|`).
 *
 * `settled()`'s `same` is the wrong tool here: the overlay re-lays every frame,
 * so rounded-equal pairs never land (10/10 timeouts on b706144's post-up wait).
 */
export async function settledPanSample(
  read: () => Promise<PanSample>,
  dx: number,
  message: string,
): Promise<PanSample> {
  const held: { sample: PanSample | null } = { sample: null };
  await expect.poll(async () => {
    held.sample = await read();
    return held.sample != null && panSampleOk(held.sample, dx);
  }, {
    timeout: 20_000,
    intervals: [40, 80, 120, 200],
    message,
  }).toBe(true);
  if (held.sample == null) {
    throw new Error(message);
  }
  return held.sample;
}

/**
 * One chart drag. A drag is not idempotent — unlike #533's More-menu click it
 * cannot be re-issued through `settled.drive` without stacking pans.
 *
 * Lightweight Charts 5.2.0 binds `documentElement` `mousemove` synchronously
 * inside `_private__mouseDownHandler` (standalone.development.js:8736-8743).
 * The flake is not "listener missing until two rAF ticks". Hosted and local
 * failures print `|moved - dx|` (job 101657271576 Received 115.85 at
 * marker-tooltip.spec.ts:388; job 101553532995 Received 122.11 / 125.15 at
 * indicator-prim-tooltip.spec.ts:310; local repeat4 Received 89.21). A poll
 * that only clears `dx * 0.5` then one-shots `after` is the anti-pattern
 * e2e/settle.ts:8-14 exists to stop.
 *
 * Sequence: attached stable box → down → two paint frames (not a listener
 * bind — that is synchronous) → first move → poll until the pixel pan
 * witness changes → remaining move → poll until travel is inside slack,
 * still down → up. Bounded timeouts, no bare sleeps. Callers must pass
 * a pixel `readOffset` (overlay cx). There is no fallback onto
 * `__mmChartAxisOpts().visibleRange.from` — that is a logical bar index
 * (ChartPanel.tsx:3169), not a pan offset.
 */
export async function settledChartDrag(
  page: Page,
  opts: {
    locator: Locator;
    from: { x: number; y: number };
    to: { x: number; y: number };
    readOffset: () => Promise<number | null>;
    message?: string;
  },
): Promise<void> {
  const { locator, from, to, readOffset } = opts;
  const dx = to.x - from.x;

  await waitForAttachedStableBox(locator);
  const start = await readOffset();
  expect(start, "a pan offset should be readable before the drag starts").not.toBeNull();
  expect(Number.isFinite(start), "a pan offset should be a finite pixel reading before the drag starts").toBe(true);

  const sign = Math.sign(dx) || 1;
  const distance = Math.abs(dx);
  const first = Math.min(40, Math.max(8, distance));

  const travel = async () => {
    const now = await readOffset();
    if (start == null || now == null) return 0;
    return Math.abs(now - start);
  };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Yield two paint frames after down so the first move is a distinct event.
  // Not a listener-bind wait — LWC attaches mousemove synchronously on down.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  try {
    let sent = first;
    await page.mouse.move(from.x + sign * sent, from.y, { steps: 3 });
    await expect.poll(travel, {
      timeout: 8_000,
      intervals: [40, 60, 80, 120],
      message: opts.message ?? "the chart should acknowledge the first drag move",
    }).toBeGreaterThan(8);
    while (sent < distance) {
      const before = await travel();
      sent = Math.min(distance, sent + 40);
      await page.mouse.move(from.x + sign * sent, from.y, { steps: 3 });
      await expect.poll(travel, {
        timeout: 8_000,
        intervals: [40, 60, 80, 120],
        message: "the chart should acknowledge the next drag step",
      }).toBeGreaterThan(before + 4);
    }
    if (from.y !== to.y) {
      await page.mouse.move(to.x, to.y, { steps: 3 });
    }
    // Stay down until travel is inside slack. Releasing on a mid-pan frame is
    // what left local repeat4 at ~91px (|moved-dx|=89.2) after a poll that
    // only required `> dx * 0.5`.
    await expect.poll(travel, {
      timeout: 8_000,
      intervals: [40, 60, 80, 120],
      message: "the chart should finish the drag before the pointer is released",
    }).toBeGreaterThan(distance * (1 - 0.35));
  } finally {
    await page.mouse.up();
  }
}
