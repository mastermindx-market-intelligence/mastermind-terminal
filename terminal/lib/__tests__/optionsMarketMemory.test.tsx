// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GexMarketMemory } from "@/components/options-companion/GexMarketMemory";
import { optionsT } from "@/components/options-companion/optionsStrings";
import { buildCompanionGexMemory, previousAvailableGexSession, readCompanionGexSnapshot } from "@/lib/optionsCompanion";
import { flowGetFresh } from "@/lib/flowClientCache";
vi.mock("@/lib/flowClientCache", () => ({ flowGetFresh: vi.fn() }));
const load = vi.mocked(flowGetFresh);
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
  load.mockImplementation(async (key) => key === "gex:SPY" ? snapshot() : key === "gex_dates:SPY" ? index() : key === `gex_at:SPY:${prior}` ? snapshot(prior) : null);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render(symbol = "SPY", session = current, strike: number | null = 770, lang: "en" | "zh" = "en") {
  await act(async () => root.render(<GexMarketMemory root={symbol} matrixSession={session} strike={strike} t={optionsT(lang)} />));
}
const status = () => host.querySelector('[data-testid="options-market-memory"]')?.getAttribute("data-memory-status");

describe("Market Memory qualification", () => {
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
    load.mockImplementation(async (key) => key.startsWith("gex_at:") ? archive : key === "gex:SPY" ? snapshot() : index());
    await render(); expect(status()).toBe("archive-missing"); expect(host.textContent).not.toContain("+1B");
    expect(load.mock.calls.map(([key]) => key)).toEqual(["gex:SPY", "gex_dates:SPY", `gex_at:SPY:${prior}`]);
  });
  it("does not let an old root's delayed archive replace the new root", async () => {
    let finish!: (value: unknown) => void;
    const delayed = new Promise<unknown>(resolve => { finish = resolve; });
    load.mockImplementation(async (key) => key === "gex:SPY" ? snapshot() : key === "gex_dates:SPY" ? index() : key.startsWith("gex_at:SPY:") ? delayed : null);
    await render(); expect(status()).toBe("loading");
    await render("QQQ"); expect(status()).toBe("unavailable");
    await act(async () => finish(snapshot(prior))); expect(status()).toBe("unavailable"); expect(host.textContent).not.toContain(prior);
  });
});
