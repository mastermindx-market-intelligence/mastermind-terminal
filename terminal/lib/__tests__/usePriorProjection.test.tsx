// @vitest-environment jsdom
// The prior-session read behind the surface tab: index first, then one stored book, never a
// synthesized frame. jsdom + createRoot/act (the repo's existing idiom; no testing-library).
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: vi.fn() }));
import { flowGetResult } from "@/lib/flowClientCache";
import { priorStoredSession, usePriorProjection } from "@/components/exposure-map/usePriorProjection";

const flow = vi.mocked(flowGetResult);
const NOW = Date.parse("2026-10-17T12:00:00Z");
const index = (dates: string[]) => ({ status: "data" as const, data: { root: "SPY", latest: dates[0] ?? null, dates } });

function Probe({ root, session }: { root: string; session: string | null }) {
  const { status, prior, priorSession } = usePriorProjection({ root, session, now: NOW });
  return <output data-status={status} data-session={priorSession ?? ""} data-prior={prior ? "yes" : "no"} />;
}

let host: HTMLDivElement;
let root: Root;
const render = async (ui: React.ReactElement) => { await act(async () => root.render(ui)); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await act(async () => { await Promise.resolve(); }); };
const out = () => host.querySelector("output") as HTMLOutputElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flow.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("priorStoredSession", () => {
  it("picks the newest stored session strictly before the current one", () => {
    expect(priorStoredSession(["2026-10-16", "2026-10-15", "2026-10-14"], "2026-10-16")).toBe("2026-10-15");
    expect(priorStoredSession(["2026-10-16", "2026-10-15", "2026-10-14"], "2026-10-15")).toBe("2026-10-14");
    expect(priorStoredSession(["2026-10-16", "2026-10-15"], "2026-10-15")).toBeNull();
    expect(priorStoredSession([], "2026-10-16")).toBeNull();
  });
});

describe("usePriorProjection", () => {
  it("reads the index, then only the prior session's stored book", async () => {
    flow.mockImplementation(async (key: string) => key === "gex_dates:SPY" ? index(["2026-10-16", "2026-10-15", "2026-10-14"])
      : key === "gex_at:SPY:2026-10-15" ? { status: "data", data: { legacy: true } } : { status: "absent", httpStatus: 404 });
    await render(<Probe root="SPY" session="2026-10-16" />);
    await settle();
    expect(out().dataset.status).toBe("ready");
    expect(out().dataset.session).toBe("2026-10-15");
    // A stored book without a projection is a prior session with nothing to match against, not a synthesized one.
    expect(out().dataset.prior).toBe("no");
    expect(flow.mock.calls.map((c) => c[0])).toEqual(["gex_dates:SPY", "gex_at:SPY:2026-10-15"]);
  });

  it("reports none without an index or without an earlier session, reading no book", async () => {
    flow.mockResolvedValue({ status: "absent", httpStatus: 404 });
    await render(<Probe root="QQQ" session="2026-10-16" />);
    await settle();
    expect(out().dataset.status).toBe("none");
    expect(flow).toHaveBeenCalledTimes(1);

    flow.mockReset();
    flow.mockImplementation(async () => index(["2026-10-16"]));
    await render(<Probe root="IWM" session="2026-10-16" />);
    await settle();
    expect(out().dataset.status).toBe("none");
    expect(flow.mock.calls.map((c) => c[0])).toEqual(["gex_dates:IWM"]);
  });

  it("reports unavailable when the index read fails and restarts as loading for a new root", async () => {
    flow.mockResolvedValue({ status: "unavailable", reason: "network" });
    await render(<Probe root="SPY" session="2026-10-16" />);
    await settle();
    expect(out().dataset.status).toBe("unavailable");
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    flow.mockImplementation(async (key: string) => {
      if (key === "gex_dates:QQQ") { await gate; return index(["2026-10-16", "2026-10-15"]); }
      return { status: "data", data: {} };
    });
    await render(<Probe root="QQQ" session="2026-10-16" />);
    expect(out().dataset.status).toBe("loading");
    release!();
    await settle();
    expect(out().dataset.status).toBe("ready");
    expect(out().dataset.session).toBe("2026-10-15");
  });
});
