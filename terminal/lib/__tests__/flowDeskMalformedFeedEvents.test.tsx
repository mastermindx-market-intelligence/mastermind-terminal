// @vitest-environment jsdom
/**
 * A malformed `feed.events` reads as no prints on the watchlist rail too (#1198 G8).
 *
 *   - WatchlistRail reads the tape through the one guard, `feedEvents`, the same guard the
 *     session gauge, the coverage line and the feed list read it through. A non-array
 *     `events` (null, {}, 5, "x") no longer throws or renders NaN.
 *   - With no tide and a malformed tape the rail made no reading, so its session totals take
 *     the gauge's unavailable form (N/A), never "$0" and an even call/put split: unknown is
 *     not zero, as it already is for FlowGauge.
 *   - FlowDeskView's watchlist pick reads the same guard, so a click on a watched root with
 *     a malformed tape selects nothing instead of throwing.
 *   - An array tape is unchanged: a non-empty one gives the same totals and a pick selects the
 *     latest print; an empty one has no measured split.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowStreamStatus } from "@/lib/flowStream";

const stream = vi.hoisted(() => ({
  data: null as unknown,
  status: "data" as FlowStreamStatus,
}));
const inspector = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));

vi.mock("@/lib/flowStream", () => ({
  useFlowStream: (f: string) => f === "feed"
    ? { data: stream.data, connected: false, error: false, status: stream.status, stale: false, retry: () => {} }
    : { data: null, connected: false, error: false, status: "loading", stale: false, retry: () => {} },
}));
vi.mock("@/components/flowdesk/RadarStrip", () => ({ RadarStrip: () => null }));
vi.mock("@/components/flowdesk/InspectorPane", () => ({
  InspectorPane: (props: Record<string, unknown>) => { inspector.props = props; return null; },
}));
vi.mock("@/components/flowdesk/FeedPane", () => ({
  FeedPane: () => null,
  normalizeEnrichPayload: (raw: unknown) => raw,
}));
vi.mock("@/components/flowdesk/FiltersPanel", () => ({ DEFAULT_FILTERS: {} }));
vi.mock("@/components/tutorial/TutorialOverlay", () => ({ TutorialOverlay: () => null }));

import { FlowDeskView } from "@/components/flowdesk/FlowDeskView";
import { WatchlistRail } from "@/components/flowdesk/WatchlistRail";
import type { FeedPayload, FlowEvent } from "@/components/flowdesk/FeedPane";
import { FD } from "@/lib/flowdeskStrings";
import { LangProvider } from "@/lib/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LANGS = ["en", "zh"] as const;
const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null], ["{}", {}], ["5", 5], ['"x"', "x"],
];
const NA = { en: FD.gaugeNa.en, zh: FD.gaugeNa.zh };

const feedEv = (over: Partial<FlowEvent> = {}): FlowEvent => ({
  id: "ev1", ts: "2026-10-16T14:05:00Z", root: "SPX", group: "Index", group_zh: "指数",
  right: "C", exp: "2026-10-16", strike: 6000, dte: 0, dte_bucket: "0d",
  mny_bucket: "atm", side: "~buy", n_prints: 12, size: 250, avg_price: 3.1,
  premium: 930000, premium_z: 4.2, baseline_source: "90d", vol_gt_oi: true,
  repeated: false, zerodte: true, signing_source: "iso", ...over,
});
const feedWith = (events: unknown): FeedPayload => ({
  asof: "2026-10-16T15:00:00Z", session_date: "2026-10-16", events: events as FlowEvent[], unusual_names: [],
});
const TWO_PRINTS = () => [
  feedEv({ id: "ev1", ts: "2026-10-16T14:05:00Z", right: "C", premium: 930000 }),
  feedEv({ id: "ev2", ts: "2026-10-16T14:35:00Z", right: "P", premium: 465000 }),
];

let host: HTMLDivElement;
let root: Root;
let errors: string[];
const onWindowError = (e: ErrorEvent) => {
  errors.push(String((e.error as Error | undefined)?.message ?? e.message));
  e.preventDefault();
};

beforeEach(() => {
  errors = [];
  inspector.props = null;
  stream.data = null;
  stream.status = "data";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  // SPX is on the watchlist and the tutorial is already seen, so the desk renders a watched
  // SPX row on every tape, including one with no SPX prints to suggest it.
  const storage = new Map<string, string>([
    ["flowdesk.tutorial.seen", "1"],
    ["flowdesk.watchlist", JSON.stringify(["SPX"])],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
  });
  document.documentElement.removeAttribute("data-lang");
  window.addEventListener("error", onWindowError);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.removeEventListener("error", onWindowError);
  document.documentElement.removeAttribute("data-lang");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(ui: React.ReactElement) {
  try {
    await act(async () => root.render(ui));
  } catch (err) {
    errors.push((err as Error).message);
  }
}

const statValues = () => Array.from(host.querySelectorAll(".obs-fd-stat-val")).map((n) => n.textContent);

function mountRail(lang: "en" | "zh", events: unknown, tide: unknown = null) {
  return render(
    <WatchlistRail
      feed={feedWith(events) as never}
      tide={tide as never}
      lang={lang}
      watchlist={["SPX"]}
      onToggleTicker={() => {}}
      onPickTicker={() => {}}
    />,
  );
}

describe("WatchlistRail reads a malformed tape as no prints (G8.1)", () => {
  for (const lang of LANGS) {
    for (const [label, events] of MALFORMED) {
      it(`events ${label} (${lang}): no throw, no NaN, totals read N/A, no even split`, async () => {
        await mountRail(lang, events);
        expect(errors).toEqual([]);
        const text = host.textContent ?? "";
        expect(text).not.toContain("NaN");
        expect(statValues()).toEqual([NA[lang], NA[lang], NA[lang]]);
        expect(text).not.toContain("$0");
        expect(text).not.toContain("50%");
        expect(host.querySelector(".obs-fd-bar-fill"), "an even split is a reading the rail never made").toBeNull();
      });
    }

    it(`a non-empty array tape is unchanged (${lang})`, async () => {
      await mountRail(lang, TWO_PRINTS());
      expect(errors).toEqual([]);
      expect(statValues()).toEqual(["$1.4M", "67%", "0.50"]);
      const fill = host.querySelector<HTMLElement>(".obs-fd-bar-fill");
      expect(fill?.style.width).toBe("67%");
      expect(host.textContent ?? "").not.toContain("NaN");
    });

    for (const [label, events, tide] of [
      ["empty tape", [], null],
      ["null print", [null], null],
      ["unknown premium", [feedEv({ premium: Number.NaN })], null],
      ["malformed tide", [], { minutes: "x" }],
      ["unmeasured minute", [], { minutes: [{}] }],
    ] as const) {
      it(`${label} has no session totals or share (${lang})`, async () => {
        await mountRail(lang, events, tide);
        expect(errors).toEqual([]);
        expect(statValues()).toEqual([NA[lang], NA[lang], NA[lang]]);
        expect(host.querySelector(".obs-fd-bar-fill")).toBeNull();
      });
    }

    it(`observed zero premium has a measured total and no call share (${lang})`, async () => {
      await mountRail(lang, [feedEv({ premium: 0 })]);
      expect(statValues()).toEqual(["$0", NA[lang], "—"]);
      expect(host.querySelector(".obs-fd-bar-fill")).toBeNull();
    });
  }
});

async function mountDesk(lang: "en" | "zh", events: unknown) {
  if (lang === "zh") document.documentElement.setAttribute("data-lang", "zh");
  stream.data = feedWith(events);
  await render(<LangProvider><FlowDeskView /></LangProvider>);
}

function watchedRowButton(rootSym: string): HTMLButtonElement {
  const rows = Array.from(host.querySelectorAll(".obs-fd-wl-row"));
  const row = rows.find((r) => r.querySelector(".obs-fd-wl-ticker")?.textContent === rootSym);
  expect(row, `no watchlist row for ${rootSym}`).toBeTruthy();
  return row!.querySelector("button") as HTMLButtonElement;
}

async function click(btn: HTMLButtonElement) {
  try {
    await act(async () => { btn.click(); });
  } catch (err) {
    errors.push((err as Error).message);
  }
}

describe("FlowDeskView: a watchlist pick reads the same guard (G8.2)", () => {
  for (const lang of LANGS) {
    for (const [label, events] of MALFORMED) {
      it(`events ${label} (${lang}): the pick selects nothing and throws nothing`, async () => {
        await mountDesk(lang, events);
        expect(errors).toEqual([]);
        await click(watchedRowButton("SPX"));
        expect(errors).toEqual([]);
        expect(inspector.props?.event ?? null).toBeNull();
        const rail = host.querySelector(".obs-fd-left")?.textContent ?? "";
        expect(rail).not.toContain("NaN");
        expect(rail).not.toContain("$0");
      });
    }

    it(`a non-empty array tape is unchanged: the pick selects the latest print (${lang})`, async () => {
      const prints = TWO_PRINTS();
      await mountDesk(lang, prints);
      await click(watchedRowButton("SPX"));
      expect(errors).toEqual([]);
      expect(inspector.props?.event).toBe(prints[1]);
    });

    it(`an empty array tape is unchanged: the pick selects nothing (${lang})`, async () => {
      await mountDesk(lang, []);
      await click(watchedRowButton("SPX"));
      expect(errors).toEqual([]);
      expect(inspector.props?.event ?? null).toBeNull();
    });
  }
});
