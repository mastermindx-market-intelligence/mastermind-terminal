import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readMatrixDisplayCapture } from "@/lib/matrixDisplayCapture";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
// Whitespace and non-ASCII bytes must survive; parsing/reserializing changes them.
const raw = new TextEncoder().encode(' {"schema":"options_structure.matrix/v1", "root":"SPY", "note":"测试"}\n');
const selected = new TextEncoder().encode('{ "root": "SPY", "strike": "600" }');
const ref = () => ({ root: "SPY", sha256: sha(raw), byte_length: raw.length, session: "2026-10-12" });
const fetcher = vi.fn();
const ask = () => { vi.stubGlobal("fetch", fetcher); return readMatrixDisplayCapture(ref(), selected); };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); fetcher.mockReset(); });
describe("raw retained Matrix capture is exact and explicitly unqualified", () => {
  it("retains both exact bodies and separate digests without parsing or sending credentials", async () => {
    const r = new Response(raw); const json = vi.spyOn(r, "json"); fetcher.mockResolvedValue(r);
    const out = await ask(); expect(out.status).toBe("captured_unqualified");
    if (out.status !== "captured_unqualified") throw Error("capture missing");
    expect(out.matrix.body).toEqual(raw); expect(out.selection.body).toEqual(selected);
    expect(out.matrix.sha256).toBe(sha(raw)); expect(out.selection.sha256).toBe(sha(selected));
    expect(out.matrix.sha256).not.toBe(out.selection.sha256); expect(json).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty("authorization"); expect(out).not.toHaveProperty("save_allowed");
    expect(fetcher.mock.calls[0][0]).toContain(`/options_structure/matrix/history/SPY/${sha(raw)}.json`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ cache: "no-store", redirect: "error", credentials: "omit", headers: { "User-Agent": "mastermind-feed/1.0" } });
    expect(Object.keys(fetcher.mock.calls[0][1].headers)).toEqual(["User-Agent"]);
  });
  it("copies tiny and empty stream chunks into one bounded result", async () => {
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) {
      if (index >= raw.length) { c.close(); return; }
      c.enqueue(new Uint8Array(0));
      c.enqueue(raw.slice(index, ++index));
    } });
    fetcher.mockResolvedValue(new Response(stream));
    const out = await ask();
    expect(out.status).toBe("captured_unqualified");
    if (out.status !== "captured_unqualified") throw Error("missing");
    expect(out.matrix.body).toEqual(raw);
    expect(out.matrix.body.buffer.byteLength).toBe(raw.length);
  });
  it("copies request inputs before the read completes", async () => {
    const selection = Uint8Array.from(selected); const expected = ref();
    let resolve!: (r: Response) => void;
    fetcher.mockReturnValue(new Promise<Response>(r => { resolve = r; })); vi.stubGlobal("fetch", fetcher);
    const pending = readMatrixDisplayCapture(expected, selection);
    selection.fill(0); expected.root = "QQQ"; resolve(new Response(raw));
    const out = await pending; if (out.status !== "captured_unqualified") throw Error("missing");
    expect(out.selection.body).toEqual(selected); expect(out.snapshot.root).toBe("SPY");
  });
  it.each(["changed", "truncated", "reserialized"])("rejects %s bytes without a head/backend fallback", async kind => {
    const changed = Uint8Array.from(raw); changed[0] = 10;
    const body = kind === "changed" ? changed : kind === "truncated" ? raw.slice(0, -1) : new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(raw))));
    fetcher.mockResolvedValue(new Response(body)); expect(await ask()).toEqual({ status: "unavailable" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([206, 301, 403, 404, 500, 503])("rejects HTTP %s", async status => {
    fetcher.mockResolvedValue(new Response(raw, { status })); expect(await ask()).toEqual({ status: "unavailable" });
  });
  it("rejects wrong declared length and cancels a too-long stream", async () => {
    fetcher.mockResolvedValueOnce(new Response(raw, { headers: { "content-length": "1" } }));
    expect(await ask()).toEqual({ status: "unavailable" });
    let cancelled = false;
    fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(raw.length + 1)); }, cancel() { cancelled = true; } })));
    expect(await ask()).toEqual({ status: "unavailable" }); expect(cancelled).toBe(true);
  });
  it.each(["root", "sha256", "session", "length", "selection"])("refuses malformed %s before fetching", async defect => {
    const expected = ref(); let selection = selected;
    if (defect === "root") expected.root = "../SPY";
    if (defect === "sha256") expected.sha256 = "invented";
    if (defect === "session") expected.session = "2026-02-30";
    if (defect === "length") expected.byte_length = 17 * 1024 * 1024;
    if (defect === "selection") selection = new Uint8Array(2049);
    vi.stubGlobal("fetch", fetcher);
    expect(await readMatrixDisplayCapture(expected, selection)).toEqual({ status: "unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("a network failure has no diagnostic or data fallback", async () => {
    fetcher.mockRejectedValue(Error("private source path")); expect(await ask()).toEqual({ status: "unavailable" });
  });
  it("a stalled retained stream times out even when cancellation never settles", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    fetcher.mockResolvedValue(new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; return new Promise(() => {}); } })));
    const pending = ask(); await vi.advanceTimersByTimeAsync(3001);
    expect(await pending).toEqual({ status: "unavailable" }); expect(cancelled).toBe(true);
  });

});
