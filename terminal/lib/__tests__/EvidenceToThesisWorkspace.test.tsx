// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const auth = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: { user: { id: string } } | null) => void),
  unsubscribe: vi.fn(), lang: "en",
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: auth.lang }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof auth.callback) => {
    auth.callback = callback;
    return { data: { subscription: { unsubscribe: auth.unsubscribe } } };
  },
} }) }));
import Workspace from "@/components/workspaces/EvidenceToThesisWorkspace";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const held = {
  schema: "mastermind.evidence-to-thesis/v1", symbol: "NVDA", question: "demand",
  state: "generation_held", reason: "temporary_generation_unavailable", evidence: [], coverage: null,
};
function json(value: unknown): Response { return { ok: true, status: 200, json: async () => value } as Response; }

async function fillQuestion() {
  const input = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "demand");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function clickCheck() { await act(async () => { container.querySelector("button")!.click(); }); }

beforeEach(async () => {
  vi.clearAllMocks(); auth.lang = "en";
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Workspace ownerId="qa-user-a" />); });
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove(); vi.unstubAllGlobals(); auth.callback = null;
});

describe("research assistant preflight account and response boundaries", () => {
  it("shows the held state without exposing any Thesis save or model action", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => json(held)); vi.stubGlobal("fetch", fetcher);
    await fillQuestion(); await clickCheck();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/research-assistant");
    expect(container.textContent).toContain("Matching source references are available");
    expect([...container.querySelectorAll("button")].some((button) => /save|draft|revise/i.test(button.textContent ?? ""))).toBe(false);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("discards a late response after the signed-in account changes", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetcher);
    await fillQuestion(); await clickCheck();
    await act(async () => { auth.callback!("SIGNED_IN", { user: { id: "qa-user-b" } }); });
    await act(async () => { resolve(json(held)); });
    expect(container.textContent).toContain("The signed-in account changed");
    expect(container.textContent).not.toContain("Matching source references are available");
    expect(container.querySelector("button")!.disabled).toBe(true);
    const init = (fetcher.mock.calls as unknown as [string, RequestInit][])[0][1];
    expect(init.signal!.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("removes results immediately on sign-out and presents the Chinese hold copy", async () => {
    auth.lang = "zh";
    await act(async () => { root.render(<Workspace ownerId="qa-user-a" />); });
    vi.stubGlobal("fetch", vi.fn(async () => json(held)));
    await fillQuestion(); await clickCheck();
    expect(container.textContent).toContain("已找到匹配的来源引用");
    await act(async () => { auth.callback!("SIGNED_OUT", null); });
    expect(container.textContent).not.toContain("已找到匹配的来源引用");
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.textContent).toContain("会话已结束");
  });
});
