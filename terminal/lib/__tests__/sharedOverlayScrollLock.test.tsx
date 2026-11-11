// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShellDirectory from "@/components/chrome/shared-shell/ShellDirectory";
import MobileSheet from "@/components/ui/MobileSheet";
import MobileNavModal from "@/components/MobileNavModal";
import AnalysisHubSheet from "@/components/mobile/AnalysisHubSheet";
import GuidePanel from "@/components/GuidePanel";
import WatchlistEventPlanner from "@/components/events/WatchlistEventPlanner";
import { acquireScrollLock, __resetScrollLockForTests } from "@/lib/scrollLock";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useT: () => (key: string, fallback?: string) => fallback ?? key }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/guides/registry", () => ({ loadGuide: async () => null }));
vi.mock("@/components/guides/GuideVisual", () => ({ default: () => null }));
vi.mock("@/lib/sharedShellCopy", () => ({ useSharedShellT: () => (key: string) => key }));
vi.mock("@/lib/sharedShellRoutes", () => ({ sharedShellDirectory: [], sharedShellCatalog: { legacyPaths: [] } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let releases: Array<() => void>;
let restoreProperties: Array<() => void>;
function stubProperty(target: object, key: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, writable: true, value });
  restoreProperties.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else Reflect.deleteProperty(target, key);
  });
}
const surfaces = ["directory", "mobile-sheet", "mobile-navigation", "analysis-hub", "guide", "event-planner"] as const;
const noop = () => {};
const openerRef = { current: null };

beforeEach(() => {
  __resetScrollLockForTests();
  document.body.style.overflow = "clip";
  document.documentElement.style.overflow = "auto";
  releases = [];
  restoreProperties = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return false; },
  }));
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  stubProperty(HTMLElement.prototype, "scrollTo", noop);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  stubProperty(HTMLDialogElement.prototype, "showModal", function(this: HTMLDialogElement) { this.setAttribute("open", ""); });
  stubProperty(HTMLDialogElement.prototype, "close", function(this: HTMLDialogElement) { this.removeAttribute("open"); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const release of releases) release();
  host.remove();
  vi.unstubAllGlobals();
  for (const restore of restoreProperties.reverse()) restore();
  __resetScrollLockForTests();
  document.body.style.overflow = "";
  document.documentElement.style.overflow = "";
});
async function render(surface: typeof surfaces[number], open: boolean, keepMounted = false) {
  await act(async () => root.render(surface === "directory"
    ? <ShellDirectory open={open} onClose={noop} onSearchCompanies={noop} />
    : surface === "mobile-sheet"
      ? <MobileSheet open={open} keepMounted={keepMounted} title="Test sheet" onClose={noop}><button>Sheet action</button></MobileSheet>
      : surface === "analysis-hub"
        ? <AnalysisHubSheet open={open} onClose={noop} onAction={noop} replay={{ active: false, blockedReason: "no-data", title: "Replay" }} context={{ available: false, open: false, label: "Context" }} />
        : !open ? null : surface === "mobile-navigation"
          ? <MobileNavModal id="test-nav" label="Navigation" closeLabel="Close" openerRef={openerRef} onClose={noop}><nav className="m-nav"><button>Navigation action</button></nav></MobileNavModal>
          : surface === "guide"
            ? <GuidePanel suiteKey="structure" moduleKey="ms" moduleLabel="Structure" onClose={noop} />
            : <WatchlistEventPlanner lists={{ Empty: [] }} initialList="Empty" onClose={noop} onOpenCompany={noop} />));
}
function siblingLock() { const release = acquireScrollLock(); releases.push(release); return release; }
function expectLocked() {
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.documentElement.style.overflow).toBe("hidden");
}
function expectRestored() {
  expect(document.body.style.overflow).toBe("clip");
  expect(document.documentElement.style.overflow).toBe("auto");
}

describe("shared shell overlay scroll ownership", () => {
  it.each(surfaces)("keeps %s locked when an earlier overlay closes first", async surface => {
    const releaseSibling = siblingLock();
    await render(surface, true);
    releaseSibling();
    expectLocked();
    await render(surface, false);
    expectRestored();
  });
  it.each(surfaces)("does not unlock a later overlay when %s closes first", async surface => {
    await render(surface, true);
    const releaseSibling = siblingLock();
    await render(surface, false);
    expectLocked();
    releaseSibling();
    expectRestored();
  });
  it.each(surfaces)("locks both document scroll roots while %s is open", async surface => {
    await render(surface, true);
    expectLocked();
    await render(surface, false);
    expectRestored();
  });
  it("parking and re-presenting a mobile sheet keeps only its own share of the lock", async () => {
    await render("mobile-sheet", true, true);
    const releaseSibling = siblingLock();
    await render("mobile-sheet", false, true);
    expectLocked();
    await render("mobile-sheet", true, true);
    releaseSibling();
    expectLocked();
    await render("mobile-sheet", false, true);
    expectRestored();
  });
});