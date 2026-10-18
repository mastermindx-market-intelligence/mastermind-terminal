// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prophetFixture } from "./prophetObservationsFixture";
const auth = vi.hoisted(() => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("../supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: auth.subscribe } }) }));
import { useProphetObservation } from "../useProphetObservation";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
function Read({ symbol, account }: { symbol: string; account: string | null }) {
  const read = useProphetObservation(symbol, account);
  return <><output>{JSON.stringify({ symbol: read.symbol, account: read.account, status: read.status, data: read.data })}</output><button onClick={read.retry}>Retry</button></>;
}
const response = (symbol: string) => new Response(JSON.stringify(prophetFixture(symbol)), { headers: { "Content-Type": "application/json" } });
describe("single account-bound Prophet observation read", () => {
  let root: Root, host: HTMLDivElement;
  let listener: (event: string, session: { user: { id: string } } | null) => void;
  beforeEach(() => {
    listener = () => {};
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    auth.subscribe.mockImplementation(cb => { listener = cb; queueMicrotask(() => cb("INITIAL_SESSION", { user: { id: "reader-a" } })); return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; });
    vi.stubGlobal("fetch", vi.fn(async () => response("KO")));
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
  const render = async (symbol = "KO", account: string | null = "reader-a") => act(async () => root.render(<Read symbol={symbol} account={account} />));
  const value = () => JSON.parse(host.querySelector("output")!.textContent!);

  it.each(["reader-a", "reader-b"])("waits for initial browser account validation: %s", async browserAccount => {
    auth.subscribe.mockImplementation(cb => { listener = cb; return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; });
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(value()).toMatchObject({ status: "loading", data: null });
    expect(fetch).not.toHaveBeenCalled();
    await act(async () => listener("INITIAL_SESSION", { user: { id: browserAccount } }));
    if (browserAccount === "reader-a") {
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(value().status).toBe("ready");
    } else {
      expect(fetch).not.toHaveBeenCalled();
      expect(value()).toMatchObject({ status: "unauthenticated", data: null });
    }
  });

  it("fetches the active symbol once without public caching or browser bearer tokens", async () => {
    await render(); expect(value()).toMatchObject({ status: "ready", symbol: "KO", account: "reader-a" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]).toMatchObject(["/api/prophet/observations?ticker=KO", { cache: "no-store", credentials: "same-origin", redirect: "error" }]);
  });
  it("fences a late WM result when the user changes to KO", async () => {
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(input => String(input).includes("WM") ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(response("KO")));
    await render("WM"); expect(value().status).toBe("loading");
    await render("KO"); expect(value().data.rows[0].ticker).toBe("KO");
    await act(async () => finish(response("WM"))); expect(value().data.rows[0].ticker).toBe("KO");
  });
  it("clears private data immediately on native sign-out and ignores an in-flight response", async () => {
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render(); await act(async () => listener("SIGNED_OUT", null));
    expect(value()).toMatchObject({ status: "unauthenticated", data: null });
    await act(async () => finish(response("KO"))); expect(value().data).toBeNull();
  });
  it("fences another account before a new response arrives", async () => {
    await render(); expect(value().data).not.toBeNull();
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    await render("KO", "reader-b"); expect(value()).toMatchObject({ account: "reader-b", status: "unauthenticated", data: null });
    await act(async () => listener("SIGNED_IN", { user: { id: "reader-b" } }));
    expect(value()).toMatchObject({ account: "reader-b", status: "loading", data: null });
  });
  it("does not fetch for signed-out or unsupported instruments", async () => {
    await render("KO", null); expect(value().status).toBe("unauthenticated"); expect(fetch).not.toHaveBeenCalled();
    await render("BTC-USD", "reader-a"); expect(value().status).toBe("unsupported"); expect(fetch).not.toHaveBeenCalled();
  });
  it("clears an old result when a deliberate refresh is refused", async () => {
    await render(); vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 403 }));
    await act(async () => host.querySelector("button")!.click());
    expect(value()).toMatchObject({ status: "forbidden", data: null });
  });
  it("does not spin on focus, but permits an explicit retry", async () => {
    await render(); await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector("button")!.click()); expect(fetch).toHaveBeenCalledTimes(2);
  });
});
