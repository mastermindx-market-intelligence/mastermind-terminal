// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let searchId: string | null = "script-a";
const routerPush = vi.fn();
let compileCancelled = false;
let compileImpl: (source: string) => Promise<any>;
let runImpl: (request: any) => Promise<any>;
const compiledSources: string[] = [];
const runRequests: any[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "id" ? searchId : null) }),
}));

vi.mock("@/lib/i18n", () => ({
  useT: () => (k: string) => k,
  useLang: () => ({ lang: "en" as const }),
}));

vi.mock("@/lib/pine-engine/host", () => ({
  createPineHost: () => ({
    compile: (source: string) => { compiledSources.push(source); return compileImpl(source); },
    run: (request: any) => { runRequests.push(request); return runImpl(request); },
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

function expectLiteralHighlight(host: HTMLElement, source: string) {
  const code = host.querySelector(".code") as HTMLElement;
  const lines = Array.from(code.children);
  expect(lines.map((line) => line.textContent)).toEqual(
    source.split("\n").map((line) => line === "" ? "\u00a0" : line),
  );
  expect(code.querySelector("img, svg, script, iframe, a, tag")).toBeNull();
  for (const element of code.querySelectorAll("*")) {
    expect(["DIV", "SPAN"]).toContain(element.tagName);
    expect(element.getAttributeNames().filter((name) =>
      name.startsWith("on") || name === "src" || name === "href",
    )).toEqual([]);
  }
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
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    searchId = "script-a";
    routerPush.mockReset(); compileCancelled = false;
    compiledSources.length = 0; runRequests.length = 0;
    compileImpl = async () => ({ ok: true, errors: [], astId: "ast", cancelled: compileCancelled });
    runImpl = async () => ({ ok: true, errors: [], result: { warnings: [] } });
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
    vi.useRealTimers();
  });

  async function render(scripts: Script[] = [A, B]) {
    await act(async () => {
      root.render(React.createElement(PineEditor, {
        scripts, isPro: true, email: "pro@example.com",
      }));
    });
  }

  async function tick(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
  }

  const engineFailure = { ok: false, errors: [{ phase: "runtime", line: 0, col: 0, message: "Pine engine failed to start" }] };

  it("permits one explicit clean-script Add during engine unavailability without claiming a check", async () => {
    vi.useFakeTimers();
    compileImpl = async () => engineFailure;
    await render();
    await tick(301);
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).not.toBeNull();
    expect(host.querySelector(".console")?.textContent).not.toContain("peCompiledOk");
    const add = host.querySelector<HTMLButtonElement>("[data-script-add]")!;
    expect(add.disabled).toBe(false);
    await act(async () => { add.click(); add.click(); });
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/terminal?addScript=script-a");
    expect(fetches).toHaveLength(0);
  });

  it("keeps Add blocked for completed script errors rather than treating them as engine downtime", async () => {
    vi.useFakeTimers();
    compileImpl = async () => ({ ok: false, errors: [{ phase: "parse", line: 1, col: 1, message: "Unexpected token" }] });
    await render();
    await tick(301);
    expect(host.querySelector(".console")?.getAttribute("data-diagnostics-state")).toBe("done");
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).toBeNull();
    const add = host.querySelector<HTMLButtonElement>("[data-script-add]")!;
    expect(add.disabled).toBe(true);
    await act(async () => { add.click(); });
    expect(routerPush).not.toHaveBeenCalled();
    expect(fetches).toHaveLength(0);
    expect(runRequests).toHaveLength(0);
  });

  it.each(["verified receipt", "newer typing", "unverified receipt"] as const)(
    "preserves unavailable-engine dirty-Add intent and receipt rules: %s", async (outcome) => {
      vi.useFakeTimers();
      compileImpl = async () => engineFailure;
      const pending = deferred<Response>();
      fetchImpl = () => pending.promise;
      await render();
      const captured = A.source + "// UNAVAILABLE-ADD\n";
      await act(async () => { setTextarea(editor(host), captured); });
      await tick(301);
      const add = host.querySelector<HTMLButtonElement>("[data-script-add]")!;
      expect(add.disabled).toBe(false);
      await act(async () => { add.click(); });
      expect(fetches).toHaveLength(1);
      expect(fetches[0].body).toMatchObject({ id: A.id, source: captured, expected_updated_at: A.updated_at });
      if (outcome === "newer typing") {
        await act(async () => { setTextarea(editor(host), captured + "// NEWER\n"); });
        await tick(301);
      }
      await act(async () => {
        pending.resolve(new Response(JSON.stringify({ ok: true, id: outcome === "unverified receipt" ? "wrong-id" : A.id,
          updated_at: "2026-10-06T12:00:00.500Z" }), { status: 200, headers: { "Content-Type": "application/json" } }));
        await Promise.resolve();
      });
      if (outcome === "verified receipt") {
        expect(routerPush).toHaveBeenCalledTimes(1);
        expect(routerPush).toHaveBeenCalledWith("/terminal?addScript=script-a");
        await act(async () => { add.click(); });
        expect(routerPush).toHaveBeenCalledTimes(1);
      } else {
        expect(routerPush).not.toHaveBeenCalled();
        if (outcome === "newer typing") expect(editor(host).value).toBe(captured + "// NEWER\n");
        else {
          expect(add.disabled).toBe(true);
          await act(async () => { add.click(); });
          expect(fetches).toHaveLength(1);
        }
      }
    },
  );

  it("retires checking and its grace when typing, and a late compile cannot launch a stale dry-run", async () => {
    vi.useFakeTimers();
    const first = deferred<any>(), second = deferred<any>();
    compileImpl = () => compiledSources.length === 1 ? first.promise : second.promise;
    await render();
    await tick(1000);
    expect(host.querySelector('[data-pe-state="checking"]')).not.toBeNull();
    await act(async () => { setTextarea(editor(host), A.source + "// B\n"); });
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
    await act(async () => { first.resolve({ ok: true, errors: [], astId: "retired" }); });
    expect(runRequests).toHaveLength(0);
    await tick(200);
    await act(async () => { setTextarea(editor(host), A.source + "// C\n"); });
    await tick(299);
    expect(compiledSources).toHaveLength(1);
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
    await tick(1);
    expect(compiledSources[1]).toContain("// C");
    await tick(699);
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
    await tick(1);
    expect(host.querySelector('[data-pe-state="checking"]')).not.toBeNull();
    await act(async () => { second.resolve({ ok: true, errors: [], astId: "current" }); });
    expect(runRequests).toHaveLength(1);
    expect(runRequests[0].source).toContain("// C");
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).toBeNull();
  });

  it("rechecks an equal buffer under a different ID and ignores the preceding script's late engine failure", async () => {
    vi.useFakeTimers();
    const first = deferred<any>(), second = deferred<any>();
    compileImpl = () => compiledSources.length === 1 ? first.promise : second.promise;
    const sameBufferB = { ...B, source: A.source, params: A.params };
    await render([A, sameBufferB]);
    await tick(1000);
    await act(async () => { row(host, B.name).click(); });
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
    expect(editor(host).getAttribute("aria-label")).toBe(B.name + " script source");
    await act(async () => { first.resolve(engineFailure); });
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).toBeNull();
    await tick(300);
    expect(compiledSources).toEqual([A.source, A.source]);
    await tick(700);
    expect(host.querySelector('[data-pe-state="checking"]')?.textContent).toContain(B.name);
    await act(async () => { second.resolve({ ok: true, errors: [], astId: "b" }); });
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).toBeNull();
  });

  it("A to B to A lets only the newest ID generation publish diagnostics", async () => {
    vi.useFakeTimers();
    const checks = [deferred<any>(), deferred<any>(), deferred<any>()];
    compileImpl = () => checks[compiledSources.length - 1].promise;
    await render(); await tick(300);
    await act(async () => { row(host, B.name).click(); }); await tick(300);
    await act(async () => { row(host, A.name).click(); }); await tick(300);
    expect(compiledSources).toEqual([A.source, B.source, A.source]);
    await act(async () => { checks[2].resolve(engineFailure); });
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).not.toBeNull();
    await act(async () => {
      checks[0].resolve({ ok: true, errors: [], astId: "old-a" });
      checks[1].resolve({ ok: true, errors: [], astId: "old-b" });
    });
    expect(runRequests).toHaveLength(0);
    expect(host.querySelector('[data-pe-state="engine-unavailable"]')).not.toBeNull();
    expect(editor(host).value).toBe(A.source);
  });

  it("a same-ID list reorder and save receipt preserve the buffer without restarting its current diagnosis", async () => {
    vi.useFakeTimers();
    const check = deferred<any>(); compileImpl = () => check.promise;
    await render();
    const edited = A.source + "// KEEP-CURRENT-DIAG\n";
    await act(async () => { setTextarea(editor(host), edited); });
    await tick(300);
    expect(compiledSources).toEqual([edited]);
    await render([B, A]);
    await act(async () => { saveButton(host).click(); });
    await tick(1000);
    expect(compiledSources).toEqual([edited]);
    expect(editor(host).value).toBe(edited);
    expect(fetches).toHaveLength(1);
    await act(async () => { check.resolve({ ok: true, errors: [], astId: "retained" }); });
    expect(runRequests).toHaveLength(1);
    expect(runRequests[0].source).toBe(edited);
    expect(host.querySelector('[data-pe-state="checking"]')).toBeNull();
  });

  it("renders saved source literally while preserving syntax classes and blank lines", async () => {
    const source = [
      'indicator("Literal <&> &lt; &#60; &nbsp;")',
      'var label = "</span><img src=x onerror=alert(1)>"',
      '// <svg onload=alert(2)><script>plot(34)</script> ta.ema',
      '\tplot(ta.sma(close, 14) + math.max(2, 3))',
      'raw <tag> & value >= 8',
      '',
      '',
      '\t ',
      '',
    ].join("\n");
    await render([{ ...A, source }, B]);

    expect(editor(host).value).toBe(source);
    expectLiteralHighlight(host, source);
    const tokens = (className: string) => Array.from(
      host.querySelectorAll(`.code .${className}`), (node) => node.textContent,
    );
    expect(tokens("st")).toEqual([
      '"Literal <&> &lt; &#60; &nbsp;"',
      '"</span><img src=x onerror=alert(1)>"',
    ]);
    expect(tokens("cm")).toEqual(['// <svg onload=alert(2)><script>plot(34)</script> ta.ema']);
    expect(tokens("fn")).toEqual(["ta.sma", "math.max"]);
    expect(tokens("kw")).toEqual(["indicator", "var", "plot"]);
    expect(tokens("nu")).toEqual(["14", "2", "3", "8"]);
    expect(host.querySelector(".st span, .cm span")).toBeNull();
  });

  it("keeps textarea edits literal across repeated tokens and trailing blank lines", async () => {
    await render([A, B]);
    const source = [
      'var fresh = "</span><iframe src=javascript:alert(3)>"',
      'plot(ta.ema(close, 7))',
      'plot(ta.ema(close, 11))',
      '// &lt; &#60; &nbsp; <a href=javascript:alert(4)>',
      '',
      '',
    ].join("\n");
    await act(async () => { setTextarea(editor(host), source); });

    expect(editor(host).value).toBe(source);
    expectLiteralHighlight(host, source);
    expect(host.querySelector(".code")?.textContent).not.toContain("My Momentum");
    expect(Array.from(host.querySelectorAll(".code .fn"), (node) => node.textContent)).toEqual(["ta.ema", "ta.ema"]);
    expect(Array.from(host.querySelectorAll(".code .kw"), (node) => node.textContent)).toEqual(["var", "plot", "plot"]);
    expect(Array.from(host.querySelectorAll(".code .nu"), (node) => node.textContent)).toEqual(["7", "11"]);
    expect(fetches).toHaveLength(0);
  });

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
      expect(fetches, rec.label).toHaveLength(1);
      expect(saveButton(host).disabled, rec.label).toBe(true);
      expect(host.querySelector("[data-save-state]")?.getAttribute("data-save-state"), rec.label).toBe("unknown");
    }
  });


  function button(label: string) {
    return Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent === label || b.getAttribute("aria-label") === label)!;
  }
  async function runCheck() {
    await act(async () => { button("Run diagnostics").click(); await Promise.resolve(); await Promise.resolve(); });
    expect(host.querySelector("[data-diagnostics-state]")?.getAttribute("data-diagnostics-state")).toBe("done");
  }
  function receipt(at = "2026-10-06T12:00:01.000Z") {
    return new Response(JSON.stringify({ ok: true, id: A.id, updated_at: at }), { status: 200 });
  }
  function listResponse(row: Script) { return new Response(JSON.stringify({ scripts: [row, B] }), { status: 200 }); }

  it("Cancel then reopen the same target cannot revive the old save-and-switch ticket", async () => {
    let release!: (response: Response) => void;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// ABA"); });
    await act(async () => { row(host, B.name).click(); });
    await act(async () => { button("peUnsavedSave").click(); });
    await act(async () => { button("peUnsavedCancel").click(); });
    await act(async () => { row(host, B.name).click(); });
    await act(async () => { release(receipt()); await Promise.resolve(); });
    expect(host.querySelector("[role=dialog]")).toBeTruthy();
    expect(host.querySelector(".script-row.on")?.textContent).toContain(A.name);
    expect(editor(host).value).toContain("ABA");
    expect(routerPush).not.toHaveBeenCalled();
    expect(fetches).toHaveLength(1);
  });

  it("newer typing while Add saves an earlier version prevents navigation", async () => {
    let release!: (response: Response) => void;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// ATTEMPT"); });
    await runCheck();
    await act(async () => { button("peAddToChart").click(); });
    await act(async () => { setTextarea(editor(host), A.source + "// NEWER"); });
    await act(async () => { release(receipt()); await Promise.resolve(); });
    expect(routerPush).not.toHaveBeenCalled();
    expect(editor(host).value).toContain("NEWER");
    expect(host.querySelector("[data-save-state]")?.textContent).toContain("newer edits");
    expect(fetches).toHaveLength(1);
  });

  it("undoing to the clean baseline cannot bypass an earlier in-flight save", async () => {
    let release!: (response: Response) => void;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// SAVING-N"); });
    await act(async () => { saveButton(host).click(); });
    await act(async () => { setTextarea(editor(host), A.source); });
    await runCheck();
    expect(button("peAddToChart").disabled).toBe(true);
    await act(async () => { button("peAddToChart").click(); release(receipt()); await Promise.resolve(); });
    expect(routerPush).not.toHaveBeenCalled();
    expect(editor(host).value).toBe(A.source);
    expect(host.querySelector(".console")?.textContent).toContain("peUnsavedChanges");
  });

  it("a fresh diagnostic request cancels pending Add even with unchanged source", async () => {
    let release!: (response: Response) => void;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// CHECK"); });
    await runCheck();
    await act(async () => { button("peAddToChart").click(); });
    compileCancelled = true;
    await act(async () => { button("Run diagnostics").click(); await Promise.resolve(); });
    expect(host.querySelector("[data-diagnostics-state]")?.getAttribute("data-diagnostics-state")).toBe("cancelled");
    await act(async () => { release(receipt()); await Promise.resolve(); });
    expect(routerPush).not.toHaveBeenCalled();
    expect(button("peAddToChart").disabled).toBe(true);
  });

  it("a repeated Add intent has one write and at most one navigation", async () => {
    let release!: (response: Response) => void;
    fetchImpl = () => new Promise((resolve) => { release = resolve; });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// ADD-ONCE"); });
    await runCheck();
    await act(async () => { button("peAddToChart").click(); button("peAddToChart").click(); });
    expect(fetches).toHaveLength(1);
    await act(async () => { release(receipt()); await Promise.resolve(); });
    expect(routerPush).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/terminal?addScript=script-a");
  });

  it("an unchanged readback keeps an unknown save fenced; a newer match retains newer typing", async () => {
    fetchImpl = async () => { throw new TypeError("transport lost"); };
    await render();
    const attempted = A.source + "// ATTEMPT";
    await act(async () => { setTextarea(editor(host), attempted); });
    await act(async () => { saveButton(host).click(); await Promise.resolve(); });
    expect(host.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("unknown");
    await act(async () => { setTextarea(editor(host), A.source + "// LOCAL-NEWER"); });
    fetchImpl = async () => listResponse(A);
    await act(async () => { button("Check saved version").click(); await Promise.resolve(); });
    expect(host.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("unresolved");
    expect(saveButton(host).disabled).toBe(true);
    const savedAt = "2026-10-06T12:00:00.000123Z";
    fetchImpl = async () => listResponse({ ...A, source: attempted, updated_at: savedAt });
    await act(async () => { button("Check saved version").click(); await Promise.resolve(); });
    expect(host.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("matched");
    expect(editor(host).value).toContain("LOCAL-NEWER");
    expect(routerPush).not.toHaveBeenCalled();
    fetchImpl = async () => receipt("2026-10-06T12:00:00.001Z");
    await act(async () => { saveButton(host).click(); await Promise.resolve(); });
    expect(fetches.filter((f) => f.url.endsWith("/save"))).toHaveLength(2);
    expect(fetches.at(-1)?.body.expected_updated_at).toBe(savedAt);
    expect(fetches.at(-1)?.body.source).toContain("LOCAL-NEWER");
  });

  it("a conflicting renamed version requires an explicit choice and preserves the current edits", async () => {
    fetchImpl = async () => new Response("{}", { status: 409 });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// KEEP-LOCAL"); });
    await act(async () => { saveButton(host).click(); await Promise.resolve(); });
    const other = { ...A, name: "Renamed elsewhere", source: A.source + "// REMOTE", params: { len: 20 }, updated_at: "2026-10-06T12:00:02.000Z" };
    fetchImpl = async () => listResponse(other);
    await act(async () => { button("Check saved version").click(); await Promise.resolve(); });
    expect(host.querySelector("[data-save-state]")?.getAttribute("data-save-state")).toBe("different");
    expect(saveButton(host).disabled).toBe(true);
    await act(async () => { button("Keep my edits").click(); });
    expect(editor(host).value).toContain("KEEP-LOCAL");
    expect(host.querySelector(".script-row.on")?.textContent).toContain(other.name);
    fetchImpl = async () => receipt("2026-10-06T12:00:03.000Z");
    await act(async () => { saveButton(host).click(); await Promise.resolve(); });
    expect(fetches.at(-1)?.body).toMatchObject({ name: other.name, source: A.source + "// KEEP-LOCAL", expected_updated_at: other.updated_at, params: A.params });
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("replacement confirmation is renewed if another readback changes the saved revision", async () => {
    fetchImpl = async () => new Response("{}", { status: 409 });
    await render();
    await act(async () => { setTextarea(editor(host), A.source + "// LOCAL"); });
    await act(async () => { saveButton(host).click(); await Promise.resolve(); });
    const v1 = { ...A, source: A.source + "// V1", updated_at: "2026-10-06T12:00:02.000Z" };
    fetchImpl = async () => listResponse(v1);
    await act(async () => { button("Check saved version").click(); await Promise.resolve(); });
    await act(async () => { button("Load saved version").click(); });
    expect(button("Replace current edits")).toBeTruthy();
    await runCheck();
    expect(button("Replace current edits")).toBeTruthy();
    const v2 = { ...v1, source: A.source + "// V2", updated_at: "2026-10-06T12:00:03.000Z" };
    fetchImpl = async () => listResponse(v2);
    await act(async () => { button("Check saved version").click(); await Promise.resolve(); });
    expect(button("Replace current edits")).toBeUndefined();
    await act(async () => { button("Load saved version").click(); });
    expect(editor(host).value).toContain("LOCAL");
    await act(async () => { button("Replace current edits").click(); });
    expect(editor(host).value).toContain("V2");
    expect(fetches.filter((f) => f.url.endsWith("/save"))).toHaveLength(1);
  });

  it("a cancelled check and A-to-B-to-A edits never reuse a green diagnostic result", async () => {
    await render();
    await runCheck();
    await act(async () => { setTextarea(editor(host), A.source + "// B"); });
    await act(async () => { setTextarea(editor(host), A.source); });
    expect(host.querySelector("[data-diagnostics-state]")?.getAttribute("data-diagnostics-state")).toBe("pending");
    expect(button("peAddToChart").disabled).toBe(true);
    compileCancelled = true;
    await act(async () => { button("Run diagnostics").click(); await Promise.resolve(); });
    expect(host.querySelector("[data-diagnostics-state]")?.getAttribute("data-diagnostics-state")).toBe("cancelled");
    expect(host.querySelector(".console")?.textContent).not.toContain("peCompiledOk");
  });

  it("an initially free editor cannot save or add unsaved changes", async () => {
    await act(async () => { root.render(React.createElement(PineEditor, { scripts: [A,B], isPro: false, email: "free@example.com" })); });
    await act(async () => { setTextarea(editor(host), A.source + "// FREE"); });
    await runCheck();
    expect(saveButton(host).disabled).toBe(true);
    expect(button("peAddToChart").disabled).toBe(true);
    await act(async () => { saveButton(host).click(); button("peAddToChart").click(); });
    expect(fetches).toHaveLength(0); expect(routerPush).not.toHaveBeenCalled();
  });

});
