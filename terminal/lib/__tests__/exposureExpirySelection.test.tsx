// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ExposureMap from "@/components/exposure-map/ExposureMap";
import qqq from "./fixtures/exposure-native-qqq-observed-v2.json";

const locale = vi.hoisted(() => ({ lang: "en" }));
vi.mock("@/lib/i18n", () => ({ useLang: () => locale }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/components/exposure-map/ExposureDivergence", () => ({ default: () => null }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "guest" }) }));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: () => {} }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => false }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: async () => ({ kind: "unavailable" }) }));
const spyBook = { root: "SPY", asof: "2026-10-16", spot_ref: 100,
  by_strike: [{ strike: 100, gamma_net: 1 }], by_expiry: [{ exp: "2026-10-21" }, { exp: "2026-10-23" }] };
let host: HTMLDivElement, view: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-21T00:00Z"));
  host = document.createElement("div"); document.body.append(host); view = createRoot(host);
});
afterEach(() => { act(() => view.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const picker = () => host.querySelector("select")!;
function choose(value: string) {
  act(() => { picker().value = value; picker().dispatchEvent(new Event("change", { bubbles: true })); });
}
function mount(root: string, source: unknown, sourceStatus: "data" | "loading" = "data", archivedSession?: string) {
  act(() => view.render(<ExposureMap root={root} source={source} sourceStatus={sourceStatus} archivedSession={archivedSession} matrix={null} />));
}
it.each(["en", "zh"])("keeps the requested date visible and requires an explicit broader read (%s)", lang => {
  locale.lang = lang; mount("SPY", spyBook); choose("2026-10-21");
  mount("QQQ", null, "loading");
  expect(picker().value).toBe("2026-10-21");
  expect(picker().selectedOptions[0].textContent).toContain(lang === "en" ? "Requested expiry" : "所选到期日");
  mount("QQQ", qqq);
  expect(picker().value).toBe("2026-10-21");
  expect(picker().selectedOptions[0].textContent).toContain(lang === "en" ? "Not listed in this book" : "此快照未列出");
  expect(host.querySelectorAll("tbody tr[aria-selected]")).toHaveLength(0);
  const recover = [...host.querySelectorAll("button")].find(b => b.textContent === (lang === "en" ? "Show all expiries" : "显示所有到期日"));
  expect(recover).toBeDefined();
  act(() => recover!.click());
  expect(picker().value).toBe("all");
  expect(host.querySelectorAll("tbody tr[aria-selected]").length).toBeGreaterThan(0);
});
it("keeps an explicit expiry that is also offered by the next root", () => {
  locale.lang = "en"; mount("SPY", spyBook); choose("2026-10-23"); mount("QQQ", qqq);
  expect(picker().value).toBe("2026-10-23");
  expect(picker().selectedOptions[0].disabled).toBe(false);
  expect(picker().selectedOptions[0].textContent).toBe("2026-10-23");
  expect(host.textContent).not.toContain("Show all expiries");
});


it("withdraws an unlisted expiry in an archived session and restores the original selection on return", () => {
  locale.lang = "en"; mount("SPY", spyBook); choose("2026-10-23");
  const archived = { ...spyBook, asof: "2026-10-15", by_expiry: [{ exp: "2026-10-21" }] };
  mount("SPY", archived, "data", archived.asof);
  expect(picker().selectedOptions[0].textContent).toBe("2026-10-23 · Not listed in this book");
  mount("SPY", spyBook);
  expect(picker().selectedOptions[0].textContent).toBe("2026-10-23");
  expect(picker().selectedOptions[0].disabled).toBe(false);
});
