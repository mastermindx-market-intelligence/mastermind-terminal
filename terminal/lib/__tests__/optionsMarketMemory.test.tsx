// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GexMarketMemory } from "@/components/options-companion/GexMarketMemory";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { buildCompanionGexMemory, previousAvailableGexSession, readCompanionGexSnapshot } from "@/lib/optionsCompanion";
import { flowGetResult, type FlowOutcome } from "@/lib/flowClientCache";
import { reportedGammaBook } from "./fixtures/reportedGammaBooks";
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: vi.fn() }));
const load = vi.mocked(flowGetResult);
const asData = (data: unknown) => ({ status: "data" as const, data });
const asAbsent = () => ({ status: "absent" as const, httpStatus: 404 });
const current = "2026-09-25", prior = "2026-09-23";
const snapshot = (asof = current, root = "SPY") => ({ schema: "options_hub.gex/v1", root, asof, spot_ref: 770,
  net_gex_bn: asof === current ? 1.2 : 1, by_strike: [{ strike: 770, gamma_net: asof === current ? 8 : 2 }] });
const index = (root = "SPY") => ({ root, dates: [current, prior], latest: current });
const parse = (input: unknown) => { const result = readCompanionGexSnapshot(input, "SPY"); if (!result.ok) throw Error(result.reason); return result.value; };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-29T12:00:00Z"));
  load.mockReset();
  load.mockImplementation(async (key) => key === "gex:SPY" ? asData(snapshot()) : key === "gex_dates:SPY" ? asData(index()) : key === `gex_at:SPY:${prior}` ? asData(snapshot(prior)) : asAbsent());
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(symbol = "SPY", session = current, strike: number | null = 770, lang: "en" | "zh" = "en", currentSnapshot?: unknown) {
  await act(async () => root.render(<GexMarketMemory root={symbol} matrixSession={session} strike={strike} t={optionsT(lang)} currentSnapshot={currentSnapshot} />));
}
const status = () => host.querySelector('[data-testid="options-market-memory"]')?.getAttribute("data-memory-status");

describe("Market Memory qualification", () => {
  it.each(["en", "zh"] as const)("keeps matched Gamma and original scoped measurements distinct in %s", async lang => {
    vi.stubGlobal("crypto", webcrypto);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-20T15:00:00Z"));
    const currentBook = reportedGammaBook("2026-10-19"), previousBook = reportedGammaBook("2026-10-16", 2);
    load.mockImplementation(async key => key === "gex_dates:SPY"
      ? asData({ root: "SPY", dates: ["2026-10-19", "2026-10-16"], latest: "2026-10-19" })
      : key === "gex_at:SPY:2026-10-16" ? asData(previousBook) : asAbsent());
    const lens = { kind: "one", exp: "2026-10-23" } as const;
    await act(async () => root.render(<GexMarketMemory root="SPY" matrixSession="2026-10-19" strike={100}
      t={optionsT(lang)} currentSnapshot={currentBook} lens={lens} />));
    for (let n = 0; n < 40 && status() === "loading"; n++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    expect(status()).toBe("ready");
    expect(host.textContent).toContain("GAMMA · 2026-10-23");
    expect(host.textContent).toContain(optionsT(lang)("memoryMatchedBasis"));
    expect(host.textContent).toContain(optionsT(lang)("memorySeparateTotals"));
    expect(host.textContent).toContain(optionsT(lang)("memoryReportedLimits"));
    expect(host.textContent).not.toContain("9.9B");
    const original = [...host.querySelectorAll("small")].filter(node => node.textContent?.includes(optionsT(lang)("memoryDelta")));
    expect(original).toHaveLength(2); expect(original.every(node => node.textContent?.endsWith("—"))).toBe(true);
    expect(load.mock.calls.map(([key]) => key)).toEqual(["gex_dates:SPY", "gex_at:SPY:2026-10-16"]);
  });
  it.each([
    { ...snapshot(), root: "QQQ" }, { ...snapshot(), schema: "wrong" }, { ...snapshot(), asof: "2026-02-30" },
    { ...snapshot(), asof: "2027-01-01" }, { ...snapshot(), by_strike: [{ strike: 770, gamma_net: 8 }, { strike: 770, gamma_net: 2 }] },
    { ...snapshot(), by_strike: [{ strike: 770, gamma_net: null }] },
  ])("rejects unqualified snapshots %j", (input) => expect(readCompanionGexSnapshot(input, "SPY").ok).toBe(false));
  it("uses the previous available indexed session, not a guessed calendar day", () => {
    expect(previousAvailableGexSession(index(), "SPY", current)).toEqual({ ok: true, value: { session: prior } });
    expect(previousAvailableGexSession(index("QQQ"), "SPY", current).ok).toBe(false);
    expect(previousAvailableGexSession({ ...index(), dates: [prior, current] }, "SPY", current).ok).toBe(false);
    expect(previousAvailableGexSession(index(), "SPY", prior)).toEqual({ ok: true, value: { session: null } });
  });
  it("retains missing strikes and scalars as unknown; never interpolates", () => {
    const a = parse({ ...snapshot(), net_gex_bn: null }); const b = parse(snapshot(prior));
    expect(buildCompanionGexMemory(a, b, 770.5)).toMatchObject({ currentStrikeMn: null, previousStrikeMn: null, current: { netGexBn: null } });
    expect(buildCompanionGexMemory(a, a, 770)).toBeNull();
    expect(buildCompanionGexMemory(a, { ...b, root: "QQQ" }, 770)).toBeNull();
  });
  it.each(["en", "zh"] as const)("shows all-expiry units, comparison and attribution limits in %s", async (lang) => {
    await render("SPY", current, 770, lang); expect(status()).toBe("ready");
    expect(host.textContent).toContain("+1B → +1.2B");
    expect(host.textContent).toContain("+2M → +8M");
    expect(host.textContent).toContain("+200M");
    expect(host.textContent).toContain(optionsT(lang)("memoryAllExpiry"));
    expect(host.textContent).toContain(optionsT(lang)("memoryCaution"));
    await render("SPY", current, 770.5, lang);
    expect(host.textContent).toContain("— → —"); expect(load).toHaveBeenCalledTimes(3);
  });
  it("refuses to compare a live snapshot from a different matrix session", async () => {
    await render("SPY", "2026-09-24"); expect(status()).toBe("mismatch"); expect(load).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("+1B");
  });
  it.each([null, snapshot(), snapshot(prior, "QQQ")])("shows a missing archive rather than using today's data: %j", async (archive) => {
    load.mockImplementation(async (key) => key.startsWith("gex_at:") ? (archive == null ? asAbsent() : asData(archive)) : key === "gex:SPY" ? asData(snapshot()) : asData(index()));
    await render(); expect(status()).toBe("archive-missing"); expect(host.textContent).not.toContain("+1B");
    expect(load.mock.calls.map(([key]) => key)).toEqual(["gex:SPY", "gex_dates:SPY", `gex_at:SPY:${prior}`]);
  });
  it("does not let an old root's delayed archive replace the new root", async () => {
    let finish!: (value: FlowOutcome) => void;
    const delayed = new Promise<FlowOutcome>(resolve => { finish = resolve; });
    load.mockImplementation(async (key) => key === "gex:SPY" ? asData(snapshot()) : key === "gex_dates:SPY" ? asData(index()) : key.startsWith("gex_at:SPY:") ? delayed : asAbsent());
    await render(); expect(status()).toBe("loading");
    await render("QQQ"); expect(status()).toBe("absent");
    await act(async () => finish(asData(snapshot(prior)))); expect(status()).toBe("absent"); expect(host.textContent).not.toContain(prior);
  });
  it("compares the selected archived book with its prior available session without requesting today's book", async () => {
    const older = "2026-09-22";
    load.mockImplementation(async key => key === "gex_dates:SPY"
      ? asData({ root: "SPY", dates: [current, prior, older], latest: current })
      : key === `gex_at:SPY:${older}` ? asData({ ...snapshot(older), net_gex_bn: 0.5 }) : asAbsent());
    await render("SPY", prior, 770, "en", snapshot(prior));
    expect(status()).toBe("ready");
    expect(host.textContent).toContain("+500M → +1B");
    expect(host.textContent).toContain(older);
    expect(load.mock.calls.map(([key]) => key)).toEqual(["gex_dates:SPY", `gex_at:SPY:${older}`]);
  });
  it.each([null, snapshot(prior, "QQQ"), snapshot()])("does not replace invalid supplied archive bytes with the latest book: %j", async supplied => {
    await render("SPY", prior, 770, "en", supplied);
    expect(status()).not.toBe("ready");
    expect(host.textContent).not.toContain("+1B");
    expect(load.mock.calls.map(([key]) => key)).toEqual(["gex_dates:SPY"]);
  });
  it("invalidates a same-session comparison when the selected source object is corrected", async () => {
    await render("SPY", current, 770, "en", snapshot());
    expect(status()).toBe("ready");
    let finish!: (value: FlowOutcome) => void;
    const delayed = new Promise<FlowOutcome>(resolve => { finish = resolve; });
    load.mockImplementation(async key => key === "gex_dates:SPY" ? asData(index()) : delayed);
    await render("SPY", current, 770, "en", { ...snapshot(), net_gex_bn: 1.3 });
    expect(status()).toBe("loading");
    expect(host.textContent).not.toContain("+1.2B");
    await act(async () => finish(asData(snapshot(prior))));
    expect(status()).toBe("ready");
    expect(host.textContent).toContain("+1B → +1.3B");
    expect(load.mock.calls.some(([key]) => key === "gex:SPY")).toBe(false);
  });
});
