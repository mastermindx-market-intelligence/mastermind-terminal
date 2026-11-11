// @vitest-environment jsdom
/**
 * sectorNativeActionsGate.test.tsx — r2 SF-3 + N-D gates for the lane 6 action
 * mount inside the native workspace (SectorNativeActions).
 *
 * Laws pinned here:
 *   - SF-3: the save/watch/note controls render ONLY when BOTH readback
 *     admission probes admit. A 503 probe, an explicit {admitted:false} answer
 *     and a rejected probe fetch each leave the surface absent — no
 *     [data-testid="sector-native-actions"] node and ZERO POST requests. The
 *     gate is per principal AND subject; nothing is faked.
 *   - N-D: the save command is minted for the CURRENT principal. After an
 *     account switch, account B's save must POST B's own command — a fresh
 *     id and operation_id — never reuse account A's ids (an idempotency/id
 *     collision for B on the same sector).
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SectorNativeActions from "@/components/sector-intelligence/SectorNativeActions";
import type { SectorNativeContext } from "@/components/sector-intelligence/sectorNativeSlots";
import { sectorNativeGeneration } from "@/lib/sectorNativeGeneration";
import { nativeGenerationFixture } from "./fixtures/sectorNativeGeneration";

const session = vi.hoisted(() => ({
  identity: { kind: "account", userId: "11111111-1111-4111-8111-111111111111", email: "a@example.test" } as
    { kind: "account"; userId: string; email: string },
}));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => session.identity }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useT: () => (key: string) => key }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const wire = nativeGenerationFixture(
  { as_of: "2026-11-06", sectors: [{ id: "xlf", ticker: "XLF", name: "Financials" }] }, "gate");
const context: SectorNativeContext = {
  generation: sectorNativeGeneration(wire),
  transport: "ready", qualification: "accepted",
  subject: { id: "xlf", ticker: "XLF", name: "Financials", nameZh: "金融" },
  ranked63: ["xlf"], lead21: "xlf", language: "en", theme: "dark",
  binding: { ownerRevision: "r1", generationKey: "g1", subjectId: "xlf", universe: "us",
    metric: "relative_wealth_pct", windows: [63], basis: "total_return" },
};

type Probe = () => Response | Promise<Response>;
let probe: Probe;
let saveAnswer: () => Response | Promise<Response>;
let calls: { url: string; method: string; body: { id: string; operation_id: string } | null; owner: string | null }[];

beforeEach(() => {
  session.identity = { kind: "account", userId: A, email: "a@example.test" };
  probe = () => Response.json({ admitted: true });
  saveAnswer = () => Response.json({ status: "invalid_payload" });
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    if (init?.method === "POST") {
      const record = JSON.parse(String(init.body)) as { id: string; operation_id: string };
      calls.push({ url: href, method: "POST", body: record,
        owner: (init.headers as Record<string, string>)["x-mm-investigation-owner"] ?? null });
      return saveAnswer();
    }
    calls.push({ url: href, method: "GET", body: null, owner: null });
    return probe();
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("SectorNativeActions admission gate (SF-3)", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const mount = async () => {
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  };
  const posts = () => calls.filter(call => call.method === "POST");

  it("stays absent when the probes answer 503 (not admitted yet)", async () => {
    probe = () => new Response("unavailable", { status: 503 });
    await mount();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("stays absent when the probes answer admitted:false", async () => {
    probe = () => Response.json({ admitted: false });
    await mount();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("stays absent when the probe fetch rejects", async () => {
    probe = () => Promise.reject(new TypeError("Failed to fetch"));
    await mount();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("renders the controls and posts under the current principal when both probes admit", async () => {
    await mount();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).not.toBeNull();
    const save = [...host.querySelectorAll("button")].find(b => b.textContent === "Save");
    expect(save).toBeDefined();
    await act(async () => { save!.click(); });
    expect(posts()).toHaveLength(1);
    expect(posts()[0].owner).toBe(A);
  });
});

describe("SectorNativeActions — item 4 (COO 19:15Z): every mount path of all four action components sits behind the SF-3 gate", () => {
  // Audit answer this describe pins: SectorNativeActions is the ONLY importer of
  // the four actions/ components, and both guards (no command/subject/symbol;
  // !saveAdmitted || !principal) precede every mount. The closed-state proofs
  // below search the WHOLE host — not just the gated section — so a control
  // hoisted above the gate cannot escape them.
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const mount = async () => {
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
  };
  const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);

  it("admitted mounts Save, ArmWatch and Note inside the gated section; Check stays closed until a save is in flight", async () => {
    await mount();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).not.toBeNull();
    expect(button("Save")).toBeDefined();                       // SaveInvestigationButton
    expect(host.querySelector("select")).not.toBeNull();       // ArmWatchControl's direction select
    expect(host.querySelector('input[type="number"]')).not.toBeNull(); // its threshold field
    expect(button("Watch")).toBeDefined();                      // its arm button
    expect(host.querySelector("textarea")).not.toBeNull();     // SymbolNoteField
    // CheckSaveStatusButton mounts ONLY for pending/uncertain save states.
    expect(button("Check save status")).toBeUndefined();
  });

  it("not admitted — none of the four renders anywhere in the host, and nothing posts", async () => {
    probe = () => new Response("unavailable", { status: 503 });
    await mount();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).toBeNull();
    // Whole-host proof, not section-scoped: no control of any of the four
    // exists, inside or outside a wrapper.
    expect(host.querySelector("button, select, input, textarea")).toBeNull();
    expect(button("Save")).toBeUndefined();
    expect(button("Watch")).toBeUndefined();
    expect(button("Check save status")).toBeUndefined();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(0);
  });

  it("no generation/subject — the whole surface is absent and no probe even fires", async () => {
    const bare = { ...context, generation: null, subject: null } as SectorNativeContext;
    await act(async () => { root.render(<SectorNativeActions context={bare} />); });
    await flush();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).toBeNull();
    expect(host.querySelector("button, select, input, textarea")).toBeNull();
    expect(calls).toHaveLength(0); // the effect guards on subjectId: zero probes
  });

  it("Check save status mounts only in the pending/uncertain path, still behind the gate", async () => {
    // A save whose answer settles to "uncertain" (non-JSON 503) leaves the save
    // state machine in pending/uncertain — the ONLY world where Check mounts.
    saveAnswer = () => new Response("unavailable", { status: 503 });
    await mount();
    await act(async () => { button("Save")!.click(); });
    await flush();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).not.toBeNull();
    const check = button("Check save status");
    expect(check).toBeDefined();
    // It lives INSIDE the gated section, and driving it stays on the read path.
    expect(host.querySelector('[data-testid="sector-native-actions"]')!.contains(check!)).toBe(true);
    await act(async () => { check!.click(); });
    await flush();
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1); // only the save
  });
});

describe("SectorNativeActions save command re-mints for a switched account (N-D)", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const saveButton = () => {
    const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Save");
    expect(button, "save button missing").toBeDefined();
    return button!;
  };

  it("account B's save after a switch posts B's own id and operation_id, not account A's", async () => {
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
    // Account A saves; the owner answers a definitive rejection so the button
    // stays usable (rejected ⇒ canSave).
    await act(async () => { saveButton().click(); });
    await flush();
    const first = calls.filter(call => call.method === "POST");
    expect(first).toHaveLength(1);
    // The account switches on the same mounted surface; the probes re-admit B.
    session.identity = { kind: "account", userId: B, email: "b@example.test" };
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
    await act(async () => { saveButton().click(); });
    await flush();
    const posts = calls.filter(call => call.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1].owner).toBe(B);
    expect(posts[1].body!.id).not.toBe(posts[0].body!.id);
    expect(posts[1].body!.operation_id).not.toBe(posts[0].body!.operation_id);
  });
});

describe("SectorNativeActions — R4 residue (third review, item 4): a pending save never shows under the next account", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const mount = async () => {
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
  };
  const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);

  it("A's uncertain save shows Check under A only — after a switch to B no Check and no unconfirmed line, and A's Check returns with A", async () => {
    // The lost-reply world: the save POST answers non-JSON 503, so the state
    // machine stays uncertain — the only world where Check mounts.
    saveAnswer = () => new Response("unavailable", { status: 503 });
    await mount();
    await act(async () => { button("Save")!.click(); });
    await flush();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).not.toBeNull();
    expect(button("Check save status")).toBeDefined();
    expect(host.textContent).toMatch(/Save unconfirmed/);
    // The account switches on the same mounted surface; the probes re-admit B.
    session.identity = { kind: "account", userId: B, email: "b@example.test" };
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
    expect(host.querySelector('[data-testid="sector-native-actions"]')).not.toBeNull();
    // B never sees A's save journey: no Check under B's new command…
    expect(button("Check save status")).toBeUndefined();
    // …and no unconfirmed line anywhere in the surface.
    expect(host.textContent).not.toMatch(/Save unconfirmed/);
    // A's scope is retired, not destroyed: when A returns, Check is back.
    session.identity = { kind: "account", userId: A, email: "a@example.test" };
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
    expect(button("Check save status")).toBeDefined();
  });
});

describe("SectorNativeActions — r4 N-7 (round 2 item 6): the save state is keyed per account", () => {
  let root: Root, host: HTMLDivElement;
  beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const mount = async () => {
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
  };
  const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);
  const switchTo = async (userId: string, email: string) => {
    session.identity = { kind: "account", userId, email };
    await act(async () => { root.render(<SectorNativeActions context={context} />); });
    await flush();
  };

  it("A's journal survives B's save: B saves into B's own slot, and A's own state returns with A", async () => {
    // Both saves lose their replies (non-JSON 503 ⇒ uncertain), so each account
    // keeps a live recovery record — the exact world where losing one hurts.
    saveAnswer = () => new Response("unavailable", { status: 503 });
    await mount();
    await act(async () => { button("Save")!.click(); });
    await flush();
    expect(button("Check save status")).toBeDefined(); // A's save is unconfirmed under A
    // Switch A→B: B starts from B's own empty slot — no Check, no unconfirmed.
    await switchTo(B, "b@example.test");
    expect(button("Check save status")).toBeUndefined();
    expect(host.textContent).not.toMatch(/Save unconfirmed/);
    // B saves — B's record must land in B's slot WITHOUT overwriting A's.
    await act(async () => { button("Save")!.click(); });
    await flush();
    expect(button("Check save status")).toBeDefined(); // B's own journey renders under B
    const posts = calls.filter(call => call.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts.map(call => call.owner)).toEqual([A, B]); // both saves flew under their own owners
    // Switch back: A sees A's OWN unconfirmed save again — B's save never
    // consumed A's recovery record.
    await switchTo(A, "a@example.test");
    expect(button("Check save status")).toBeDefined();
    expect(host.textContent).toMatch(/Save unconfirmed/);
  });
});
