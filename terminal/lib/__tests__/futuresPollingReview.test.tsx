// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useFuturesWorkspace } from "@/components/futures/useFuturesWorkspace";
import { DEFAULT_FUTURES_REQUEST as request } from "../futuresRequest";
import { joinFuturesSource } from "../futuresSourceJoin";
import { sourceFixture, fixtureNow } from "./fixtures/futuresSourceFixture";
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let observed: ReturnType<typeof useFuturesWorkspace> | undefined;
const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = undefined; host?.remove(); host = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
  if (visibility) Object.defineProperty(document, "visibilityState", visibility);
  else Reflect.deleteProperty(document, "visibilityState");
});
async function mount(basis: "historical" | "realtime") {
  vi.useFakeTimers(); vi.setSystemTime(fixtureNow); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const result = joinFuturesSource(sourceFixture(), request, fixtureNow);
  if (result.status !== "data") throw Error("fixture_join");
  const data = { ...result.data, basis, freshUntilMs: fixtureNow + 14000 };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data)));
  vi.stubGlobal("fetch", fetcher);
  function Probe() { observed = useFuturesWorkspace(request, "review:owner", 0); return null; }
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root!.render(createElement(Probe)); });
  return fetcher;
}
describe("independent polling review counterexample uses the actual mounted hook", () => {
  it("successful real-time response overrides the 15s failure delay before the first reschedule", async () => {
    const fetcher = await mount("realtime"); expect(fetcher).toHaveBeenCalledTimes(1); expect(observed?.status).toBe("data");
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); }); expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("historical success disables the automatic timer instead of adopting a live cadence", async () => {
    const fetcher = await mount("historical"); expect(observed?.status).toBe("data");
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); }); expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
