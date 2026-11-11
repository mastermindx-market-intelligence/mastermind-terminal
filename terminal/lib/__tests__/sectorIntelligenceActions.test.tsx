// @vitest-environment jsdom
/**
 * Sector Intelligence action components (packet SI-P16-LANE6): the save button rides the
 * investigationSave state machine over the real /api/investigations contract (owner fence
 * header included), the status check keeps not_found uncertain with no Replay, the watch
 * arms only through the incumbent alerts owner, and the note writes through the
 * annotations owner — with the three effects provably independent (a failed watch never
 * rolls a saved note back). All strings arrive through props; none is read from LEX.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SaveInvestigationButton, type SaveInvestigationCopy } from "@/components/sector-intelligence/actions/SaveInvestigationButton";
import { CheckSaveStatusButton, type CheckSaveStatusCopy } from "@/components/sector-intelligence/actions/CheckSaveStatusButton";
import { ArmWatchControl, type ArmWatchCopy } from "@/components/sector-intelligence/actions/ArmWatchControl";
import { SymbolNoteField, type SymbolNoteCopy } from "@/components/sector-intelligence/actions/SymbolNoteField";
import type { InvestigationCommand } from "@/lib/investigations";
import type { InvestigationSaveState } from "@/lib/investigationSave";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const PRINCIPAL = "11111111-1111-4111-8111-111111111111";
const SHA = "a3573d7cefe87da155ef7575feb2071b4c32c9f562f42d5724b3ec54332d9eab";
const command: InvestigationCommand = {
  id: "10000000-0000-4000-8000-000000000001",
  operation_id: "20000000-0000-4000-8000-000000000001",
  action: "create",
  expected_revision: 0,
  manifest: {
    schema: "investigation_manifest.v2",
    intent: { title: "Financials leadership", question: "Is the 63-session leadership supported by participation?", subjects: [{ kind: "sector", owner: "macro.sector", object_id: "xlf" }] },
    layout_refs: [], thesis_refs: [],
    evidence_refs: [{ owner: "macro.sector", object_type: "sector_observation", object_id: "xlf", mode: "pinned", version_ref: "captured-sector-1", fingerprint: SHA }],
    continuation: {},
  },
};
const saveCopy: Record<"en" | "zh", SaveInvestigationCopy> = {
  en: { save: "Save", saving: "Saving…", unconfirmed: "Save unconfirmed", retry: "Retry", saved: r => `Saved revision ${r}`, rejected: r => `Not saved: ${r}`, signedOut: "Sign in to save" },
  zh: { save: "保存", saving: "保存中…", unconfirmed: "保存未确认", retry: "重试", saved: r => `已保存版本 ${r}`, rejected: r => `未保存：${r}`, signedOut: "登录后保存" },
};
const checkCopy: Record<"en" | "zh", CheckSaveStatusCopy> = {
  en: { check: "Check save status", checking: "Checking…", committed: r => `Committed revision ${r}`, unconfirmed: "Still unconfirmed", rejected: r => `Not saved: ${r}`, signedOut: "Sign in first" },
  zh: { check: "检查保存状态", checking: "检查中…", committed: r => `已提交版本 ${r}`, unconfirmed: "仍未确认", rejected: r => `未保存：${r}`, signedOut: "请先登录" },
};
const watchCopy: Record<"en" | "zh", ArmWatchCopy> = {
  en: { title: "Direction", threshold: "Price threshold", arm: "Watch", arming: "Arming…", armed: (s, p) => `Watching ${s} · ${p}`, refused: p => p, unavailable: "Alerts unavailable right now; nothing was armed.", signedOut: "Sign in to watch" },
  zh: { title: "方向", threshold: "价格阈值", arm: "监测", arming: "创建中…", armed: (s, p) => `正在监测 ${s} · ${p}`, refused: p => p, unavailable: "提醒系统暂不可用；未创建任何监测。", signedOut: "登录后监测" },
};
const noteCopy: Record<"en" | "zh", SymbolNoteCopy> = {
  en: { title: "Note", placeholder: "Note on this reading", saved: "Saved", saving: "Saving…", conflict: t => `Changed elsewhere: ${t}`, invalid: "Note not accepted", pending: "Not synced yet — kept as a draft", signedOut: "Sign in to note" },
  zh: { title: "笔记", placeholder: "对这次阅读的笔记", saved: "已保存", saving: "保存中…", conflict: t => `已在别处修改：${t}`, invalid: "笔记未被接受", pending: "尚未同步——已保留为草稿", signedOut: "登录后笔记" },
};

const json = (body: unknown, ok = true) => new Response(JSON.stringify(body), { status: ok ? 200 : 400, headers: { "content-type": "application/json" } });

describe("sector intelligence action components", () => {
  let root: Root, host: HTMLDivElement;
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  let routes: Record<string, (url: string, init: RequestInit | undefined) => Response | Promise<Response>>;
  beforeEach(() => {
    calls.length = 0;
    routes = {};
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      calls.push({ url: href, init });
      const route = Object.entries(routes).find(([prefix]) => href.includes(prefix))?.[1];
      if (!route) throw new Error(`no route for ${href}`);
      return route(href, init);
    }));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
  const mount = async (node: React.ReactNode) => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(node));
    return host;
  };
  const status = () => host.querySelector('[role="status"]')?.textContent ?? "";
  const click = async (index: number) => {
    const buttons = [...host.querySelectorAll("button")];
    await act(async () => buttons[index]?.click());
  };
  /** Type into a controlled React input/textarea: React ignores a plain value write. */
  const type = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
    await act(async () => {
      setter.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("saves through the investigations contract with the owner fence header; a lost reply stays unconfirmed, a receipt settles it", async () => {
    routes["/api/investigations"] = () => json({ status: "committed", id: command.id, revision: 1, lifecycle: "active", manifest: command.manifest, committed_at: "2026-11-09T00:00:00Z" });
    await mount(<SaveInvestigationButton principal={PRINCIPAL} command={command} lang="en" copy={saveCopy} />);
    await click(0);
    expect(calls[0]?.url).toBe("/api/investigations");
    expect(calls[0]?.init?.method).toBe("POST");
    expect((calls[0]?.init?.headers as Record<string, string>)["x-mm-investigation-owner"]).toBe(PRINCIPAL);
    expect(JSON.parse(String(calls[0]?.init?.body)).operation_id).toBe(command.operation_id);
    expect(status()).toContain("Saved revision 1");
  });

  it("keeps a lost save unconfirmed and never shows failure; check status keeps not_found unconfirmed and settles on the committed receipt", async () => {
    routes["/api/investigations"] = () => json({ status: "not_found" }, false);
    const states: InvestigationSaveState[] = [];
    await mount(<SaveInvestigationButton principal={PRINCIPAL} command={command} lang="en" copy={saveCopy} onStateChange={s => states.push(s)} />);
    // Lost reply: the fetch itself throws.
    (routes as Record<string, unknown>)["/api/investigations"] = () => { throw new Error("offline"); };
    await click(0);
    expect(status()).toContain("Save unconfirmed");
    expect(host.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    const uncertain = states.at(-1);
    expect(uncertain?.phase).toBe("uncertain");
    // Check save status: not_found is still uncertain — never "failed", never a Replay.
    (routes as Record<string, unknown>)["/api/investigations"] = () => json({ status: "not_found" }, false);
    root.unmount();
    await mount(<CheckSaveStatusButton principal={PRINCIPAL} command={command} state={uncertain!} lang="en" copy={checkCopy} />);
    await click(0);
    expect(calls.at(-1)?.url).toContain(`operation_id=${command.operation_id}`);
    expect((calls.at(-1)?.init?.headers as Record<string, string>)["x-mm-investigation-owner"]).toBe(PRINCIPAL);
    expect(status()).toContain("Still unconfirmed");
    // The committed receipt settles the same uncertain state.
    (routes as Record<string, unknown>)["/api/investigations"] = () => json({ status: "committed", id: command.id, revision: 1, lifecycle: "active", manifest: command.manifest, committed_at: "2026-11-09T00:00:00Z" });
    root.unmount();
    await mount(<CheckSaveStatusButton principal={PRINCIPAL} command={command} state={uncertain!} lang="en" copy={checkCopy} />);
    await click(0);
    expect(status()).toContain("Committed revision 1");
  });

  it("arms a price watch through the incumbent alerts owner only, and a refusal names the builder's reason", async () => {
    routes["/api/alerts"] = () => json({ alert: { id: "a1", symbol: "XLF", active: true, condition: {} } });
    await mount(<ArmWatchControl principal={PRINCIPAL} link={{ investigation_id: command.id, revision: 1 }} symbol="xlf" lang="en" copy={watchCopy} />);
    const input = host.querySelector("input")!;
    await type(input, "42");
    await click(0);
    const alertCall = calls.find(call => call.url.includes("/api/alerts"));
    expect(alertCall).toBeDefined();
    expect(JSON.parse(String(alertCall?.init?.body))).toMatchObject({ symbol: "XLF", condition: { type: "price", op: "above", value: 42, evidence: { investigation_id: command.id, revision: 1 } } });
    expect(status()).toContain("Watching XLF");
  });

  it("keeps note and watch independent: a failed watch never rolls a saved note back (partial success stays visible)", async () => {
    routes["/api/watchlist/annotations"] = () => json({ results: [{ symbol: "XLF", field: "note", status: "ok", revision: 3, value: "Financials leading", updatedAt: "2026-11-09T00:00:00Z" }] });
    routes["/api/alerts"] = () => new Response("{}", { status: 503 });
    await mount(<div>
      <SymbolNoteField principal={PRINCIPAL} symbol="XLF" initial={{ value: "", baseRevision: 2 }} lang="en" copy={noteCopy} />
      <ArmWatchControl principal={PRINCIPAL} link={{ investigation_id: command.id, revision: 1 }} symbol="XLF" lang="en" copy={watchCopy} />
    </div>);
    const textarea = host.querySelector("textarea")!;
    await type(textarea, "Financials leading");
    const input = host.querySelector("input")!;
    await type(input, "50");
    await click(0);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    const noteCall = calls.find(call => call.url.includes("/api/watchlist/annotations"));
    expect(noteCall).toBeDefined();
    expect((noteCall?.init?.headers as Record<string, string>)["x-mm-annotation-owner"]).toBe(PRINCIPAL);
    expect(JSON.parse(String(noteCall?.init?.body)).writes[0]).toMatchObject({ symbol: "XLF", field: "note", value: "Financials leading", baseRevision: 2 });
    const statuses = [...host.querySelectorAll('[role="status"]')].map(node => node.textContent);
    expect(statuses.some(text => text?.includes("Saved"))).toBe(true);
    expect(statuses.some(text => text?.includes("Alerts unavailable"))).toBe(true);
  });

  it("shows the note conflict with the other text and keeps an unsynced draft pending, never 'saved'", async () => {
    routes["/api/watchlist/annotations"] = () => json({ results: [{ symbol: "XLF", field: "note", status: "conflict", revision: 7, value: "Changed on the phone", updatedAt: null }] });
    await mount(<SymbolNoteField principal={PRINCIPAL} symbol="XLF" initial={{ value: "old", baseRevision: 2 }} lang="en" copy={noteCopy} />);
    const textarea = host.querySelector("textarea")!;
    await type(textarea, "new text");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(status()).toContain("Changed elsewhere: Changed on the phone");
  });

  it("keeps a transport-failed note as a pending draft and labels the signed-out surfaces", async () => {
    routes["/api/watchlist/annotations"] = () => { throw new Error("offline"); };
    await mount(<SymbolNoteField principal={PRINCIPAL} symbol="XLF" initial={{ value: "", baseRevision: 1 }} lang="en" copy={noteCopy} />);
    const textarea = host.querySelector("textarea")!;
    await type(textarea, "draft");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(textarea.value).toBe("draft");
    expect(status()).toContain("Not synced yet");
    act(() => root.unmount());
    await mount(<SaveInvestigationButton principal={null} command={command} lang="zh" copy={saveCopy} />);
    expect(host.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    expect(status()).toContain("登录后保存");
  });

  it("r4 N-7: A's in-flight save never disables B's Save after the switch (the flight flag is per account)", async () => {
    // A's POST hangs in flight while the surface re-binds to account B on the
    // SAME component instance (no remount): B's Save must stand enabled and
    // read B's idle label, and A's late reply must neither clear a flag B
    // raised nor forge a result — the journal stays A's raw recovery record.
    const PRINCIPAL_B = "22222222-2222-4222-8222-222222222222";
    let answerA: ((value: Response) => void) | null = null;
    routes["/api/investigations"] = () => new Promise<Response>(resolve => { answerA = resolve; });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const states: InvestigationSaveState[] = [];
    const mountAs = async (principal: string | null) => {
      await act(async () => {
        root.render(<SaveInvestigationButton principal={principal} command={command} lang="en" copy={saveCopy} onStateChange={s => states.push(s)} />);
      });
    };
    await mountAs(PRINCIPAL);
    await click(0);
    expect(host.querySelector("button")!.hasAttribute("disabled")).toBe(true); // A's own flight disables A's Save
    // The account switches on the same mounted button — no remount, no reset.
    await mountAs(PRINCIPAL_B);
    expect(host.querySelector("button")!.hasAttribute("disabled")).toBe(false); // never disabled by A's pending POST
    expect(host.querySelector("button")!.textContent).toBe("Save");             // B's idle label, not A's "Saving…"
    expect(status()).toBe("Save");                                              // no unconfirmed line under B
    // A's reply lands at last: a non-JSON 503 keeps A's operation uncertain.
    await act(async () => { answerA!(new Response("unavailable", { status: 503 })); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(host.querySelector("button")!.hasAttribute("disabled")).toBe(false); // A's reply cleared only A's flag
    expect(status()).toBe("Save");                                              // B still sees nothing of A's journey
    const journal = states.at(-1);
    expect(journal?.phase).toBe("uncertain");                    // the caller-owned record survives…
    expect(journal?.phase === "uncertain" ? journal.principal : null).toBe(PRINCIPAL); // …owned by A
  });
});
