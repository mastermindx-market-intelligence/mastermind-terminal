// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TodaySinceLastVisit, { STORAGE_KEY, ownerSlot } from "@/components/workspaces/TodaySinceLastVisit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const i18n = vi.hoisted(() => ({ lang: "en" as "en" | "zh" }));

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: i18n.lang }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { throw new Error("TodaySinceLastVisit must not own identity"); } }));

type Held = { url: string; init?: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void };
let held: Held[]; let root: Root; let container: HTMLDivElement; let unauthenticated: ReturnType<typeof vi.fn>;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
async function flush() { for (let n = 0; n < 4; n++) await act(async () => { await Promise.resolve(); }); }
async function answer(index: number, value: unknown, status = 200) { await act(async () => { held[index].resolve(json(value, status)); }); await flush(); }
async function fail(index: number) { await act(async () => { held[index].reject(new TypeError("Failed to fetch")); }); await flush(); }
async function mountNode(node: React.ReactNode) { await act(async () => root.render(node)); await flush(); }
async function renderOwner(ownerKey: string) {
  const scope = { current: new AbortController() };
  await mountNode(<TodaySinceLastVisit ownerKey={ownerKey} scope={scope} onUnauthenticated={unauthenticated} />);
  return scope;
}
const state = () => container.querySelector("[data-today-since-state]")?.getAttribute("data-today-since-state") ?? null;
const sentPrevious = (index: number) => JSON.parse(String(held[index].init?.body)).previous;
const button = (text: string) => Array.from(container.querySelectorAll("button")).find(b => b.textContent?.includes(text));

// Envelope helpers — the house format `{ "<owner>": <digest> }` under ONE key (lib/ownerStorage.ts).
const envelope = () => JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, unknown>;
const slot = (owner: string) => envelope()[ownerSlot(owner)];
const seed = (slots: Record<string, unknown>) => window.localStorage.setItem(STORAGE_KEY, JSON.stringify(
  Object.fromEntries(Object.entries(slots).map(([owner, digest]) => [ownerSlot(owner), digest])),
));

// Producer-shaped fixtures (engine/portfolio_changes.py snapshot(): `names` values are the
// per-name desk state RECORDS, `sectors` the sector records, regime labels at the top).
// Digest shapes follow engine/portfolio_changes.py snapshot(): SNAPSHOT_SCHEMA, per-name
// records (stage / entry "label / state" / earnings / sector), sector records with
// class + conviction_en/zh, and the regime labels at the top.
const DIGEST_OLD = {
  schema: "portfolio_state_digest.v1", asof: "2026-10-29",
  names: { NVDA: { stage: 2, entry: "Entry zone / open", earnings: "2026-11-19", sector: "Technology" }, AAPL: { stage: 3, sector: "Technology" } },
  sectors: { Technology: { class: "leading", conviction_en: "high", conviction_zh: "高" } },
  regime_en: "Risk-on", regime_zh: "风险偏好",
};
const DIGEST_NEW = {
  schema: "portfolio_state_digest.v1", asof: "2026-10-30",
  names: { NVDA: { stage: 3, entry: "Extended / closed", earnings: "2026-11-19", sector: "Technology" }, AAPL: { stage: 3, sector: "Technology" } },
  sectors: { Technology: { class: "weakening", conviction_en: "medium", conviction_zh: "中" } },
  regime_en: "Mixed", regime_zh: "分化",
};
// Disclosure sentences verbatim from engine/portfolio_brief.py _population_block.
const BRIEF = { schema: "portfolio_brief.v2", asof: "2026-10-30", state_digest: DIGEST_NEW, population: { mode: "positions", label_en: "Open positions", label_zh: "开仓持仓", n: 2, disclosure_en: "This read describes the 2 names you hold.", disclosure_zh: "此判读描述你持有的 2 只个股。" } };
const BRIEF_WATCHLIST = { ...BRIEF, population: { mode: "watchlist_union", label_en: "Watchlist", label_zh: "观察列表", n: 2, disclosure_en: "This read describes the 2 names on your watchlists, equal weighted — not a position book.", disclosure_zh: "此判读描述你观察列表中的 2 只个股，按等权计算 — 并非持仓。" } };
// CURSOR_DISCLOSURE verbatim from engine/portfolio_changes.py.
const CURSOR = { scope: "device", note_en: "This “since your last visit” marker is kept on this device, so a different browser or phone keeps its own separate history.", note_zh: "“自你上次查看以来”的记录保存在本设备上，因此换用其他浏览器或手机时会各自独立计算。" };
// The desk's own kinds: regime carries no ticker; stage/entry/earnings carry one;
// sector_class/sector_conviction carry a sector; added/removed are membership lines.
const REGIME = { kind: "regime", en: "The desk's daily read moved from Risk-on to Mixed.", zh: "桌面的每日判读从风险偏好转为分化。" };
const STAGE = { kind: "stage", en: "NVDA moved from Stage 2 to Stage 3.", zh: "NVDA 从第 2 阶段进入第 3 阶段。", ticker: "NVDA" };
const ENTRY = { kind: "entry", en: "NVDA's entry read changed: Entry zone / open → Extended / closed.", zh: "NVDA 的入场判读发生变化：Entry zone / open → Extended / closed。", ticker: "NVDA" };
const SECTOR = { kind: "sector_class", en: "Technology moved from leading to weakening on the desk's rotation board.", zh: "Technology 在桌面轮动板上从领先转为走弱。", sector: "Technology" };
const CONVICTION = { kind: "sector_conviction", en: "The desk read on Technology moved from high to medium.", zh: "桌面对Technology的判读从高转为中。", sector: "Technology" };
const ADDED = { kind: "added", en: "1 name joined this read since your last visit: XOM.", zh: "自你上次查看以来，新增 1 只个股：XOM。" };
function changes(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  return { schema: "portfolio_changes.v1", asof: "2026-10-30", population: "positions", first_visit: false, changes: lines, state_digest: DIGEST_NEW, cursor: CURSOR, ...extra };
}
const stageLine = (ticker: string) => ({ kind: "stage", en: `${ticker} moved from Stage 2 to Stage 3.`, zh: `${ticker} 从第 2 阶段进入第 3 阶段。`, ticker });

beforeEach(() => {
  // Node 26 ships its own experimental global localStorage getter that shadows jsdom's
  // Storage under vitest; force the window back onto jsdom's instance (same workaround
  // as ThesisWorkspaceLensRail.test.tsx).
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) Object.defineProperty(window, "localStorage", { value: dom.window.localStorage, configurable: true, writable: true });
  i18n.lang = "en"; held = []; unauthenticated = vi.fn(); window.localStorage.clear();
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => held.push({ url: String(input), init, resolve, reject }))));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Today — since your last visit", () => {
  it("first visit on a device: posts previous=null, renders the first-visit line, stores the desk's digest in the owner's slot", async () => {
    await renderOwner(A);
    expect(state()).toBe("loading");
    expect(held).toHaveLength(1); expect(held[0].url).toBe("/api/portfolio-brief");
    await answer(0, BRIEF);
    expect(held).toHaveLength(2); expect(held[1].url).toBe("/api/portfolio-changes");
    expect(held[1].init?.method).toBe("POST");
    expect(sentPrevious(1)).toBeNull();
    await answer(1, changes([], { first_visit: true }));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain("No earlier comparison is available");
    expect(envelope()).toEqual({ [ownerSlot(A)]: DIGEST_NEW });
  });

  it("returning visit: posts the stored digest verbatim and renders every desk kind, ticker lines linking to Analysis", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    expect(sentPrevious(1)).toEqual(DIGEST_OLD);
    await answer(1, changes([REGIME, STAGE, ENTRY, SECTOR, CONVICTION, ADDED]));
    expect(state()).toBe("ready");
    for (const line of [REGIME, STAGE, ENTRY, SECTOR, CONVICTION, ADDED]) expect(container.textContent).toContain(line.en);
    const links = Array.from(container.querySelectorAll("li a")).map(a => a.getAttribute("href"));
    expect(links).toEqual(["/analysis?symbol=NVDA", "/analysis?symbol=NVDA"]);
    expect(container.textContent).toContain("This read describes the 2 names you hold.");
    expect(container.textContent).toContain(CURSOR.note_en);
    expect(container.textContent).toContain("2026-10-30");
    expect(slot(A)).toEqual(DIGEST_NEW);
  });

  it("no change: renders the quiet line, never invents a change", async () => {
    seed({ [A]: DIGEST_NEW });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([]));
    expect(container.textContent).toContain("No tracked changes in this reading");
    expect(container.querySelectorAll("li")).toHaveLength(0);
  });

  it("shows six lines first and expands the rest in place — no desk line is sent elsewhere or lost", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes(["A", "B", "C", "D", "E", "F", "G", "H"].map(stageLine)));
    expect(container.querySelectorAll("li")).toHaveLength(6);
    expect(container.textContent).not.toContain("Portfolio.");
    const more = button("Show 2 more changes");
    expect(more).toBeTruthy();
    await act(async () => more!.click()); await flush();
    const items = container.querySelectorAll("li");
    expect(items).toHaveLength(8);
    expect(container.textContent).toContain("H moved from Stage 2 to Stage 3.");
    expect(button("Show")).toBeUndefined();
    // The control unmounted; focus lands on the first revealed line, not on <body>.
    expect(document.activeElement).toBe(items[6]);
    expect(items[6].textContent).toContain("G moved from Stage 2 to Stage 3.");
  });

  it("accepts the desk's longest names (up to 48 characters) as Analysis links", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    const long = "A".repeat(48);
    await answer(1, changes([stageLine(long), stageLine("B".repeat(49))]));
    const links = Array.from(container.querySelectorAll("li a")).map(a => a.getAttribute("href"));
    expect(links).toEqual([`/analysis?symbol=${long}`]);
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("free tier: a 403 on the brief renders the teaser and never posts the digest", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, { error: "pro_required", tier: "free" }, 403);
    expect(state()).toBe("teaser");
    expect(held).toHaveLength(1);
    expect(container.textContent).toContain("See the Pro brief");
    expect(slot(A)).toEqual(DIGEST_OLD);
  });

  it("a 403 on the diff after a 200 brief is the teaser and keeps the marker", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, { error: "pro_required", tier: "free" }, 403);
    expect(state()).toBe("teaser");
    expect(slot(A)).toEqual(DIGEST_OLD);
  });

  it("signed out: a 401 renders nothing, clears only this owner's slot, and hands the departure to the parent", async () => {
    seed({ [A]: DIGEST_OLD, [B]: DIGEST_NEW });
    await renderOwner(A);
    await answer(0, { error: "unauthenticated" }, 401);
    expect(container.querySelector("[data-today-since-state]")).toBeNull();
    expect(unauthenticated).toHaveBeenCalledTimes(1);
    expect(held).toHaveLength(1);
    expect(envelope()).toEqual({ [ownerSlot(B)]: DIGEST_NEW });
  });

  it("desk unavailable: a 503 on the diff keeps the stored marker and offers one retry", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, { error: "ctx_unavailable" }, 503);
    expect(state()).toBe("unavailable");
    expect(slot(A)).toEqual(DIGEST_OLD);
    const retry = button("Check again");
    expect(retry).toBeTruthy();
    await act(async () => retry!.click()); await flush();
    expect(state()).toBe("loading");
    expect(held).toHaveLength(3); expect(held[2].url).toBe("/api/portfolio-brief");
  });

  it("a 503 on the brief is unavailable and never posts the digest", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, { error: "ctx_unavailable" }, 503);
    expect(state()).toBe("unavailable");
    expect(held).toHaveLength(1);
    expect(slot(A)).toEqual(DIGEST_OLD);
  });

  it("network failure on the brief is unavailable, not a crash", async () => {
    await renderOwner(A);
    await fail(0);
    expect(state()).toBe("unavailable");
  });

  it("a malformed desk payload is unavailable and does not overwrite the marker", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, { schema: "portfolio_changes.v1", first_visit: false, changes: [{ kind: "x" }], state_digest: DIGEST_NEW });
    expect(state()).toBe("unavailable");
    expect(slot(A)).toEqual(DIGEST_OLD);
  });

  it("a 200 whose state_digest is not a digest is unavailable and does not advance the marker", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([STAGE], { state_digest: { names: "NVDA,AAPL" } }));
    expect(state()).toBe("unavailable");
    expect(slot(A)).toEqual(DIGEST_OLD);
    expect(container.textContent).not.toContain(STAGE.en);
  });

  it("the retry's read wins: a late answer to the superseded read is dropped and writes nothing", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, { error: "ctx_unavailable" }, 503);
    await act(async () => button("Check again")!.click()); await flush();
    expect(held).toHaveLength(3);
    // The retry's brief answers, then the retry's diff is pending while a stray late
    // 200 arrives for the FIRST read's diff: it must neither render nor store.
    await answer(2, BRIEF);
    expect(held).toHaveLength(4);
    const stray = { names: { STRAY: { stage: 1 } } };
    await answer(1, changes([STAGE], { state_digest: stray }));
    expect(state()).toBe("loading");
    expect(slot(A)).toEqual(DIGEST_OLD);
    await answer(3, changes([ENTRY]));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain(ENTRY.en);
    expect(slot(A)).toEqual(DIGEST_NEW);
  });

  it("a storage write that is refused still renders the desk's lines", async () => {
    seed({ [A]: DIGEST_OLD });
    const setItem = vi.spyOn(window.localStorage.__proto__ as Storage, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await renderOwner(A);
    await answer(0, BRIEF);
    expect(sentPrevious(1)).toEqual(DIGEST_OLD);
    await answer(1, changes([STAGE]));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain(STAGE.en);
    expect(setItem).toHaveBeenCalled();
    setItem.mockRestore();
    expect(slot(A)).toEqual(DIGEST_OLD);
  });

  it("markers are per owner and the section remounts on owner change", async () => {
    seed({ [A]: DIGEST_OLD });
    const scope = { current: new AbortController() };
    await mountNode(<TodaySinceLastVisit ownerKey={A} scope={scope} onUnauthenticated={unauthenticated} />);
    await answer(0, BRIEF);
    expect(sentPrevious(1)).toEqual(DIGEST_OLD);
    const next = { current: new AbortController() };
    await act(async () => scope.current.abort());
    await mountNode(<TodaySinceLastVisit ownerKey={B} scope={next} onUnauthenticated={unauthenticated} />);
    expect(held).toHaveLength(3); expect(held[2].url).toBe("/api/portfolio-brief");
    await answer(2, BRIEF);
    expect(sentPrevious(3)).toBeNull();
  });

  it("an owner switch while the diff is in flight: the late 200 is dropped and the departed owner's slot is untouched", async () => {
    seed({ [A]: DIGEST_OLD });
    const scope = { current: new AbortController() };
    await mountNode(<TodaySinceLastVisit ownerKey={A} scope={scope} onUnauthenticated={unauthenticated} />);
    await answer(0, BRIEF);
    expect(held).toHaveLength(2);
    const next = { current: new AbortController() };
    await act(async () => scope.current.abort());
    await mountNode(<TodaySinceLastVisit ownerKey={B} scope={next} onUnauthenticated={unauthenticated} />);
    await answer(1, changes([STAGE]));
    expect(slot(A)).toEqual(DIGEST_OLD);
    expect(slot(B)).toBeUndefined();
    expect(container.textContent).not.toContain(STAGE.en);
    await answer(2, BRIEF);
    await answer(3, changes([], { first_visit: true }));
    expect(envelope()).toEqual({ [ownerSlot(A)]: DIGEST_OLD, [ownerSlot(B)]: DIGEST_NEW });
  });

  it("a scope abort ends the section and drops any late answer", async () => {
    const scope = await renderOwner(A);
    await act(async () => scope.current!.abort()); await flush();
    expect(container.querySelector("[data-today-since-state]")).toBeNull();
    await answer(0, BRIEF);
    expect(held).toHaveLength(1);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("shows the watchlist population sentence when the diff was read over the same set", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF_WATCHLIST);
    await answer(1, changes([STAGE], { population: "watchlist_union" }));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain("This read describes the 2 names on your watchlists, equal weighted — not a position book.");
  });

  it("shows no population sentence when the cached brief names a different set than the diff", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([STAGE], { population: "watchlist_union" }));
    expect(state()).toBe("ready");
    expect(container.textContent).toContain(STAGE.en);
    expect(container.textContent).not.toContain("This read describes");
    expect(container.textContent).toContain("Desk read as of");
  });

  it("shows no population sentence when the diff does not name its set", async () => {
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([STAGE], { population: undefined }));
    expect(state()).toBe("ready");
    expect(container.textContent).not.toContain("This read describes");
  });

  it("renders the desk's zh sentence and zh chrome when the reader is in zh", async () => {
    i18n.lang = "zh";
    seed({ [A]: DIGEST_OLD });
    await renderOwner(A);
    await answer(0, BRIEF);
    await answer(1, changes([STAGE, ...["B", "C", "D", "E", "F", "G"].map(stageLine)]));
    expect(container.textContent).toContain("与已保存读数比较");
    expect(container.textContent).toContain(STAGE.zh);
    expect(container.textContent).not.toContain(STAGE.en);
    expect(container.textContent).toContain(CURSOR.note_zh);
    expect(container.textContent).toContain("此判读描述你持有的 2 只个股。");
    expect(button("显示另外 1 项变化")).toBeTruthy();
  });
});


describe("Today request-bound comparison basis", () => {
  const fields = () => Array.from(container.querySelectorAll("[data-today-comparison-basis] dd")).map(n => n.textContent);

  it("keeps the request's actual saved date after the slot has been overwritten", async () => {
    seed({ [A]: DIGEST_OLD }); await renderOwner(A); await answer(0, BRIEF);
    expect(sentPrevious(1)).toEqual(DIGEST_OLD);
    // A separate browser event changes storage while the accepted request is in flight.
    seed({ [A]: { ...DIGEST_OLD, asof: "2026-10-28" } });
    await answer(1, changes([STAGE]));
    expect(slot(A)).toEqual(DIGEST_NEW);
    expect(fields()).toEqual(["2026-10-29", "2026-10-30", "Held names", "Not recorded"]);
    const count = held.length;
    const details = container.querySelector<HTMLDetailsElement>("[data-today-comparison-basis]")!;
    expect(details.open).toBe(false);
    await act(async () => details.querySelector("summary")!.click()); await flush();
    expect(details.open).toBe(true); expect(held).toHaveLength(count);
    expect(fields()[0]).toBe("2026-10-29");
  });

  it("does not equate a valid empty baseline with no history or an empty portfolio", async () => {
    const baseline = { names: {} }; seed({ [A]: baseline });
    await renderOwner(A); await answer(0, BRIEF); await answer(1, changes([]));
    expect(sentPrevious(1)).toEqual(baseline);
    expect(fields()[0]).toBe("Date unavailable");
    expect(container.textContent).toContain("No tracked changes in this reading");
    expect(container.textContent).toContain("does not mean your lists or holdings are empty");
    expect(container.textContent).not.toContain("No usable saved reading");
  });

  it("retains the valid response and exposes a failed local save without retrying", async () => {
    seed({ [A]: DIGEST_OLD, [B]: { names: { PRIVATE: {} } } });
    await renderOwner(A); await answer(0, BRIEF);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError"); });
    await answer(1, changes([STAGE]));
    expect(state()).toBe("ready"); expect(container.textContent).toContain(STAGE.en);
    expect(container.querySelector('[role="status"]')?.textContent).toContain("saving the next comparison was not confirmed");
    expect(slot(A)).toEqual(DIGEST_OLD); expect(slot(B)).toEqual({ names: { PRIVATE: {} } });
    expect(held).toHaveLength(2); expect(fields()[0]).toBe("2026-10-29");
  });

  it("does not borrow the brief's population when the current comparison differs", async () => {
    seed({ [A]: DIGEST_OLD }); await renderOwner(A); await answer(0, BRIEF);
    await answer(1, changes([STAGE], { population: "watchlist_union" }));
    expect(fields().slice(2)).toEqual(["Watchlist symbols", "Not recorded"]);
    expect(container.textContent).not.toContain("This read describes the 2 names you hold");
  });

  it.each(["2026-02-30", "2026-10", "not-a-date", null])("does not normalize an invalid saved date %s", async (date) => {
    seed({ [A]: { ...DIGEST_OLD, asof: date } }); await renderOwner(A); await answer(0, BRIEF);
    await answer(1, changes([])); expect(fields()[0]).toBe("Date unavailable");
    expect(fields()[1]).toBe("2026-10-30");
  });

  it.each(["2026-10-30", "2026-11-01"])("keeps equal/reversed reading dates %s without inventing visit chronology", async (date) => {
    seed({ [A]: { ...DIGEST_OLD, asof: date } }); await renderOwner(A); await answer(0, BRIEF);
    await answer(1, changes([])); expect(fields().slice(0, 2)).toEqual([date, "2026-10-30"]);
    expect(container.textContent).toContain("Reading dates are not visit times");
  });
});


describe("Today risk and earnings share the existing brief read", () => {
  const fullBrief = { ...BRIEF, generated_at: "2026-10-30T06:00:00Z", stale: true,
    weighting: { mode: "equal", label_en: "Equal weighted", label_zh: "等权" },
    book: { n: 2, covered: 2, uncovered: [] }, headline: { en: "Source headline", zh: "来源标题" },
    sections: [{ key: "regime", title_en: "Regime", title_zh: "环境", lines: [{ en: "SOURCE RISK CONTEXT", zh: "来源风险背景" }] }],
    data: { events: { earnings_10d: [{ ticker: "NVDA", date: "2026-11-06", days_to: 7 }] } } };
  const mountContext = async () => {
    const scope = { current: new AbortController() };
    await mountNode(<TodaySinceLastVisit ownerKey={A} scope={scope} onUnauthenticated={unauthenticated}
      render={({ priority, teaser, context }) => <>{priority}{teaser}{context}</>} />);
    return scope;
  };
  it("presents the qualified brief with one existing request and keeps dates source-bound", async () => {
    await mountContext(); await answer(0, fullBrief);
    const context = container.querySelector("[data-today-brief-context]")!;
    expect(context.textContent).toContain("SOURCE RISK CONTEXT");
    expect(context.textContent).toContain("Source marked behind");
    expect(context.querySelector('time[datetime="2026-11-06"]')).toBeTruthy();
    expect(context.querySelector('a[href="/analysis?symbol=NVDA"]')).toBeTruthy();
    expect(held.map(r => r.url)).toEqual(["/api/portfolio-brief", "/api/portfolio-changes"]);
    expect(context.textContent).not.toMatch(/in 7 days|upcoming|buy now/i);
  });
  it("a comparison outage preserves independently valid risk/event context", async () => {
    await mountContext(); await answer(0, fullBrief); await answer(1, {}, 503);
    expect(state()).toBe("unavailable");
    expect(container.querySelector("[data-today-brief-context]")?.textContent).toContain("SOURCE RISK CONTEXT");
    expect(held).toHaveLength(2);
  });
  it.each([401, 403])("removes the private context when the later comparison denies access: %i", async status => {
    await mountContext(); await answer(0, fullBrief); await answer(1, {}, status);
    expect(container.querySelector("[data-today-brief-context]")).toBeNull();
    expect(container.textContent).not.toContain("SOURCE RISK CONTEXT");
  });
  it("an aborted owner lifetime drops its context and cannot resurrect a late comparison", async () => {
    const scope = await mountContext(); await answer(0, fullBrief);
    await act(async () => scope.current.abort()); await flush();
    await answer(1, changes([STAGE]));
    expect(container.textContent).not.toContain("SOURCE RISK CONTEXT");
    expect(container.querySelector("[data-today-brief-context]")).toBeNull();
  });
});
