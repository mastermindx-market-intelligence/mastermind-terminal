import { describe, it, expect } from "vitest";
import { readFuturesJson, FUTURES_MAX_BYTES } from "../futuresTransport";

describe("bounded futures browser response", () => {
  it("parses normal JSON including non-ASCII labels", async () => {
    expect(await readFuturesJson(new Response(JSON.stringify({ label: "\u6df1\u5ea6", zero: 0 })))).toEqual({ label: "\u6df1\u5ea6", zero: 0 });
  });
  it("rejects declared oversized data before buffering it", async () => {
    let cancelled = 0;
    const stream = new ReadableStream({ cancel() { cancelled++; } });
    await expect(readFuturesJson(new Response(stream, { headers: { "content-length": String(FUTURES_MAX_BYTES + 1) } }))).rejects.toThrow("response_size");
    expect(cancelled).toBe(1);
  });
  it("cancels an unbounded undeclared stream at its byte limit", async () => {
    let cancelled = 0;
    const stream = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(500)); }, cancel() { cancelled++; } });
    await expect(readFuturesJson(new Response(stream), 800)).rejects.toThrow("response_size");
    expect(cancelled).toBe(1);
  });
  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    await expect(readFuturesJson(new Response(JSON.stringify("\u6df1".repeat(10))), 15)).rejects.toThrow("response_size");
  });
  it("decodes UTF-8 split inside a multi-byte character", async () => {
    const data = new TextEncoder().encode(JSON.stringify({ x: "\u6df1" }));
    const stream = new ReadableStream({ start(c) { for (const byte of data) c.enqueue(new Uint8Array([byte])); c.close(); } });
    expect(await readFuturesJson(new Response(stream))).toEqual({ x: "\u6df1" });
  });
  it("refuses malformed UTF-8 instead of replacing source bytes", async () => {
    await expect(readFuturesJson(new Response(new Uint8Array([123, 255, 125])))).rejects.toThrow();
  });
  it("does not manufacture data from an absent or non-JSON body", async () => {
    await expect(readFuturesJson(new Response(null, { status: 204 }))).rejects.toThrow();
    await expect(readFuturesJson(new Response("<html>sign in</html>"))).rejects.toThrow();
  });
});
