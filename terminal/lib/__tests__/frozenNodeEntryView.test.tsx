// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const H = vi.hoisted(() => ({ enabled: false, lang: "en", auth: vi.fn(), owner: "10000000-0000-4000-8000-000000000001" }));
vi.mock("@/lib/frozenNodeEntryProtocol", async () => ({ ...await vi.importActual<typeof import("@/lib/frozenNodeEntryProtocol")>("@/lib/frozenNodeEntryProtocol"), get FROZEN_ENTRY_CLIENT_ENABLED() { return H.enabled; } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: H.auth }));
vi.mock("@/components/exposure-map/ExposureDivergence", () => ({ default: () => null }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: H.lang }) }));
vi.mock("@/components/chrome/AppShell", () => ({ useShellIdentity: () => ({ kind: "account", userId: H.owner, email: "synthetic@example.test" }) }));
vi.mock("@/components/researchlab/useResearchAppearance", () => ({ useResearchAppearance: () => {} }));
vi.mock("@/lib/useMediaQuery", () => ({ useIsPhone: () => false }));
vi.mock("@/lib/flowClientCache", () => ({ flowGetResult: async () => ({ kind: "unavailable" }) }));
vi.mock("@/components/exposure-map/usePriorProjection", () => ({ usePriorProjection: () => ({ prior: null, status: "none", priorSession: null }) }));
import fixture from "./fixtures/exposure-native-qqq-observed-v2.json";
import ExposureMap from "@/components/exposure-map/ExposureMap";
import FrozenNodeEntry from "@/components/exposure-map/FrozenNodeEntry";
const at = Date.parse("2026-10-21T00:00:00Z");
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  H.enabled = false; H.lang = "en"; H.auth.mockReset(); localStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(Date, "now").mockReturnValue(at);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  H.auth.mockReturnValue({ auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: "synthetic" } }, error: null })), getUser: vi.fn(async () => ({ data: { user: { id: H.owner } }, error: null })) } });
  const held = new Set<string>();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name: string, _opts: unknown, cb: (lock: unknown) => Promise<unknown>) => {
    if (held.has(name)) return cb(null); held.add(name); try { return await cb({ name, mode: "exclusive" }); } finally { held.delete(name); }
  } } });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (name: string) => { const b = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === name); if (!b) throw new Error("missing button "+name+"; buttons="+[...host.querySelectorAll("button")].map(b=>b.textContent).join(",").slice(0,1200)+"; view="+host.textContent?.slice(0,700)); return b; };
async function select(strike: number) { await act(async () => {
  const target = strike === 159 ? [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith("Provisional net leader159"))! : button(String(strike));
  target.click();
}); }
function mountMap() { act(() => { root.render(<ExposureMap root="QQQ" source={fixture} matrix={null} />); }); }

describe("actual ExposureMap → default-off or explicitly enabled frozen entry fixture", () => {
  it("defaultOFF selected-node render performs zero entry Auth/fetch/storage", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const write = vi.spyOn(Storage.prototype, "setItem"); mountMap(); await select(159);
    expect(host.querySelector('[aria-label="Frozen node enrollment preview"]')).toBeNull();
    expect(H.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
  });
  it("actual parent strike-B key remount invalidates pending A issuance and clears confirmation", async () => {
    H.enabled = true;
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); expect(body.action).toBe("issue"); started(); await gate;
      return Response.json({ kind: "issued", descriptor: { schema: "options.frozen_entry/v1", alertId: "30000000-0000-4000-8000-000000000001", attemptId: "60000000-0000-4000-8000-000000000001", principal: H.owner, issuedAt: new Date(at).toISOString(), ...body.selection } });
    }); vi.stubGlobal("fetch", fetcher);
    mountMap(); await select(159);
    await act(async () => { button("Prepare and save reference").click(); }); await ready;
    await select(123);
    expect(button("Confirm this enrollment").disabled).toBe(true);
    await act(async () => { release(); await gate; await Promise.resolve(); });
    expect(localStorage.length).toBe(0); expect(button("Confirm this enrollment").disabled).toBe(true);
    expect(host.textContent).not.toContain("Original reference saved on this device"); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("enabled preview keeps bilingual explicit status and controls (zh=%s)", zh => {
    H.enabled = true;
    act(() => root.render(<FrozenNodeEntry owner={H.owner} identity="fixture|159" root="QQQ" source={fixture} lens={{ kind: "all" }} price={159} metric="gamma" shock={{ spotPercent: 0, ivPoints: 0, calendarDays: 0 }} now={at} zh={zh} />));
    expect(host.textContent).toContain(zh ? "实时提醒评估尚未启用" : "live alert evaluation is not enabled");
    expect(host.textContent).toContain("0.5%");
    expect(host.querySelectorAll("button")).toHaveLength(3); expect(H.auth).not.toHaveBeenCalled();
  });
});

it("known missing-reference UNKNOWN disables Prepare across actual parent remount", async () => {
  H.enabled = true; const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  mountMap(); await select(159);
  await act(async () => { button("Read original attempt").click(); });
  expect(host.textContent).toContain("Unconfirmed"); expect(button("Prepare and save reference").disabled).toBe(true);
  await select(123);
  expect(button("Prepare and save reference").disabled).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});


it("confirmed reference exposes exact original identity and keeps UUIDs in a closed keyboard disclosure", async () => {
  H.enabled = true; let issued!: () => void; const ready = new Promise<void>(resolve => { issued = resolve; });
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); expect(body.action).toBe("issue"); issued();
    return Response.json({ kind: "issued", descriptor: { schema: "options.frozen_entry/v1", alertId: "30000000-0000-4000-8000-000000000001", attemptId: "60000000-0000-4000-8000-000000000001", principal: H.owner, issuedAt: new Date(at).toISOString(), ...body.selection } });
  }));
  mountMap(); await select(159);
  await act(async () => { button("Prepare and save reference").click(); await ready; });
  expect(host.textContent).toContain("Original reference saved on this device");
  expect(host.textContent).toContain("QQQ · 159 · 2026-10-20"); expect(host.textContent).toContain("0.5%");
  const details = [...host.querySelectorAll("details")].find(d => d.querySelector("summary")?.textContent === "Original attempt reference")!;
  expect(details).toBeDefined(); expect(details.open).toBe(false); expect(details.querySelector("code")?.textContent).toContain("60000000-");
  expect(button("Confirm this enrollment").disabled).toBe(false);
});

it("missing client SDK configuration refuses the preview action without fetch or enrollment", async () => {
  H.enabled = true;
  let releaseDigest!: () => void, reachedSdk!: () => void;
  const digestGate = new Promise<void>(resolve => { releaseDigest = resolve; });
  const sdkReached = new Promise<void>(resolve => { reachedSdk = resolve; });
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => {
    await digestGate;
    return nativeDigest(...args);
  });
  H.auth.mockImplementation(() => { reachedSdk(); throw new Error("synthetic missing SDK config"); });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); mountMap(); await select(159);
  await act(async () => { button("Prepare and save reference").click(); });
  // act() cannot settle native WebCrypto IO. Keep it delayed deliberately, then
  // await the actual SDK boundary rather than assuming the click completed it.
  expect(H.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Unconfirmed");
  await act(async () => { releaseDigest(); await sdkReached; });
  expect(host.textContent).toContain("Unconfirmed"); expect(fetcher).not.toHaveBeenCalled();
  expect(button("Confirm this enrollment").disabled).toBe(true);
});


describe("source availability and publication remain distinct in the actual map", () => {
  it.each(["en", "zh"])("unknown publication does not borrow the availability clock (%s)", lang => {
    H.lang = lang;
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    mountMap();
    const label = [...host.querySelectorAll("span")].find(el => el.textContent === (lang === "zh" ? "时钟" : "CLOCKS"))!;
    const clocks = label.parentElement!;
    expect(clocks.textContent).toContain(lang === "zh" ? "发布 未提供" : "published Not supplied");
    expect(clocks.textContent).toContain(lang === "zh" ? "来源可用 10-20 12:04" : "source available 10-20 12:04");
    expect(clocks.textContent).not.toContain(lang === "zh" ? "发布 10-20 12:04" : "published 10-20 12:04");
    expect(H.auth).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["en", "zh"])("known publication shows its own clock alongside availability (%s)", lang => {
    H.lang = lang;
    const source = { ...fixture, exposure_projection: { ...fixture.exposure_projection, clocks: { ...fixture.exposure_projection.clocks, published_at: "2026-10-20T13:10:00Z" } } };
    act(() => root.render(<ExposureMap root="QQQ" source={source} matrix={null} />));
    const label = [...host.querySelectorAll("span")].find(el => el.textContent === (lang === "zh" ? "时钟" : "CLOCKS"))!;
    expect(label.parentElement!.textContent).toContain(lang === "zh" ? "发布 10-20 13:10Z" : "published 10-20 13:10Z");
    expect(label.parentElement!.textContent).toContain(lang === "zh" ? "来源可用 10-20 12:04" : "source available 10-20 12:04");
  });
});
