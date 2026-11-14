// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { useDiscoverQuotes } from "@/components/screener/useDiscoverQuotes";

type Pending = { url: string; resolve: (response: Response) => void; reject: (reason: Error) => void; signal: AbortSignal };
let pending: Pending[], hidden: boolean, root: Root, host: HTMLDivElement;
let value: ReturnType<typeof useDiscoverQuotes>;
function Reader({ owner = "A" }: { owner?: string }) { value = useDiscoverQuotes(owner, ["NVDA"], ["NVDA"], true, true); return <output>{JSON.stringify(value)}</output>; }
const response = (last = 200) => new Response(JSON.stringify({ quotes: { NVDA: { last, regularPrice: last, regularChg: 2, live: true, ts: Date.now() / 1000 } } }), { status: 200 });
const overnight = () => new Response(JSON.stringify({ quotes: { NVDA: null } }), { status: 200 });
async function changeVisibility(next: boolean) { await act(async () => { hidden = next; document.dispatchEvent(new Event("visibilitychange")); }); }
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(async () => {
  vi.useFakeTimers(); pending = []; hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => pending.push({ url, resolve, reject, signal: init.signal as AbortSignal }))));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<Reader />); });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Discover quote subscription lifecycle", () => {
  it.each(["rejection", "success"])("ignores an old %s after hidden/resumed polling", async late => {
    const [oldRegular, oldOvernight] = pending;
    await changeVisibility(true); expect(oldRegular.signal.aborted).toBe(true);
    await changeVisibility(false); expect(pending).toHaveLength(4);
    const [, , nextRegular, nextOvernight] = pending;
    await act(async () => { nextRegular.resolve(response(200)); });
    await act(async () => { if (late === "rejection") oldRegular.reject(new Error("aborted")); else oldRegular.resolve(response(100)); oldOvernight.resolve(overnight()); });
    await act(async () => { nextOvernight.resolve(overnight()); });
    expect(value.regular.NVDA?.regularPrice).toBe(200); expect(value.regularStatus).toBe("ready");
  });
  it("keeps successful regular quotes when the overnight lane fails", async () => {
    await act(async () => { pending[0].resolve(response()); pending[1].resolve(new Response("", { status: 503 })); });
    expect(value.regular.NVDA?.regularPrice).toBe(200);
    expect(value.regularStatus).toBe("ready"); expect(value.overnightStatus).toBe("unavailable");
  });
  it("keeps a completed regular lane when only overnight reaches the request deadline", async () => {
    await act(async () => { pending[0].resolve(response()); });
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); pending[1].reject(new Error("deadline")); });
    expect(value.regular.NVDA?.regularPrice).toBe(200);
    expect(value.regularStatus).toBe("ready"); expect(value.overnightStatus).toBe("unavailable");
  });
  it("clears outgoing-owner data synchronously and rejects its late response", async () => {
    const old = [...pending];
    await act(async () => { root.render(<Reader owner="B" />); });
    expect(value.regular).toEqual({});
    await act(async () => { old[0].resolve(response(100)); old[1].resolve(overnight()); });
    expect(value.regular).toEqual({});
    await act(async () => { pending[2].resolve(response(220)); pending[3].resolve(overnight()); });
    expect(value.regular.NVDA?.regularPrice).toBe(220);
  });
});
