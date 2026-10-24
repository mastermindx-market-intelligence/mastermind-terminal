// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetaPrefs } from "@/lib/accountPrefs";
type Reply = { data: { user: unknown }; error: unknown };
let getUser: () => Promise<Reply>;
let update: () => Promise<{ error: unknown }>;
const writes: Record<string, unknown>[] = [];
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: {
  getUser: () => getUser(),
  updateUser: ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return update(); },
} }) }));
vi.mock("@/lib/i18n", () => ({ applyLang: vi.fn() }));
import {
  __loadOwner, __marketPrefsSnapshot as snap, __resetMarketPrefsStore,
  __subscribeMarketPrefs, persistMetaPrefs, persistTradeTypes,
} from "@/lib/useMarketPrefs";

const A = "8f2c41ba-7d19-4e6a-9c03-5b71ee0a4d22";
const B = "0b6d1f57-3c84-4a11-8e29-6d40cc1b7f93";
const user = (id = A, metadata: Record<string, unknown> = {}) => ({ data: { user: { id, user_metadata: metadata } }, error: null });
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
beforeEach(() => {
  __resetMarketPrefsStore();
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  writes.length = 0;
  getUser = async () => user(); update = async () => ({ error: null });
});
afterEach(() => { __resetMarketPrefsStore(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("appearance publication in the existing owner store", () => {
  it("starts at zero and hydration never invents a selection", async () => {
    expect(snap().appearanceRevision).toBe(0);
    getUser = async () => user(A, { theme: "light", theme_auto: "1" });
    __loadOwner(`account:${A}`);
    expect(snap().appearanceRevision).toBe(0);
    await settle();
    expect(snap().metaPrefs).toEqual({ theme: "light", themeAuto: "1" });
    expect(snap().appearanceRevision).toBe(0);
    expect(writes).toEqual([]);
  });
  it("distinguishes repeated Auto selections from repeated language publications", () => {
    __loadOwner("guest");
    persistMetaPrefs({ themeAuto: "1" });
    expect(snap().appearanceRevision).toBe(1);
    persistMetaPrefs({ lang: "en" }); persistMetaPrefs({ lang: "en" });
    expect(snap().appearanceRevision).toBe(1);
    persistMetaPrefs({ themeAuto: "1" });
    expect(snap().appearanceRevision).toBe(2);
    expect(writes).toEqual([]);
  });
  it("malformed appearance with valid language publishes only language, without increment", () => {
    __loadOwner("guest");
    persistMetaPrefs({ theme: "bad", themeAuto: true, lang: "zh" } as unknown as MetaPrefs);
    expect(snap().metaPrefs).toEqual({ lang: "zh" });
    expect(snap().appearanceRevision).toBe(0);
    persistMetaPrefs({ theme: "bad" } as unknown as MetaPrefs);
    expect(snap().appearanceRevision).toBe(0);
  });
  it("same explicit theme and two appearance fields each count once per call", () => {
    __loadOwner("guest");
    persistMetaPrefs({ theme: "light", themeAuto: "0" });
    expect(snap().appearanceRevision).toBe(1);
    persistMetaPrefs({ theme: "light", themeAuto: "0", lang: "en" });
    expect(snap().appearanceRevision).toBe(2);
    persistMetaPrefs({ theme: "light" });
    expect(snap().appearanceRevision).toBe(3);
  });
  it("held metadata and pump publications never double-count the same selection", async () => {
    const read = deferred<Reply>(); getUser = () => read.promise;
    __loadOwner(`account:${A}`);
    const observed: number[] = [];
    const stop = __subscribeMarketPrefs((snapshot) => observed.push(snapshot.appearanceRevision));
    persistMetaPrefs({ themeAuto: "1" });
    expect(observed.length).toBeGreaterThan(1);
    expect(observed.every((revision) => revision === 1)).toBe(true);
    expect(snap().held).toBe(true);
    read.resolve(user(A, { prefs: { retained: "unchanged" } }));
    await settle();
    expect(snap().appearanceRevision).toBe(1);
    expect(snap().held).toBe(false);
    expect(observed.every((revision) => revision === 1)).toBe(true);
    stop();
  });
  it("owner reset fences late prior-owner hydration and resets the local revision", async () => {
    const oldRead = deferred<Reply>(); getUser = () => oldRead.promise;
    __loadOwner(`account:${A}`); persistMetaPrefs({ theme: "light" });
    expect(snap().appearanceRevision).toBe(1);
    getUser = async () => user(B, { theme: "dark" });
    __loadOwner(`account:${B}`);
    expect(snap().appearanceRevision).toBe(0);
    expect(snap().ready).toBe(false);
    await settle();
    oldRead.resolve(user(A, { theme: "light", theme_auto: "1" })); await settle();
    expect(snap().owner).toBe(`account:${B}`);
    expect(snap().metaPrefs).toEqual({ theme: "dark" });
    expect(snap().appearanceRevision).toBe(0);
    __resetMarketPrefsStore(); expect(snap().appearanceRevision).toBe(0);
  });
  it("late old-owner write acknowledgment cannot alter the incoming revision", async () => {
    __loadOwner(`account:${A}`); await settle();
    const ack = deferred<{ error: unknown }>(); update = () => ack.promise;
    persistMetaPrefs({ theme: "light" });
    getUser = async () => user(B); __loadOwner(`account:${B}`); await settle();
    persistMetaPrefs({ theme: "dark" });
    expect(snap().appearanceRevision).toBe(1);
    ack.resolve({ error: null }); await settle();
    expect(snap().owner).toBe(`account:${B}`);
    expect(snap().appearanceRevision).toBe(1);
  });
  it("retains exact atomic and legacy payloads without serializing the revision", async () => {
    getUser = async () => user(A, { prefs: { retained: "unchanged" } });
    __loadOwner(`account:${A}`); await settle();
    persistMetaPrefs({ theme: "light", themeAuto: "0" }); await settle();
    expect(writes).toEqual([{ theme: "light", theme_auto: "0", prefs: { retained: "unchanged", theme: "light", themeAuto: "0" } }]);
    expect(snap().appearanceRevision).toBe(1);
    persistMetaPrefs({ lang: "zh" }); await settle();
    expect(writes[1]).toEqual({ lang: "zh", prefs: { retained: "unchanged", theme: "light", themeAuto: "0", lang: "zh" } });
    persistTradeTypes(["stocks"]); await settle();
    expect(writes[2]).toEqual({ trade_types: ["stocks"] });
    expect(snap().appearanceRevision).toBe(1);
    expect(JSON.stringify(writes)).not.toContain("appearanceRevision");
    expect(localStorage.getItem("appearanceRevision")).toBeNull();
  });
});
