// @vitest-environment jsdom
/** R2-PR5 — ExposureScanTable presentational contract: loading → ready, the
 * counts line, rollout "next" vs non-rollout labels with NO fetch for books
 * outside the rollout, the inspector read of the reduction, a versioned
 * refresh whose FLAGS/REVISIONS never rewrite the original, the admitted-only
 * filter, the zh footer, and no raw reason enum in the DOM.
 * `@testing-library/react` is not installed; the repo's createRoot + act
 * jsdom pattern is used (ExposureChangeInspector.test.tsx). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const { outcomes, calls } = vi.hoisted(() => ({
  outcomes: {} as Record<string, unknown>,
  calls: [] as string[],
}));

vi.mock("@/lib/flowClientCache", () => ({
  flowGetResult: (f: string) => {
    calls.push(f);
    return Promise.resolve(outcomes[f] ?? { status: "absent", httpStatus: 404 });
  },
}));

import ExposureScanTable from "@/components/exposure-map/ExposureScanTable";
import observedProducerV2 from "./fixtures/exposure-projection-observed-v2.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = "2026-10-20";
const NOW = Date.parse(`${SESSION}T22:00:00Z`);
const MN = 1e6;
const PRESETS = ["SPY", "QQQ", "SPXW", "IWM", "NDXP", "AAPL"];

interface Receipt {
  root: string; security_id: string; source_snapshot_ref: string; input_sha256: string;
  clocks: Record<string, string | null>; underlying_reference: Record<string, unknown>;
  valuation: { source_session: string };
  cell_count: number;
  expiry_terms: Array<[string, string | null]>;
  contract_identity: { root: string; source_session: string; effective_from: string;
    effective_to: string; known_at: string; security_id: string; listing_key: string;
    reference_pages: Array<{ params: Record<string, unknown>; completed_at: string }>;
    contract_keys: unknown; observed_contract_keys: unknown;
    [key: string]: unknown };
  population: { scope: string };
  cells: Array<[number, number, number, Array<Array<number | string | null | Record<string, unknown>>>, unknown[]]>;
  [key: string]: unknown;
}

/** The observed-v2 producer fixture moved onto the test session, with gamma
 * nets that reproduce the oracle base shape: dominant 102, runner-up 80/100.
 * The one bound-incomplete cell (its strike is bound to a single contract, so
 * it can never be a valid complete zero) is dropped with its key bindings —
 * a whole-book scan needs every cell complete. */
const receipt = (root: "SPY" | "QQQ", nets: Record<number, number>): Receipt => {
  const book = JSON.parse(JSON.stringify(observedProducerV2)) as Receipt;
  const next = new Date(Date.parse(SESSION) + 86_400_000).toISOString().slice(0, 10);
  book.root = root;
  book.security_id = root === "QQQ" ? "SEC:US-XNAS-QQQ" : "SEC:US-ARCX-SPY";
  book.clocks.source_session = SESSION;
  book.clocks.oi_report_date = SESSION;
  book.clocks.oi_available_at = `${SESSION}T12:00:00+00:00`;
  book.clocks.greeks_available_at = `${SESSION}T20:00:00+00:00`;
  book.clocks.available_at = `${SESSION}T21:00:00+00:00`;
  book.underlying_reference.source_session = SESSION;
  book.valuation.source_session = SESSION;
  const id = book.contract_identity;
  id.root = root; id.security_id = book.security_id; id.source_session = SESSION;
  id.effective_from = SESSION; id.effective_to = next; id.known_at = `${SESSION}T21:00:00+00:00`;
  id.listing_key = root === "QQQ" ? "US-XNAS-QQQ" : "US-ARCX-SPY";
  const page = id.reference_pages[0];
  page.params.underlying_ticker = root;
  page.params.as_of = SESSION;
  page.params["expiration_date.gte"] = SESSION;
  page.completed_at = `${SESSION}T20:30:00+00:00`;
  const dropped = new Set(book.cells.filter((w) => w[3][0][5] == null)
    .map((w) => `${book.expiry_terms[w[0]][0]}|${Number(w[1])}`));
  book.cells = book.cells.filter((w) => !dropped.has(`${book.expiry_terms[w[0]][0]}|${Number(w[1])}`));
  id.contract_keys = (id.contract_keys as Array<[string, string, string]>)
    .filter((k) => !dropped.has(`${k[0]}|${Number(k[1])}`));
  id.observed_contract_keys = (id.observed_contract_keys as Array<[string, string, string]>)
    .filter((k) => !dropped.has(`${k[0]}|${Number(k[1])}`));
  book.cell_count = book.cells.length;
  for (const wire of book.cells) {
    const net = nets[wire[1]];
    if (net == null) continue;
    const gamma = wire[3][0];
    gamma[5] = net * MN; gamma[6] = Math.abs(net) * 2 * MN;
    gamma[7] = net * MN; gamma[8] = Math.abs(net) * 2 * MN;
  }
  return book;
};

const gexPayload = (root: string, book: Receipt) => ({ root, asof: `${SESSION}T21:00:00Z`,
  spot_ref: 100, convention: "assumed_long_call_short_put", by_strike: [], by_expiry: [],
  exposure_projection: book });
const movesPayload = (root: string) => ({ schema: "options_hub.moves/v1", root,
  asof: `${SESSION}T15:45:00Z`, spot_ref: 100,
  expected_move: { pct: 2, horizon_days: 1, band_mult: 1 } });

const spy = () => receipt("SPY", { 102: -100, 100: -80, 99: -80, 98: -60 });
const qqq = () => receipt("QQQ", { 102: -95, 100: -75, 99: -75, 98: -55 });
const spyMoved = () => receipt("SPY", { 105: -100, 100: -80, 99: -80, 98: -60 });

const load = () => {
  outcomes[`gex:SPY`] = { status: "data", data: gexPayload("SPY", spy()) };
  outcomes[`moves:SPY`] = { status: "data", data: movesPayload("SPY") };
  outcomes[`gex:QQQ`] = { status: "data", data: gexPayload("QQQ", qqq()) };
  outcomes[`moves:QQQ`] = { status: "data", data: movesPayload("QQQ") };
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  for (const key of Object.keys(outcomes)) delete outcomes[key];
  calls.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const renderTable = (lang: "en" | "zh" = "en") => {
  act(() => { root.render(<ExposureScanTable presets={PRESETS} lang={lang} now={NOW} />); });
};
const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const section = () => document.querySelector<HTMLElement>("[data-scan-status]")!;
const rows = () => Array.from(section().querySelectorAll("tbody tr"));
const rowOf = (preset: string) => rows().find((r) => r.textContent?.includes(preset));
const buttonOf = (label: string) => Array.from(section().querySelectorAll("button"))
  .find((b) => b.textContent === label);
const inspector = () => document.querySelector<HTMLElement>("aside")!;

describe("ExposureScanTable", () => {
  it("moves loading → ready with skeleton rows and the counts line", async () => {
    load();
    renderTable();
    expect(section().getAttribute("data-scan-status")).toBe("loading");
    expect(rows().length).toBe(5);
    await flush();
    expect(section().getAttribute("data-scan-status")).toBe("ready");
    expect(section().getAttribute("data-scan-revision")).toBe("1");
    expect(section().textContent).toContain("6 presets · 2 scored · 4 unscored");
    expect(section().textContent).toContain("Scanner e7-reconstruction/v1 · rev 1");
  });

  it("labels the next rollout root and never fetches outside the rollout", async () => {
    load();
    renderTable();
    await flush();
    expect(rowOf("SPXW")?.textContent).toContain("identity unadmitted · next");
    expect(rowOf("AAPL")?.textContent).toContain("identity unadmitted");
    expect(rowOf("AAPL")?.textContent).not.toContain("next");
    expect(calls.some((f) => f.includes("AAPL"))).toBe(false);
    expect(calls.filter((f) => f.startsWith("gex:")).length).toBe(5);
  });

  it("fills the inspector from the selected row's reduction", async () => {
    load();
    renderTable();
    await flush();
    act(() => { rowOf("SPY")?.querySelector("button")?.click(); });
    await flush();
    expect(inspector().querySelector("h3")?.textContent).toBe("SPY");
    expect(inspector().textContent).toContain("CANDIDATE 2 / 2");
    expect(inspector().textContent).toContain("Dominance u");
    expect(inspector().textContent).toContain("Concentration c");
    expect(inspector().textContent).toContain("Strength");
    expect(inspector().textContent).toContain("78");
  });

  it("appends a versioned refresh: flags, rev tag, revisions, untouched original", async () => {
    load();
    renderTable();
    await flush();
    act(() => { rowOf("SPY")?.querySelector("button")?.click(); });
    await flush();
    outcomes[`gex:SPY`] = { status: "data", data: gexPayload("SPY", spyMoved()) };
    act(() => { buttonOf("Refresh")?.click(); });
    await flush();
    expect(section().getAttribute("data-scan-revision")).toBe("2");
    expect(section().textContent).toContain("rev 2");
    const spyRow = rowOf("SPY")!;
    expect(spyRow.textContent).toContain("node moved 102 → 105");
    const revisions = inspector().textContent ?? "";
    expect(revisions).toContain("REVISIONS");
    expect(revisions).toContain("rev 1 original");
    expect(revisions).toContain("rev 2");
    expect(revisions).toContain("102 · 78");
    expect(revisions).toContain("105");
  });

  it("hides identity-less rows behind the admitted-only toggle", async () => {
    load();
    renderTable();
    await flush();
    expect(rows().length).toBe(6);
    act(() => { buttonOf("Admitted identity only")?.click(); });
    expect(rows().length).toBe(2);
    expect(rows().map((r) => r.textContent?.includes("QQQ"))).toContain(true);
  });

  it("renders the zh footer and never leaks a raw reason enum", async () => {
    load();
    renderTable("zh");
    await flush();
    outcomes[`gex:SPY`] = { status: "data", data: gexPayload("SPY", spyMoved()) };
    act(() => { buttonOf("刷新")?.click(); });
    await flush();
    expect(section().textContent).toContain("空评分是一个原因，绝不是零");
    const text = document.body.textContent ?? "";
    for (const raw of ["identity_unadmitted", "insufficient_coverage", "outside_horizon",
      "metric_not_scanned", "book_unavailable", "missing_expected_move"]) {
      expect(text).not.toContain(raw);
    }
  });
});

