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
let calls: { url: string; method: string; body: unknown; owner: string | null }[];

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
    expect(posts[1].body.id).not.toBe(posts[0].body.id);
    expect(posts[1].body.operation_id).not.toBe(posts[0].body.operation_id);
  });
});
