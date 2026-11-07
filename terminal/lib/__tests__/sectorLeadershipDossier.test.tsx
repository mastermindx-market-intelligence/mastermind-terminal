// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SectorLeadershipDossier from "@/components/sector-intelligence/SectorLeadershipDossier";
import { LangProvider, applyLang } from "@/lib/i18n";
import type { FeedPayload, FeedStatus } from "@/lib/sectorIntelligence";
import ready from "./fixtures/sector_dossiers_v1.json";
import outage from "./fixtures/sector_dossiers_unavailable_v1.json";
import complete from "./fixtures/sector_window_measurements.complete.v1.json";
import unavailable from "./fixtures/sector_window_measurements.unavailable.v1.json";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payload = (read: unknown = ready) => ({ measured_read: read });
const feed = (data: unknown, status: FeedStatus = "ready"): FeedPayload => ({
  data,
  receipt: { source: "sector", status, path: "/sectordata/sector_central.json", asOf: "2026-10-09",
    observedAt: "2026-10-09T21:00:00Z", stale: false, contentHash: "sha256:transport" },
});

describe("Persistent Sector Leadership dossier — the overview section", () => {
  let root: Root, host: HTMLDivElement;
  const render = async (props: {
    feed?: FeedPayload; selectedTicker?: string; onSources?: () => void;
  } = {}) => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={feed(payload())} selectedTicker="XLK" {...props} />
    </LangProvider>));
  };
  const section = () => host.querySelector('[data-testid="sector-leadership-dossier"]')!;
  const metrics = () => [...section().querySelectorAll('[data-testid="sector-dossier-metric"]')] as HTMLElement[];
  const metric = (window: string) => metrics().find(row => row.dataset.window === window)!;
  const rows = () => [...section().querySelectorAll("tbody tr")] as HTMLElement[];
  const openCompare = async () => {
    const details = section().querySelector('[data-testid="sector-dossier-compare"]') as HTMLDetailsElement;
    await act(async () => { details.open = true; });
    return details;
  };

  beforeEach(() => {
    applyLang("en"); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
  });

  it("renders the header, the selected sector and the owner's own through date once", async () => {
    await render();
    expect(section().querySelector("h2")!.textContent).toBe("Leadership evidence");
    expect(section().textContent).toContain("Technology · XLK");
    const through = section().querySelectorAll("time");
    expect(through).toHaveLength(1);
    expect(through[0].textContent).toBe("2026-10-09");
    expect(through[0].getAttribute("dateTime")).toBe("2026-10-09");
  });

  it("shows the two exact windows as equal metrics against the admitted benchmark", async () => {
    await render({ selectedTicker: "XLE" });
    expect(metrics()).toHaveLength(2);
    // The owner's own values for Energy: +2.4 over 21 sessions, +4.1 over 63.
    expect(metrics()[0].textContent).toContain("21 sessions");
    expect(metrics()[0].textContent).toContain("+2.40%");
    expect(metrics()[1].textContent).toContain("63 sessions");
    expect(metrics()[1].textContent).toContain("+4.10%");
    expect(metrics()[0].textContent).toContain("Ahead of SPY");
    expect(metrics()[1].textContent).toContain("Ahead of SPY");
    expect(section().textContent).toContain("Relative wealth vs SPY");
  });

  it("keeps a signed zero a plain zero, with no sign and no direction", async () => {
    await render({ selectedTicker: "XLK" });
    const value = metric("63").querySelector("strong")!;
    expect(value.textContent).toBe("0.00%");
    expect(value.getAttribute("data-sign")).toBeNull();
    expect(metric("63").textContent).toContain("Level with SPY");
    // The 21-session window for the same sector is a genuine negative.
    const negative = metric("21").querySelector("strong")!;
    expect(negative.textContent).toBe("-0.50%");
    expect(negative.getAttribute("data-sign")).toBe("down");
  });

  it("never falls back to another sector when the selected identity is missing", async () => {
    await render({ selectedTicker: "QQQ" });
    expect(section().querySelector('[data-testid="sector-dossier-identity"]')!.textContent)
      .toContain("The selected sector is not part of this evidence.");
    expect(metrics()).toHaveLength(0);
    // No cohort row claims to be the selection, so no other sector stands in for it.
    await openCompare();
    expect(rows().filter(row => row.dataset.selected === "true")).toHaveLength(0);
  });

  it("states the cross-sector positive count against its measured and expected denominator", async () => {
    await render();
    const breadth = [...section().querySelectorAll('[data-testid="sector-dossier-breadth"]')].map(row => row.textContent);
    expect(breadth[0]).toContain("21 sessions: 5 of 9 measured ETF sectors are positive (11 expected).");
    expect(breadth[1]).toContain("63 sessions: 5 of 9 measured ETF sectors are positive (11 expected).");
    // The denominator is the ETF sector cohort, never constituent breadth.
    expect(section().textContent).toContain("ETF sector proxies, not constituent breadth.");
    expect(section().textContent).toContain("Mechanism and sector-risk context are unavailable from this source.");
  });

  it("carries one stance and one plain caveat, and no forecast or recommendation", async () => {
    await render();
    const text = section().textContent!;
    expect(text).toContain("Compare the evidence before acting");
    expect(text).toContain("These are observed relative moves. No forecast is available from this source.");
    // The authority disclosure names the disabled powers; the evidence itself proposes nothing.
    const body = section().cloneNode(true) as HTMLElement;
    body.querySelector('[data-testid="sector-dossier-source"]')!.remove();
    for (const forbidden of ["probability", "conviction", "recommend", "buy", "target", "rank"]) {
      expect(body.textContent!.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("lists every cohort sector in the owner's own order with its exact windows and null reasons", async () => {
    await render();
    await openCompare();
    expect(rows().map(row => row.getAttribute("data-sector")))
      .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
    const xlk = rows().find(row => row.getAttribute("data-sector") === "XLK")!;
    expect(xlk.textContent).toContain("-0.50%");
    expect(xlk.textContent).toContain("0.00%");
    const xlre = rows().find(row => row.getAttribute("data-sector") === "XLRE")!;
    expect(xlre.textContent).toContain("—");
    // The owner's machine reason reads as plain language here…
    expect(xlre.textContent).toContain("This sector group was not supplied.");
    expect(xlre.textContent).not.toContain("missing_group");
    const xlu = rows().find(row => row.getAttribute("data-sector") === "XLU")!;
    expect(xlu.textContent).toContain("Not enough history for this window.");
  });

  it("marks the selected sector's own row without changing any other row", async () => {
    await render();
    await openCompare();
    expect(rows().filter(row => row.dataset.selected === "true").map(row => row.getAttribute("data-sector")))
      .toEqual(["XLK"]);
  });

  it("discloses the owner's qualifications and keeps every machine reason exact", async () => {
    await render();
    const details = section().querySelector('[data-testid="sector-dossier-source"]') as HTMLDetailsElement;
    await act(async () => { details.open = true; });
    const text = details.textContent!;
    expect(text).toContain("Source session date");
    expect(text).toContain("2026-10-09");
    expect(text).toContain("total return");
    expect(text).toContain("Unverified — the owner supplied no freshness receipt.");
    expect(text).toContain("Reconstructed from prices; not naturally observed.");
    expect(text).toContain("The original availability time was not supplied.");
    expect(text).toContain("The native revision selection was not supplied.");
    expect(text).toContain("The immutable generation was not supplied.");
    expect(text).toContain("Not qualified by the owner; no forecast is available.");
    expect(text).toContain("Ranking, gating, sizing, trading and escalation authority are disabled.");
    expect(text).toContain("engine.sector_cycles");
    expect(text).toContain("Not established");
    // The compatibility key is present, and is explicitly not an immutable generation.
    expect(text).toContain("2026-10-09|SPY|us_sectors_11");
    expect(text).toContain("It is not an immutable generation.");
    // The exact owner reasons stay reachable.
    expect(text).toContain("XLRE: missing_group");
    expect(text).toContain("XLU: thin_history");
    // The document-level machine reasons are available in their exact raw form too.
    expect(text).toContain("owner_freshness_receipt_not_supplied");
    expect(text).toContain("native_revision_selection_not_supplied");
    expect(text).toContain("immutable_generation_not_supplied");
    expect(text).toContain("original_availability_not_supplied");
    expect(text).toContain("not_supplied_by_owner");
    expect(text).toContain("not_qualified");
    expect(text).toContain("no_qualified_evidence");
    expect(text).toContain("no_qualified_risk_context");
    expect(text).toContain("reconstructed_price_history");
    // The transport receipt is evidence of the transfer only.
    expect(text).toContain("/sectordata/sector_central.json");
    expect(text).toContain("sha256:transport");
    expect(text).toContain("Transport evidence only");
  });

  it("shows no measurement at all for a sector the owner did not measure", async () => {
    await render({ selectedTicker: "XLU" });
    const text = metrics().map(row => row.textContent);
    expect(text[0]).toContain("Not enough history for this window.");
    expect(text[0]).toContain("—");
    expect(text[0]).not.toMatch(/[+-]\d/);
    expect(text[1]).not.toMatch(/[+-]\d/);
  });

  it.each([
    ["loading", "loading"],
    ["access", "access"],
    ["unavailable", "unavailable"],
    ["invalid", "invalid"],
    ["error", "error"],
  ] as [FeedStatus, string][])("bounds the %s feed to one message and no figures", async (status, expected) => {
    await render({ feed: feed(payload(), status) });
    expect(section().getAttribute("data-state")).toBe(expected);
    expect(metrics()).toHaveLength(0);
    expect(rows()).toHaveLength(0);
    expect(section().textContent).not.toContain("+2.40%");
    expect(section().textContent).not.toContain("0.00%");
  });

  it("reads an absent dossier as a missing capability, not as an error", async () => {
    await render({ feed: feed({ sectors: [] }) });
    expect(section().getAttribute("data-state")).toBe("absent");
    expect(section().textContent).toContain("Leadership evidence is not available for this sector");
    expect(metrics()).toHaveLength(0);
  });

  it("reads an unreadable dossier as unverified and shows no values", async () => {
    const broken = JSON.parse(JSON.stringify(ready)) as { sector_dossiers: { benchmark: string } };
    broken.sector_dossiers.benchmark = "QQQ";
    await render({ feed: feed(payload(broken)) });
    expect(section().getAttribute("data-state")).toBe("invalid");
    expect(section().textContent).toContain("Leadership evidence could not be verified");
    expect(metrics()).toHaveLength(0);
    expect(section().textContent).not.toContain("+2.40%");
  });

  it("preserves all eleven null rows and source reasons in the owner's valid unavailable document", async () => {
    await render({ feed: feed(payload(outage)) });
    expect(section().getAttribute("data-state")).toBe("outage");
    expect(section().textContent).toContain("Leadership evidence is unavailable");
    expect(metrics()).toHaveLength(2);
    expect(metrics().every(row => row.querySelector("strong")!.textContent === "—")).toBe(true);
    await openCompare();
    expect(rows()).toHaveLength(11);
    expect(metric("21").textContent).toContain("The source session date is missing or invalid.");
    expect(rows()[0].textContent).toContain("The source benchmark is missing or invalid.");
    expect(rows()[0].textContent).not.toContain("benchmark_missing_or_invalid");
    expect(section().textContent).toContain("0 measured ETF sectors; 11 expected");
    expect(section().querySelector('[data-testid="sector-dossier-source"]')!.textContent)
      .toContain("XLK: source_session_missing_or_invalid");
    expect(section().textContent).not.toContain("0.00%");
  });

  it("keeps unavailable causes readable in Chinese and raw reasons inspectable", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await render({ feed: feed(payload(outage)) });
    expect(metric("21").textContent).toContain("来源交易日期缺失或无效。");
    expect(rows()[0].textContent).toContain("来源基准缺失或无效。");
    expect(rows()[0].textContent).not.toContain("benchmark_missing_or_invalid");
    expect(section().querySelector('[data-testid="sector-dossier-source"]')!.textContent)
      .toContain("benchmark_missing_or_invalid");
  });

  it("discloses the requested as-known cut without admitting historical measurements", async () => {
    const cut = structuredClone(outage);
    Object.assign(cut.sector_dossiers.availability, {
      mode: "as_known", decision_cutoff: "2026-10-08T20:00:00Z", reason: "availability_time_missing",
    });
    await render({ feed: feed(payload(cut)) });
    const source = section().querySelector('[data-testid="sector-dossier-source"]')!;
    expect(source.textContent).toContain("2026-10-08T20:00:00Z");
    expect(source.textContent).toContain("The source does not establish what was known at the requested cutoff.");
    expect(rows()).toHaveLength(11);
    expect(metrics().every(row => row.querySelector("strong")!.textContent === "—")).toBe(true);
  });

  it("uses the selected identity when its optional display names are missing", async () => {
    const unnamed = structuredClone(ready);
    Object.assign(unnamed.sector_dossiers.groups.find(row => row.group_id === "XLK")!, { name_en: null, name_zh: null });
    await render({ feed: feed(payload(unnamed)) });
    expect(section().textContent).not.toContain("null");
    expect(section().textContent).toContain("XLK");
    expect(metric("63").querySelector("strong")!.textContent).toBe("0.00%");
  });

  it("clears every figure the moment the feed stops being ready", async () => {
    await render();
    expect(section().textContent).toContain("+2.40%");
    await render({ feed: feed(payload(), "access") });
    expect(section().textContent).not.toContain("+2.40%");
    expect(section().textContent).not.toContain("0.00%");
    expect(metrics()).toHaveLength(0);
    expect(rows()).toHaveLength(0);
  });

  it("keeps the existing source drawer reachable from a bounded state", async () => {
    let opened = 0;
    await render({ feed: feed(payload(), "unavailable"), onSources: () => { opened += 1; } });
    const button = section().querySelector("button")!;
    expect(button.textContent).toContain("Read source details");
    await act(async () => { button.click(); });
    expect(opened).toBe(1);
  });

  it("localizes every label and never leaks one language into the other view", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await render({ selectedTicker: "XLK" });
    const text = section().textContent!;
    expect(text).toContain("领涨证据");
    expect(text).toContain("科技 · XLK");
    expect(text).toContain("21个交易日");
    expect(text).toContain("与SPY持平");
    expect(text).toContain("先核对证据，再作判断");
    expect(text).toContain("已测量的9个ETF板块中5个为正（预期11个）");
    expect(text).not.toContain("Leadership evidence");
    expect(text).not.toContain("Compare the evidence before acting");
  });

  it("uses native keyboard-operable disclosures and adds no focusable control of its own", async () => {
    await render();
    const compare = section().querySelector('[data-testid="sector-dossier-compare"]')!;
    const source = section().querySelector('[data-testid="sector-dossier-source"]')!;
    expect(compare.tagName).toBe("DETAILS");
    expect(source.tagName).toBe("DETAILS");
    const summary = compare.querySelector("summary")!;
    expect(summary.getAttribute("tabindex")).toBeNull();
    summary.focus();
    expect(document.activeElement).toBe(summary);
    expect(section().querySelectorAll("button, input, select, a[href]")).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- *
 * The exact-session companion.
 *
 * The canonical fixtures are the producer's own frozen documents. The parent below is a clearly
 * labelled synthetic November 5 parent — it is NOT the October 9 legacy fixture with its dates
 * moved, and it carries no legacy dossier, so the companion is proved on its own.
 * -------------------------------------------------------------------------- */
const nov5Parent = (read: unknown = complete) => ({
  schema: "leadership_rotation_context.measured_group_read/v1",
  status: "available",
  generation: {
    benchmark: "SPY", cohort_id: "us_sectors_11", history_as_of: "2026-11-05",
    history_schema: "sector_cycles.rs_history.v1", id: "2026-11-05|SPY|us_sectors_11",
    price_basis: "total_return", session_end: "2026-11-05",
  },
  groups: [],
  sector_window_measurements: read,
});
const companionFeed = (read: unknown = complete, status: FeedStatus = "ready"): FeedPayload =>
  feed({ measured_read: nov5Parent(read) }, status);

/** The clearly labelled synthetic companion variants used by the copy regressions. Each one is
 * derived from the canonical producer document and changes only the named field. */
type CompanionVariant = {
  status: string;
  reason: string | null;
  windows: Record<string, {
    status: string; null_reason: string | null; benchmark_return_pct: number | null;
    benchmark_null_reason: string | null;
  }>;
  groups: { group_id: string; windows: Record<string, {
    absolute_return_pct: number | null; relative_wealth_pct: number | null;
    null_reasons: { absolute_return_pct: string | null; relative_wealth_pct: string | null };
    status: string;
  }> }[];
  clocks: Record<string, string | null>;
  limitations: Record<string, { status: string; reason?: string; clock?: string }>;
  receipt: Record<string, unknown> | null;
  diagnostics: { complete_cells: number; measured_cells: number; receipt_withheld: boolean };
};

/** One withheld value inside an otherwise complete packet. */
const partialCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionVariant;
  const xlp63 = source.groups[6].windows["63"];
  xlp63.absolute_return_pct = null;
  xlp63.null_reasons.absolute_return_pct = "missing_input";
  xlp63.status = "partial";
  source.windows["63"].status = "partial";
  source.diagnostics.complete_cells = 32;
  source.status = "partial";
  return source;
};

/** An ordinary all-null packet with no top cause: nothing was published, and no cause is claimed. */
const allNullCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionVariant;
  source.status = "unavailable";
  source.reason = null;
  for (const key of ["5", "20", "63"]) {
    source.windows[key].status = "unavailable";
    source.windows[key].null_reason = null;
    source.windows[key].benchmark_return_pct = null;
    source.windows[key].benchmark_null_reason = "benchmark_missing";
  }
  for (const group of source.groups) {
    for (const key of ["5", "20", "63"]) {
      const cell = group.windows[key];
      cell.absolute_return_pct = null;
      cell.relative_wealth_pct = null;
      cell.null_reasons = {
        absolute_return_pct: "missing_input", relative_wealth_pct: "missing_input",
      };
      cell.status = "unavailable";
    }
  }
  source.diagnostics.complete_cells = 0;
  source.diagnostics.measured_cells = 0;
  return source;
};

/** The owner's own publication, availability and history clocks, supplied unchanged. */
const suppliedClockCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionVariant;
  for (const name of ["publication", "availability", "history"]) {
    source.clocks[name] = "2026-11-05T21:00:00Z";
    source.limitations[name] = { status: "supplied", clock: "2026-11-05T21:00:00Z" };
  }
  return source;
};

/** A receipt the owner explicitly withheld. */
const withheldReceiptCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionVariant;
  source.receipt = null;
  source.diagnostics.receipt_withheld = true;
  return source;
};

/** A bounded receipt the owner supplied. Its contents are never expanded. */
const suppliedReceiptCompanion = () => {
  const source = structuredClone(complete) as unknown as CompanionVariant;
  source.receipt = { alpha: "beta-value" };
  source.diagnostics.receipt_withheld = false;
  return source;
};

/** The clearly labelled synthetic legacy dossier for the coherent November 5 parent. It is not the
 * October 9 fixture with its dates moved: it carries its own synthetic 21/63 values. */
const LEGACY_IDS = ["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"];
function coherentBothPayload() {
  const groups = LEGACY_IDS.map((group_id, index) => ({
    group_id, name_en: null, name_zh: null, status: "available",
    relative_wealth_pct: { rs_21d: (index - 5) * 0.5, rs_63d: (index - 5) * 0.25 },
    null_reasons: { rs_21d: null, rs_63d: null },
    qualification_reasons: [] as string[],
  }));
  const positives = (key: "rs_21d" | "rs_63d") =>
    groups.filter(group => group.relative_wealth_pct[key] > 0).length;
  const legacy = {
    schema: "leadership_rotation_context.sector_dossiers/v1",
    status: "partial", measurement_status: "available",
    cohort_id: "us_sectors_11", population: "eleven_sector_etf_proxies",
    as_of: "2026-11-05", benchmark: "SPY", price_basis: "total_return", units: "pct",
    windows_sessions: [21, 63],
    unavailable_windows: { sessions: [5, 20], reason: "not_supplied_by_owner" },
    absolute_returns: { status: "unavailable", reason: "not_supplied_by_owner" },
    compatibility_key: "2026-11-05|SPY|us_sectors_11",
    source_generation: { status: "unavailable", reason: "immutable_generation_not_supplied", id: null },
    availability: {
      mode: "dated_snapshot", decision_cutoff: null, original_available_at: null,
      historically_admissible: false, reason: "original_availability_not_supplied",
    },
    history: { mode: "reconstructed_price_history", naturally_observed: false },
    freshness: { status: "unverified", reason: "owner_freshness_receipt_not_supplied" },
    corrections: { status: "unavailable", reason: "native_revision_selection_not_supplied" },
    authority: {
      may_rank: false, may_gate: false, may_size: false, may_trade: false, may_escalate: false,
    },
    forecasts: {
      status: "not_qualified", expected_return: null,
      persistence_estimate: null, allocation_weight: null,
    },
    mechanism: { status: "unavailable", reason: "no_qualified_evidence", owner: "engine.theme_graph" },
    risk: {
      status: "unavailable", reason: "no_qualified_risk_context",
      owner: "engine.risk_envelope", scope: null,
    },
    constituent_breadth: { status: "unavailable", reason: "native_membership_not_supplied" },
    constituent_concentration: { status: "unavailable", reason: "native_weights_not_supplied" },
    cross_sector_breadth_counts: {
      "21": { expected_n: 11, measured_n: 11, positive_n: positives("rs_21d") },
      "63": { expected_n: 11, measured_n: 11, positive_n: positives("rs_63d") },
    },
    dependency_audit: {
      source_roots: ["engine.sector_cycles"], source_family_count: 1,
      independence: "not_established", shared_rolling_windows: true, constituent_overlap: "unknown",
    },
    diagnostics: {
      qualification_reasons: [] as string[], duplicate_groups: [] as string[],
      outside_cohort: [] as string[], malformed_source_rows: 0, malformed_measured_rows: 0,
    },
    groups,
  };
  return {
    measured_read: {
      ...nov5Parent(),
      groups: groups.map(group => ({
        group_id: group.group_id, group_kind: "sector",
        current: {
          metric: "relative_wealth_pct", units: "pct",
          rs_21d: group.relative_wealth_pct.rs_21d, rs_63d: group.relative_wealth_pct.rs_63d,
        },
      })),
      sector_dossiers: legacy,
    },
  };
}

describe("Persistent Sector Leadership — the exact-session companion", () => {
  let root: Root, host: HTMLDivElement;
  const render = async (props: {
    feed?: FeedPayload; selectedTicker?: string; onSources?: () => void;
  } = {}) => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed()} selectedTicker="XLP" {...props} />
    </LangProvider>));
  };
  const legacy = () => host.querySelector('[data-testid="sector-leadership-dossier"]')!;
  const exact = () => host.querySelector('[data-testid="sector-exact-window-returns"]');
  const windows = () => [...(exact()?.querySelectorAll('[data-testid="sector-exact-window"]') || [])] as HTMLElement[];
  const window_ = (key: string) => windows().find(row => row.dataset.window === key)!;
  const rows = () => [...(exact()?.querySelectorAll('[data-testid="sector-exact-compare"] tbody tr') || [])] as HTMLElement[];

  beforeEach(() => {
    applyLang("en"); document.documentElement.setAttribute("data-lang", "en");
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); host.remove();
  });

  it("adds nothing at all when the owner published no companion", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={feed(payload())} selectedTicker="XLK" />
    </LangProvider>));
    expect(exact()).toBeNull();
    expect(host.querySelectorAll("section")).toHaveLength(1);
    // The accepted legacy DOM and its own values are untouched.
    expect(legacy().querySelector("h2")!.textContent).toBe("Leadership evidence");
    expect(legacy().querySelectorAll('[data-testid="sector-dossier-metric"]')).toHaveLength(2);
    expect(legacy().querySelectorAll("time")).toHaveLength(1);
  });

  it("keeps a valid companion visible when the legacy dossier itself is absent", async () => {
    await render();
    // The legacy dossier is absent from this owner document, and it says so.
    expect(legacy().getAttribute("data-state")).toBe("absent");
    expect(legacy().textContent).toContain("Leadership evidence is not available for this sector");
    // The companion is its own document, and it is still there.
    expect(exact()).not.toBeNull();
    expect(exact()!.getAttribute("data-state")).toBe("available");
    expect(exact()!.textContent).toContain("Exact session returns");
  });

  it("shows the three exact windows with the absolute return, the relative wealth, the exact span and the coverage", async () => {
    await render();
    expect(windows()).toHaveLength(3);
    expect(windows().map(row => row.dataset.window)).toEqual(["5", "20", "63"]);
    const five = window_("5");
    expect(five.textContent).toContain("5 sessions");
    expect(five.querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("+1.11%");
    expect(five.querySelector('[data-testid="sector-exact-relative"]')!.textContent).toBe("0.00%");
    expect(five.querySelector('[data-testid="sector-exact-span"]')!.textContent)
      .toContain("2026-10-29 → 2026-11-05");
    expect(five.querySelector('[data-testid="sector-exact-coverage"]')!.textContent)
      .toContain("6 of 6 observations");
    expect(window_("20").querySelector('[data-testid="sector-exact-span"]')!.textContent)
      .toContain("2026-10-08 → 2026-11-05");
    expect(window_("63").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("+14.38%");
    expect(window_("63").querySelector('[data-testid="sector-exact-coverage"]')!.textContent)
      .toContain("64 of 64 observations");
    // The interval count and the observation count are both explained.
    expect(exact()!.textContent).toContain("6, 21 and 64");
    expect(exact()!.textContent).toContain("a wealth ratio");
    // The exact 20-session window is not the legacy 21-session window.
    expect(exact()!.textContent).toContain("not the legacy 21-session window");
  });

  it("keeps the producer's signed zero an ordinary zero with no sign and no direction", async () => {
    await render();
    const relative = window_("63").querySelector('[data-testid="sector-exact-relative"]')!;
    expect(relative.textContent).toBe("0.00%");
    expect(relative.getAttribute("data-sign")).toBeNull();
    expect(relative.textContent).not.toContain("-");
    // The absolute return of the same window is a genuine positive.
    const absolute = window_("63").querySelector('[data-testid="sector-exact-absolute"]')!;
    expect(absolute.textContent).toBe("+14.38%");
    expect(absolute.getAttribute("data-sign")).toBe("up");
  });

  it("discloses the benchmark return and its coverage separately from the sector's own figures", async () => {
    await render();
    const benchmark = exact()!.querySelector('[data-testid="sector-exact-benchmark"]')!;
    expect(benchmark.textContent).toContain("Benchmark SPY");
    expect(benchmark.querySelector('[data-testid="sector-exact-benchmark-return"][data-window="5"]')!.textContent)
      .toContain("+1.11%");
    expect(benchmark.querySelector('[data-testid="sector-exact-benchmark-return"][data-window="20"]')!.textContent)
      .toContain("+4.39%");
    expect(benchmark.querySelector('[data-testid="sector-exact-benchmark-return"][data-window="63"]')!.textContent)
      .toContain("+14.38%");
    expect(benchmark.textContent).toContain("6 of 6 observations");
    expect(benchmark.textContent).toContain("64 of 64 observations");
  });

  it("keeps all eleven identities in the producer's own order with the selected one marked", async () => {
    await render();
    const details = exact()!.querySelector('[data-testid="sector-exact-compare"]') as HTMLDetailsElement;
    await act(async () => { details.open = true; });
    expect(rows().map(row => row.getAttribute("data-sector")))
      .toEqual(["XLB", "XLC", "XLE", "XLF", "XLI", "XLK", "XLP", "XLRE", "XLU", "XLV", "XLY"]);
    expect(rows().filter(row => row.dataset.selected === "true").map(row => row.getAttribute("data-sector")))
      .toEqual(["XLP"]);
    // The owner's own names and figures reach the row.
    expect(rows().find(row => row.dataset.sector === "XLE")!.textContent).toContain("Energy");
    expect(rows().find(row => row.dataset.sector === "XLE")!.textContent).toContain("+33.00%");
    // Every row carries its own coverage, in the producer's own compact form.
    expect(rows().find(row => row.dataset.sector === "XLE")!.textContent).toContain("64/64");
  });

  it("keeps a valid all-null block visible with its identities, dates, coverage and plain cause", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(unavailable)} selectedTicker="XLP" />
    </LangProvider>));
    expect(exact()!.getAttribute("data-state")).toBe("unavailable");
    expect(exact()!.textContent).toContain("Exact-session returns are unavailable");
    // No prior positive figure survives the refusal.
    expect(exact()!.textContent).not.toContain("+14.38%");
    expect(exact()!.textContent).not.toContain("+1.11%");
    // The identities, the exact dates and the observed coverage are all kept.
    const details = exact()!.querySelector('[data-testid="sector-exact-compare"]') as HTMLDetailsElement;
    await act(async () => { details.open = true; });
    expect(rows()).toHaveLength(11);
    expect(rows().map(row => row.getAttribute("data-sector"))[6]).toBe("XLP");
    expect(window_("63").querySelector('[data-testid="sector-exact-span"]')!.textContent)
      .toContain("2026-08-07 → 2026-11-05");
    expect(window_("63").querySelector('[data-testid="sector-exact-coverage"]')!.textContent)
      .toContain("64 of 64 observations");
    expect(window_("63").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("—");
    // The plain cause is readable, and the raw reason stays in the source details.
    expect(exact()!.textContent).toContain("The source panel holds sessions after the end of the measurement cut.");
    expect(exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent).toContain("future_tail");
  });

  it("leaves the legacy dossier intact when the companion cannot be verified", async () => {
    const broken = structuredClone(complete) as { benchmark: string };
    broken.benchmark = "QQQ";
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={feed(payload(ready))} selectedTicker="XLK" />
    </LangProvider>));
    // The legacy dossier still reads exactly as before.
    expect(legacy().getAttribute("data-state")).toBeNull();
    expect(legacy().querySelectorAll('[data-testid="sector-dossier-metric"]')).toHaveLength(2);
    expect(legacy().textContent).toContain("Technology · XLK");
    // A companion the consumer cannot verify stays inside its own section.
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(broken)} selectedTicker="XLK" />
    </LangProvider>));
    expect(exact()).not.toBeNull();
    expect(exact()!.getAttribute("data-state")).toBe("invalid");
    expect(exact()!.textContent).toContain("Exact-session returns could not be verified");
    expect(exact()!.querySelectorAll('[data-testid="sector-exact-window"]')).toHaveLength(0);
    expect(exact()!.textContent).not.toContain("+14.38%");
  });

  it("clears every companion figure the moment the feed stops being ready", async () => {
    await render();
    expect(exact()!.textContent).toContain("+14.38%");
    for (const status of ["loading", "access", "unavailable", "invalid", "error"] as FeedStatus[]) {
      await act(async () => root.render(<LangProvider>
        <SectorLeadershipDossier feed={companionFeed(complete, status)} selectedTicker="XLP" />
      </LangProvider>));
      expect(exact()).toBeNull();
      expect(host.textContent).not.toContain("+14.38%");
      expect(host.textContent).not.toContain("0.00%");
    }
  });

  it("changes the companion with the selection and never falls back to the previous sector", async () => {
    await render({ selectedTicker: "XLE" });
    expect(exact()!.textContent).toContain("Energy · XLE");
    expect(window_("63").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("+33.00%");
    await render({ selectedTicker: "XLB" });
    expect(exact()!.textContent).toContain("Materials · XLB");
    expect(exact()!.textContent).not.toContain("Energy · XLE");
    expect(window_("63").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("-15.50%");
  });

  it("says plainly when the selected sector is outside the measurement", async () => {
    await render({ selectedTicker: "QQQ" });
    expect(exact()!.querySelector('[data-testid="sector-exact-identity"]')!.textContent)
      .toContain("The selected sector is not part of this measurement.");
    expect(exact()!.querySelectorAll('[data-testid="sector-exact-window"]')).toHaveLength(0);
  });

  it("maps the producer's reasons and limitations into plain language and keeps the raw reason", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(unavailable)} selectedTicker="XLP" />
    </LangProvider>));
    const source = exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent!;
    // The six limitation reasons and the owner's own machine reasons stay inspectable.
    expect(source).toContain("owner_availability_clock_not_supplied");
    expect(source).toContain("owner_publication_clock_not_supplied");
    expect(source).toContain("owner_history_clock_not_supplied");
    expect(source).toContain("native_revision_selection_not_supplied");
    expect(source).toContain("owner_freshness_receipt_not_supplied");
    expect(source).toContain("point_in_time_admission_not_supplied");
    expect(source).toContain("future_tail");
    // The plain-language lines are visible in the same disclosure.
    expect(source).toContain("The original availability time was not supplied.");
    expect(source).toContain("The native revision selection was not supplied.");
    expect(source).toContain("The owner supplied no freshness receipt.");
    expect(source).toContain("The point-in-time admission was not supplied.");
    // The measurement's own availability is distinguished from the owner's clocks.
    expect(exact()!.textContent).toContain("These are the measurement's own availability.");
    // It is never called independent corroboration of the dossier.
    expect(exact()!.textContent).toContain("It is not independent, naturally observed corroboration");
  });

  it("localizes fully in Chinese and never leaks English", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await render();
    const text = exact()!.textContent!;
    expect(text).toContain("精确交易时段回报");
    expect(text).toContain("精确结束交易日");
    expect(text).toContain("板块绝对回报");
    expect(text).toContain("必需消费 · XLP");
    expect(text).toContain("与SPY持平".length > 0 ? "基准 SPY" : "");
    expect(text).not.toContain("Exact session returns");
    expect(text).not.toContain("Sector absolute return");
    expect(text).not.toContain("Benchmark SPY");
  });

  it("adds no focusable control and no second ranking of its own", async () => {
    await render();
    expect(exact()!.querySelectorAll("button, input, select, a[href]")).toHaveLength(0);
    expect(exact()!.querySelectorAll("th[scope]").length).toBeGreaterThan(0);
    // The comparison is the producer's own order, not a rank.
    expect(exact()!.querySelector('[data-testid="sector-exact-compare"]')!.textContent)
      .not.toMatch(/rank/i);
  });

  it("describes a partial packet accurately and keeps every published value", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(partialCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const text = exact()!.textContent!;
    // A partial packet is not an unavailable one: the blanket denial is absent.
    expect(text).not.toContain("Exact-session returns are unavailable");
    expect(text).not.toContain("The owner withheld every measurement for this cut.");
    expect(text).toContain("Some exact-session measurements are missing");
    // The published value survives beside the withheld one, and the reason stays with the value.
    expect(window_("63").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("—");
    expect(window_("63").querySelector('[data-testid="sector-exact-relative"]')!.textContent).toBe("0.00%");
    expect(window_("63").textContent).toContain("The source supplied no value for this measurement.");
    // The other windows keep their own published values.
    expect(window_("5").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("+1.11%");
  });

  it("describes a partial packet accurately in Chinese", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(partialCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const text = exact()!.textContent!;
    expect(text).not.toContain("精确时段回报暂不可用");
    expect(text).not.toContain("来源扣留了此截面的全部测量值。");
    expect(text).toContain("部分精确时段测量值缺失");
    expect(window_("63").querySelector('[data-testid="sector-exact-relative"]')!.textContent).toBe("0.00%");
  });

  it("does not call an ordinary all-null packet a deliberate withholding", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(allNullCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const text = exact()!.textContent!;
    // The owner published nothing and named no cause: no withholding is claimed.
    expect(text).not.toContain("The owner withheld every measurement for this cut.");
    expect(text).toContain("No exact-session returns were published");
    expect(text).toContain("named no overall refusal cause");
    // The identities, the dates and the coverage are still kept.
    const details = exact()!.querySelector('[data-testid="sector-exact-compare"]') as HTMLDetailsElement;
    await act(async () => { details.open = true; });
    expect(rows()).toHaveLength(11);
    expect(window_("63").querySelector('[data-testid="sector-exact-span"]')!.textContent)
      .toContain("2026-08-07 → 2026-11-05");
    expect(window_("63").querySelector('[data-testid="sector-exact-coverage"]')!.textContent)
      .toContain("64 of 64 observations");
  });

  it("keeps a supplied owner clock visible and stops denying it", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(suppliedClockCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const text = exact()!.textContent!;
    // The blanket denial of the owner's clocks is gone when the owner supplied them.
    expect(text).not.toContain("The original availability, publication and history times were not supplied");
    expect(text).toContain("A supplied clock does not establish verified freshness");
    // The owner's own clock text is preserved unchanged.
    expect(text).toContain("2026-11-05T21:00:00Z");
    // The separate limitations are untouched by a supplied clock.
    expect(text).toContain("The owner supplied no freshness receipt.");
    expect(text).toContain("The point-in-time admission was not supplied.");
    expect(text).toContain("The native revision selection was not supplied.");
  });

  it("keeps a supplied owner clock visible in Chinese and stops denying it", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(suppliedClockCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const text = exact()!.textContent!;
    expect(text).not.toContain("原始可用时间、发布时间与历史截断时间均未提供");
    expect(text).toContain("所提供的时钟无法确立已核实的新鲜度");
    expect(text).toContain("2026-11-05T21:00:00Z");
    expect(text).toContain("来源未提供新鲜度凭据。");
  });

  it("distinguishes an unsupplied receipt from an explicitly withheld one", async () => {
    // The canonical document carries no receipt and never says it was withheld.
    await render();
    const source = exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent!;
    expect(source).toContain("The owner supplied no receipt.");
    expect(source).not.toContain("The owner withheld its receipt.");
    // An explicitly withheld receipt is named as withheld.
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(withheldReceiptCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const withheld = exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent!;
    expect(withheld).toContain("The owner withheld its receipt.");
    expect(withheld).not.toContain("The owner supplied no receipt.");
    // A bounded receipt is reported as supplied, never expanded and never a proof.
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(suppliedReceiptCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const supplied = exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent!;
    expect(supplied).toContain("The owner supplied a bounded receipt. It is not a measurement.");
    expect(supplied).not.toContain("beta-value");
    expect(supplied).not.toContain("alpha");
  });

  it("distinguishes the receipt states in Chinese", async () => {
    applyLang("zh"); document.documentElement.setAttribute("data-lang", "zh");
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(complete)} selectedTicker="XLP" />
    </LangProvider>));
    const source = exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent!;
    expect(source).toContain("来源未提供凭据。");
    expect(source).not.toContain("来源扣留了其凭据。");
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={companionFeed(withheldReceiptCompanion())} selectedTicker="XLP" />
    </LangProvider>));
    const withheld = exact()!.querySelector('[data-testid="sector-exact-source"]')!.textContent!;
    expect(withheld).toContain("来源扣留了其凭据。");
    expect(withheld).not.toContain("来源未提供凭据。");
  });

  it("renders both the legacy dossier and the exact companion in one coherent owner document", async () => {
    await act(async () => root.render(<LangProvider>
      <SectorLeadershipDossier feed={feed(coherentBothPayload())} selectedTicker="XLB" />
    </LangProvider>));
    // The legacy section keeps its own synthetic 21/63 figures.
    expect(legacy().getAttribute("data-state")).toBeNull();
    expect(legacy().textContent).toContain("-2.50%");
    expect(legacy().textContent).toContain("-1.25%");
    // The companion section keeps its own exact figures in the same document.
    expect(exact()!.getAttribute("data-state")).toBe("available");
    expect(window_("63").querySelector('[data-testid="sector-exact-absolute"]')!.textContent).toBe("-15.50%");
  });
});
