// @vitest-environment jsdom
import React, { act } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseExpectedUpdatedAtMs } from "@/lib/savedScriptStamp";

let searchId: string | null = "script-a";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "id" ? searchId : null) }),
}));

vi.mock("@/lib/i18n", () => ({
  useT: () => (k: string) => k,
  useLang: () => ({ lang: "en" as const }),
}));

vi.mock("@/lib/pine-engine/host", () => ({
  createPineHost: () => ({
    compile: async () => ({ ok: true, errors: [], astId: "ast" }),
    run: async () => ({ ok: true, errors: [], result: { warnings: [] } }),
    dispose: () => {},
    evict: () => {},
    clear: () => {},
    usingWorker: false,
  }),
}));

import PineEditor from "@/components/PineEditor";

type Script = {
  id: string;
  name: string;
  source: string;
  lang: string;
  params: Record<string, unknown>;
  updated_at: string;
  locked?: boolean;
};

const A: Script = {
  id: "script-a",
  name: "My Momentum",
  source: "//@version=6\nindicator(\"My Momentum\")\nplot(close)\n",
  lang: "pine",
  params: { len: 14 },
  updated_at: "2026-10-06T12:00:00.000Z",
};
const B: Script = {
  id: "script-b",
  name: "My Reversion",
  source: "//@version=6\nindicator(\"My Reversion\")\nplot(open)\n",
  lang: "pine",
  params: {},
  updated_at: "2026-10-06T11:00:00.000Z",
};

function setTextarea(el: HTMLTextAreaElement, value: string) {
  const native = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
  native!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function editor(host: HTMLElement) {
  return host.querySelector("textarea") as HTMLTextAreaElement;
}

function saveButton(host: HTMLElement) {
  return Array.from(host.querySelectorAll("button")).find((b) =>
    /peSave|peSaveChanges|peSaving|peSaved|peError/.test(b.textContent || ""),
  ) as HTMLButtonElement;
}

function row(host: HTMLElement, name: string) {
  return Array.from(host.querySelectorAll(".script-row")).find((el) =>
    el.textContent?.includes(name),
  ) as HTMLElement;
}

describe("PineEditor ID-keyed buffers and save receipts", () => {
  let host: HTMLElement;
  let root: Root;
  const fetches: Array<{ url: string; body: any }> = [];
  let fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

  beforeEach(() => {
    searchId = "script-a";
    fetches.length = 0;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    fetchImpl = async () => new Response(JSON.stringify({ ok: true, id: "script-a", updated_at: "2026-10-06T12:00:00.500Z" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetches.push({ url, body });
      return fetchImpl(input, init);
    }));
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function render(scripts: Script[] = [A, B]) {
    await act(async () => {
      root.render(React.createElement(PineEditor, {
        scripts, isPro: true, email: "pro@example.com",
      }));
    });
  }

  it("Cancel closes a dirty-switch dialog and preserves the selected script buffer", async () => {
    await render([A,B]);
    await act(async()=>{setTextarea(editor(host),A.source+"// CANCEL-DRAFT\n");});
    await act(async()=>{row(host,"My Reversion").click();});
    expect(host.querySelector("[role=dialog]")).toBeTruthy();
    const cancel=Array.from(host.querySelectorAll("button")).find(b=>b.textContent==="peUnsavedCancel") as HTMLButtonElement;
    await act(async()=>{cancel.click();});
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(editor(host).value).toContain("CANCEL-DRAFT");
    expect(host.querySelector(".script-row.on")?.textContent).toContain("My Momentum");
    expect(fetches).toHaveLength(0);
  });

  it("keeps the unsaved buffer bound to script ID across a server list reorder", async () => {
    await render([A, B]);
    const edited = A.source.replace("plot(close)", "plot(close * 2) // A-DRAFT");
    await act(async () => { setTextarea(editor(host), edited); });
    expect(editor(host).value).toContain("A-DRAFT");
    expect(saveButton(host).textContent).toBe("peSaveChanges");

    // Same identities, reversed order — index 0 is now B. A dirty buffer keyed by
    // array index would snap to B's source and look like data loss.
    await render([B, A]);
    expect(editor(host).value).toContain("A-DRAFT");
    expect(host.querySelector(".script-row.on")?.textContent).toContain("My Momentum");
    expect(saveButton(host).textContent).toBe("peSaveChanges");
  });

  it("sends expected_updated_at and does not mark newer edits clean on an old receipt", async () => {
    let release: (r: Response) => void = () => {};
    fetchImpl = () => new Promise<Response>((resolve) => { release = resolve; });

    await render([A, B]);
    const snap = A.source.replace("plot(close)", "plot(hlc3) // SNAP");
    await act(async () => { setTextarea(editor(host), snap); });
    await act(async () => { saveButton(host).click(); });

    expect(fetches).toHaveLength(1);
    expect(fetches[0].body).toMatchObject({
      id: "script-a",
      source: snap,
      expected_updated_at: A.updated_at,
    });

    const newer = snap.replace("SNAP", "NEWER");
    await act(async () => { setTextarea(editor(host), newer); });

    await act(async () => {
      release(new Response(JSON.stringify({
        ok: true, id: "script-a", updated_at: "2026-10-06T12:00:00.500Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });

    expect(editor(host).value).toContain("NEWER");
    expect(saveButton(host).textContent).toBe("peSaveChanges");
    expect(host.querySelector(".console")?.textContent).toContain("peUnsavedChanges");
  });

  it("single-flights save per script ID", async () => {
    let inflight = 0;
    let max = 0;
    let release: (r: Response) => void = () => {};
    fetchImpl = () => {
      inflight += 1;
      max = Math.max(max, inflight);
      return new Promise<Response>((resolve) => {
        const prev = release;
        release = (r) => { inflight -= 1; prev(r); resolve(r); };
      });
    };

    await render([A, B]);
    await act(async () => { setTextarea(editor(host), A.source + "// x\n"); });
    await act(async () => { saveButton(host).click(); saveButton(host).click(); saveButton(host).click(); });
    expect(fetches).toHaveLength(1);

    await act(async () => {
      release(new Response(JSON.stringify({
        ok: true, id: "script-a", updated_at: "2026-10-06T12:00:00.500Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });
    expect(max).toBe(1);
  });

  it("keeps the dirty buffer on 409 conflict", async () => {
    fetchImpl = async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 });
    await render([A, B]);
    const edited = A.source + "// CONFLICT-KEEP\n";
    await act(async () => { setTextarea(editor(host), edited); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });
    expect(editor(host).value).toContain("CONFLICT-KEEP");
    expect(saveButton(host).textContent).toMatch(/peSaveChanges|peError/);
  });

  it("save-and-switch after a reorder still saves the captured script, not the current index", async () => {
    let release: (r: Response) => void = () => {};
    fetchImpl = () => new Promise<Response>((resolve) => { release = resolve; });

    await render([A, B]);
    await act(async () => { setTextarea(editor(host), A.source + "// CAPTURE-A\n"); });
    await act(async () => { row(host, "My Reversion").click(); });
    expect(host.querySelector("[role=dialog]")).toBeTruthy();

    await render([B, A]);
    expect(host.querySelector("[role=dialog]")).toBeTruthy();
    const saveSwitch = Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("peUnsavedSave"),
    ) as HTMLButtonElement;
    await act(async () => { saveSwitch.click(); });

    expect(fetches).toHaveLength(1);
    expect(fetches[0].body.id).toBe("script-a");
    expect(fetches[0].body.source).toContain("CAPTURE-A");
    expect(fetches[0].body.expected_updated_at).toBe(A.updated_at);

    await act(async () => {
      release(new Response(JSON.stringify({
        ok: true, id: "script-a", updated_at: "2026-10-06T12:00:00.500Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
    });

    expect(host.querySelector(".script-row.on")?.textContent).toContain("My Reversion");
    expect(editor(host).value).toContain("plot(open)");
  });

  it("a failed save-and-switch plus a server refresh leaves the dirty buffer on the same script", async () => {
    fetchImpl = async () => new Response("{}", { status: 500 });
    await render([A, B]);
    await act(async () => { setTextarea(editor(host), A.source + "// FRAGILE\n"); });
    await act(async () => { row(host, "My Reversion").click(); });
    const saveSwitch = Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("peUnsavedSave"),
    ) as HTMLButtonElement;
    await act(async () => { saveSwitch.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(host.querySelector("[role=dialog]")).toBeTruthy();
    expect(editor(host).value).toContain("FRAGILE");

    await render([B, A]);
    expect(editor(host).value).toContain("FRAGILE");
    expect(host.querySelector(".script-row.on")?.textContent).toContain("My Momentum");
  });

  it("the next save after a receipt uses the returned updated_at as expected_updated_at", async () => {
    const receiptAt = "2026-10-06T12:00:01.000Z";
    fetchImpl = async () => new Response(JSON.stringify({ ok: true, id: "script-a", updated_at: receiptAt }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
    await render([A, B]);
    await act(async () => { setTextarea(editor(host), A.source + "// first\n"); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => { setTextarea(editor(host), A.source + "// second\n"); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { await Promise.resolve(); });

    expect(fetches).toHaveLength(2);
    expect(fetches[0].body.expected_updated_at).toBe(A.updated_at);
    expect(fetches[1].body.expected_updated_at).toBe(receiptAt);
    expect(fetches[1].body.source).toContain("second");
  });

  it("a cancelled switch's later pending save receipt never navigates away or drops newer dirty edits", async () => {
    let release: (r: Response) => void = () => {};
    fetchImpl = () => new Promise<Response>((resolve) => { release = resolve; });

    await render([A, B]);
    await act(async () => { setTextarea(editor(host), A.source + "// SWITCH-DRAFT\n"); });
    await act(async () => { row(host, "My Reversion").click(); });
    expect(host.querySelector("[role=dialog]")).toBeTruthy();
    const saveSwitch = Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes("peUnsavedSave"),
    ) as HTMLButtonElement;
    await act(async () => { saveSwitch.click(); });
    expect(fetches).toHaveLength(1);
    expect(fetches[0].body.source).toContain("SWITCH-DRAFT");
    expect(fetches[0].body.expected_updated_at).toBe(A.updated_at);

    const cancel = Array.from(host.querySelectorAll("button")).find((b) => b.textContent === "peUnsavedCancel") as HTMLButtonElement;
    await act(async () => { cancel.click(); });
    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(host.querySelector(".script-row.on")?.textContent).toContain("My Momentum");
    expect(editor(host).value).toContain("SWITCH-DRAFT");

    const newer = editor(host).value.replace("SWITCH-DRAFT", "AFTER-CANCEL");
    await act(async () => { setTextarea(editor(host), newer); });

    await act(async () => {
      release(new Response(JSON.stringify({
        ok: true, id: "script-a", updated_at: "2026-10-06T12:00:00.500Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.querySelector("[role=dialog]")).toBeNull();
    expect(host.querySelector(".script-row.on")?.textContent).toContain("My Momentum");
    expect(editor(host).value).toContain("AFTER-CANCEL");
    expect(saveButton(host).textContent).toBe("peSaveChanges");
    expect(host.querySelector(".console")?.textContent).toContain("peUnsavedChanges");
  });

  it("malformed, missing, or wrong-id success receipts stay unverified and keep the CAS token", async () => {
    const receipts: Array<{ label: string; body: string }> = [
      { label: "malformed", body: "{not-json" },
      { label: "missing updated_at", body: JSON.stringify({ ok: true, id: "script-a" }) },
      { label: "missing id", body: JSON.stringify({ ok: true, updated_at: "2026-10-06T12:00:00.500Z" }) },
      { label: "wrong id", body: JSON.stringify({ ok: true, id: "script-b", updated_at: "2026-10-06T12:00:00.500Z" }) },
      { label: "unparseable stamp", body: JSON.stringify({ ok: true, id: "script-a", updated_at: "not-a-stamp" }) },
    ];
    for (const rec of receipts) {
      act(() => { root.unmount(); });
      host.remove();
      host = document.createElement("div");
      document.body.appendChild(host);
      root = createRoot(host);
      fetches.length = 0;
      fetchImpl = async () => new Response(rec.body, { status: 200, headers: { "Content-Type": "application/json" } });
      await render([A, B]);
      const edited = A.source + `// UNVERIFIED-${rec.label}\n`;
      await act(async () => { setTextarea(editor(host), edited); });
      await act(async () => { saveButton(host).click(); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(fetches, rec.label).toHaveLength(1);
      expect(fetches[0].body.expected_updated_at, rec.label).toBe(A.updated_at);
      expect(editor(host).value, rec.label).toContain(`UNVERIFIED-${rec.label}`);
      expect(saveButton(host).textContent, rec.label).toMatch(/peSaveChanges|peError/);
      expect(host.querySelector(".console")?.textContent, rec.label).toContain("peUnsavedChanges");

      fetchImpl = async () => new Response(JSON.stringify({
        ok: true, id: "script-a", updated_at: "2026-10-06T12:00:01.000Z",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
      await act(async () => { saveButton(host).click(); });
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      const follow = fetches[fetches.length - 1];
      expect(follow.body.expected_updated_at, rec.label).toBe(A.updated_at);
      expect(follow.body.source, rec.label).toContain(`UNVERIFIED-${rec.label}`);
    }
  });

  it("source has no undeclared legacy pending-index setters and names the stamp capsule", () => {
    const srcPath = path.resolve(__dirname, "../../components/PineEditor.tsx");
    const src = readFileSync(srcPath, "utf8");
    expect(src).toMatch(/import\s*\{\s*parseExpectedUpdatedAtMs\s*\}\s*from\s*"@\/lib\/savedScriptStamp"/);
    expect(src).not.toMatch(/\bsetPendingIdx\b/);
    expect(src).not.toMatch(/\bpendingIdx\b/);
    expect(src).toMatch(/\bsetPendingTargetId\b/);
    expect(src).toMatch(/\bpendingTargetIdRef\b/);
    expect(parseExpectedUpdatedAtMs).toBeTypeOf("function");
  });
});
