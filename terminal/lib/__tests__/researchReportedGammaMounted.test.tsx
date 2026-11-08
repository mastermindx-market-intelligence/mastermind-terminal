// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionsResearchLab } from "@/components/researchlab/OptionsResearchLab";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { formatExposureMn, readCompanionGexSnapshot } from "@/lib/optionsCompanion";
import { flowGetResult } from "@/lib/flowClientCache";
import type { MastermindBrainHost } from "@/lib/mastermindBrain";
import type { OptionsQuestionReference } from "@/lib/optionsQuestionContext";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";

vi.mock("next/dynamic", () => ({ default: () => () => <span>3D renderer</span> }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: vi.fn() }));
const load = vi.mocked(flowGetResult);
const asData = (data: unknown) => ({ status: "data" as const, data });
const asAbsent = () => ({ status: "absent" as const, httpStatus: 404 });

const SESSION = "2026-10-19", PRIOR = "2026-10-16", EXPIRY = "2026-10-23";
const NOW = Date.parse("2026-10-21T12:00:00Z");
const matrix = {
  schema: "options_structure.matrix/v1", root: "SPY", asof: "2026-10-20T02:00:00Z",
  _build_meta: { asof_date: SESSION },
  cells: [
    { strike: 100, expiry: EXPIRY, gex: -100, call_vol: 243, call_oi: 110, put_vol: 0, put_oi: 9 },
    { strike: 103, expiry: EXPIRY, gex: 40, call_vol: 12, call_oi: 30, put_vol: 4, put_oi: 8 },
    { strike: 104, expiry: EXPIRY, gex: 5, call_vol: 2, call_oi: 3, put_vol: 1, put_oi: 2 },
    { strike: 159, expiry: "2026-11-06", gex: 12, call_vol: 7, call_oi: 21, put_vol: 0, put_oi: null },
  ],
};
// A valid aggregate archive without a reported basis: the panel must say the
// contract-level evidence is missing, never fill it from the scalar totals.
const aggregatePrior = { schema: "options_hub.gex/v1", root: "SPY", asof: PRIOR, spot_ref: 100,
  net_gex_bn: 1, by_strike: [{ strike: 100, gamma_net: 2 }] };
const foreignRootSource = { schema: "options_hub.gex/v1", root: "QQQ", asof: SESSION, spot_ref: 100,
  net_gex_bn: 1, by_strike: [{ strike: 100, gamma_net: 2 }] };

const dates = { root: "SPY", dates: [SESSION, PRIOR], latest: SESSION };
const archive = (scale = 1) => reportedGammaBook(PRIOR, scale);
const wire = (previous: unknown = archive()) => load.mockImplementation(async key =>
  key === "gex_dates:SPY" ? asData(dates) : key === `gex_at:SPY:${PRIOR}` ? asData(previous) : asAbsent());

/** Reference values come from the existing reader, not a reimplemented encoder. */
function memberValue(book: unknown, expiry: string, strike: number, right: "C" | "P"): number {
  const read = readCompanionGexSnapshot(book, "SPY", NOW);
  if (!read.ok || !read.value.measurement?.reportedGamma) throw new Error("fixture has no reported basis");
  const member = read.value.measurement.reportedGamma.members
    .find(m => m.expiry === expiry && m.strike === strike && m.right === right);
  if (!member || member.valueUsd === null) throw new Error("fixture member missing");
  return member.valueUsd;
}
const usd = (value: number | null) => value == null ? "—" : formatExposureMn(value / 1_000_000);

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubGlobal("crypto", webcrypto);
  load.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function mount(options: { source?: unknown; lang?: "en" | "zh" } = {}) {
  await act(async () => root.render(<OptionsResearchLab root="SPY" matrix={matrix} lang={options.lang ?? "en"}
    onClose={() => {}} currentGexSnapshot={"source" in options ? options.source : reportedGammaBook(SESSION)} />));
}
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === text);
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
const memoryStatus = () => host.querySelector("[data-memory-status]")?.getAttribute("data-memory-status");
const panel = () => host.querySelector<HTMLElement>('[data-testid="research-reported-gamma"]');
const pin = () => host.querySelector<HTMLElement>('[data-testid="research-reported-gamma-pin"]');
async function openReplay(lang: "en" | "zh") {
  await click(lang === "en" ? "Replay & change" : "回放与变化");
  for (let n = 0; n < 60 && memoryStatus() !== "ready"; n++) await act(async () => new Promise(r => setTimeout(r, 5)));
  expect(memoryStatus()).toBe("ready");
  expect(panel()).not.toBeNull();
}

it.each(["en", "zh"] as const)("pins the selected row by its own side and expiry in %s", async lang => {
  wire(archive(2));
  await mount({ lang });
  await click(lang === "en" ? "100 Call · 2026-10-23" : "100 看涨 · 2026-10-23");
  await openReplay(lang);
  // Matched cohort heading and the reported-dollar basis, never per-option gamma.
  expect(panel()!.textContent).toContain(`119 ${optionsT(lang)("memoryMatchedContracts")}`);
  expect(panel()!.textContent).toContain(lang === "en" ? "reported Gamma dollars" : "已报告 Gamma 美元");
  expect(panel()!.textContent).toContain(optionsT(lang)("memoryGammaUnit"));
  expect(panel()!.textContent).toContain(optionsT(lang)("memoryReportedLimits"));
  expect(panel()!.textContent).not.toContain(lang === "en" ? "Not in this snapshot" : "此快照未提供");
  const prev = memberValue(archive(2), EXPIRY, 100, "C"), cur = memberValue(reportedGammaBook(SESSION), EXPIRY, 100, "C");
  expect(pin()!.getAttribute("data-pin-state")).toBe("pinned");
  expect(pin()!.querySelector("b")!.textContent).toBe(`${usd(prev)} → ${usd(cur)}`);
  expect(pin()!.querySelector("small")!.textContent).toContain(`· ${usd(cur - prev)}`);
  expect(pin()!.textContent).toContain(lang === "en" ? "Selected contract" : "所选合约");
  expect(pin()!.textContent).toContain(`${lang === "en" ? "100 Call" : "100 看涨"} · ${EXPIRY}`);
  expect(panel()!.textContent).toContain(PRIOR);
  // Source keys and recorded availability live in the closed details; the matrix
  // build clock is not a source clock.
  const details = host.querySelector('[data-testid="research-reported-gamma-details"]') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  await act(async () => (details.querySelector("summary") as HTMLElement).click());
  expect(details.open).toBe(true);
  expect(details.textContent).toMatch(/[0-9a-f]{64}/);
  expect(details.textContent).toContain("2026-10-20T09:00:00Z");
  expect(details.textContent).toContain("2026-10-20T10:00:00Z");
  expect(panel()!.textContent).not.toContain(matrix.asof);
  // The full-chain replay gap stays distinct from this comparison.
  expect(host.textContent).toContain(lang === "en"
    ? "Dated chain frames and availability times are not supplied" : "共享回放尚未提供带日期的期权链帧");
  // Back in the chain lens the reported dollars are gone and the exact inspector
  // still keeps per-option gamma out of this snapshot.
  await click(lang === "en" ? "Chain landscape" : "期权链分布");
  expect(panel()).toBeNull();
  expect(host.querySelector('[data-testid="research-inspector"]')!.textContent)
    .toContain(lang === "en" ? "Not in this snapshot" : "此快照未提供");
});

it("keeps the pin on the selected side and re-pins without duplicate reads", async () => {
  wire(archive(2));
  await mount({});
  await click("103 Put · 2026-10-23");
  await openReplay("en");
  const prev = memberValue(archive(2), EXPIRY, 103, "P"), cur = memberValue(reportedGammaBook(SESSION), EXPIRY, 103, "P");
  expect(pin()!.getAttribute("data-pin-state")).toBe("pinned");
  expect(pin()!.querySelector("b")!.textContent).toBe(`${usd(prev)} → ${usd(cur)}`);
  expect(pin()!.textContent).toContain("Put");
  const reads = load.mock.calls.length;
  await click("103 Call · 2026-10-23");
  expect(pin()!.querySelector("b")!.textContent)
    .toBe(`${usd(memberValue(archive(2), EXPIRY, 103, "C"))} → ${usd(memberValue(reportedGammaBook(SESSION), EXPIRY, 103, "C"))}`);
  expect(pin()!.textContent).toContain("Call");
  expect(load.mock.calls.length).toBe(reads);
});

it("renders an agreeing vintage as a truthful zero change, never a filled value", async () => {
  wire(archive(1));
  await mount({});
  await click("100 Call · 2026-10-23");
  await openReplay("en");
  expect(pin()!.getAttribute("data-pin-state")).toBe("pinned");
  expect(pin()!.querySelector("b")!.textContent).toBe(`${usd(10000)} → ${usd(10000)}`);
  expect(pin()!.querySelector("small")!.textContent).toContain("· 0");
});

it("states why the pin is absent: no selection, unreported coordinate and unqualified member", async () => {
  wire(archive(2));
  await mount({});
  await click("Replay & change");
  for (let n = 0; n < 60 && memoryStatus() !== "ready"; n++) await act(async () => new Promise(r => setTimeout(r, 5)));
  expect(memoryStatus()).toBe("ready");
  expect(pin()!.getAttribute("data-pin-state")).toBe("no_selection");
  expect(pin()!.textContent).toContain("Select a coordinate");
  expect(panel()!.getAttribute("data-comparison-state")).toBe("data");

  await click("Chain landscape");
  await click("104 Call · 2026-10-23");
  await openReplay("en");
  expect(pin()!.getAttribute("data-pin-state")).toBe("member_absent");
  expect(pin()!.textContent).toContain("not reported on both sessions");
  expect(panel()!.getAttribute("data-comparison-state")).toBe("data");

  await click("Chain landscape");
  await click("159 Put · 2026-11-06");
  await openReplay("en");
  expect(pin()!.getAttribute("data-pin-state")).toBe("member_unqualified");
  expect(pin()!.textContent).toContain("no qualified reported value");
  expect(panel()!.getAttribute("data-comparison-state")).toBe("data");
});

it("renders incumbent comparator refusals instead of dollar output", async () => {
  // One vintage declares a different Gamma convention: the incumbent definition refusal.
  const current = reportedGammaBook(SESSION);
  current.exposure_projection.greek_provenance.gamma.model_ref += "-different";
  wire(archive(2));
  await mount({ source: current });
  await click("100 Call · 2026-10-23");
  await openReplay("en");
  expect(panel()!.getAttribute("data-comparison-state")).toBe("unavailable");
  expect(panel()!.getAttribute("data-reason")).toBe("definition");
  expect(panel()!.textContent).toContain(optionsT("en")("memoryDefinitionMismatch"));
  expect(pin()).toBeNull();

  // A valid scalar archive without the reported basis: missing comparison evidence.
  wire(aggregatePrior);
  await mount({});
  await click("100 Call · 2026-10-23");
  await openReplay("en");
  expect(panel()!.getAttribute("data-comparison-state")).toBe("unavailable");
  expect(panel()!.getAttribute("data-reason")).toBe("missing_basis");
  expect(panel()!.textContent).toContain(optionsT("en")("memoryMissingComparison"));
});

it("mounts nothing without a supplied current source and never reads the live cache", async () => {
  await mount({ source: null });
  await click("Replay & change");
  expect(memoryStatus()).toBeUndefined();
  expect(panel()).toBeNull();
  expect(host.textContent).toContain("No current all-expiry GEX source is supplied");
  expect(host.textContent).toContain("Dated chain frames and availability times are not supplied");
  expect(load).not.toHaveBeenCalled();
  // An omitted prop behaves exactly like an explicit null.
  await mount({ source: undefined });
  expect(load).not.toHaveBeenCalled();
  expect(panel()).toBeNull();
});

it("keeps the incumbent refusal fences: session mismatch, foreign root and invalidation", async () => {
  wire(archive(2));
  await mount({ source: reportedGammaBook(PRIOR) });
  await click("100 Call · 2026-10-23");
  await click("Replay & change");
  for (let n = 0; n < 60 && memoryStatus() !== "mismatch"; n++) await act(async () => new Promise(r => setTimeout(r, 5)));
  expect(memoryStatus()).toBe("mismatch");
  expect(panel()).toBeNull();
  expect(load.mock.calls.some(([key]) => key === "gex:SPY")).toBe(false);

  await mount({ source: foreignRootSource });
  for (let n = 0; n < 60 && memoryStatus() !== "unavailable"; n++) await act(async () => new Promise(r => setTimeout(r, 5)));
  expect(memoryStatus()).toBe("unavailable");
  expect(panel()).toBeNull();

  // A changed matrix session invalidates the comparison through the incumbent fence.
  await act(async () => root.render(<OptionsResearchLab root="SPY"
    matrix={{ ...matrix, _build_meta: { asof_date: PRIOR } }} currentGexSnapshot={reportedGammaBook(SESSION)}
    lang="en" onClose={() => {}} />));
  for (let n = 0; n < 60 && memoryStatus() !== "mismatch"; n++) await act(async () => new Promise(r => setTimeout(r, 5)));
  expect(memoryStatus()).toBe("mismatch");
  expect(panel()).toBeNull();
  // A changed root withdraws the whole owner together with the matrix.
  await act(async () => root.render(<OptionsResearchLab root="QQQ" matrix={matrix}
    currentGexSnapshot={reportedGammaBook(SESSION)} lang="en" onClose={() => {}} />));
  expect(memoryStatus()).toBeUndefined();
  expect(panel()).toBeNull();
  expect(host.textContent).toContain("Matrix unavailable");
});


it("composes the same exact pin with account-bound staging and reported-Gamma navigation", async () => {
  wire(archive(2));
  const brainHost = window as unknown as MastermindBrainHost;
  const submit = vi.fn<(ref: OptionsQuestionReference) => boolean>().mockReturnValue(true);
  const clear = vi.fn();
  brainHost.MM_BRAIN_CFG = { principal: "one" };
  brainHost.MMBrain = { submitOptionsQuestion: submit, clearOptionsQuestion: clear };
  try {
    await act(async () => root.render(<OptionsResearchLab root="SPY" matrix={{ ...matrix,
      _matrix_source_identity: { schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY",
        session: SESSION, sha256: "a".repeat(64), byte_length: 1234 } }}
      lang="en" onClose={() => {}} currentGexSnapshot={reportedGammaBook(SESSION)} questionOwnerKey="account:one" />));
    await click("100 Call · 2026-10-23");
    const stage = () => host.querySelector<HTMLButtonElement>('[data-testid="research-question-action"] button')!;
    expect(stage().disabled).toBe(false);
    await act(async () => stage().click());
    expect(submit).toHaveBeenCalledTimes(1);
    const ref = submit.mock.calls[0][0];
    expect(JSON.parse(ref.selection).primary).toEqual({ expiry: EXPIRY, side: "call", strike: "100" });
    await openReplay("en");
    expect(clear).toHaveBeenCalledWith(ref);
    expect(pin()!.getAttribute("data-pin-state")).toBe("pinned");
    expect(pin()!.textContent).toContain(`100 Call · ${EXPIRY}`);
    await click("Chain landscape");
    expect(stage().disabled).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "Save investigation")!.disabled).toBe(true);
  } finally {
    delete brainHost.MMBrain;
    delete brainHost.MM_BRAIN_CFG;
  }
});

it.each(["retain", "root", "matrix", "session"] as const)("settles a delayed archive only into its still-admitted Lab context: %s", async change => {
  let finishArchive!: (value: ReturnType<typeof asData>) => void;
  const pendingArchive = new Promise<ReturnType<typeof asData>>(resolve => { finishArchive = resolve; });
  load.mockImplementation(async key => key === "gex_dates:SPY" ? asData(dates)
    : key === `gex_at:SPY:${PRIOR}` ? pendingArchive : asAbsent());
  const brainHost = window as unknown as MastermindBrainHost;
  const submit = vi.fn<(ref: OptionsQuestionReference) => boolean>().mockReturnValue(true);
  const clear = vi.fn();
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  brainHost.MM_BRAIN_CFG = { principal: "one" };
  brainHost.MMBrain = { submitOptionsQuestion: submit, clearOptionsQuestion: clear };
  const source = reportedGammaBook(SESSION);
  const capturedMatrix = { ...matrix, _matrix_source_identity: {
    schema: "options_structure.acquired_bytes/v1", kind: "matrix", root: "SPY",
    session: SESSION, sha256: "a".repeat(64), byte_length: 1234,
  } };
  const render = (instrument: string, value: unknown) => act(async () => root.render(
    <OptionsResearchLab root={instrument} matrix={value} currentGexSnapshot={source}
      questionOwnerKey="account:one" lang="en" onClose={() => {}} />));
  try {
    await render("SPY", capturedMatrix);
    await click("100 Call · 2026-10-23");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="research-question-action"] button')!.click());
    expect(submit).toHaveBeenCalledTimes(1);
    const reference = submit.mock.calls[0][0];
    await click("Replay & change");
    await vi.waitFor(() => expect(load).toHaveBeenCalledWith(`gex_at:SPY:${PRIOR}`));
    expect(memoryStatus()).toBe("loading");
    expect(clear).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledWith(reference);

    await render(change === "root" ? "QQQ" : "SPY", change === "matrix" ? null
      : change === "session" ? { ...capturedMatrix, _build_meta: { asof_date: PRIOR } } : capturedMatrix);
    // The session mismatch must be committed before the old archive is released.
    if (change === "session") await vi.waitFor(() => expect(memoryStatus()).toBe("mismatch"));
    else if (change !== "retain") {
      const inspector = host.querySelector('[data-testid="research-inspector"]')!;
      expect(inspector.querySelector("dl")).toBeNull();
      expect(inspector.textContent).not.toContain(`100 Call · ${EXPIRY}`);
      expect(host.querySelector<HTMLButtonElement>('[data-testid="research-question-action"] button')!.disabled).toBe(true);
    }
    const readsBeforeSettlement = load.mock.calls.length;
    await act(async () => { finishArchive(asData(archive(2))); await pendingArchive; });
    if (change === "retain") {
      // Positive control: these exact delayed bytes are valid and must render
      // when the context survives. An invalid archive cannot prove withdrawal.
      for (let n = 0; n < 60 && memoryStatus() !== "ready"; n++) {
        await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
      }
      expect(memoryStatus()).toBe("ready");
      expect(pin()!.getAttribute("data-pin-state")).toBe("pinned");
      expect(pin()!.textContent).toContain(`100 Call · ${EXPIRY}`);
    } else expect(panel()).toBeNull();
    expect(host.textContent).not.toContain("Selection staged in Brain");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1); expect(clear).toHaveBeenCalledWith(reference);
    expect(load).toHaveBeenCalledTimes(readsBeforeSettlement);
    expect(load.mock.calls.some(([key]) => key === "gex:SPY" || key.startsWith("gex:QQQ"))).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect([...host.querySelectorAll("button")].find(b => b.textContent === "Save investigation")!.disabled).toBe(true);
  } finally {
    finishArchive(asData(archive(2)));
    delete brainHost.MMBrain;
    delete brainHost.MM_BRAIN_CFG;
  }
});
