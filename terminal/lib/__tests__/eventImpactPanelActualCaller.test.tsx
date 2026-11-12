// @vitest-environment jsdom
//
// The ACTUAL caller composition: PortfolioView -> PortfolioWorkspace -> EventImpactPanel,
// through a real PositionModal edit and the canonical readback that follows the write.
//
// The panel-level discriminators live in eventImpactPanelRefresh.test.tsx. This file proves the
// same behaviour where it actually happens — the workspace renders the real panel, the real
// mutation queue issues the write, and the real canonical reread replaces the book — so a
// refresh that only worked when the panel was mounted directly would not pass here.
//
// Fixtures only: no real backend, no production account, no credentials.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PortfolioView from "@/components/PortfolioView";
import { LangProvider } from "@/lib/i18n";
import {
  normalizeEntryCurrency,
  normalizeEntryDate,
  normalizeNotes,
  normalizeNumeric,
  normalizeTicker,
  type Position,
} from "@/lib/portfolio";
import { portfolioBookKey } from "@/lib/portfolioSnapshot.server";
import { portfolioCopy } from "@/lib/portfolioWorkspace";
import { invalidationForKind, type EventImpactRead } from "@/lib/eventImpact";

// The only external transport is controlled below; the real view, workspace, panel, modal,
// decoders and copy helpers are kept.
vi.mock("@/lib/dataCache", () => ({ getJSON: async () => ({ symbols: {} }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OWNER = "11111111-1111-4111-8111-111111111111";

const BASE: Position = {
  id: "record-a",
  ticker: "NVDA",
  shares: 10,
  entryPrice: 100,
  entryCurrency: "USD",
  entryDate: null,
  notes: "A record",
  status: "open",
  createdAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

type Pending = {
  response: ReturnType<typeof deferred<Response>>;
  body: ReturnType<typeof deferred<unknown>>;
};

/** The route's own projection of the CURRENT book: {id, ticker, shares, status}. */
function payload(marker: string, positions: readonly Position[]): EventImpactRead {
  const open = positions.filter(p => p.status === "open");
  return {
    state: "ok",
    asof: "2026-11-02",
    heldTickers: new Set(open.map(p => p.ticker)).size,
    heldPositions: open.length,
    unjoinable: [],
    events: open.map(p => ({
      eventId: `earnings|${p.ticker}|2026-11-10`,
      kind: "earnings",
      ticker: p.ticker,
      date: "2026-11-10",
      daysUntil: 8,
      positions: [{ id: p.id, ticker: p.ticker, shares: p.shares, status: p.status }],
      direction: { state: "not_stated" },
      mechanism: { state: "stated", text: marker, textZh: marker },
      timeframe: { state: "not_stated" },
      invalidation: invalidationForKind("earnings", "2026-11-10"),
      sourcePath: "/data/portfolio_ctx.json",
    })),
  };
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let node: HTMLDivElement;
let root: Root;
let book: Position[];
let seed: Position[];
let eventRequests: Pending[];
let writes: Record<string, unknown>[];
let dialogDescriptors: ReadonlyArray<readonly ["showModal" | "close", PropertyDescriptor | undefined]>;

async function flush() {
  await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); });
}

async function mount() {
  await act(async () => {
    root.render(
      <LangProvider>
        <PortfolioView positions={seed} email="synthetic@example.test" userId={OWNER} />
      </LangProvider>
    );
  });
  await flush();
}

async function settleEvent(pending: Pending, marker: string) {
  await act(async () => {
    pending.response.resolve({
      ok: true,
      status: 200,
      json: () => pending.body.promise,
    } as unknown as Response);
    pending.body.resolve(payload(marker, book));
  });
  await flush();
}

async function click(el: Element | null | undefined) {
  expect(el, "expected an element to click").not.toBeNull();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}

async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}

const panel = () => node.querySelector('[data-testid="event-impact"]');
const panelText = () => panel()?.textContent ?? "";
const rows = () => panel()?.querySelectorAll('[data-testid="event-impact-row"]');
const showAllButton = () => panel()?.querySelector<HTMLButtonElement>("button");

/** Open the workspace's record inspector for a holding, then its edit modal. */
async function openEditor(positionId: string, ticker: string) {
  await click(node.querySelector(`[data-position-id="${positionId}"] button`));
  const inspector = node.querySelector("dialog");
  expect(inspector).not.toBeNull();
  const edit = Array.from(inspector!.querySelectorAll("button"))
    .find(b => (b.getAttribute("aria-label") ?? "").endsWith(` ${ticker}`));
  expect(edit, `expected an edit control for ${ticker}`).not.toBeUndefined();
  await click(edit!);
  const modal = node.querySelector("dialog form");
  expect(modal).not.toBeNull();
  return modal as HTMLFormElement;
}

/** The workspace's own "Refresh holdings" control — a canonical reread of the same book. */
function refreshButton(lang: "en" | "zh") {
  return node.querySelector(`header button[aria-label="${portfolioCopy(lang)("refresh")}"]`);
}

beforeEach(() => {
  vi.useFakeTimers();
  book = [{ ...BASE }];
  seed = structuredClone(book);
  eventRequests = [];
  writes = [];
  document.documentElement.setAttribute("data-lang", "en");

  // jsdom has no dialog implementation; the real components call showModal()/close().
  dialogDescriptors = (["showModal", "close"] as const).map(name =>
    [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) { this.removeAttribute("open"); },
  });

  vi.stubGlobal("fetch", vi.fn((input: string, init?: RequestInit) => {
    if (input === "/api/event-impact") {
      const pending: Pending = { response: deferred<Response>(), body: deferred<unknown>() };
      eventRequests.push(pending);
      return pending.response.promise;
    }
    if (input === "/api/portfolio?view=positions") {
      return Promise.resolve(response({
        positions: structuredClone(book),
        bookKey: portfolioBookKey(book),
      }));
    }
    if (input === "/api/portfolio" && init?.method === "POST") {
      const data = JSON.parse(String(init.body)) as Record<string, unknown>;
      writes.push(data);
      if (data.action === "update") {
        // The canonical writer's own normalization, not a hand-rolled coercion: a blank field
        // is null there, and the receipt has to say exactly what the store would say.
        const existing = book.find(p => p.id === data.id);
        const ticker = normalizeTicker(data.ticker);
        const shares = normalizeNumeric(data.shares);
        const entryPrice = normalizeNumeric(data.entryPrice);
        const entryCurrency = normalizeEntryCurrency(data.entryCurrency);
        const entryDate = normalizeEntryDate(data.entryDate);
        const notes = normalizeNotes(data.notes);
        expect(existing).toBeDefined();
        expect(ticker).not.toBeNull();
        book = book.map(p => p.id === data.id ? {
          ...p,
          ticker: ticker!,
          shares: shares.kind === "value" ? shares.value : p.shares,
          entryPrice: entryPrice.kind === "value" ? entryPrice.value : p.entryPrice,
          entryCurrency: entryCurrency.kind === "value" ? entryCurrency.value : p.entryCurrency,
          entryDate: entryDate.kind === "value" ? entryDate.value : p.entryDate,
          notes: notes.kind === "value" ? notes.value : p.notes,
        } : p);
      }
      return Promise.resolve(response({ ok: true, position: book.find(p => p.id === data.id) }));
    }
    if (input.startsWith("/api/quote")) return Promise.resolve(response({ quotes: {} }));
    if (["/api/portfolio", "/api/portfolio/targets", "/api/portfolio/risk-history"].includes(input)) {
      return Promise.resolve(response({ error: "optional analysis unavailable" }, 503));
    }
    throw new Error(`Unexpected request: ${input}`);
  }));

  node = document.createElement("div");
  document.body.appendChild(node);
  root = createRoot(node);
});

afterEach(() => {
  act(() => root.unmount());
  node.remove();
  document.documentElement.removeAttribute("data-lang");
  for (const [name, original] of dialogDescriptors) {
    if (original) Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(["en", "zh"] as const)("actual Portfolio caller (%s)", lang => {
  beforeEach(() => { document.documentElement.setAttribute("data-lang", lang); });

  it("refreshes the event facts after a real position edit and the canonical readback", async () => {
    await mount();
    expect(eventRequests).toHaveLength(1);
    await settleEvent(eventRequests[0], "BEFORE_EDIT");
    expect(panelText()).toContain("BEFORE_EDIT");
    expect(panelText()).toContain(lang === "en" ? "You hold 10 shares" : "你持有 10 股");

    // Open the workspace's record inspector for the holding and edit its size.
    const form = await openEditor("record-a", "NVDA");
    const shares = node.querySelector<HTMLInputElement>('input[name="shares"]');
    expect(shares).not.toBeNull();
    await typeInto(shares!, "25");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    await flush();

    // The write went through the real mutation queue and the real canonical reread.
    expect(writes).toHaveLength(1);
    expect(book[0].shares).toBe(25);
    expect(node.querySelector('input[name="shares"]')).toBeNull(); // the modal closed

    // The canonical reread replaced the book, so the panel's committed input changed: a fresh
    // read is due and the previous facts are no longer current.
    expect(eventRequests).toHaveLength(2);
    expect(panelText()).not.toContain("BEFORE_EDIT");
    expect(rows()).toHaveLength(0);

    await settleEvent(eventRequests[1], "AFTER_EDIT");
    expect(panelText()).toContain("AFTER_EDIT");
    expect(panelText()).toContain(lang === "en" ? "You hold 25 shares" : "你持有 25 股");
    expect(panelText()).not.toContain("BEFORE_EDIT");
  });

  it("keeps Show all across a same-count edit made through the real modal", async () => {
    book = Array.from({ length: 7 }, (_, i) => ({ ...BASE, id: `record-${i}`, ticker: `SYN${i}` }));
    seed = structuredClone(book);
    await mount();
    await settleEvent(eventRequests[0], "OLD_FACT");
    expect(rows()).toHaveLength(6);
    await click(showAllButton());
    expect(rows()).toHaveLength(7);

    const form = await openEditor("record-0", "SYN0");
    const shares = node.querySelector<HTMLInputElement>('input[name="shares"]');
    expect(shares).not.toBeNull();
    await typeInto(shares!, "25");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    await flush();

    expect(eventRequests).toHaveLength(2);
    expect(rows()).toHaveLength(0); // the obsolete rows are gone while the fresh read is pending
    await settleEvent(eventRequests[1], "NEW_FACT");
    // Seven rows, not six: the expansion survived the same-count edit.
    expect(rows()).toHaveLength(7);
    expect(panelText()).toContain("NEW_FACT");
    expect(panelText()).not.toContain("OLD_FACT");
  });

  it("does not reload for a same-owner canonical reread that changed nothing", async () => {
    await mount();
    await settleEvent(eventRequests[0], "STILL_CURRENT");
    expect(eventRequests).toHaveLength(1);

    // A second canonical read of an unchanged book must not restart the event read.
    await click(refreshButton(lang));
    expect(eventRequests).toHaveLength(1);
  });
});
