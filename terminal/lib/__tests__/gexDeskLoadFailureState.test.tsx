// @vitest-environment jsdom
/**
 * Failure-state truth on the GEX desk: a read that did not land is not an absence.
 *
 * The REAL flowClientCache and useFlowStream run against an injected transport — a
 * stubbed fetch for /api/flow and, where a case needs the push path, a fake EventSource
 * for /api/flow/stream — so the whole chain is exercised: transport → classification →
 * desk state → rendered copy. Every read the desk makes is covered: the live snapshot
 * (stream, polling fallback and the desk's own read), an archived session, the market
 * state, and the strike × expiry matrix behind the pick card, the expiry lens, the
 * matrix view and the confluence board. A 5xx, a rejected fetch and an unparseable body
 * must render a load error with a Retry that really re-reads; only a 404 may render the
 * absence copy, and it offers nothing to retry.
 */
import React, { act, Profiler } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en", setLang: () => undefined }) }));
vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));
vi.mock("@/components/ui/Tip", () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
// The belt makes reads of its own (covered by its own suite); it is not this desk's copy.
vi.mock("@/components/eodcontext/EodContextBelt", () => ({ EodContextBelt: () => null }));

import { GexDeskView } from "@/components/gexdesk/GexDeskView";
import { flowInvalidate } from "@/lib/flowClientCache";

const LOAD_ERROR = "Could not load GEX data";
const LOADING = "Loading GEX data…";
const EMPTY_TITLE = "No strike snapshot for this name yet";
const EMPTY_WHY_SPY = "SPY isn't in this nightly build";
const HISTORY_NONE = "No settled sessions on file yet";
const STATE_COMPUTING = "State computing — nightly";
const STATE_ERROR = "Could not load the market state";
const STATE_REFRESH_FAILED = "Could not refresh — showing the last read.";
const STATE_DATA = "Stability"; // rendered only beside a held market state
const HEAT_NULL = "No standout pick";
const HEAT_ABSENT = "No pick is published for this name";
const HEAT_ERROR = "Could not read the published pick just now";
const LENS_NO_MATRIX = "per-expiration split not available for this ticker";
const MTX_NONE = "No strike × expiry matrix published for this root.";
const MTX_ERROR = "Could not load the strike × expiry matrix";
const CONFLUENCE_EMPTY = "No alignment detected across indices at this metric.";
const CONFLUENCE_ERROR = "Could not read QQQ";
const ARCHIVED_MISSING = (date: string) => `No archived snapshot for ${date}`;
const ARCHIVED_MISSING_WHY = "This session was never published";
const ARCHIVED_ERROR = (date: string) => `Could not load the ${date} session`;
const LIVE_REFRESH_FAILED = "Could not refresh — showing the last read.";

// One injected transport answer per f-param. Anything unlisted is a published absence.
// `gated` holds its answer until openGate() — a read that lands after the user moved on.
type Answer = { status: number; body: string };
type Reply = Answer | "reject" | "pending" | { gated: Answer };
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const ABSENT = json(404, { error: "not published" });
// What the real route answers for a name isValidF refuses.
const REFUSED = json(400, { error: "bad f param" });
let replies: Record<string, Reply>;
let openGate: () => void = () => undefined;
const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const f = new URL(String(input), "http://terminal.test").searchParams.get("f") ?? "";
  const reply = replies[f] ?? ABSENT;
  if (reply === "reject") throw new TypeError("Failed to fetch");
  if (reply === "pending") return new Promise<Response>(() => undefined);
  const answer = "gated" in reply ? reply.gated : reply;
  if ("gated" in reply) await new Promise<void>((resolve) => { openGate = resolve; });
  return new Response(answer.body, { status: answer.status, headers: { "content-type": "application/json" } });
});

// The committed dev fixtures, read as data — the same payloads FLOW_FIXTURE serves.
type Payload = Record<string, unknown>;
let gex: Record<string, Payload>;
let matrix: Record<string, Payload>;
let state: Payload;
let GEX_SPY: Answer;
let GEX_QQQ: Answer;
let MATRIX_SPY: Answer;
let STATE_SPY: Answer;
beforeAll(async () => {
  const fixture = async (name: string) =>
    JSON.parse(await readFile(path.join(process.cwd(), "public", "data", name), "utf8"));
  gex = await fixture("gex_fixture.json");
  matrix = await fixture("matrix_fixture.json");
  state = await fixture("gexstate_fixture.json");
  GEX_SPY = json(200, gex.SPY);
  GEX_QQQ = json(200, gex.QQQ);
  MATRIX_SPY = json(200, matrix.SPY);
  STATE_SPY = json(200, state);
});

// The push path. Each stream either errors (the server cut it), stays silent (the
// producer has nothing for the key — what the route does for an absent or unread key),
// or opens and pushes a first frame.
type StreamPlan = "error" | "silent" | { frame: unknown };
let streams: Record<string, StreamPlan>;
class FakeEventSource {
  static opened: FakeEventSource[] = [];
  readonly f: string;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  closed = false;
  constructor(readonly url: string) {
    this.f = new URL(url, "http://terminal.test").searchParams.get("f") ?? "";
    FakeEventSource.opened.push(this);
    const plan = streams[this.f] ?? "silent";
    setTimeout(() => {
      if (this.closed) return;
      if (plan === "error") { this.onerror?.(new Event("error")); return; }
      this.onopen?.(new Event("open"));
      if (typeof plan === "object") this.push(plan.frame);
    }, 0);
  }
  push(frame: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(frame) }));
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  /** The route's named `status` event: what the producer's last read of the key established. */
  status(status: "absent" | "unavailable") {
    const ev = new MessageEvent("status", { data: JSON.stringify({ status }) });
    for (const fn of this.listeners.get("status") ?? []) fn(ev);
  }
  close() { this.closed = true; }
}

let host: HTMLDivElement;
let root: Root;
const originalScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = () => undefined;
  fetchMock.mockClear();
  flowInvalidate();
  replies = {};
  streams = {};
  FakeEventSource.opened = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  flowInvalidate();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  await act(async () => root.render(<GexDeskView />));
  await settle();
}
async function commitRoot(next: string) {
  const input = host.querySelector<HTMLInputElement>('input[list="gex-roots"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}
async function pickSession(date: string) {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Archived session"]');
  expect(select).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select!, date);
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}
async function clickButton(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, `a "${label}" button`).toBeDefined();
  await act(async () => { button!.click(); });
  await settle();
}
async function refocus() {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await settle();
}
const text = (el: ParentNode | null = host) => (el as Element | null)?.textContent ?? "";
const within = (selector: string) => host.querySelector(selector);
const requested = (f: string) => fetchMock.mock.calls.filter(([u]) => String(u) === `/api/flow?f=${encodeURIComponent(f)}`).length;
const retryIn = (el: ParentNode | null = host) =>
  el ? [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry") ?? null : null;
async function clickRetry(el: ParentNode | null) {
  const button = retryIn(el);
  expect(button).not.toBeNull();
  await act(async () => { button!.click(); });
  await settle();
}
const opened = (f: string) => FakeEventSource.opened.filter((e) => e.f === f);

// The three ways the live snapshot reaches the desk. jsdom has no EventSource, so the
// hook polls from the start; with one installed it streams, and the route either cuts
// the stream or keeps it open without a frame.
type Transport = "polling" | "errored stream" | "silent stream";
function useTransport(transport: Transport, key = "gex:SPY") {
  if (transport === "polling") return;
  vi.stubGlobal("EventSource", FakeEventSource);
  streams[key] = transport === "errored stream" ? "error" : "silent";
}
function expectedStream(transport: Transport, key = "gex:SPY") {
  // A stream case must really have streamed, or it silently became a polling case.
  if (transport !== "polling") expect(opened(key).length).toBeGreaterThan(0);
}
const TRANSPORTS: Transport[] = ["polling", "errored stream", "silent stream"];
const FAILURES: [string, Reply][] = [
  ["a 5xx from /api/flow", UNAVAILABLE],
  ["a rejected fetch (network failure)", "reject"],
  ["an unparseable 200 body", { status: 200, body: "<html>upstream error page</html>" }],
];

describe("GEX desk: a failed live-snapshot read is not a coverage gap", () => {
  describe.each(TRANSPORTS)("over %s", (transport) => {
    it.each(FAILURES)("renders the load error for %s", async (_label, reply) => {
      useTransport(transport);
      replies["gex:SPY"] = reply;
      await mount();
      expectedStream(transport);
      expect(requested("gex:SPY")).toBe(1);
      const error = within('[data-testid="gex-load-error"]');
      expect(error).not.toBeNull();
      expect(text(error)).toContain(LOAD_ERROR);
      expect(retryIn(error)).not.toBeNull();
      expect(text()).not.toContain(EMPTY_TITLE);
      expect(text()).not.toContain(EMPTY_WHY_SPY);
      expect(text()).not.toContain(LOADING);
      // The history strip and the summary bar are derived from the same unread payload.
      expect(text()).not.toContain(HISTORY_NONE);
      expect(within('[data-tut="gex-summary"]')).toBeNull();
    });

    it("keeps the coverage-gap empty state for a real 404 absence, with nothing to retry", async () => {
      useTransport(transport);
      replies["gex:SPY"] = ABSENT;
      await mount();
      expectedStream(transport);
      expect(text()).toContain(EMPTY_TITLE);
      expect(text()).toContain(EMPTY_WHY_SPY);
      expect(text()).not.toContain(LOAD_ERROR);
      expect(text()).not.toContain(LOADING);
      expect(retryIn()).toBeNull();
    });
  });

  it("does not claim absence while the snapshot is still being read", async () => {
    replies["gex:SPY"] = "pending";
    await mount();
    expect(text()).toContain(LOADING);
    expect(text()).not.toContain(EMPTY_TITLE);
    expect(text()).not.toContain(HISTORY_NONE);
    expect(text()).not.toContain(LOAD_ERROR);
  });

  it("re-reads in place: Retry asks the store again and renders what it answers", async () => {
    replies["gex:SPY"] = UNAVAILABLE;
    await mount();
    expect(within('[data-testid="gex-load-error"]')).not.toBeNull();

    replies["gex:SPY"] = GEX_SPY;
    await clickRetry(within('[data-testid="gex-load-error"]'));
    expect(requested("gex:SPY")).toBe(2);
    expect(text()).toContain("751.71");
    expect(within('[data-testid="gex-load-error"]')).toBeNull();
    expect(text()).not.toContain(LOAD_ERROR);
  });

  it("recovers on the stream's next frame without a Retry", async () => {
    useTransport("silent stream");
    replies["gex:SPY"] = UNAVAILABLE;
    await mount();
    expect(within('[data-testid="gex-load-error"]')).not.toBeNull();

    await act(async () => opened("gex:SPY")[0].push(gex.SPY));
    await settle();
    expect(text()).toContain("751.71");
    expect(within('[data-testid="gex-load-error"]')).toBeNull();
    expect(text()).not.toContain(LOAD_ERROR);
  });

  describe.each(["polling", "silent stream"] as Transport[])("over %s", (transport) => {
    it.each([["^VIX"], ["$SPX"], ["BRK/B"]])(
      "never asks for %s, a name no store can hold: the coverage gap, with nothing to retry",
      async (name) => {
        useTransport(transport);
        replies["gex:SPY"] = GEX_SPY;
        for (const key of ["gex", "gexstate", "matrix", "gex_dates"]) replies[`${key}:${name}`] = REFUSED;
        await mount();
        await commitRoot(name);
        for (const key of ["gex", "gexstate", "matrix", "gex_dates"]) expect(requested(`${key}:${name}`)).toBe(0);
        expect(opened(`gex:${name}`)).toHaveLength(0);
        expect(text()).toContain(EMPTY_TITLE);
        expect(text()).toContain(`${name} isn't in this nightly build`);
        expect(text()).not.toContain("751.71");
        expect(text()).not.toContain(LOAD_ERROR);
        expect(text()).not.toContain(LOADING);
        expect(retryIn()).toBeNull();
      },
    );
  });

  it("a refused name still fences the read it replaced", async () => {
    replies["gex:SPY"] = GEX_SPY;
    replies["gex:QQQ"] = { gated: GEX_QQQ };
    await mount();
    await commitRoot("QQQ");
    expect(requested("gex:QQQ")).toBe(1);
    await commitRoot("^VIX");
    await act(async () => openGate()); // QQQ's read lands after the user moved on
    await settle();
    expect(text()).toContain("^VIX isn't in this nightly build");
    expect(text()).not.toContain("484.30");
  });

  it("does not remember a failed read: the next visit to the root reads again", async () => {
    replies["gex:SPY"] = UNAVAILABLE;
    await mount();
    expect(within('[data-testid="gex-load-error"]')).not.toBeNull();

    replies["gex:SPY"] = GEX_SPY;
    replies["gex:QQQ"] = GEX_QQQ;
    await commitRoot("QQQ");
    expect(text()).toContain("484.30");
    await commitRoot("SPY");
    expect(requested("gex:SPY")).toBe(2);
    expect(text()).toContain("751.71");
    expect(text()).not.toContain(LOAD_ERROR);
  });
});

describe("GEX desk: an archived session that could not be read is not an archive gap", () => {
  const DATE = "2026-07-09";
  beforeEach(() => {
    replies["gex:SPY"] = GEX_SPY;
    replies["gex_dates:SPY"] = json(200, {
      schema: "options_hub.gex_dates/v1",
      root: "SPY",
      dates: ["2026-07-10", "2026-07-09", "2026-07-08"],
      latest: "2026-07-10",
    });
  });

  it.each([
    ["a 5xx", UNAVAILABLE],
    ["a rejected fetch", "reject" as const],
  ])("renders the archived load error for %s", async (_label, reply) => {
    replies[`gex_at:SPY:${DATE}`] = reply;
    await mount();
    await pickSession(DATE);
    expect(requested(`gex_at:SPY:${DATE}`)).toBe(1);
    const error = within('[data-testid="gex-archived-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(ARCHIVED_ERROR(DATE));
    expect(retryIn(error)).not.toBeNull();
    expect(text()).not.toContain(ARCHIVED_MISSING(DATE));
    expect(text()).not.toContain(ARCHIVED_MISSING_WHY);
  });

  it("keeps the archive-gap copy for a real 404, with nothing to retry", async () => {
    replies[`gex_at:SPY:${DATE}`] = ABSENT;
    await mount();
    await pickSession(DATE);
    expect(within('[data-testid="gex-archived-missing"]')).not.toBeNull();
    expect(text()).toContain(ARCHIVED_MISSING(DATE));
    expect(within('[data-testid="gex-archived-error"]')).toBeNull();
    expect(retryIn()).toBeNull();
  });

  it("re-reads the session in place", async () => {
    replies[`gex_at:SPY:${DATE}`] = UNAVAILABLE;
    await mount();
    await pickSession(DATE);
    expect(within('[data-testid="gex-archived-error"]')).not.toBeNull();

    replies[`gex_at:SPY:${DATE}`] = json(200, { ...gex.SPY, asof: `${DATE}T20:15:00Z` });
    await clickRetry(within('[data-testid="gex-archived-error"]'));
    expect(requested(`gex_at:SPY:${DATE}`)).toBe(2);
    expect(within('[data-testid="gex-archived-error"]')).toBeNull();
    expect(within('[data-testid="gex-archived-missing"]')).toBeNull();
    expect(within('[data-tut="gex-ladder"]')).not.toBeNull();
  });
});

describe("GEX desk: the market-state card names a failed read", () => {
  const card = () => within('[data-tut="gex-state-card"]');
  beforeEach(() => { replies["gex:SPY"] = GEX_SPY; });

  it.each([
    ["a 5xx", UNAVAILABLE],
    ["a rejected fetch", "reject" as const],
  ])("renders the state load error for %s", async (_label, reply) => {
    replies["gexstate:SPY"] = reply;
    await mount();
    expect(requested("gexstate:SPY")).toBe(1);
    expect(text(card())).toContain(STATE_ERROR);
    expect(text(card())).not.toContain(STATE_COMPUTING);
    expect(retryIn(card())).not.toBeNull();
  });

  it("keeps 'computing' for a real 404, with nothing to retry", async () => {
    replies["gexstate:SPY"] = ABSENT;
    await mount();
    expect(text(card())).toContain(STATE_COMPUTING);
    expect(text(card())).not.toContain(STATE_ERROR);
    expect(retryIn(card())).toBeNull();
  });

  it("does not claim 'computing' while the state is still being read", async () => {
    replies["gexstate:SPY"] = "pending";
    await mount();
    expect(text(card())).toContain("Loading…");
    expect(text(card())).not.toContain(STATE_COMPUTING);
  });

  it("re-reads the state in place", async () => {
    replies["gexstate:SPY"] = "reject";
    await mount();
    expect(text(card())).toContain(STATE_ERROR);

    replies["gexstate:SPY"] = STATE_SPY;
    await clickRetry(card());
    expect(requested("gexstate:SPY")).toBe(2);
    expect(text(card())).toContain(STATE_DATA);
    expect(text(card())).not.toContain(STATE_ERROR);
  });

  it("a failed refresh keeps the state on screen and says it is the last read", async () => {
    replies["gexstate:SPY"] = STATE_SPY;
    await mount();
    expect(text(card())).toContain(STATE_DATA);

    flowInvalidate("gexstate:SPY");
    replies["gexstate:SPY"] = UNAVAILABLE;
    await refocus();
    expect(requested("gexstate:SPY")).toBe(2);
    expect(text(card())).toContain(STATE_DATA);
    expect(text(card())).toContain(STATE_REFRESH_FAILED);
    expect(text(card())).not.toContain(STATE_COMPUTING);
    expect(retryIn(card())).not.toBeNull();
  });
});

describe("GEX desk: an unread matrix is not an unpublished one", () => {
  beforeEach(() => { replies["gex:SPY"] = GEX_SPY; });

  it.each([
    ["a 5xx", UNAVAILABLE],
    ["a rejected fetch", "reject" as const],
  ])("the pick card and expiry lens name the failed read after %s", async (_label, reply) => {
    replies["matrix:SPY"] = reply;
    await mount();
    expect(requested("matrix:SPY")).toBe(1);
    const pick = within('[data-testid="gex-heatseeker-error"]');
    expect(pick).not.toBeNull();
    expect(text(pick)).toContain(HEAT_ERROR);
    expect(retryIn(pick)).not.toBeNull();
    expect(text()).not.toContain(HEAT_NULL);
    expect(text()).not.toContain(LENS_NO_MATRIX);
  });

  it("a real 404 says the pick is not published — not 'load is shared' — with the lens note", async () => {
    replies["matrix:SPY"] = ABSENT;
    await mount();
    const absent = within('[data-testid="gex-heatseeker-absent"]');
    expect(absent).not.toBeNull();
    expect(text(absent)).toContain(HEAT_ABSENT);
    expect(text()).not.toContain(HEAT_NULL);
    expect(text()).toContain(LENS_NO_MATRIX);
    expect(within('[data-testid="gex-heatseeker-error"]')).toBeNull();
    expect(retryIn()).toBeNull();
  });

  it("keeps 'no standout pick' for a published matrix whose build named no pick", async () => {
    replies["matrix:SPY"] = json(200, { ...matrix.SPY, heat_seeker: null });
    await mount();
    expect(text()).toContain(HEAT_NULL);
    expect(text()).not.toContain(HEAT_ABSENT);
    expect(within('[data-testid="gex-heatseeker-absent"]')).toBeNull();
  });

  it("re-reads the matrix in place", async () => {
    replies["matrix:SPY"] = UNAVAILABLE;
    await mount();
    expect(within('[data-testid="gex-heatseeker-error"]')).not.toBeNull();

    replies["matrix:SPY"] = MATRIX_SPY;
    await clickRetry(within('[data-testid="gex-heatseeker-error"]'));
    expect(requested("matrix:SPY")).toBe(2);
    expect(text()).toContain("3.10×");
    expect(text()).toContain("$760");
    expect(within('[data-testid="gex-heatseeker-error"]')).toBeNull();
  });

  it("the matrix view renders the load error, never 'no matrix published'", async () => {
    replies["matrix:SPY"] = UNAVAILABLE;
    await mount();
    await clickButton("Matrix");
    const error = within('[data-testid="gex-matrix-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(MTX_ERROR);
    expect(retryIn(error)).not.toBeNull();
    expect(text()).not.toContain(MTX_NONE);
  });

  it("the matrix view keeps 'no matrix published' for a real 404", async () => {
    replies["matrix:SPY"] = ABSENT;
    await mount();
    await clickButton("Matrix");
    expect(text()).toContain(MTX_NONE);
    expect(within('[data-testid="gex-matrix-error"]')).toBeNull();
  });

  it("the confluence board does not judge alignment on a partial read", async () => {
    replies["matrix:SPY"] = MATRIX_SPY;
    replies["matrix:IWM"] = json(200, matrix.IWM);
    replies["matrix:QQQ"] = UNAVAILABLE;
    await mount();
    await clickButton("Matrix");
    await clickButton("CONFLUENCE");
    expect(requested("matrix:QQQ")).toBe(1);
    const error = within('[data-testid="gex-confluence-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(CONFLUENCE_ERROR);
    expect(text()).not.toContain(CONFLUENCE_EMPTY);

    replies["matrix:QQQ"] = json(200, matrix.QQQ);
    await clickRetry(error);
    expect(requested("matrix:QQQ")).toBe(2);
    expect(within('[data-testid="gex-confluence-error"]')).toBeNull();
    expect(text()).toContain("484.30");
  });
});

describe("GEX desk: one root's reads never render under another", () => {
  it("the previous root's streamed snapshot is not committed under the new root, not even once", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    streams["gex:SPY"] = { frame: gex.SPY };
    streams["gex:QQQ"] = "silent";
    replies["gex:SPY"] = GEX_SPY;
    replies["gex:QQQ"] = "pending";
    const commits: string[] = [];
    await act(async () => root.render(
      <Profiler id="desk" onRender={() => commits.push(host.textContent ?? "")}>
        <GexDeskView />
      </Profiler>,
    ));
    await settle();
    expect(text()).toContain("751.71");

    const input = host.querySelector<HTMLInputElement>('input[list="gex-roots"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "QQQ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    commits.length = 0;
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(commits.length).toBeGreaterThan(0);
    for (const frame of commits) expect(frame).not.toContain("751.71");
    expect(text()).toContain(LOADING);
  });

  it("a late session index for the previous root never fills the new root's dropdown", async () => {
    replies["gex:SPY"] = GEX_SPY;
    replies["gex:QQQ"] = GEX_QQQ;
    replies["gex_dates:SPY"] = { gated: json(200, {
      schema: "options_hub.gex_dates/v1",
      root: "SPY",
      dates: ["2026-07-10", "2026-07-09", "2026-07-08"],
      latest: "2026-07-10",
    }) };
    replies["gex_dates:QQQ"] = ABSENT;
    await mount();
    expect(requested("gex_dates:SPY")).toBe(1);
    await commitRoot("QQQ");
    expect(text()).toContain("484.30");
    await act(async () => openGate()); // SPY's index lands after the user moved on
    await settle();
    expect(host.querySelector('select[aria-label="Archived session"]')).toBeNull();
    expect(text()).not.toContain("2026-07-09");
  });

  it("the previous root's session index is not committed under the new root, not even once", async () => {
    replies["gex:SPY"] = GEX_SPY;
    replies["gex:QQQ"] = "pending";
    replies["gex_dates:SPY"] = json(200, {
      schema: "options_hub.gex_dates/v1",
      root: "SPY",
      dates: ["2026-07-10", "2026-07-09", "2026-07-08"],
      latest: "2026-07-10",
    });
    replies["gex_dates:QQQ"] = "pending";
    const commits: string[] = [];
    await act(async () => root.render(
      <Profiler id="desk" onRender={() => commits.push(host.textContent ?? "")}>
        <GexDeskView />
      </Profiler>,
    ));
    await settle();
    expect(text(host.querySelector('select[aria-label="Archived session"]'))).toContain("2026-07-09");

    const input = host.querySelector<HTMLInputElement>('input[list="gex-roots"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "QQQ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    commits.length = 0;
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await settle();
    expect(commits.length).toBeGreaterThan(0);
    for (const frame of commits) expect(frame).not.toContain("2026-07-09");
  });

  it("a late session index for the previous root does not erase the new root's dropdown", async () => {
    replies["gex:SPY"] = GEX_SPY;
    replies["gex:QQQ"] = GEX_QQQ;
    replies["gex_dates:SPY"] = { gated: json(200, {
      schema: "options_hub.gex_dates/v1",
      root: "SPY",
      dates: ["2026-07-10", "2026-07-09", "2026-07-08"],
      latest: "2026-07-10",
    }) };
    replies["gex_dates:QQQ"] = json(200, {
      schema: "options_hub.gex_dates/v1",
      root: "QQQ",
      dates: ["2026-07-07", "2026-07-06"],
      latest: "2026-07-07",
    });
    const dropdown = () => host.querySelector('select[aria-label="Archived session"]');
    // Every commit is checked: a dropdown that vanishes and is re-read back is still a flicker.
    const commits: string[] = [];
    await act(async () => root.render(
      <Profiler id="desk" onRender={() => commits.push(text(dropdown()))}>
        <GexDeskView />
      </Profiler>,
    ));
    await settle();
    await commitRoot("QQQ");
    expect(text(dropdown())).toContain("2026-07-06");
    commits.length = 0;
    await act(async () => openGate()); // SPY's index lands after QQQ's
    await settle();
    for (const options of commits) expect(options).toContain("2026-07-06");
    expect(text(dropdown())).not.toContain("2026-07-09");
  });
});

describe("GEX desk: a failed refresh of the live snapshot is labelled, not silent", () => {
  const row = () => within('[data-testid="gex-live-refresh-failed"]');
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
    streams["gex:SPY"] = { frame: gex.SPY };
    replies["gex:SPY"] = GEX_SPY;
  });

  it("keeps the ladder, says it is the last read, and offers a Retry that re-reads", async () => {
    await mount();
    expect(text()).toContain("751.71");
    expect(row()).toBeNull();

    await act(async () => opened("gex:SPY")[0].status("unavailable"));
    await settle();
    expect(text(row())).toContain(LIVE_REFRESH_FAILED);
    expect(text()).toContain("751.71");
    expect(within('[data-testid="gex-load-error"]')).toBeNull();
    expect(text()).not.toContain(EMPTY_TITLE);

    const before = requested("gex:SPY");
    await clickRetry(row());
    expect(requested("gex:SPY")).toBe(before + 1);
    expect(row()).toBeNull();
    expect(text()).toContain("751.71");
  });

  it("a Retry that fails again keeps the ladder and the label", async () => {
    await mount();
    await act(async () => opened("gex:SPY")[0].status("unavailable"));
    await settle();
    replies["gex:SPY"] = "reject";
    await clickRetry(row());
    expect(text(row())).toContain(LIVE_REFRESH_FAILED);
    expect(text()).toContain("751.71");
  });

  it("the next pushed frame clears the label without a Retry", async () => {
    await mount();
    await act(async () => opened("gex:SPY")[0].status("unavailable"));
    await settle();
    expect(row()).not.toBeNull();
    await act(async () => opened("gex:SPY")[0].push(gex.SPY));
    await settle();
    expect(row()).toBeNull();
  });
});
