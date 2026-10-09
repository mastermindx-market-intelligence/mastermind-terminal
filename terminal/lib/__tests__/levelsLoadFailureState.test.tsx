// @vitest-environment jsdom
/**
 * Failure-state truth on the Levels board: a read that did not land is not an absence.
 *
 * The REAL flowClientCache runs against a stubbed fetch for /api/flow, so the chain is
 * exercised end to end: transport → classification → board state → rendered copy. A
 * 5xx, a rejected fetch and an unparseable body must render a load error with a Retry
 * that really re-reads; only a 404 (or a published payload that carries no levels) may
 * render "No levels for this root yet", and it offers nothing to retry. A refresh that
 * fails keeps the map already on screen and says it is the last read.
 */
import React, { act } from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/searchTrack", () => ({ trackSearch: () => undefined }));

import { LevelsView } from "@/components/levels/LevelsView";
import { flowInvalidate } from "@/lib/flowClientCache";

const LOAD_ERROR = (ticker: string) => `Could not load levels for ${ticker}`;
const NO_LEVELS = "No levels for this root yet";
const EMPTY_MAP = (ticker: string) => `No dealer-gamma levels to map for ${ticker}.`;
const READING = "Reading the gamma map…";
const NOT_PRESENT = "not present";
const REFRESH_FAILED = "Could not refresh — showing the last read.";

// One injected transport answer per f-param. Anything unlisted is a published absence.
// `gated` holds its answer until openGate() — a read that lands after the user moved on.
type Answer = { status: number; body: string };
type Reply = Answer | "reject" | "pending" | { gated: Answer };
const json = (status: number, body: unknown): Answer => ({ status, body: JSON.stringify(body) });
const UNAVAILABLE = json(503, { error: "feed unavailable" });
const ABSENT = json(404, { error: "not published" });
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

// The committed dev fixture, read as data — the payload FLOW_FIXTURE serves for SPY.
// QQQ is the same map moved to another root, so a stale SPY answer is recognisable.
let LEVELS_SPY: Answer;
let LEVELS_QQQ: Answer;
beforeAll(async () => {
  const fixture = JSON.parse(
    await readFile(path.join(process.cwd(), "public", "data", "levels_fixture.json"), "utf8"),
  ) as Record<string, Record<string, unknown>>;
  LEVELS_SPY = json(200, fixture.SPY);
  LEVELS_QQQ = json(200, { ...fixture.SPY, root: "QQQ", spot: 484.3 });
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  flowInvalidate();
  replies = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  flowInvalidate();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 12; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
async function mount() {
  await act(async () => root.render(<LevelsView />));
  await settle();
}
async function clickButton(label: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, `a "${label}" button`).toBeDefined();
  await act(async () => { button!.click(); });
  await settle();
}
// The board re-reads when the tab comes back into view — the same read its poll makes.
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
const rungs = () => host.querySelectorAll('[data-testid="levels-rung"]').length;

const FAILURES: [string, Reply][] = [
  ["a 5xx from /api/flow", UNAVAILABLE],
  ["a rejected fetch (network failure)", "reject"],
  ["an unparseable 200 body", { status: 200, body: "<html>upstream error page</html>" }],
];

describe("Levels board: a failed read is not a coverage gap", () => {
  it.each(FAILURES)("renders the load error for %s", async (_label, reply) => {
    replies["levels:SPY"] = reply;
    await mount();
    expect(requested("levels:SPY")).toBe(1);
    const error = within('[data-testid="levels-load-error"]');
    expect(error).not.toBeNull();
    expect(text(error)).toContain(LOAD_ERROR("SPY"));
    expect(retryIn(error)).not.toBeNull();
    expect(text()).not.toContain(NO_LEVELS);
    expect(text()).not.toContain(EMPTY_MAP("SPY"));
    expect(text()).not.toContain(READING);
    // The named-levels rail is derived from the same unread payload: it cannot say a
    // level is absent when the map was never read.
    expect(text()).not.toContain(NOT_PRESENT);
  });

  it("keeps the empty state for a real 404 absence, with nothing to retry", async () => {
    replies["levels:SPY"] = ABSENT;
    await mount();
    expect(text()).toContain(NO_LEVELS);
    expect(text()).toContain(EMPTY_MAP("SPY"));
    expect(text()).toContain(NOT_PRESENT);
    expect(text()).not.toContain(LOAD_ERROR("SPY"));
    expect(retryIn()).toBeNull();
  });

  it("keeps the empty state for a published payload that carries no levels", async () => {
    // What FLOW_FIXTURE serves for a root it has no map for: a 200 with an empty body.
    replies["levels:SPY"] = json(200, {});
    await mount();
    expect(text()).toContain(NO_LEVELS);
    expect(text()).toContain(EMPTY_MAP("SPY"));
    expect(text()).not.toContain(LOAD_ERROR("SPY"));
    expect(retryIn()).toBeNull();
  });

  it("does not claim absence while the map is still being read", async () => {
    replies["levels:SPY"] = "pending";
    await mount();
    expect(text()).toContain(READING);
    expect(text()).not.toContain(NO_LEVELS);
    expect(text()).not.toContain(NOT_PRESENT);
    expect(text()).not.toContain(LOAD_ERROR("SPY"));
  });

  it("renders the map for a published payload", async () => {
    replies["levels:SPY"] = LEVELS_SPY;
    await mount();
    expect(rungs()).toBeGreaterThan(0);
    expect(text()).toContain("768.56");
    expect(text()).not.toContain(NO_LEVELS);
    expect(text()).not.toContain(LOAD_ERROR("SPY"));
    expect(retryIn()).toBeNull();
  });

  it("re-reads in place: Retry asks the store again and renders what it answers", async () => {
    replies["levels:SPY"] = UNAVAILABLE;
    await mount();
    replies["levels:SPY"] = LEVELS_SPY;
    await clickRetry(within('[data-testid="levels-load-error"]'));
    expect(requested("levels:SPY")).toBe(2);
    expect(within('[data-testid="levels-load-error"]')).toBeNull();
    expect(rungs()).toBeGreaterThan(0);
    expect(text()).toContain("768.56");
  });

  it("a Retry that fails again stays a load error, never the empty state", async () => {
    replies["levels:SPY"] = UNAVAILABLE;
    await mount();
    replies["levels:SPY"] = "reject";
    await clickRetry(within('[data-testid="levels-load-error"]'));
    expect(requested("levels:SPY")).toBe(2);
    expect(within('[data-testid="levels-load-error"]')).not.toBeNull();
    expect(text()).not.toContain(NO_LEVELS);
  });

  describe("a refresh that fails keeps the map on screen", () => {
    it.each(FAILURES)("for %s, labelled as the last read with a Retry", async (_label, reply) => {
      replies["levels:SPY"] = LEVELS_SPY;
      await mount();
      expect(rungs()).toBeGreaterThan(0);
      flowInvalidate("levels:SPY");
      replies["levels:SPY"] = reply;
      await refocus();
      expect(requested("levels:SPY")).toBe(2);
      expect(rungs()).toBeGreaterThan(0);
      expect(text()).toContain("768.56");
      const stale = within('[data-testid="levels-refresh-failed"]');
      expect(stale).not.toBeNull();
      expect(text(stale)).toContain(REFRESH_FAILED);
      expect(text()).not.toContain(NO_LEVELS);
      expect(within('[data-testid="levels-load-error"]')).toBeNull();

      replies["levels:SPY"] = LEVELS_SPY;
      await clickRetry(stale);
      expect(requested("levels:SPY")).toBe(3);
      expect(within('[data-testid="levels-refresh-failed"]')).toBeNull();
      expect(rungs()).toBeGreaterThan(0);
    });

    it("but a 404 on refresh is a real withdrawal, so the map goes", async () => {
      replies["levels:SPY"] = LEVELS_SPY;
      await mount();
      flowInvalidate("levels:SPY");
      replies["levels:SPY"] = ABSENT;
      await refocus();
      expect(rungs()).toBe(0);
      expect(text()).toContain(NO_LEVELS);
      expect(within('[data-testid="levels-refresh-failed"]')).toBeNull();
      expect(retryIn()).toBeNull();
    });
  });

  describe("a read that lands after the user moved on", () => {
    it("never paints the previous root's map", async () => {
      replies["levels:SPY"] = { gated: LEVELS_SPY };
      replies["levels:QQQ"] = LEVELS_QQQ;
      await mount();
      await clickButton("QQQ");
      expect(text()).toContain("484.30");
      openGate();
      await settle();
      expect(text()).toContain("484.30");
      expect(text()).not.toContain("768.56");
    });

    it("never paints the previous root's failure", async () => {
      replies["levels:SPY"] = { gated: UNAVAILABLE };
      replies["levels:QQQ"] = LEVELS_QQQ;
      await mount();
      await clickButton("QQQ");
      openGate();
      await settle();
      expect(within('[data-testid="levels-load-error"]')).toBeNull();
      expect(text()).not.toContain(NO_LEVELS);
      expect(text()).toContain("484.30");
    });

    it("a failed read is not remembered: coming back to the root asks again", async () => {
      replies["levels:SPY"] = UNAVAILABLE;
      replies["levels:QQQ"] = LEVELS_QQQ;
      await mount();
      await clickButton("QQQ");
      replies["levels:SPY"] = LEVELS_SPY;
      await clickButton("SPY");
      expect(requested("levels:SPY")).toBe(2);
      expect(text()).toContain("768.56");
      expect(within('[data-testid="levels-load-error"]')).toBeNull();
    });
  });
});
