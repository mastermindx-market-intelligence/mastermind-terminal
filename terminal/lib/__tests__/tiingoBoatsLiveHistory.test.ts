import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  boatsLiveSessionWindow, mergeBoatsLiveHistory, readBoatsLiveSnapshot,
  requestBoatsLiveHistory, parseIsoEpochMs,
} from "../tiingoBoatsLiveHistory";
import { readTiingoBoatsHistory } from "../tiingoBoatsStore";
import type { Bar6 } from "../intradayShared";
import bridgeFixtures from "./fixtures/boatsLiveBridge.v1.json";

// Current-night fixtures use the 2026-10-16 (Friday) overnight session:
// display 2026-10-15T20:00 .. 2026-10-16T04:00 ET == real UTC 2026-10-16T00:00Z .. 07:59Z (EDT).
const SESSION = "2026-10-16";
const NIGHT_MS = Date.parse("2026-10-16T01:15:00Z"); // 21:15 ET Oct 15 -> overnight of 2026-10-16
const disp = (isoUtc: string) => Date.parse(isoUtc) / 1000 - 4 * 3600; // EDT display epoch
const SESSION_START_DISPLAY = disp("2026-10-16T00:00:00Z");

const ID = "a".repeat(64);
function vendorHistory(symbol: string, rows: Array<[string, number, number, number, number, number]>, capturedAt: string) {
  return {
    schema: "terminal.tiingo_boats_history.v1", symbol, source: "tiingo-boats-rest",
    venue: "BOATS", timestamp_basis: "utc", bar_seconds: 60,
    price_basis: "vendor_reported_unqualified", volume_basis: "vendor_reported_shares",
    coverage: "captured_vendor_bars_only", complete: false,
    receipts: [{ receipt_id: ID, raw_sha256: "b".repeat(64), observed_at_utc: capturedAt,
      request_path: `/boats/${symbol}/prices?startDate=${SESSION}&endDate=${SESSION}&resampleFreq=1min` }],
    bars: rows.map(([t, o, h, l, c, v]) => [Date.parse(t) / 1000, o, h, l, c, v]), // real UTC epochs
    bar_receipt_ids: rows.map(() => [ID]),
  };
}
function snapshot(sessionDate: string, capturedAt: string, history: unknown) {
  return { schema: "terminal.boats_live_history.v1", session_date: sessionDate, captured_at_utc: capturedAt, history };
}
function emptyHistory(capturedAt: string) {
  return vendorHistory("AMD", [], capturedAt);
}
// Three current-night minutes and one pre-market print at the 04:00 boundary.
const CAPTURED = "2026-10-16T07:59:59Z"; // last second before the 04:00 ET session close
function currentNightRows(): Array<[string, number, number, number, number, number]> {
  return [
    ["2026-10-16T00:00:00Z", 20, 22, 19, 21, 7],
    ["2026-10-16T00:01:00Z", 20.5, 22.5, 19.5, 21.5, 8],
    ["2026-10-16T07:59:00Z", 21, 23, 20, 22, 9],
  ];
}
// Baseline archive: one prior-session bar, two current-night bars (older vintage), one 04:00 pre print.
function baseRows(): Array<[string, number, number, number, number, number]> {
  return [
    ["2026-10-15T00:00:00Z", 10, 12, 9, 11, 100],
    ["2026-10-16T00:00:00Z", 10.5, 12.5, 9.5, 11.5, 200],
    ["2026-10-16T00:01:00Z", 10.6, 12.6, 9.6, 11.6, 300],
    ["2026-10-16T08:00:00Z", 10, 12, 9, 11, 400],
  ];
}
function baseHistory(observedAt: string) {
  return {
    schema: "terminal.tiingo_boats_history.v1", symbol: "AMD", source: "tiingo-boats-rest",
    venue: "BOATS", timestamp_basis: "utc", bar_seconds: 60,
    price_basis: "vendor_reported_unqualified", volume_basis: "vendor_reported_shares",
    coverage: "captured_vendor_bars_only", complete: false,
    receipts: [{ receipt_id: ID, raw_sha256: "b".repeat(64), observed_at_utc: observedAt,
      request_path: "/boats/AMD/prices?resampleFreq=1min" }],
    bars: baseRows().map(([t, o, h, l, c, v]) => [Date.parse(t) / 1000, o, h, l, c, v]), // real UTC epochs
    bar_receipt_ids: baseRows().map(() => [ID]),
  };
}
function interestRecord(symbol: string, requestedAt: string, sessionDate = SESSION) {
  return { schema: "terminal.boats_history_interest.v1", symbol, session_date: sessionDate, requested_at_utc: requestedAt };
}

let root: string;
let historyDir: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "terminal-boats-live-"));
  historyDir = await mkdtemp(path.join(os.tmpdir(), "terminal-boats-base-"));
  await mkdir(path.join(root, "requests"), { mode: 0o700 });
  await mkdir(path.join(root, "bars"), { mode: 0o700 });
  vi.stubEnv("TIINGO_BOATS_LIVE_DIR", root);
  vi.stubEnv("TIINGO_BOATS_HISTORY_DIR", historyDir);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  await rm(historyDir, { recursive: true, force: true });
});
const saveSnapshot = async (value: unknown, symbol = "AMD") =>
  writeFile(path.join(root, "bars", `${symbol}.json`), JSON.stringify(value), { mode: 0o600 });
const saveBase = async (value: unknown, symbol = "AMD") =>
  writeFile(path.join(historyDir, `${symbol}.json`), JSON.stringify(value), { mode: 0o600 });
const listRequests = async () => readdir(path.join(root, "requests"));

describe("current-night session windows (DST/holiday/04:00 boundary)", () => {
  it("uses the fixed 20:00..04:00 ET wall span for an ordinary session", () => {
    expect(boatsLiveSessionWindow(SESSION)).toEqual([
      disp("2026-10-16T00:00:00Z"), // 20:00 ET Oct 15
      Date.parse(`${SESSION}T04:00:00Z`) / 1000,
    ]);
  });
  it("stays a wall-clock span across the fall-back transition", () => {
    // Session of Mon 2026-11-02 starts Sun 20:00 EST-side wall clock; the display
    // span is the 8 wall hours 20:00..04:00 regardless of the offset change.
    expect(boatsLiveSessionWindow("2026-11-02")).toEqual([
      Date.parse("2026-11-01T20:00:00Z") / 1000,
      Date.parse("2026-11-02T04:00:00Z") / 1000,
    ]);
  });
  it("stays a wall-clock span across the spring-forward transition", () => {
    expect(boatsLiveSessionWindow("2026-03-09")).toEqual([
      Date.parse("2026-03-08T20:00:00Z") / 1000,
      Date.parse("2026-03-09T04:00:00Z") / 1000,
    ]);
  });
  it("gives holidays and weekends no window at all", () => {
    expect(boatsLiveSessionWindow("2026-07-03")).toBeNull(); // July 4 observed Friday
    expect(boatsLiveSessionWindow("2026-10-10")).toBeNull(); // Saturday
    expect(boatsLiveSessionWindow("2026-11-01")).toBeNull(); // fall-back Sunday
    expect(boatsLiveSessionWindow("2026-02-30")).toBeNull(); // non-calendar date
  });
});

describe("interest demand recording", () => {
  it("records the exact bounded record after the documented auth-before-cache caller gate", async () => {
    // CALLER PLACEMENT CONTRACT: the route calls this after auth and before the
    // cache; this module simulates no authentication and only observes the
    // preprovisioned private root (see module header).
    const out = await requestBoatsLiveHistory("AMD", "5m", "", NIGHT_MS);
    expect(out).toMatchObject({ status: "recorded", symbol: "AMD", vendor_symbol: "AMD", session_date: SESSION });
    expect(out.requested_at_utc).toBe("2026-10-16T01:15:00.000Z");
    const file = path.join(root, "requests", "AMD.json");
    expect(await readFile(file, "utf8"))
      .toBe('{"schema":"terminal.boats_history_interest.v1","symbol":"AMD","session_date":"2026-10-16","requested_at_utc":"2026-10-16T01:15:00.000Z"}');
    const info = await stat(file);
    expect(info.isFile()).toBe(true);
    expect(info.mode & 0o777).toBe(0o600);
  });
  it("keeps vendor identity for class shares", async () => {
    const out = await requestBoatsLiveHistory("BRK.B", "1m", "", NIGHT_MS);
    expect(out.status).toBe("recorded");
    expect(await readFile(path.join(root, "requests", "BRK-B.json"), "utf8")).toContain('"symbol":"BRK-B"');
  });
  it("refuses strict symbol and timeframe grammar without writing", async () => {
    for (const [sym, tf] of [["amd!", "1m"], ["../AMD", "1m"], ["", "1m"], ["AMD", "1s"], ["AMD", "13h"], ["AMD", "bogus"]] as const) {
      const out = await requestBoatsLiveHistory(sym, tf, "", NIGHT_MS);
      expect(out.status).toBe("unsupported");
    }
    expect(await listRequests()).toEqual([]);
  });
  it("refuses any session date that is not the current trading date", async () => {
    expect((await requestBoatsLiveHistory("AMD", "1m", "2026-10-15", NIGHT_MS)).status).toBe("unsupported");
    expect((await requestBoatsLiveHistory("AMD", "1m", "2026-10-17", NIGHT_MS)).status).toBe("unsupported");
    expect((await requestBoatsLiveHistory("AMD", "1m", "2026-13-99", NIGHT_MS)).status).toBe("unsupported");
    expect((await requestBoatsLiveHistory("AMD", "1m", SESSION, NIGHT_MS)).status).toBe("recorded");
  });
  it("records demand only while the overnight session is actually live", async () => {
    for (const utc of ["2026-10-15T23:00:00Z", "2026-10-16T08:00:00Z", "2026-10-16T14:30:00Z"]) {
      const out = await requestBoatsLiveHistory("AMD", "1m", "", Date.parse(utc));
      expect(out.status).toBe("unsupported");
    }
    // 03:59 ET still belongs to the live night.
    expect((await requestBoatsLiveHistory("AMD", "1m", "", Date.parse("2026-10-16T07:59:00Z"))).status).toBe("recorded");
    expect(await listRequests()).toEqual(["AMD.json"]);
  });
  it("gives the night before a holiday no session", async () => {
    // Thu Jul 2 21:00 ET would trade date Fri Jul 3: NYSE holiday (July 4 observed).
    const out = await requestBoatsLiveHistory("AMD", "1m", "", Date.parse("2026-07-03T01:00:00Z"));
    expect(out.status).toBe("unsupported");
    expect(out.session_date).toBeNull();
    expect(await listRequests()).toEqual([]);
  });
  it("degrades to disabled and unprovisioned statuses without fake effects", async () => {
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "");
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).status).toBe("disabled");
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "relative/path");
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).status).toBe("unprovisioned");
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", historyDir); // no requests/ or bars/ inside
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).status).toBe("unprovisioned");
    expect(await listRequests()).toEqual([]);
  });
  it("coalesces touches at most once per 30s and refreshes after", async () => {
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).status).toBe("recorded");
    expect(await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS + 10_000)).toMatchObject({
      status: "coalesced", requested_at_utc: "2026-10-16T01:15:00.000Z",
    });
    expect(await readFile(path.join(root, "requests", "AMD.json"), "utf8")).toContain("2026-10-16T01:15:00.000Z");
    const refreshed = await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS + 30_001);
    expect(refreshed.status).toBe("recorded");
    expect(refreshed.requested_at_utc).toBe("2026-10-16T01:15:30.001Z");
  });
  it("refreshes demand after a backwards clock step instead of suppressing it", async () => {
    await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS);
    const corrected = await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS - 10_000);
    expect(corrected).toMatchObject({ status: "recorded", requested_at_utc: "2026-10-16T01:14:50.000Z" });
    expect(await readFile(path.join(root, "requests", "AMD.json"), "utf8")).toContain(corrected.requested_at_utc);
  });
  it("reports an unavailable calendar without blaming private IO or writing demand", async () => {
    expect(await requestBoatsLiveHistory("AMD", "1m", "", Date.parse("2030-10-16T01:00:00Z")))
      .toMatchObject({ status: "error", reason: "calendar_unavailable" });
    expect(await listRequests()).toEqual([]);
    await saveSnapshot(snapshot("2030-10-16", "2030-10-16T01:00:00Z", emptyHistory(CAPTURED)));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse("2030-10-16T02:00:00Z"))).status).toBe("unreadable");
  });
  it("bounds regular demand records at 256 and prunes only schema-valid expired records", async () => {
    const fresh = "2026-10-16T01:14:00.000Z";
    for (let i = 0; i < 256; i++) {
      await writeFile(path.join(root, "requests", `C${String(i).padStart(3, "0")}.json`),
        JSON.stringify(interestRecord(`C${String(i).padStart(3, "0")}`, fresh)), { mode: 0o600 });
    }
    await writeFile(path.join(root, "requests", "TARGET.orig.json"), "keepme");
    await symlink(path.join(root, "requests", "C000.json"), path.join(root, "requests", "SY1.json"));
    const full = await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS);
    expect(full.status).toBe("capacity");
    expect(await listRequests()).toHaveLength(258); // 256 records + decoy + symlink, untouched
    // Age every schema-valid record past its 120s expiry, then capacity frees.
    for (let i = 0; i < 256; i++) {
      await writeFile(path.join(root, "requests", `C${String(i).padStart(3, "0")}.json`),
        JSON.stringify(interestRecord(`C${String(i).padStart(3, "0")}`, "2026-10-15T00:00:00.000Z")), { mode: 0o600 });
    }
    const freed = await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS);
    expect(freed.status).toBe("recorded");
    const remaining = (await listRequests()).sort();
    expect(remaining).toEqual(["AMD.json", "SY1.json", "TARGET.orig.json"]); // non-records never followed or removed
  });
});

describe("live snapshot bounded private IO", () => {
  it("never follows a symlinked snapshot", async () => {
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)), "OTHER");
    await symlink(path.join(root, "bars", "OTHER.json"), path.join(root, "bars", "AMD.json"));
    const out = await readBoatsLiveSnapshot("AMD", null, Date.parse(CAPTURED) + 1000);
    expect(out.status).toBe("unreadable");
    expect(out.minutes).toEqual([]);
  });
  it("refuses oversized and non-regular inputs without unbounded reads", async () => {
    await writeFile(path.join(root, "bars", "AMD.json"), Buffer.alloc(512 * 1024 + 1, 0x20));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse(CAPTURED))).status).toBe("malformed");
    await rm(path.join(root, "bars", "AMD.json"));
    await mkdir(path.join(root, "bars", "AMD.json"));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse(CAPTURED))).status).toBe("malformed");
    await rm(path.join(root, "bars", "AMD.json"), { recursive: true });
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse(CAPTURED))).status).toBe("missing");
  });
  it("reports disabled without the private root", async () => {
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "");
    expect((await readBoatsLiveSnapshot("AMD", null, Date.now())).status).toBe("disabled");
  });
});

describe("snapshot validation (receipt integrity, window, recency, no future)", () => {
  const NOW = Date.parse(CAPTURED);
  it("accepts a valid whole-session snapshot", async () => {
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const out = await readBoatsLiveSnapshot("AMD", null, NOW);
    expect(out.status).toBe("applied");
    expect(out.session_date).toBe(SESSION);
    expect(out.observed_at_utc).toBe(CAPTURED);
    expect(out.receipt_ids).toEqual([ID]);
    expect(out.content_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.minutes).toHaveLength(3);
    expect(out.minutes[0][0]).toBe(SESSION_START_DISPLAY);
  });
  it("preserves newer baseline bars when an older snapshot is empty", async () => {
    await saveBase(baseHistory("2026-10-16T09:00:00Z"));
    await saveSnapshot(snapshot(SESSION, CAPTURED, emptyHistory(CAPTURED)));
    const out = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(out.evidence.live_history?.status).toBe("stale");
    expect(out.bars).toContainEqual([disp("2026-10-16T00:00:00Z"), 10.5, 12.5, 9.5, 11.5, 200]);
  });
  it("preserves observation milliseconds at the future tolerance boundary", async () => {
    const stamp = "2026-10-16T07:50:05.001Z";
    expect(parseIsoEpochMs(stamp)).toBe(Date.parse(stamp));
    await saveSnapshot(snapshot(SESSION, stamp, emptyHistory(stamp)));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse("2026-10-16T07:50:00Z"))).status).toBe("malformed");
  });
  it("accepts an empty provider response as an authoritative empty window", async () => {
    await saveSnapshot(snapshot(SESSION, CAPTURED, emptyHistory(CAPTURED)));
    const out = await readBoatsLiveSnapshot("AMD", null, NOW);
    expect(out.status).toBe("empty");
    expect(out.minutes).toEqual([]);
    expect(out.receipt_ids).toEqual([ID]);
    expect(out.window).toEqual(boatsLiveSessionWindow(SESSION));
  });
  it("consumes the protected bridge's nonempty and receipt-bearing empty contracts", async () => {
    for (const doc of bridgeFixtures.snapshots) {
      await saveSnapshot(doc);
      const out = await readBoatsLiveSnapshot("AMD", null, Date.parse(doc.captured_at_utc));
      expect(out.status).toBe(doc.history.bars.length ? "applied" : "empty");
      expect(out.receipt_ids).toEqual([ID]);
    }
  });
  it("accepts latest-session receipts for both bars and empty results with exact lineage", async () => {
    for (const rows of [currentNightRows(), []]) {
      const history = vendorHistory("AMD", rows, CAPTURED);
      history.receipts[0].request_path = "/boats/AMD/prices?resampleFreq=1min&forceFill=false";
      await saveSnapshot(snapshot(SESSION, CAPTURED, history));
      const out = await readBoatsLiveSnapshot("AMD", null, NOW);
      expect(out.status).toBe(rows.length ? "applied" : "empty");
      expect(out.receipt_ids).toEqual([ID]);
      expect(out.session_date).toBe(SESSION);
      // Removing query dates cannot relabel an observation into another night.
      await saveSnapshot(snapshot("2026-10-15", CAPTURED, history));
      expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
    }
    const history = vendorHistory("AMD", [["2026-10-15T00:01:00Z", 20, 22, 19, 21, 7]], CAPTURED);
    history.receipts[0].request_path = "/boats/AMD/prices?resampleFreq=1min";
    await saveSnapshot(snapshot(SESSION, CAPTURED, history));
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
  });
  it("refuses wrong or ambiguous request dates and after-close observations", async () => {
    for (const query of ["startDate=2026-10-15&endDate=2026-10-16", "startDate=2026-10-16&endDate=2026-10-16&endDate=2026-10-17", "startDate=2026-10-16", "endDate=2026-10-16", "startDate=&endDate=", "startDate=2026-10-16&startDate=2026-10-16&endDate=2026-10-16"]) {
      const history = emptyHistory(CAPTURED);
      history.receipts[0].request_path = `/boats/AMD/prices?resampleFreq=1min&${query}`;
      await saveSnapshot(snapshot(SESSION, CAPTURED, history));
      expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
    }
    const stamp = "2026-10-16T08:00:00Z";
    await saveSnapshot(snapshot(SESSION, stamp, emptyHistory(stamp)));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse(stamp))).status).toBe("malformed");
  });
  it("refuses receipt-integrity violations", async () => {
    const good = vendorHistory("AMD", currentNightRows(), CAPTURED);
    const mismatched = snapshot(SESSION, "2026-10-16T07:29:00Z", good);
    await saveSnapshot(mismatched);
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");

    const twoReceipts = vendorHistory("AMD", currentNightRows(), CAPTURED);
    twoReceipts.receipts.push({ ...twoReceipts.receipts[0], receipt_id: "b".repeat(64), observed_at_utc: "2026-10-16T07:29:00Z" });
    twoReceipts.bar_receipt_ids = twoReceipts.bar_receipt_ids.map((ids: string[]) => [ID, "b".repeat(64)]);
    await saveSnapshot(snapshot(SESSION, CAPTURED, twoReceipts));
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");

    await saveSnapshot(snapshot(SESSION, CAPTURED, { ...good, symbol: "MSFT" }));
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");

    // Empty snapshots must retain the producer receipt, not discard lineage.
    const emptyWithoutReceipt = { ...emptyHistory(CAPTURED), receipts: [] };
    await saveSnapshot(snapshot(SESSION, CAPTURED, emptyWithoutReceipt));
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
  });
  it("refuses wrapper drift and unknown fields", async () => {
    await saveSnapshot({ ...snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)), extra: 1 });
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
    await saveSnapshot(snapshot("2026-10-15", CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    // Wrong (though trading) session date: bars fall outside that window.
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
    await saveSnapshot(snapshot("2026-10-10", CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed"); // Saturday session
  });
  it("enforces the 04:00 boundary and the no-future rules", async () => {
    const late = vendorHistory("AMD", [...currentNightRows(), ["2026-10-16T08:00:00Z", 21, 23, 20, 22, 1]], CAPTURED);
    await saveSnapshot(snapshot(SESSION, CAPTURED, late));
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed"); // 04:00 belongs to the day session
    const early = vendorHistory("AMD", [["2026-10-15T23:59:00Z", 21, 23, 20, 22, 1]], CAPTURED);
    await saveSnapshot(snapshot(SESSION, CAPTURED, early)); // 19:59 ET is before the 20:00 open
    expect((await readBoatsLiveSnapshot("AMD", null, NOW)).status).toBe("malformed");
    const afterObservation = vendorHistory("AMD", [["2026-10-16T05:30:00Z", 21, 23, 20, 22, 1]], "2026-10-16T05:00:00Z");
    await saveSnapshot(snapshot(SESSION, "2026-10-16T05:00:00Z", afterObservation));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse("2026-10-16T05:00:00Z"))).status).toBe("malformed");
    const beforeClose = Date.parse("2026-10-16T07:50:00Z");
    await saveSnapshot(snapshot(SESSION, "2026-10-16T07:50:06Z", emptyHistory("2026-10-16T07:50:06Z")));
    expect((await readBoatsLiveSnapshot("AMD", null, beforeClose)).status).toBe("malformed");
    await saveSnapshot(snapshot(SESSION, "2026-10-16T07:50:05Z", emptyHistory("2026-10-16T07:50:05Z")));
    expect((await readBoatsLiveSnapshot("AMD", null, beforeClose)).status).toBe("empty"); // exactly +5s tolerance
  });
  it("accepts a full 480-minute session and refuses anything longer", async () => {
    // The overnight window is exactly 480 minutes (20:00..04:00 ET), so the
    // snapshot cap and the session bound coincide.
    const rows = (n: number): Array<[string, number, number, number, number, number]> =>
      Array.from({ length: n }, (_, i) => {
        const utc = new Date(Date.parse("2026-10-16T00:00:00Z") + (i * 60_000));
        return [utc.toISOString().slice(0, 19) + "Z", 20, 22, 19, 21, 1] as [string, number, number, number, number, number];
      });
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", rows(480), CAPTURED)));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse("2026-10-16T08:00:00Z"))).status).toBe("applied");
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", rows(481), CAPTURED)));
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse("2026-10-16T08:00:00Z"))).status).toBe("malformed");
  });
  it("ignores an older vintage than the baseline's newest receipt", async () => {
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const stale = await readBoatsLiveSnapshot("AMD", Date.parse("2026-10-16T08:00:00.001Z"), NOW);
    expect(stale.status).toBe("stale");
    expect(stale.minutes).toEqual([]);
    const current = await readBoatsLiveSnapshot("AMD", Date.parse(CAPTURED), NOW);
    expect(current.status).toBe("applied"); // equal vintage is not older
  });
});

describe("pure same-session replacement merge", () => {
  it("replaces the whole window and retains other sessions untouched", () => {
    const base: Bar6[] = [[1, 10, 12, 9, 11, 100], [50, 10, 12, 9, 11, 200], [90, 10, 12, 9, 11, 300]];
    const live: Bar6[] = [[50, 20, 22, 19, 21, 7], [60, 20.5, 22.5, 19.5, 21.5, 8]];
    const merged = mergeBoatsLiveHistory(base, live, [40, 80]);
    expect(merged.excluded_base_bars).toBe(1);
    expect(merged.minutes).toEqual([[1, 10, 12, 9, 11, 100], [50, 20, 22, 19, 21, 7], [60, 20.5, 22.5, 19.5, 21.5, 8], [90, 10, 12, 9, 11, 300]]);
    expect(mergeBoatsLiveHistory(base, live, null).minutes).toBe(base);
    // An authoritative empty window is vacated, never refilled from the baseline.
    const vacated = mergeBoatsLiveHistory(base, [], [40, 80]);
    expect(vacated.excluded_base_bars).toBe(1);
    expect(vacated.minutes).toEqual([[1, 10, 12, 9, 11, 100], [90, 10, 12, 9, 11, 300]]);
  });
});

describe("store integration: reload recovers the actual current night", () => {
  it("keeps private snapshots out of default archive-only calls", async () => {
    await saveBase(baseHistory("2026-10-15T12:00:00Z"));
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const baseline = await readTiingoBoatsHistory("AMD", "1m");
    expect(baseline.evidence).not.toHaveProperty("live_history");
    expect(baseline.bars).toContainEqual([disp("2026-10-16T00:00:00Z"), 10.5, 12.5, 9.5, 11.5, 200]);
    expect(baseline.bars.some(bar => bar[4] === 21)).toBe(false);
  });
  it("lets an accepted snapshot replace the current-night baseline minutes after one resample", async () => {
    await saveBase(baseHistory("2026-10-15T12:00:00Z"));
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const out = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(out.evidence.status).toBe("available");
    expect(out.evidence.complete).toBe(false);
    expect(out.evidence.live_history).toMatchObject({ status: "applied", session_date: SESSION, observed_at_utc: CAPTURED });
    expect(out.evidence.input_bars).toBe(4);
    expect(out.evidence.calendar_excluded_bars).toBe(1); // only the 04:00 pre print
    // Current-night minutes are exactly the snapshot's (never blended or summed);
    // the prior session keeps its baseline bar and the 04:00 print stays excluded.
    expect(out.bars).toEqual([
      [disp("2026-10-15T00:00:00Z"), 10, 12, 9, 11, 100],
      [disp("2026-10-16T00:00:00Z"), 20, 22, 19, 21, 7],
      [disp("2026-10-16T00:01:00Z"), 20.5, 22.5, 19.5, 21.5, 8],
      [disp("2026-10-16T07:59:00Z"), 21, 23, 20, 22, 9],
    ]);
    expect(out.evidence.receipt_ids).toEqual([ID]); // base lineage unchanged
  });
  it("treats an empty snapshot as an authoritative empty current window", async () => {
    await saveBase(baseHistory("2026-10-15T12:00:00Z"));
    await saveSnapshot(snapshot(SESSION, CAPTURED, emptyHistory(CAPTURED)));
    const out = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(out.evidence.live_history?.status).toBe("empty");
    expect(out.bars).toEqual([[disp("2026-10-15T00:00:00Z"), 10, 12, 9, 11, 100]]);
    expect(out.evidence.complete).toBe(false);
  });
  it("falls back to the baseline for stale, missing and malformed vintages", async () => {
    await saveBase(baseHistory("2026-10-16T09:00:00Z")); // baseline newer than the snapshot
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const stale = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(stale.evidence.live_history?.status).toBe("stale");
    expect(stale.bars).toContainEqual([disp("2026-10-16T00:00:00Z"), 10.5, 12.5, 9.5, 11.5, 200]);
    await rm(path.join(root, "bars", "AMD.json"));
    const missing = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(missing.evidence.live_history?.status).toBe("missing");
    expect(missing.evidence.status).toBe("available");
    await saveSnapshot({ broken: true });
    const malformed = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(malformed.evidence.live_history?.status).toBe("malformed");
    expect(malformed.evidence.status).toBe("available");
  });
  it("serves the live snapshot alone when no baseline file exists", async () => {
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const out = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(out.evidence.status).toBe("available");
    expect(out.evidence.input_bars).toBe(0);
    expect(out.evidence.content_sha256).toBeNull();
    expect(out.evidence.live_history?.receipt_ids).toEqual([ID]);
    expect(out.bars).toHaveLength(3);
  });
  it("omits live_history entirely when the private root is unset", async () => {
    vi.stubEnv("TIINGO_BOATS_LIVE_DIR", "");
    await saveBase(baseHistory("2026-10-15T12:00:00Z"));
    const out = await readTiingoBoatsHistory("AMD", "1m", "", { live: true });
    expect(out.evidence.live_history).toBeUndefined();
    expect(out.evidence.status).toBe("available");
  });
  it("resamples the merged raw minutes once for a wide timeframe", async () => {
    await saveBase(baseHistory("2026-10-15T12:00:00Z"));
    await saveSnapshot(snapshot(SESSION, CAPTURED, vendorHistory("AMD", currentNightRows(), CAPTURED)));
    const out = await readTiingoBoatsHistory("AMD", "12h", "", { live: true });
    // One candle per session bucket: prior session (baseline) + current night (snapshot).
    expect(out.bars.map(bar => bar[0])).toEqual([
      disp("2026-10-15T00:00:00Z"),
      SESSION_START_DISPLAY,
    ]);
    expect(out.bars[1][5]).toBe(24); // snapshot volume only: 7 + 8 + 9
  });
});

describe("provisioning hygiene", () => {
  it("preserves another writer's pending file and foreign targets", async () => {
    const pending = path.join(root, "requests", ".AMD.json.tmp");
    await writeFile(pending, "pending incumbent bytes", { mode: 0o600 });
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).status).toBe("recorded");
    expect(await readFile(pending, "utf8")).toBe("pending incumbent bytes");
    await symlink(pending, path.join(root, "requests", "MSFT.json"));
    expect((await requestBoatsLiveHistory("MSFT", "1m", "", NIGHT_MS)).reason).toBe("target_not_owned_interest");
    expect(await readFile(path.join(root, "requests", "MSFT.json"), "utf8")).toBe("pending incumbent bytes");
  });
  it("rejects public directories and files without changing permissions", async () => {
    await chmod(root, 0o755);
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).status).toBe("unprovisioned");
    expect((await readBoatsLiveSnapshot("AMD", null, NIGHT_MS)).status).toBe("unreadable");
    await chmod(root, 0o700);
    await saveSnapshot(snapshot(SESSION, CAPTURED, emptyHistory(CAPTURED)));
    await chmod(path.join(root, "bars", "AMD.json"), 0o644);
    expect((await readBoatsLiveSnapshot("AMD", null, Date.parse(CAPTURED))).status).toBe("unreadable");
  });
  it("bounds scans even when foreign files occupy the directory", async () => {
    await Promise.all(Array.from({length: 1025}, (_, i) => writeFile(path.join(root, "requests", `.foreign-${i}`), "")));
    expect((await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS)).reason).toBe("directory_scan_limit");
    expect(await listRequests()).toHaveLength(1025);
  });
  it("never writes demand outside the provisioned root", async () => {
    await chmod(path.join(root, "requests"), 0o700);
    const out = await requestBoatsLiveHistory("AMD", "1m", "", NIGHT_MS);
    expect(out.status).toBe("recorded");
    expect(await listRequests()).toEqual(["AMD.json"]);
    expect((await stat(path.join(root, "requests", "AMD.json")).then(s => s.mode & 0o777))).toBe(0o600);
  });
});
