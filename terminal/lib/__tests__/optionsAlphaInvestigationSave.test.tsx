// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionsAlphaInvestigation } from "@/components/prophet/OptionsAlphaInvestigation";
import type { OptionsAlphaMeasuredFeed } from "@/components/prophet/optionsAlphaMeasuredEvidence";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const feed = { events: [{ id: "fixture", root: "NVDA", right: "C", strike: 200, expiration: "2026-12-18", microstructure: {} }], stale: false, source_asof: null } as unknown as OptionsAlphaMeasuredFeed;
let host: HTMLDivElement, root: Root, writes: string[], membership: Set<string>, readMode: "ready" | "fail" | "signed-out", postStatus: number;
const inventory = () => ({ lists: ["one", "two"].map(id => ({ id, name: id, symbols: membership.has(id) ? [{ symbol: "NVDA" }] : [] })) });
const button = (text: string) => [...host.querySelectorAll("button")].find(el => el.textContent === text)!;
const click = async (text: string) => { const el = button(text); expect(el, text).toBeTruthy(); await act(async () => el.click()); };
const select = async (id: string) => { await act(async () => { const el = host.querySelector("select")!; el.value = id; el.dispatchEvent(new Event("change", { bubbles: true })); }); };
const open = async () => { await act(async () => root.render(<OptionsAlphaInvestigation feed={feed} failed={false} lang="en" renderEvent={() => null} />)); await click("Inspect NVDA ↗"); };
beforeEach(() => {
 host = document.createElement("div"); document.body.append(host); root = createRoot(host); writes = []; membership = new Set(); readMode = "ready"; postStatus = 0;
 HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
 vi.stubGlobal("fetch", vi.fn(async (_url, init?: RequestInit) => {
  if (init?.method === "POST") { const id = JSON.parse(init.body as string).listId; writes.push(id); if (postStatus) return new Response("{}", { status: postStatus }); if (id === "two") { membership.add(id); return new Response("{}", { status: 200 }); } throw new TypeError("lost response"); }
  if (readMode === "fail") throw new TypeError("offline");
  return new Response(JSON.stringify(inventory()), { status: readMode === "signed-out" ? 401 : 200 });
 }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("retains unresolved target through selection while another list remains writable", async () => {
 await open(); await click("Add underlying to watchlist"); expect(host.textContent).toContain("Save not confirmed");
 await select("two"); await click("Add underlying to watchlist"); expect(host.textContent).toContain("Saved to two");
 await select("one"); expect(button("Check watchlist")).toBeTruthy(); expect(button("Add underlying to watchlist")).toBeUndefined();
 await click("Check watchlist"); expect(host.textContent).toContain("Save not confirmed"); expect(writes).toEqual(["one", "two"]);
});
it("failed reconciliation retains uncertainty until positive membership", async () => {
 await open(); readMode = "fail"; await click("Add underlying to watchlist");
 // A later inventory outage is reached through Check watchlist in the existing UI.
 await click("Check watchlist");
 readMode = "ready"; await click("Check watchlist"); expect(host.textContent).toContain("Save not confirmed");
 membership.add("one"); await click("Check watchlist"); expect(host.textContent).toContain("Saved to one"); expect(writes).toEqual(["one"]);
});
it("auth loss after lost response preserves uncertainty", async () => {
 await open(); readMode = "signed-out"; await click("Add underlying to watchlist");
 expect(host.textContent).toContain("Sign in to save"); expect(host.textContent).toContain("Save not confirmed"); expect(writes).toEqual(["one"]);
});
it("a deterministic pre-write authentication refusal is signed out without unknown status", async () => {
 await open(); postStatus = 401; await click("Add underlying to watchlist");
 expect(host.textContent).toContain("Sign in to save"); expect(host.textContent).not.toContain("Save not confirmed"); expect(writes).toEqual(["one"]);
});

it("keeps a known pre-write rejection through failed checks, then permits an explicit retry after an absent read", async () => {
 await open(); postStatus = 400; await click("Add underlying to watchlist");
 expect(host.textContent).toContain("Save request was declined");
 readMode = "fail"; await click("Check watchlist");
 expect(host.textContent).toContain("Save request was declined"); expect(host.textContent).not.toContain("Save not confirmed");
 readMode = "ready"; await click("Check watchlist");
 expect(button("Add underlying to watchlist")).toBeTruthy(); expect(writes).toEqual(["one"]);
});
