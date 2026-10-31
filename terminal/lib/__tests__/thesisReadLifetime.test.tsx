// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import ThesisWorkspace from "@/components/workspaces/ThesisWorkspace";
import { LangProvider } from "@/lib/i18n";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Read = { path: string; method: string; body: BodyInit | null | undefined; signal: AbortSignal | null | undefined; resolve: (value: Response) => void; reject: (error: Error) => void };
let root: Root | null = null, container: HTMLDivElement, reads: Read[];
const response = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const summary = (title: string) => ({ id: title, currentVersion: 1, lifecycleState: "active", title, updatedAt: "2026-10-14T00:00:00.000Z", subject: { schema: "mastermind.thesis-subject-ref/v1", kind: "issuer", owner: "data_os.security_master", key: title, identityState: "resolved", display: title } });
const flush = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function render(owner: string, strict = false) {
  await act(async () => {
    const child = <LangProvider><ThesisWorkspace ownerKey={owner} /></LangProvider>;
    root!.render(strict ? <StrictMode>{child}</StrictMode> : child);
  });
  await flush();
}
async function answer(group: Read[], title = "Current") {
  await act(async () => { for (const read of group) read.resolve(response(read.path === "/api/theses" ? { theses: [summary(title)] } : { views: [] })); });
  await flush();
}
const list = (group: Read[]) => group.find(read => read.path === "/api/theses")!;
const views = (group: Read[]) => group.find(read => read.path === "/api/thesis-saved-views")!;
const renderedTitles = () => container.querySelector('[data-testid="thesis-list-pane"]')?.textContent;

beforeEach(() => {
  reads = [];
  const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom;
  if (dom) for (const key of ["localStorage", "sessionStorage"] as const) Object.defineProperty(window, key, { value: dom.window[key], configurable: true, writable: true });
  window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/analysis?view=theses");
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://fixture.test");
    reads.push({ path: url.pathname, method: init?.method ?? "GET", body: init?.body, signal: init?.signal, resolve, reject });
  })));
  if (!window.matchMedia) window.matchMedia = ((media: string) => ({ matches: false, media, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } })) as typeof window.matchMedia;
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount()); root = null;
  await answer(reads); container.remove(); vi.unstubAllGlobals();
});

describe("Thesis entry read lifetime", () => {
  it("aborts the inventory and saved-view reads when the mounted owner leaves", async () => {
    await render("owner-a"); expect(reads).toHaveLength(2);
    expect(reads.every(read => read.signal && !read.signal.aborted)).toBe(true);
    await act(async () => root!.unmount()); root = null;
    expect(reads.every(read => read.signal?.aborted)).toBe(true);
  });

  it("StrictMode's discarded setup cannot borrow the replacement lifetime", async () => {
    await render("owner-a", true);
    expect(reads.filter(read => read.path === "/api/theses")).toHaveLength(1);
    expect(reads.filter(read => read.path === "/api/thesis-saved-views")).toHaveLength(1);
    expect(reads.every(read => read.signal && !read.signal.aborted)).toBe(true);
    await answer(reads, "StrictCurrent"); expect(renderedTitles()).toContain("StrictCurrent");
  });

  it("late old-owner responses cannot replace the new owner's answered list", async () => {
    await render("owner-a"); const old = [...reads];
    await render("owner-b"); const current = reads.slice(old.length);
    await answer(current, "Bravo"); await answer(old, "Alpha");
    expect(renderedTitles()).toContain("Bravo"); expect(renderedTitles()).not.toContain("Alpha");
    expect(old.every(read => read.signal?.aborted)).toBe(true);
  });

  it("fences an old body that finishes after headers and the owner change", async () => {
    await render("owner-a"); const old = [...reads];
    let finishBody!: (body: unknown) => void;
    await act(async () => list(old).resolve({ ok: true, status: 200, json: () => new Promise(resolve => { finishBody = resolve; }) } as Response));
    await flush(); expect(finishBody).toBeTypeOf("function");
    await render("owner-b"); await answer(reads.slice(old.length), "Bravo");
    await act(async () => finishBody({ theses: [summary("Alpha")] })); await flush();
    expect(renderedTitles()).toContain("Bravo"); expect(renderedTitles()).not.toContain("Alpha");
  });

  it("ignores late errors from the previous owner for both entry reads", async () => {
    await render("owner-a"); const old = [...reads];
    await render("owner-b"); await answer(reads.slice(old.length), "Bravo");
    await act(async () => { for (const read of old) read.reject(new TypeError("late network failure")); }); await flush();
    expect(renderedTitles()).toContain("Bravo");
    expect(container.textContent).not.toContain("Your thesis store did not answer");
    expect(container.querySelector('[data-testid="rms-saved-views-retry"]')).toBeNull();
  });

  it("still exposes a genuine current inventory failure", async () => {
    await render("owner-a");
    await act(async () => { list(reads).reject(new TypeError("current network failure")); views(reads).resolve(response({ views: [] })); }); await flush();
    expect(container.textContent).toContain("Your thesis store did not answer");
  });

  it("still exposes a genuine current saved-view failure", async () => {
    await render("owner-a");
    await act(async () => { list(reads).resolve(response({ theses: [] })); views(reads).reject(new TypeError("current network failure")); }); await flush();
    expect(container.querySelector('[data-testid="rms-saved-views-retry"]')).not.toBeNull();
  });
  it("does not borrow a later same-owner lifetime for a delayed saved-view refresh", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const saved = { id, name: "Old lifetime view", filter: { lifecycle: "active" }, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" };
    vi.stubGlobal("confirm", () => true);
    await render("owner-a");
    await act(async () => { list(reads).resolve(response({ theses: [] })); views(reads).resolve(response({ views: [saved] })); }); await flush();
    const chip = container.querySelector(`[data-saved-view="${id}"]`)!;
    const remove = [...chip.querySelectorAll("button")].find(button => button.textContent === "Delete this view")!;
    expect(remove).toBeDefined(); await act(async () => remove.click()); await flush();
    const write = reads.find(read => read.method === "PUT")!;
    expect(write.signal).toBeUndefined(); expect(JSON.parse(String(write.body))).toEqual({ action: "delete", id });
    let offset = reads.length;
    await render("owner-b"); await answer(reads.slice(offset), "Bravo");
    offset = reads.length;
    await render("owner-a"); await answer(reads.slice(offset), "CurrentAlpha");
    const beforeCompletion = reads.length;
    await act(async () => write.resolve(response({ ok: true }))); await flush();
    expect(reads.slice(beforeCompletion).filter(read => read.method === "GET")).toEqual([]);
    expect(renderedTitles()).toContain("CurrentAlpha");
  });

});
