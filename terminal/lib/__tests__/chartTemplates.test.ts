// @vitest-environment jsdom
// E07 — the device template store: legacy recovery, verified writes, and a corrupt or blocked
// store that is reported instead of being overwritten.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_TEMPLATES_KEY,
  deleteDeviceTemplate,
  listTemplates,
  publishTemplateMenu,
  readDeviceTemplates,
  renameDeviceTemplate,
  saveDeviceTemplate,
} from "../chartTemplates";
import { STUDY_TEMPLATE_LIMITS, STUDY_TEMPLATE_VERSION } from "../studyTemplateSchema";

const body = {
  indicators: ["rsi", "rsi__abcd1234"],
  indParams: { rsi: { length: 14 }, rsi__abcd1234: { length: 7 } },
  hidden: [],
};

const legacy = {
  id: "ct_k3j2h1lmao",
  name: "Swing (old)",
  indicators: ["ema", "macd"],
  // v1 captured the WHOLE chart params map.
  indParams: { ema: { p1: 9 }, macd: { fast: 8 }, rsi: { length: 3 } },
  createdAt: "2026-07-01T00:00:00.000Z",
};

// Node's own (flag-gated) `localStorage` global shadows jsdom's, so install a plain in-memory
// Storage on both the window and the global the module and this test read.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, String(value)); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}
let localStorage: MemoryStorage;

const stored = () => JSON.parse(localStorage.getItem(DEVICE_TEMPLATES_KEY) ?? "null");

beforeEach(() => {
  localStorage = new MemoryStorage();
  Object.defineProperty(window, "localStorage", { value: localStorage, configurable: true, writable: true });
  publishTemplateMenu(null);
});
afterEach(() => vi.restoreAllMocks());

describe("legacy device templates", () => {
  it("lists and recovers a v1 record without rewriting it", () => {
    localStorage.setItem(DEVICE_TEMPLATES_KEY, JSON.stringify([legacy]));
    const read = readDeviceTemplates();
    expect(read).toMatchObject({ status: "ok", unreadable: 0 });
    if (read.status !== "ok") return;
    expect(read.templates[0]).toMatchObject({
      v: 1, id: legacy.id, name: legacy.name, revision: 1, newer: false,
      indicators: ["ema", "macd"], indParams: { ema: { p1: 9 }, macd: { fast: 8 } },
    });
    // Reading is not a migration: the stored bytes are untouched.
    expect(stored()).toEqual([legacy]);
    expect(listTemplates()).toEqual([{ id: legacy.id, name: legacy.name }]);
  });

  it("renames a v1 record in place and keeps the rest of it", () => {
    localStorage.setItem(DEVICE_TEMPLATES_KEY, JSON.stringify([legacy]));
    const renamed = renameDeviceTemplate(legacy.id, "Swing", { now: new Date("2026-10-11T00:00:00.000Z") });
    expect(renamed).toMatchObject({ ok: true, record: { name: "Swing", revision: 2 } });
    expect(stored()[0]).toEqual({ ...legacy, name: "Swing", revision: 2, updatedAt: "2026-10-11T00:00:00.000Z" });
  });

  it("keeps entries it cannot read, verbatim and in place", () => {
    const junk = { what: "is this" };
    localStorage.setItem(DEVICE_TEMPLATES_KEY, JSON.stringify([junk, legacy, "text"]));
    const read = readDeviceTemplates();
    expect(read).toMatchObject({ status: "ok", unreadable: 2 });
    const saved = saveDeviceTemplate("New", body);
    expect(saved.ok).toBe(true);
    expect(stored().slice(0, 3)).toEqual([junk, legacy, "text"]);
    expect(deleteDeviceTemplate(legacy.id)).toEqual({ ok: true });
    expect(stored()[0]).toEqual(junk);
    expect(stored()[1]).toBe("text");
  });

  it("reports a corrupt store and never writes over it", () => {
    localStorage.setItem(DEVICE_TEMPLATES_KEY, "{not json");
    expect(readDeviceTemplates()).toEqual({ status: "unavailable", reason: "unreadable" });
    expect(saveDeviceTemplate("New", body)).toEqual({ ok: false, error: "unreadable" });
    expect(deleteDeviceTemplate("ct_x")).toEqual({ ok: false, error: "unreadable" });
    expect(localStorage.getItem(DEVICE_TEMPLATES_KEY)).toBe("{not json");
    localStorage.setItem(DEVICE_TEMPLATES_KEY, JSON.stringify({ an: "object" }));
    expect(readDeviceTemplates()).toEqual({ status: "unavailable", reason: "unreadable" });
    expect(listTemplates()).toEqual([]);
  });
});

describe("device writes", () => {
  it("saves a v2 record an older build can still read", () => {
    const saved = saveDeviceTemplate(" Two  RSI ", body, { now: new Date("2026-10-11T00:00:00.000Z") });
    expect(saved).toMatchObject({ ok: true, record: { v: STUDY_TEMPLATE_VERSION, name: "Two RSI", revision: 1 } });
    const [record] = stored();
    expect(record.id).toMatch(/^ct_[0-9a-f]{24}$/);
    // The v1 reader's fields are all present.
    expect(record).toMatchObject({ name: "Two RSI", indicators: body.indicators, indParams: body.indParams, createdAt: "2026-10-11T00:00:00.000Z" });
  });

  it("refuses a duplicate name and overwrites only when asked", () => {
    const first = saveDeviceTemplate("Swing", body);
    if (!first.ok) throw new Error("save failed");
    const dup = saveDeviceTemplate("swing", { ...body, indicators: ["rsi"], indParams: { rsi: { length: 2 } } });
    expect(dup).toEqual({ ok: false, error: "name_taken", existingId: first.record.id });
    const over = saveDeviceTemplate("Swing", { indicators: ["rsi"], indParams: { rsi: { length: 2 } }, hidden: [] }, { overwriteId: first.record.id });
    expect(over).toMatchObject({ ok: true, record: { id: first.record.id, revision: 2, indicators: ["rsi"] } });
    expect(stored()).toHaveLength(1);
  });

  it("never answers ok when the write throws or does not stick", () => {
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(saveDeviceTemplate("Swing", body)).toEqual({ ok: false, error: "write_failed" });
    setItem.mockImplementation(() => undefined); // silently dropped write
    expect(saveDeviceTemplate("Swing", body)).toEqual({ ok: false, error: "write_failed" });
    setItem.mockRestore();
    expect(readDeviceTemplates()).toEqual({ status: "ok", templates: [], unreadable: 0 });
  });

  it("reports blocked storage", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(readDeviceTemplates()).toEqual({ status: "unavailable", reason: "storage_blocked" });
    expect(saveDeviceTemplate("Swing", body)).toEqual({ ok: false, error: "storage_blocked" });
  });

  it("validates before writing", () => {
    expect(saveDeviceTemplate("", body)).toEqual({ ok: false, error: "invalid_name" });
    expect(saveDeviceTemplate("Empty", { indicators: [], indParams: {}, hidden: [] })).toEqual({ ok: false, error: "empty" });
    expect(localStorage.getItem(DEVICE_TEMPLATES_KEY)).toBeNull();
  });

  it("caps the number of device templates", () => {
    const many = Array.from({ length: STUDY_TEMPLATE_LIMITS.templatesMax }, (_, i) => ({ ...legacy, id: `ct_${i}`, name: `T${i}` }));
    localStorage.setItem(DEVICE_TEMPLATES_KEY, JSON.stringify(many));
    expect(saveDeviceTemplate("One more", body)).toEqual({ ok: false, error: "limit_reached" });
    expect(deleteDeviceTemplate("ct_0")).toEqual({ ok: true });
    expect(saveDeviceTemplate("One more", body).ok).toBe(true);
  });

  it("refuses to rewrite a newer build's record but lets it be deleted", () => {
    const future = { v: STUDY_TEMPLATE_VERSION + 1, id: "ct_future", name: "Future", indicators: ["rsi"], revision: 2, extra: 1 };
    localStorage.setItem(DEVICE_TEMPLATES_KEY, JSON.stringify([future]));
    expect(renameDeviceTemplate("ct_future", "Old")).toEqual({ ok: false, error: "newer_version" });
    expect(saveDeviceTemplate("Future", body, { overwriteId: "ct_future" })).toEqual({ ok: false, error: "newer_version" });
    expect(stored()).toEqual([future]);
    expect(deleteDeviceTemplate("ct_future")).toEqual({ ok: true });
  });
});

describe("chart menu", () => {
  it("lists account templates first and marks device rows only when both exist", () => {
    const saved = saveDeviceTemplate("Local", body);
    if (!saved.ok) throw new Error("save failed");
    expect(listTemplates()).toEqual([{ id: saved.record.id, name: "Local" }]);
    publishTemplateMenu({ account: [{ id: "a".repeat(32), name: "Cloud" }], deviceSuffix: "This device" });
    expect(listTemplates()).toEqual([
      { id: `acct:${"a".repeat(32)}`, name: "Cloud" },
      { id: saved.record.id, name: "Local · This device" },
    ]);
    publishTemplateMenu(null);
    expect(listTemplates()).toEqual([{ id: saved.record.id, name: "Local" }]);
  });
});
