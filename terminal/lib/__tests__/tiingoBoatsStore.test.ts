import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readTiingoBoatsHistory, prependBoatsHistory, boatsVendorSymbol } from "../tiingoBoatsStore";
import type { Bar6 } from "../intradayShared";

const ID = "a".repeat(64);
function history(dates: string[]) {
  return { schema: "terminal.tiingo_boats_history.v1", symbol: "AMD", source: "tiingo-boats-rest",
    venue: "BOATS", timestamp_basis: "utc", bar_seconds: 60,
    price_basis: "vendor_reported_unqualified", volume_basis: "vendor_reported_shares",
    coverage: "captured_vendor_bars_only", complete: false,
    receipts: [{ receipt_id: ID, raw_sha256: "b".repeat(64), observed_at_utc: "2026-10-11T12:00:00Z",
      request_path: "/boats/AMD/prices?resampleFreq=1min" }],
    bars: dates.map((d, i) => [Date.parse(d) / 1000, 10, 12, 9, 11, i + 1]),
    bar_receipt_ids: dates.map(() => [ID]) };
}
let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "terminal-boats-test-")); vi.stubEnv("TIINGO_BOATS_HISTORY_DIR", directory); vi.stubEnv("TIINGO_BOATS_LIVE_DIR", ""); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
async function save(value: unknown) { await writeFile(path.join(directory, "AMD.json"), JSON.stringify(value)); }

describe("private stored BOATS history", () => {
  it("maps only the documented US A/B class-share punctuation", () => {
    expect(boatsVendorSymbol("BRK.B")).toBe("BRK-B");
    expect(boatsVendorSymbol("HEI.A")).toBe("HEI-A");
    for (const s of ["AMD", "BRK-B", "SPG-P-J", "0700.HK", "VOD.L", "ABC.TO", "ABC.C"]) {
      expect(boatsVendorSymbol(s)).toBe(s);
    }
  });
  it("reads vendor identity and retains chart identity for class shares", async () => {
    const data = history(["2026-10-09T00:00:00Z"]);
    data.symbol = "BRK-B";
    data.receipts[0].request_path = "/boats/BRK-B/prices?resampleFreq=1min";
    await writeFile(path.join(directory, "BRK-B.json"), JSON.stringify(data));
    const out = await readTiingoBoatsHistory("BRK.B", "5m");
    expect(out.evidence).toMatchObject({ status: "available", requested_symbol: "BRK.B", vendor_symbol: "BRK-B" });
    expect(out.bars).toHaveLength(1);
    data.symbol = "BRK.A";
    await writeFile(path.join(directory, "BRK-B.json"), JSON.stringify(data));
    expect((await readTiingoBoatsHistory("BRK.B", "5m")).evidence.status).toBe("malformed");
  });
  it("reports missing and disabled without fake candles", async () => {
    expect((await readTiingoBoatsHistory("AMD", "1m")).evidence.status).toBe("missing");
    vi.stubEnv("TIINGO_BOATS_HISTORY_DIR", "");
    expect((await readTiingoBoatsHistory("AMD", "1m")).evidence.status).toBe("disabled");
  });
  it("converts UTC to ET and resamples one venue with source volume", async () => {
    await save(history(["2026-10-09T00:00:00Z", "2026-10-09T00:01:00Z"]));
    const out = await readTiingoBoatsHistory("AMD", "5m");
    expect(out.bars).toEqual([[Date.parse("2026-10-08T20:00:00Z") / 1000, 10, 12, 9, 11, 3]]);
    expect(out.evidence.status).toBe("available");
    expect(out.evidence.receipt_ids).toEqual([ID]);
    expect(out.evidence.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.evidence.complete).toBe(false);
  });
  it("uses the incumbent calendar for holiday and Friday evening exclusions", async () => {
    await save(history(["2026-07-03T00:00:00Z", "2026-10-10T00:00:00Z"]));
    const out = await readTiingoBoatsHistory("AMD", "1m");
    expect(out.bars).toEqual([]);
    expect(out.evidence.calendar_excluded_bars).toBe(2);
    expect(out.evidence.status).toBe("empty");
  });
  it("never crosses the 04:00 phase boundary", async () => {
    await save(history(["2026-10-09T07:59:00Z", "2026-10-09T08:00:00Z"]));
    const out = await readTiingoBoatsHistory("AMD", "12h");
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0][0]).toBe(Date.parse("2026-10-08T20:00:00Z") / 1000);
    expect(out.bars[0][5]).toBe(1);
    expect(out.evidence.calendar_excluded_bars).toBe(1);
  });
  it("refuses malformed volume and unsupported seconds or ticker paths", async () => {
    const data = history(["2026-10-09T00:00:00Z"]); data.bars[0][5] = Number.NaN;
    await save(data);
    expect((await readTiingoBoatsHistory("AMD", "1m")).evidence.status).toBe("malformed");
    expect((await readTiingoBoatsHistory("AMD", "1s")).evidence.status).toBe("unsupported");
    expect((await readTiingoBoatsHistory("../AMD", "1m")).evidence.status).toBe("unsupported");
  });
  it("refuses symlinked inputs before reading them", async () => {
    await writeFile(path.join(directory, "other.json"), JSON.stringify(history([])));
    await symlink(path.join(directory, "other.json"), path.join(directory, "AMD.json"));
    const out = await readTiingoBoatsHistory("AMD", "1m");
    expect(out.evidence.status).toBe("unreadable");
    expect(out.bars).toEqual([]);
  });
  it("retains provider authority on overlap and never blends OHLCV", () => {
    const h: Bar6[] = [[1, 10, 12, 9, 11, 100], [2, 20, 22, 19, 21, 200]];
    const current: Bar6[] = [[2, 30, 32, 29, 31, 300]];
    expect(prependBoatsHistory(h, current)).toEqual({ bars: [h[0], current[0]], addedEpochs: [1], conflicts: 1 });
  });
});
