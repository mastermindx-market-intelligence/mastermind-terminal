// @vitest-environment jsdom
/**
 * The Portfolio workspace and the admitted sector context.
 *
 * Covered against the REAL PortfolioWorkspace, the REAL admitted-context parser and the REAL
 * section machinery:
 *   - the Portfolio still defaults to its Overview section;
 *   - an admitted sector→Portfolio context applies the Risk section and renders the selected
 *     sector there, once and only for that context;
 *   - a foreign, malformed, duplicated or absent context leaves the ordinary Portfolio
 *     untouched — no Risk section, no selected-sector block;
 *   - the section change is reported through the incumbent's own section signal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LangProvider } from "@/lib/i18n";
import { bookTotals, type Position } from "@/lib/portfolio";
import { DEFAULT_SECTOR_STATE } from "@/lib/sectorIntelligence";
import { sectorPortfolioHref } from "@/lib/sectorPortfolioContext";
import PortfolioWorkspace from "@/components/PortfolioWorkspace";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({
  useOptionalSharedShellPresentation: () => null,
}));
// jsdom has no app router; the anchor is the link a reader actually follows.
vi.mock("next/link", () => ({
  default: (props: { href: string; children?: ReactNode; className?: string; [key: string]: unknown }) =>
    createElement("a", props, props.children),
}));

const POSITIONS: Position[] = [
  { id: "pos-xlk", ticker: "XLK", shares: 10, entryPrice: 100, entryCurrency: "USD",
    entryDate: null, notes: null, status: "open", createdAt: null },
];
const QUOTES = { XLK: { last: 120, chg: 1, currency: "USD" } };
const MANIFEST = { XLK: { name: "Technology Select Sector SPDR", zh: "科技行业SPDR", last: 120, chg: 1, currency: "USD" } };
const TOTALS = bookTotals(POSITIONS, QUOTES, MANIFEST);

const baseProps = () => ({
  positions: POSITIONS, quotes: QUOTES, manifest: MANIFEST, totals: TOTALS, risk: null,
  unreadable: false, stale: false, retrying: false, lastChecked: null, failure: null,
  busyId: null, confirmDelete: null,
  riskContent: createElement("p", null, "market risk"), historyContent: createElement("p", null, "history"),
  targetsContent: createElement("p", null, "targets"), briefContent: createElement("p", null, "brief"),
  eventContent: createElement("p", null, "events"),
  onRetry: () => {}, onAdd: () => {}, onEdit: () => {}, onToggleStatus: () => {},
  onDeleteRequest: () => {}, onDeleteCancel: () => {}, onDeleteConfirm: () => {},
  onSectionChange: vi.fn(),
});

describe("the Portfolio workspace and the admitted sector context", () => {
  let root: Root, host: HTMLDivElement;

  const render = async (props = baseProps()) => {
    await act(async () => root.render(<LangProvider><PortfolioWorkspace {...props} /></LangProvider>));
  };

  const tab = (key: string) => host.querySelector(`#portfolio-tab-${key}`)!;
  const panel = (key: string) => host.querySelector(`#portfolio-panel-${key}`)!;
  const sectorBlock = () => host.querySelector('[data-testid="portfolio-sector-context"]');

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
    window.history.replaceState({}, "", "/portfolio");
    vi.restoreAllMocks();
  });

  it("keeps the Overview section when the address carries no context", async () => {
    window.history.replaceState({}, "", "/portfolio");
    await render();
    expect(tab("overview").getAttribute("aria-selected")).toBe("true");
    expect(panel("overview").hasAttribute("hidden")).toBe(false);
    expect(sectorBlock()).toBeNull();
  });

  it("applies the Risk section for an admitted context and renders the selected sector there", async () => {
    const href = sectorPortfolioHref("XLK", { ...DEFAULT_SECTOR_STATE })!;
    window.history.replaceState({}, "", href);
    const props = baseProps();
    await render(props);
    expect(tab("risk").getAttribute("aria-selected")).toBe("true");
    expect(panel("risk").hasAttribute("hidden")).toBe(false);
    expect(panel("overview").hasAttribute("hidden")).toBe(true);
    expect(sectorBlock()?.getAttribute("data-etf")).toBe("XLK");
    expect(props.onSectionChange).toHaveBeenCalledWith("risk");
  });

  it("signals the effective section and gives new context its own Risk landing", async () => {
    window.history.replaceState({}, "", sectorPortfolioHref("XLK", { ...DEFAULT_SECTOR_STATE })!);
    const props = baseProps();
    await render(props);
    await act(async () => { (tab("holdings") as HTMLButtonElement).click(); });
    expect(tab("holdings").getAttribute("aria-selected")).toBe("true");
    vi.mocked(props.onSectionChange).mockClear();
    await render({ ...props, positions: [...props.positions] });
    expect(props.onSectionChange).not.toHaveBeenCalledWith("risk");
    await act(async () => {
      window.history.replaceState({}, "", sectorPortfolioHref("XLE", { ...DEFAULT_SECTOR_STATE, sector: "xle" })!);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await render(props);
    expect(tab("risk").getAttribute("aria-selected")).toBe("true");
    expect(props.onSectionChange).toHaveBeenCalledWith("risk");
  });

  it.each([
    ["a foreign sector", "/portfolio?sector=SPY&sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a malformed sector", "/portfolio?sector=xlk&sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a duplicated identity", "/portfolio?sector=XLK&sector=XLE&sectorReturn=sectorWorkspace%3Ddiscover"],
    ["a duplicated snapshot", "/portfolio?sector=XLK&sectorReturn=sectorWorkspace%3Ddiscover&sectorReturn=sectorWorkspace%3Drotation"],
    ["a noncanonical snapshot", "/portfolio?sector=XLK&sectorReturn=sectorWorkspace%3Ddiscover%26extra%3D1"],
    ["no context at all", "/portfolio"],
  ])("leaves the ordinary Portfolio untouched for %s", async (_label, href) => {
    window.history.replaceState({}, "", href);
    await render();
    expect(tab("overview").getAttribute("aria-selected")).toBe("true");
    expect(panel("risk").hasAttribute("hidden")).toBe(true);
    expect(sectorBlock()).toBeNull();
  });

  it("keeps the selected sector's evidence available when the book itself cannot be read", async () => {
    const href = sectorPortfolioHref("XLK", { ...DEFAULT_SECTOR_STATE })!;
    window.history.replaceState({}, "", href);
    await render({ ...baseProps(), unreadable: true, positions: [] });
    expect(host.querySelector('[data-testid="portfolio-unreadable"]')).not.toBeNull();
    expect(sectorBlock()?.getAttribute("data-etf")).toBe("XLK");
    // The book proved nothing, so no number is claimed in either direction.
    expect(host.querySelector('[data-testid="portfolio-sector-weight"]')).toBeNull();
    expect(host.querySelector('[data-testid="portfolio-sector-weight-unavailable"]')?.getAttribute("data-gap"))
      .toBe("unreadable");
    expect(host.querySelector('[data-testid="portfolio-sector-no-record"]')).toBeNull();
  });
});
