// @vitest-environment jsdom
/**
 * C1 navigation wiring for the Portfolio workspace — links only, no behaviour change beyond them.
 *
 * Covered, against the REAL PortfolioWorkspace, the REAL EN/ZH copy tuples and the REAL portfolio
 * math (bookTotals):
 *   - the holdings table lists a supported hyphenated ticker (BRK-B) with its terminal link;
 *   - ordinary shell mode keeps the classic `/terminal?sym=<encoded>` href in the table and in the
 *     record dialog's chart action, and the company action stays
 *     `/analysis?symbol=<encoded>&page=overview` (from companyHref, unchanged);
 *   - beta shared-shell mode routes BOTH terminal links through sharedShellTerminalHref with the
 *     CURRENT presentation URL — query and hash preserved — exactly as the helper contract states;
 *   - rendering without a window (SSR) keeps the classic deep link even when the shared shell is
 *     present;
 *   - the renamed labels render: "Open company analysis"/"打开公司分析" and
 *     "Open current chart"/"打开当前图表";
 *   - an unsupported company symbol contributes no research link, and its chart action survives.
 *
 * Mocks are limited to the optional shared-shell presentation hook (per mode) and a passthrough
 * Next Link (jsdom has no app router). No network, no auth, no mutation.
 */
import { beforeEach, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { bookTotals, type Position } from "@/lib/portfolio";
import { LangProvider } from "@/lib/i18n";
import PortfolioWorkspace from "@/components/PortfolioWorkspace";

type WorkspaceProps = Parameters<typeof PortfolioWorkspace>[0];

const shell = vi.hoisted(() => ({ presentation: null as unknown }));

// Only the presence of the beta shared shell matters to the links; a truthy presentation object is
// the whole contract the workspace is allowed to rely on.
vi.mock("@/components/chrome/shared-shell/SharedShellPresentation", () => ({
  useOptionalSharedShellPresentation: () => shell.presentation,
}));

// jsdom has no app router; render next/link as the anchor it becomes so href assertions hold.
vi.mock("next/link", () => ({
  default: (props: { href: string; className?: string; children?: ReactNode }) =>
    createElement("a", { href: props.href, className: props.className }, props.children),
}));

const SYMBOL = "BRK-B";
const UNSUPPORTED = "BAD\u0007TICK"; // rejected by any sane company-symbol validator (control char)

const POSITIONS: Position[] = [
  {
    id: "pos-company", ticker: SYMBOL, shares: 100, entryPrice: 300, entryCurrency: "HKD",
    entryDate: "2026-01-05", notes: "core desk holding", status: "open", createdAt: "2026-01-05T08:00:00.000Z",
  },
  {
    id: "pos-odd", ticker: UNSUPPORTED, shares: 10, entryPrice: 12.5, entryCurrency: "USD",
    entryDate: null, notes: null, status: "open", createdAt: "2026-02-01T08:00:00.000Z",
  },
];

const QUOTES = {
  [SYMBOL]: { last: 320, chg: 1.2, currency: "HKD" },
  [UNSUPPORTED]: { last: 12.5, chg: -0.4, currency: "USD" },
};

const MANIFEST = {
  [SYMBOL]: { name: "Berkshire Hathaway", zh: "伯克希尔哈撒韦", last: 320, chg: 1.2, currency: "HKD" },
  [UNSUPPORTED]: { name: "Unlisted", last: 12.5, chg: -0.4, currency: "USD" },
};

// Real book totals — the workspace renders these on the overview panel.
const TOTALS = bookTotals(POSITIONS, QUOTES, MANIFEST);

const baseProps = (): WorkspaceProps => ({
  positions: POSITIONS,
  quotes: QUOTES,
  manifest: MANIFEST,
  totals: TOTALS,
  risk: null,
  unreadable: false,
  stale: false,
  retrying: false,
  lastChecked: null,
  failure: null,
  busyId: null,
  confirmDelete: null,
  riskContent: null,
  historyContent: null,
  targetsContent: null,
  briefContent: null,
  eventContent: null,
  onRetry: vi.fn(),
  onAdd: vi.fn(),
  onEdit: vi.fn(),
  onToggleStatus: vi.fn(),
  onDeleteRequest: vi.fn(),
  onDeleteCancel: vi.fn(),
  onDeleteConfirm: vi.fn(),
  onSectionChange: vi.fn(),
});

let container: HTMLElement | null = null;
let root: Root | null = null;

async function mount(ui: ReactElement): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(ui); });
  return container;
}

async function click(element: Element): Promise<void> {
  await act(async () => { (element as HTMLElement).click(); });
}

function listedRow(view: HTMLElement, positionId: string): HTMLElement {
  const row = view.querySelector(`tr[data-position-id="${positionId}"]`);
  expect(row, `holding ${positionId} should be listed`).toBeTruthy();
  return row as HTMLElement;
}

/** Open the record dialog for one listed holding via its review action. */
async function openRecord(view: HTMLElement, positionId: string): Promise<HTMLDialogElement> {
  const trigger = listedRow(view, positionId).querySelector("button");
  expect(trigger, "review action should exist").toBeTruthy();
  await click(trigger!);
  const dialog = view.querySelector("dialog");
  expect(dialog, "record dialog should open").toBeTruthy();
  return dialog as HTMLDialogElement;
}

function dialogHrefs(dialog: HTMLDialogElement): string[] {
  return [...dialog.querySelectorAll("a")].map(a => a.getAttribute("href") ?? "");
}

const ordinaryTerminalHref = (ticker: string) => `/terminal?sym=${encodeURIComponent(ticker)}`;
const companyAnalysisHref = (ticker: string) => `/analysis?symbol=${encodeURIComponent(ticker)}&page=overview`;
// sharedShellTerminalHref contract: /terminal?from=macro&ret=<canonicalHref>&symbol=<symbol>
const betaTerminalHref = (ticker: string) =>
  `/terminal?from=macro&ret=${encodeURIComponent(window.location.href)}&symbol=${encodeURIComponent(ticker)}`;

function setLang(lang: "en" | "zh"): void {
  document.documentElement.setAttribute("data-lang", lang);
}

function workspace(props = baseProps()): ReactElement {
  return <LangProvider><PortfolioWorkspace {...props} /></LangProvider>;
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom implements <dialog> markup but neither showModal() nor close().
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

beforeEach(() => {
  shell.presentation = null;
  setLang("en");
  window.history.replaceState({}, "", "/");
});

afterEach(async () => {
  if (root) {
    const mounted = root;
    root = null;
    await act(async () => { mounted.unmount(); });
  }
  container?.remove();
  container = null;
});

describe("PortfolioWorkspace navigation", () => {
  it("lists a supported hyphenated holding and keeps the classic deep links in ordinary mode (EN)", async () => {
    const view = await mount(workspace());

    const row = listedRow(view, "pos-company");
    expect(row.getAttribute("data-ticker")).toBe(SYMBOL);
    expect(row.textContent).toContain("Berkshire Hathaway");
    expect(row.querySelector("a.pf-tk")!.getAttribute("href")).toBe(ordinaryTerminalHref(SYMBOL));

    const dialog = await openRecord(view, "pos-company");
    expect(dialogHrefs(dialog)).toEqual([companyAnalysisHref(SYMBOL), ordinaryTerminalHref(SYMBOL)]);
    expect(dialog.querySelector('a[href^="/analysis?symbol="]')!.textContent).toBe("Open company analysis");
    expect(dialog.querySelector('a[href^="/terminal"]')!.textContent).toBe("Open current chart");
  });

  it("routes the table and dialog chart links through the shared shell with query and hash preserved", async () => {
    window.history.replaceState({}, "", "/portfolio?view=holdings#book");
    shell.presentation = {};
    const view = await mount(workspace());

    const expected = betaTerminalHref(SYMBOL);
    expect(expected).toContain(encodeURIComponent("/portfolio?view=holdings#book"));

    expect(listedRow(view, "pos-company").querySelector("a.pf-tk")!.getAttribute("href")).toBe(expected);

    const dialog = await openRecord(view, "pos-company");
    expect(dialogHrefs(dialog).filter(href => href.startsWith("/terminal"))).toEqual([expected]);
  });

  it("keeps the classic deep link when rendering without a window (SSR)", () => {
    shell.presentation = {}; // shared shell present, but there is no window to read a URL from
    vi.stubGlobal("window", undefined);
    try {
      const markup = renderToStaticMarkup(workspace());
      expect(markup).toContain(`href="${ordinaryTerminalHref(SYMBOL)}"`);
      expect(markup).not.toContain("from=macro");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("labels the actions in Chinese and lists the localized name (ZH)", async () => {
    setLang("zh");
    const view = await mount(workspace());
    expect(listedRow(view, "pos-company").textContent).toContain("伯克希尔哈撒韦");

    const dialog = await openRecord(view, "pos-company");
    expect(dialogHrefs(dialog)).toEqual([companyAnalysisHref(SYMBOL), ordinaryTerminalHref(SYMBOL)]);
    expect(dialog.querySelector('a[href^="/analysis?symbol="]')!.textContent).toBe("打开公司分析");
    expect(dialog.querySelector('a[href^="/terminal"]')!.textContent).toBe("打开当前图表");
  });

  it("preserves a numeric-leading listing for charting without inventing company coverage", async () => {
    const ticker = "0700.HK";
    const positions = [{ ...POSITIONS[0], ticker }];
    const props = { ...baseProps(), positions, quotes: {}, manifest: {}, totals: bookTotals(positions, {}, {}) };
    shell.presentation = {};
    window.history.replaceState({}, "", "/portfolio?view=holdings#coverage");
    const view = await mount(workspace(props));
    expect(listedRow(view, "pos-company").querySelector("a.pf-tk")!.getAttribute("href")).toBe(betaTerminalHref(ticker));
    const dialog = await openRecord(view, "pos-company");
    expect(dialogHrefs(dialog)).toEqual([betaTerminalHref(ticker)]);
    expect(dialog.textContent).not.toContain("Open company analysis");
  });

  it("omits the company analysis link for an unsupported symbol but keeps the chart action", async () => {
    const view = await mount(workspace());
    const dialog = await openRecord(view, "pos-odd");
    const links = dialogHrefs(dialog);
    expect(links).toEqual([ordinaryTerminalHref(UNSUPPORTED)]);
    expect(links.some(href => href.startsWith("/analysis?symbol="))).toBe(false);
  });
});
