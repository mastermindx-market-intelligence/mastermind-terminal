// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WatchlistAnnotationSync from "@/components/watchlist/WatchlistAnnotationSync";
import { LangProvider } from "@/lib/i18n";
import { watchlistOwnerKey, WL_NOTES_KEY } from "@/lib/watchlistOwner";
import { ANNOTATION_SCHEMA_VERSION } from "@/lib/watchlistAnnotations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const read = vi.fn();

function Harness() {
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  return <LangProvider><WatchlistAnnotationSync owner={watchlistOwnerKey("focus-proof-user")} ready
    flags={flags} notes={notes} setFlags={setFlags} setNotes={setNotes} /></LangProvider>;
}

beforeEach(() => {
  localStorage.clear(); document.documentElement.setAttribute("data-lang", "en");
  localStorage.setItem(WL_NOTES_KEY, JSON.stringify({ guest: { NVDA: "Unimported focus proof note" } }));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  read.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => ({ schemaVersion: ANNOTATION_SCHEMA_VERSION, annotations: [], complete: true }) });
  vi.stubGlobal("fetch", read);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("keeps the chosen import-preview action focused through a background annotation refresh", async () => {
  await act(async () => root.render(<Harness />));
  const offer = host.querySelector<HTMLButtonElement>('[data-testid="wl-annotation-import"]')!;
  expect(offer).not.toBeNull();
  await act(async () => offer.click());
  const dialog = document.querySelector<HTMLElement>('[data-testid="wl-annotation-import-dialog"]')!;
  const later = [...dialog.querySelectorAll("button")].find(button => button.textContent === "Not now")!;
  later.focus(); expect(document.activeElement).toBe(later);
  const readsBefore = read.mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(read.mock.calls.length).toBeGreaterThan(readsBefore);
  expect(document.activeElement).toBe(later);
  await act(async () => later.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[data-testid="wl-annotation-import-dialog"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem(WL_NOTES_KEY)!).guest.NVDA).toBe("Unimported focus proof note");
  expect(read.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});
