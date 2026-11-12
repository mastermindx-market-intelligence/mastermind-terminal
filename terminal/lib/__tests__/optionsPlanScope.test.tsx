// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ listener: null as null | ((event: string, session: {user:{id:string}} | null) => void), finish: null as null | ((v: unknown) => void), unsubscribe: vi.fn() }));
vi.mock("../supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.listener) => { auth.listener = callback; return { data: { subscription: { unsubscribe: auth.unsubscribe } } }; },
  getUser: () => new Promise(resolve => { auth.finish = resolve; }),
} }) }));
import { useOptionsPlanScope } from "../useOptionsPlanScope";
import { useContractShortlist } from "@/components/options/ContractShortlist";
import { draft } from "./fixtures/optionsPlanPayoff";
vi.mock("../optionsContractShortlistLex", () => ({ useShortlistT: () => (key: string) => key, fillShortlistCopy: (key: string) => key }));
let host: HTMLDivElement, root: Root;
function Harness() {
  const scope = useOptionsPlanScope(), shortlist = useContractShortlist(scope), pin = draft().legs[0].snapshot;
  return <><output>{scope}</output><span data-count>{shortlist.pins.length}</span><button onClick={() => shortlist.toggle(pin.row,{family:pin.family,asof:pin.asofRaw,schema:pin.schema,stale:pin.sourceStale,hotView:pin.hotView},[pin.row])}>Pin</button></>;
}
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); host = document.createElement("div"); document.body.append(host); root = createRoot(host); auth.unsubscribe.mockClear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const account = async (id: string | null) => act(async () => auth.listener?.(id ? "SIGNED_IN" : "SIGNED_OUT", id ? {user:{id}} : null));
describe("account-scoped shortlist lifetime", () => {
  it("clears pins on A→B→A and ignores a late initial user read", async () => {
    await act(async () => root.render(<Harness />));
    await account("a"); await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("[data-count]")?.textContent).toBe("1");
    await account("b"); expect(host.querySelector("[data-count]")?.textContent).toBe("0");
    await account("a"); expect(host.querySelector("[data-count]")?.textContent).toBe("0");
    expect(host.querySelector("output")?.textContent).toBe('["a",3]');
    await act(async () => auth.finish?.({data:{user:{id:"late"}},error:null}));
    expect(host.querySelector("output")?.textContent).toBe('["a",3]');
    await act(async () => root.unmount()); expect(auth.unsubscribe).toHaveBeenCalledOnce();
    root = createRoot(host);
  });
  it("retains same-account token refresh but clears sign-out", async () => {
    await act(async () => root.render(<Harness />)); await account("a");
    await act(async () => host.querySelector("button")!.click());
    await account("a"); expect(host.querySelector("[data-count]")?.textContent).toBe("1");
    await account(null); expect(host.querySelector("[data-count]")?.textContent).toBe("0");
  });
});
