import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPineHost, type PineHost, type RunRequest } from "../pine-engine/host";
import type { Bar } from "../pine-engine";

const names = ["TG_rsi", "TG_rsi_macd", "TG_rsi_macd_signal", "TG_rsi_macd_hist", "TG_stoch_k", "TG_stoch_d"];
const source = ['//@version=5', 'indicator("fixture")',
  ...names.map(name => 'plot(bar_index == 0 ? na : close, "' + name + '")')].join("\n");
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const bars: Bar[] = [0, 1, 2].map(i => ({
  time: new Date(Date.UTC(2001, 0, 2, 15, i)).toISOString(),
  timeClose: new Date(Date.UTC(2001, 0, 2, 15, i + 1)).toISOString(),
  o: 1, h: 2, l: 0, c: 1.2345678901234567, v: i,
}));

function request(probe = source, rows = bars): RunRequest {
  const inputBytes = new TextEncoder().encode(JSON.stringify(rows));
  const columns = rows.map(b => [b.time, b.timeClose, b.o, b.h, b.l, b.c, b.v]);
  return { slot: "asc", source: probe, bars: rows, opts: { symbol: "SYN", timeframe: "1" },
    referenceExport: { inputBytes, probeSha256: hash(probe), inputSha256: hash(inputBytes),
      columnsSha256: hash(JSON.stringify(columns)) } };
}

// Exercise the production host and worker handler. Only the browser transport is a double.
let host: PineHost, paused: boolean, deferFirstBoot: boolean;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SHARED_SHELL_BUILD", "a".repeat(40));
  const { default: config } = await import("../../next.config");
  vi.stubEnv("NEXT_PUBLIC_PINE_SOURCE_SHA256", config.env!.NEXT_PUBLIC_PINE_SOURCE_SHA256 as string);
  paused = deferFirstBoot = false;
  let generations = 0;
  let current: LoopWorker;
  const endpoint = {
    onmessage: null as null | ((e: { data: any }) => Promise<void>),
    postMessage(msg: any) { if (current) current.onmessage?.({ data: structuredClone(msg) }); },
  };
  class LoopWorker {
    onmessage?: (msg: any) => void;
    readonly waiting = ++generations === 1 && deferFirstBoot;
    constructor() { current = this; if (!this.waiting) queueMicrotask(() => this.onmessage?.({ data: { kind: "ready" } })); }
    postMessage(msg: unknown) { if (!this.waiting && !paused) void endpoint.onmessage!({ data: structuredClone(msg) }); }
    terminate() {}
  }
  vi.stubGlobal("window", {});
  vi.stubGlobal("Worker", LoopWorker);
  vi.stubGlobal("self", endpoint);
  await import("../pine-engine/worker");
  host = createPineHost();
});
afterEach(() => { host.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("optional Pine worker reference export", () => {
  it("retains the actual inline probe, columns, clocks, precision and whitespace gaps", async () => {
    const wrong = await host.compile(source.replaceAll("na : close", "na : open"));
    const req = { ...request(), astId: wrong.astId! };
    const before = Date.now();
    const result = await host.run(req);
    const receipt = result.referenceExport;
    expect(result.errors).toEqual([]);
    expect(receipt?.status).toBe("retained");
    if (receipt?.status !== "retained") throw new Error(JSON.stringify(receipt));
    expect(hash(receipt.bytes)).toBe(receipt.sha256);
    expect(receipt.byteLength).toBe(receipt.bytes.length);
    const record = JSON.parse(new TextDecoder().decode(receipt.bytes));
    expect(record.series).toEqual(names.map(n => [n, [null, bars[1].c, bars[2].c]]));
    expect(record.times).toEqual(bars.map(b => [b.time, b.timeClose]));
    expect(record.probeSha256).toBe(hash(source));
    expect(record.columnsSha256).toBe(req.referenceExport!.columnsSha256);
    expect(record.inputSha256).toBe(hash(req.referenceExport!.inputBytes));
    expect(record.normalizationBinding).toBe("supplied_pair_unverified_derivation");
    expect(record.options).toMatchObject({ timeframe: "1", symbol: "SYN", sessionAnchor: null, params: {} });
    expect(record.startedMs).toBeGreaterThanOrEqual(before);
    expect(record.completedMs).toBeGreaterThanOrEqual(record.startedMs);
    expect(record.completedMs).toBeLessThanOrEqual(Date.now());
    expect(record.sourceClosure).toBe(process.env.NEXT_PUBLIC_PINE_SOURCE_SHA256);
    expect(record.build).toBe("a".repeat(40));
  });

  it("retains the supported RSI, MACD and stochastic calculations on synthetic bars", async () => {
    const rows = Array.from({ length: 36 }, (_, i) => ({ ...bars[0],
      time: new Date(Date.UTC(2001, 0, 2, 15, i)).toISOString(),
      timeClose: new Date(Date.UTC(2001, 0, 2, 15, i + 1)).toISOString(), c: 1 + Math.sin(i) }));
    const probe = ['indicator("synthetic oscillators")', 'n = input.int(3, "length")',
      'r = ta.rsi(close, n)', 'm = ta.ema(r, 2) - ta.ema(r, 4)', 's = ta.ema(m, 2)',
      'lo = ta.lowest(r, n)', 'hi = ta.highest(r, n)',
      'k = ta.sma(hi == lo ? na : 100 * (r - lo) / (hi - lo), 2)', 'd = ta.sma(k, 2)',
      ...["r", "m", "s", "m - s", "k", "d"].map((expr, i) => 'plot(' + expr + ', "' + names[i] + '")')
    ].join("\n");
    const ref = (await host.run(request(probe, rows))).referenceExport;
    expect(ref?.status).toBe("retained");
    if (ref?.status !== "retained") throw new Error(JSON.stringify(ref));
    const record = JSON.parse(new TextDecoder().decode(ref.bytes));
    expect(record.probeLanguage).toBe("asc-six-series-v1");
    for (const [, values] of record.series) expect(Number.isFinite(values.at(-1))).toBe(true);
  });

  it("binds the post-coercion override by variable, even when two inputs share a title", async () => {
    const probe = ['indicator("override fixture")', 'length = input.int(14, "Length")',
      'other = input.int(5, "Length")',
      ...names.map(name => 'plot(length + other, "' + name + '")')].join("\n");
    const defaultRun = (await host.run(request(probe))).referenceExport;
    const override = (await host.run({ ...request(probe), inputs: { length: "3" } })).referenceExport;
    if (defaultRun?.status !== "retained" || override?.status !== "retained") throw new Error("unavailable inputs");
    const read = (b: Uint8Array) => JSON.parse(new TextDecoder().decode(b));
    expect(read(defaultRun.bytes).series[0][1]).toEqual([19, 19, 19]);
    const record = read(override.bytes);
    expect(record.series[0][1]).toEqual([8, 8, 8]);
    expect(record.effectiveInputs).toEqual([{ variable: "length", value: 3 }, { variable: "other", value: 5 }]);
    expect(record.declaredInputs.map((x: {value: number}) => x.value)).toEqual([14, 5]);
  });

  it.each([
    ["missing series", source.replace('"TG_rsi"', '"different"')],
    ["duplicate series", source + '\nplot(close, "TG_rsi")'],
    ["unsupported operation", source + '\nplot(request.security("OTHER", "1D", close), "guard")'],
    ["unimplemented member", source + '\nplot(session.ismarket, "metadata")'],
    ["placeholder instrument metadata", source + '\nplot(syminfo.mintick, "metadata")'],
    ["constant timeframe.change stub", source.replace("bar_index == 0 ? na : close", 'timeframe.change("D") ? 7 : 1')],
    ["timestamp stub masked by nz", source.replace("bar_index == 0 ? na : close", "nz(timestamp(2001,1,2,0,0),7)")],
    ["unclassified call on an unselected branch", source.replace("bar_index == 0 ? na : close", "false ? timestamp(2001,1,2,0,0) : close")],
    ["parse failure", 'indicator("broken"'],
  ])("refuses a completed reference for %s", async (_name, probe) => {
    expect((await host.run(request(probe))).referenceExport?.status).toBe("unavailable");
  });

  it("rejects missing closing timestamps, conflicting source bytes and unversioned builds", async () => {
    const req = request();
    expect((await host.run({ ...req, bars: bars.map(b => ({ ...b, timeClose: undefined })) })).referenceExport?.status).toBe("unavailable");
    expect((await host.run({ ...req, referenceExport: { ...req.referenceExport!, inputSha256: "0".repeat(64) } })).referenceExport)
      .toMatchObject({ status: "unavailable", reason: "source_binding_mismatch" });
    vi.stubEnv("NEXT_PUBLIC_SHARED_SHELL_BUILD", "unversioned");
    expect((await host.run(req)).referenceExport).toMatchObject({ status: "unavailable", reason: "unidentified_worker_build" });
  });

  it("refuses shared source bytes before dispatch", async () => {
    const req = request();
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    shared[0] = 1;
    req.referenceExport!.inputBytes = shared;
    req.referenceExport!.inputSha256 = hash(shared);
    const pending = host.run(req);
    shared[0] = 2;
    expect((await pending).referenceExport).toEqual({ status: "unavailable", reason: "shared_source_bytes" });
  });

  it("boot repost retains the bytes and columns from the original host call", async () => {
    vi.useFakeTimers();
    deferFirstBoot = true;
    const req = structuredClone(request());
    const expected = req.referenceExport!.inputSha256;
    const pending = host.run(req);
    req.referenceExport!.inputBytes[0] ^= 1;
    req.bars[1].c = 99;
    await vi.advanceTimersByTimeAsync(30_001);
    const ref = (await pending).referenceExport;
    expect(ref?.status).toBe("retained");
    if (ref?.status !== "retained") throw new Error(JSON.stringify(ref));
    const record = JSON.parse(new TextDecoder().decode(ref.bytes));
    expect(record.inputSha256).toBe(expected);
    expect(record.series[0][1][1]).toBe(bars[1].c);
  });

  it("retains nothing after supersession or a host timeout", async () => {
    vi.useFakeTimers();
    paused = true;
    const first = host.run(request());
    const second = host.run({ ...request(), budgetMs: 10 });
    expect((await first).referenceExport).toEqual({ status: "unavailable", reason: "cancelled" });
    await vi.advanceTimersByTimeAsync(20);
    expect((await second).referenceExport).toEqual({ status: "unavailable", reason: "timeout" });
  });

  it("leaves ordinary runs unchanged and refuses export without a worker", async () => {
    const { referenceExport, ...ordinary } = request();
    expect(await host.run(ordinary)).not.toHaveProperty("referenceExport");
    vi.stubGlobal("Worker", undefined);
    const sync = createPineHost();
    expect((await sync.run(request())).referenceExport).toEqual({ status: "unavailable", reason: "worker_required" });
    sync.dispose();
  });
});
