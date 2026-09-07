import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(() => ({ ok: true })),
  tooMany: vi.fn(() => new Response("rate limited", { status: 429 })),
  hasLiveOptions: vi.fn(async () => true),
  isValidF: vi.fn(() => true),
  // Typed to the real `loadFlowFresh` signature (Promise<Record<string, unknown> | null>)
  // so each test can hand back whatever fixture shape it needs — the default payload
  // below is a sentinel that must never actually be read.
  loadFlowFresh: vi.fn<() => Promise<Record<string, unknown> | null>>(async () => ({
    schema: "must-never-be-read",
  })),
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
import { activeProducerCount } from "@/lib/flowBroadcast";

const savedFixture = process.env.FLOW_FIXTURE;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (savedFixture === undefined) delete process.env.FLOW_FIXTURE;
  else process.env.FLOW_FIXTURE = savedFixture;
  vi.unstubAllGlobals();
});

describe("SSE route — producer lifecycle under disconnect (no leak)", () => {
  afterEach(() => {
    // A stranded producer here would poison every later test's counts too.
    expect(activeProducerCount()).toBe(0);
  });

  it("never attaches a producer for a request whose signal is already aborted", async () => {
    mocks.loadFlowFresh.mockImplementation(async () => ({ asof: "T1" }));
    const controller = new AbortController();
    controller.abort();

    const res = await GET(
      new Request("https://terminal.test/api/flow/stream?f=feed", { signal: controller.signal }),
    );
    // Drain the stream body so start()/cancel() run to completion under vitest's runtime.
    await res.body?.cancel().catch(() => {});

    expect(mocks.loadFlowFresh).not.toHaveBeenCalled();
    expect(activeProducerCount()).toBe(0);
  });

  it("tears the producer down when the client cancels an established connection", async () => {
    mocks.loadFlowFresh.mockImplementation(async () => ({ asof: "T1" }));

    const res = await GET(new Request("https://terminal.test/api/flow/stream?f=feed"));
    expect(activeProducerCount()).toBe(1);

    await res.body?.cancel();
    expect(activeProducerCount()).toBe(0);
  });

  it("tears the producer down when the client aborts an established connection", async () => {
    mocks.loadFlowFresh.mockImplementation(async () => ({ asof: "T1" }));
    const controller = new AbortController();

    const res = await GET(
      new Request("https://terminal.test/api/flow/stream?f=feed", { signal: controller.signal }),
    );
    expect(activeProducerCount()).toBe(1);

    controller.abort();
    // The abort event fires teardown() synchronously; drain the reader so the stream
    // finishes settling under vitest.
    await res.body?.cancel().catch(() => {});
    expect(activeProducerCount()).toBe(0);
  });
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
