import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  tooMany: vi.fn(() => new Response("rate limited", { status: 429 })),
  hasLiveOptions: vi.fn(async () => true),
  isValidF: vi.fn(() => true),
  loadFlowFresh: vi.fn(async () => ({ schema: "must-never-be-read" })),
}));

vi.mock("@/lib/rateLimit", () => ({
  rateLimit: mocks.rateLimit,
  tooMany: mocks.tooMany,
}));

vi.mock("@/lib/entitlement", () => ({
  hasLiveOptions: mocks.hasLiveOptions,
}));

vi.mock("@/lib/flowSource", () => ({
  isValidF: mocks.isValidF,
  loadFlowFresh: mocks.loadFlowFresh,
}));

import { GET } from "@/app/api/flow/stream/route";

const savedFixture = process.env.FLOW_FIXTURE;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (savedFixture === undefined) delete process.env.FLOW_FIXTURE;
  else process.env.FLOW_FIXTURE = savedFixture;
  vi.unstubAllGlobals();
});

describe("Prophet full-plan transport boundary", () => {
  it.each([
    ["normal mode", undefined],
    ["fixture mode", "1"],
  ])(
    "rejects prophet_idx before auth, upstream, or stream creation in %s",
    async (_label, fixture) => {
      if (fixture === undefined) delete process.env.FLOW_FIXTURE;
      else process.env.FLOW_FIXTURE = fixture;

      const NativeReadableStream = globalThis.ReadableStream;
      vi.stubGlobal(
        "ReadableStream",
        new Proxy(NativeReadableStream, {
          construct(target, args, newTarget) {
            const source = args[0] as { type?: string } | undefined;
            // Node's native Response(string) allocates a byte stream for the
            // rejection body. Permit only that internal stream; the route's
            // explicit SSE source has no `type: "bytes"` and must never exist.
            if (source?.type !== "bytes") {
              throw new Error("prophet_idx must be rejected before SSE stream creation");
            }
            return Reflect.construct(target, args, newTarget);
          },
        }),
      );

      const res = await GET(
        new Request("https://terminal.test/api/flow/stream?f=prophet_idx"),
      );

      expect(res.status).toBe(400);
      expect(await res.text()).toBe("bad f param");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(res.headers.get("content-type")).not.toContain("text/event-stream");

      expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
      expect(mocks.hasLiveOptions).not.toHaveBeenCalled();
      expect(mocks.isValidF).not.toHaveBeenCalled();
      expect(mocks.loadFlowFresh).not.toHaveBeenCalled();
    },
  );
});
