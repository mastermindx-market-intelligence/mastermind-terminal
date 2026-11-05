import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Bar6 } from "../intradayShared";
import type { IntradayAssemblyTrace } from "../intradayEvidence";

const state = vi.hoisted(() => ({ raw: Buffer.alloc(0), calls: 0 }));
vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>(),
  promises: { readFile: async () => { state.calls++; return state.raw; } },
}));
import { withStoredHistory } from "../intradayStore";
beforeEach(() => { state.calls = 0; });
it("selects precise old-day storage before the history cap or unrelated calendar lookups", async () => {
  const selected: Bar6 = [Date.parse("2026-10-14T09:30:00Z") / 1000, 100, 102, 99, 101, 10];
  const bars: Bar6[] = [[Date.parse("1900-01-01T12:00:00Z") / 1000, 100, 102, 99, 101, 10], selected];
  for (let day = Date.parse("2027-01-01T00:00:00Z") / 1000; day < Date.parse("2031-01-01T00:00:00Z") / 1000; day += 86_400) {
    for (let minute = 240; minute < 1200; minute += 30) bars.push([day + minute * 60, 100, 102, 99, 101, 10]);
  }
  state.raw = Buffer.from(JSON.stringify({ bars }));
  let trace: IntradayAssemblyTrace | undefined;
  expect(await withStoredHistory("AAPL", "30m", true, [], value => { trace = value; }, true, "2026-10-14")).toEqual([selected]);
  expect(state.calls).toBe(1); expect(trace?.origins).toEqual([[selected[0], "stored_5m"]]);
  expect(trace?.storeReads[0]).toMatchObject({ base: "5m", status: "available",
    content_sha256: createHash("sha256").update(state.raw).digest("hex") });
});
