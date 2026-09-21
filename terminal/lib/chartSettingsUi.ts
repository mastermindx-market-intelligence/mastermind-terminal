/** Browser-only chart preferences. No chart/feed/indicator math and no dependencies. */
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
  const focusSelectedTab = () => dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  focusSelectedTab();
  // Pointer-opened chart menus finish their own dismissal during the same frame.
  // Settle that handoff once; never steal focus after the user enters a control.
  const focusFrame = requestAnimationFrame(() => {
    if (dialog.open && !dialog.contains(document.activeElement)) focusSelectedTab();
  });
  return () => {
    cancelAnimationFrame(focusFrame);
    dialog.close();
    if (!document.querySelector("dialog[open]")) {
      if (document.body.style.overflow === "hidden") document.body.style.overflow = previousOverflow;
      const target = opener?.isConnected ? opener : returnFocusTo;
      if (target?.isConnected) target.focus({ preventScroll: true });
    }
  };
}
