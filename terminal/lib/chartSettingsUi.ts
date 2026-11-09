import type { ChartSettings } from "@/components/ChartFrameBar";
import { parseCssColor } from "./chart-engine/canvas/priceAxis";
import { readablePriceTagTextColor } from "./priceTagPlacement";

/** Browser-only chart preferences and render appearance. No chart/feed/indicator math. */
export function colorInputHex(value: string, fallback = "#000000"): string {
  const hex = (input: string): string | null => {
    const s = input.trim();
    if (/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(s)) return s.slice(0, 7).toLowerCase();
    if (/^#[\da-f]{3,4}$/i.test(s)) return "#" + s.slice(1, 4).split("").map((c) => c + c).join("").toLowerCase();
    const rgb = s.match(/^rgba?\(\s*([\d.]+%?)[,\s]+([\d.]+%?)[,\s]+([\d.]+%?)(?:\s*[,/]\s*[\d.]+%?)?\s*\)$/i);
    if (!rgb) return null;
    const channels = rgb.slice(1, 4).map((c) => c.endsWith("%") ? Number.parseFloat(c) / 100 * 255 : Number.parseFloat(c));
    if (channels.some((n) => !Number.isFinite(n))) return null;
    return "#" + channels.map((n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")).join("");
  };
  // Keep the swatch's original alpha. Native type=color receives only opaque sRGB.
  return hex(value) ?? hex(fallback) ?? "#000000";
}

export function previewNumber(raw: string, min: number, max: number): number | null {
  if (!raw.trim()) return null;
  const number = Number(raw);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

export function commitNumber(raw: string, previous: number, min: number, max: number): number {
  if (!raw.trim()) return previous;
  const number = Number(raw);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : previous;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Recover valid fields from old templates; never spread arbitrary stored keys into settings. */
export function parseSettingTemplates<T extends object>(raw: string | null, defaults: T): Record<string, Partial<T>> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (!record(parsed)) return {};
    const known = defaults as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, entry]) => record(entry)).map(([name, entry]) => [
      name,
      Object.fromEntries(Object.entries(entry as Record<string, unknown>).filter(([key, value]) =>
        Object.hasOwn(known, key) && typeof value === typeof known[key]
          && (typeof value !== "number" || Number.isFinite(value)))),
    ])) as Record<string, Partial<T>>;
  } catch { return {}; }
}

/** This is an ephemeral native-dialog lifecycle, not a second chart settings owner. */
export function activateSettingsDialog(dialog: HTMLDialogElement, returnFocusTo?: HTMLElement | null): () => void {
  const active = document.activeElement;
  // Pointer-opened menu items may disappear before the dialog mounts, leaving body focused.
  const opener = active instanceof HTMLElement && active !== document.body && active !== document.documentElement ? active : returnFocusTo;
  const previousOverflow = document.body.style.overflow;
  dialog.showModal();
  document.body.style.overflow = "hidden";
  // Native modality makes the page inert, but Chromium can send Tab from the
  // last control to browser chrome. Keep sequential settings navigation cyclic.
  const wrapTab = (event: KeyboardEvent) => {
    if (event.key !== "Tab" || event.defaultPrevented) return;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex], [contenteditable="true"]',
    )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled")
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const first = controls[0], last = controls.at(-1);
    const current = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
      dialog.focus({ preventScroll: true });
    } else if (event.shiftKey && (current === first || current === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };
  dialog.addEventListener("keydown", wrapTab);
  const focusSelectedTab = () => dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  focusSelectedTab();
  // Pointer-opened chart menus finish their own dismissal during the same frame.
  // Settle that handoff once; never steal focus after the user enters a control.
  const focusFrame = requestAnimationFrame(() => {
    if (dialog.open && !dialog.contains(document.activeElement)) focusSelectedTab();
  });
  return () => {
    cancelAnimationFrame(focusFrame);
    dialog.removeEventListener("keydown", wrapTab);
    dialog.close();
    if (!document.querySelector("dialog[open]")) {
      if (document.body.style.overflow === "hidden") document.body.style.overflow = previousOverflow;
      const target = opener?.isConnected ? opener : returnFocusTo;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
  };
}


/** Render policy only. Empty factory colours remain transparent/inherit while
 * their host follows the selected material; nonempty saved colours remain exact. An equal default is not proof
 * a user never edited it. This never writes settings or chart/view state. */
export function resolveChartAppearance(settings: Partial<Pick<ChartSettings, "backgroundTop" | "backgroundBottom">>, light: boolean,
  tokens: { panel: string; chartBackground: string; axis: string; grid: string; line: string; text: string }) {
  const backgroundTop = settings.backgroundTop || "transparent";
  const backgroundBottom = settings.backgroundBottom || backgroundTop;
  const foregroundBase = parseCssColor(backgroundTop), host = parseCssColor(light ? tokens.panel : tokens.chartBackground);
  const frame = foregroundBase && host
    ? foregroundBase.slice(0, 3).map((channel, i) => Math.round(channel * foregroundBase[3] + host[i] * (1 - foregroundBase[3]))) : null;
  const frameBackground = frame ? `rgb(${frame.join(", ")})` : (light ? tokens.panel : tokens.chartBackground);
  const ink = light ? readablePriceTagTextColor(frameBackground) : undefined;
  return { backgroundTop, backgroundBottom, frameBackground,
    headerInk: light && settings.backgroundTop ? ink : undefined,
    axis: light ? (settings.backgroundTop ? ink! : tokens.text) : tokens.axis,
    grid: light && ink !== "#fff" ? tokens.line : tokens.grid };
}

/** Contrast for the existing translucent legend row over its actual frame.
 * Colours come from those existing layers; no new palette or preference field. */
export function chartLegendInk(frameBackground: string, rowBackground: string) {
  const frame = parseCssColor(frameBackground), row = parseCssColor(rowBackground);
  if (!frame || !row) return undefined;
  const composed = row.slice(0, 3).map((channel, i) => Math.round(channel * row[3] + frame[i] * (1 - row[3])));
  return readablePriceTagTextColor(`rgb(${composed.join(", ")})`);
}
