// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import SectorLeadershipDossier from "@/components/sector-intelligence/SectorLeadershipDossier";
import { LangProvider, applyLang } from "@/lib/i18n";
import type { FeedPayload, FeedStatus } from "@/lib/sectorIntelligence";
import ready from "./fixtures/sector_dossiers_v1.json";
import outage from "./fixtures/sector_dossiers_unavailable_v1.json";

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
