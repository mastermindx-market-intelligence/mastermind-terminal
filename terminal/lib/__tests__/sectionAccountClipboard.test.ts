// @vitest-environment jsdom
// Real SectionAccount, React createRoot/act, and real EN/ZH LEX; no clipboard OS access.
// Place at terminal/lib/__tests__/sectionAccountClipboard.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LEX } from "@/lib/i18n";
import { accountIdentity } from "@/lib/accountIdentity";
import type { SectionProps } from "@/components/settings/types";

const forbidden = vi.hoisted(() => ({
  createClient: vi.fn(() => { throw new Error("Auth forbidden in clipboard fixture"); }),
  accountWrite: vi.fn(() => { throw new Error("Account write forbidden in clipboard fixture"); }),
  passwordWrite: vi.fn(() => { throw new Error("Password write forbidden in clipboard fixture"); }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: forbidden.createClient }));
vi.mock("@/lib/accountPrefs", () => ({ sendScopedAccountWrite: forbidden.accountWrite }));
vi.mock("@/lib/passwordAuth", () => ({ updateAuthPassword: forbidden.passwordWrite }));
import SectionAccount from "@/components/settings/SectionAccount";

const UID = "00000000-0000-4000-8000-000000000001";
const EMAIL = "clipboard-fixture@example.invalid";
type Lang = "en" | "zh";
type LegacyResult = "true" | "false" | "throw" | "create-throw";
type Api = "absent" | "reject" | "resolve";

function makeT(lang: Lang) {
  return (key: string, fallback?: string) => {
    const entry = LEX[key];
    return entry ? entry[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function restoreOwnProperty(target: object, key: string, descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(target, key, descriptor);
  else Reflect.deleteProperty(target, key);
}

const cases: { name: string; api: Api; legacy: LegacyResult; prior?: boolean; success: boolean }[] = [
  { name: "missing API + fallback false", api: "absent", legacy: "false", success: false },
  { name: "denied API + fallback false", api: "reject", legacy: "false", success: false },
  { name: "prior success + fallback false", api: "absent", legacy: "false", prior: true, success: false },
  { name: "missing API + fallback true", api: "absent", legacy: "true", success: true },
  { name: "denied API + fallback true", api: "reject", legacy: "true", success: true },
  { name: "resolved API without fallback", api: "resolve", legacy: "false", success: true },
  { name: "throwing fallback, initially clear", api: "absent", legacy: "throw", success: false },
  { name: "prior success + throwing fallback", api: "absent", legacy: "throw", prior: true, success: false },
  { name: "createElement throws, initially clear", api: "absent", legacy: "create-throw", success: false },
  { name: "prior success + createElement throws", api: "absent", legacy: "create-throw", prior: true, success: false },
];

describe.each(["en", "zh"] as const)("SectionAccount clipboard (%s)", (lang) => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let clipboardDescriptor: PropertyDescriptor | undefined;
  let execDescriptor: PropertyDescriptor | undefined;
  let created: HTMLTextAreaElement[];
  let forbiddenRequests: string[];
  let submissions: number;
  let legacyResult: LegacyResult;
  let observations: { command: string; value: string | undefined; connected: boolean; start: number | null; end: number | null }[];
  const t = makeT(lang);
  const callback = vi.fn(() => { throw new Error("Unrelated callback forbidden"); });
  const refresh = vi.fn(async () => { throw new Error("Refresh forbidden"); });

  function preventSubmit(event: Event) {
    event.preventDefault();
    submissions++;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    execDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
    created = [];
    forbiddenRequests = [];
    observations = [];
    submissions = 0;
    legacyResult = "false";
    container = document.createElement("div");
    document.body.appendChild(container);
    document.addEventListener("submit", preventSubmit, true);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "GET" && (url === "/api/teams" || url === "/api/account/deletion")) {
        return {
          ok: true,
          status: 200,
          json: async () => url === "/api/teams" ? { teams: [], truncated: false } : { requests: [] },
        };
      }
      forbiddenRequests.push(`${method} ${url}`);
      throw new Error("Network request refused by clipboard fixture");
    }));
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn((command: string) => {
        const active = document.activeElement;
        const textarea = active instanceof HTMLTextAreaElement ? active : undefined;
        observations.push({
          command,
          value: textarea?.value,
          connected: textarea?.isConnected ?? false,
          start: textarea?.selectionStart ?? null,
          end: textarea?.selectionEnd ?? null,
        });
        if (legacyResult === "throw") throw new Error("Fixture copy denied");
        return legacyResult === "true";
      }),
    });
    setClipboard(undefined);
  });

  afterEach(() => {
    // Always clean up, including against the defective source that leaks its textarea.
    try {
      act(() => { root?.unmount(); });
      expect(forbiddenRequests).toEqual([]);
      expect(submissions).toBe(0);
      for (const stub of Object.values(forbidden)) expect(stub).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      root = undefined;
      for (const textarea of created) textarea.remove();
      container.remove();
      document.removeEventListener("submit", preventSubmit, true);
      vi.restoreAllMocks();
      restoreOwnProperty(navigator, "clipboard", clipboardDescriptor);
      restoreOwnProperty(document, "execCommand", execDescriptor);
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  function setClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: writeText ? { writeText } : undefined,
    });
  }

  async function mount() {
    const props: SectionProps = {
      t, lang, identity: accountIdentity(UID, EMAIL), email: EMAIL,
      user: { id: UID, email: EMAIL, createdAt: null, lastSignInAt: null, provider: "email", meta: {} },
      onClose: callback, onPatchMeta: callback, onRefreshUser: refresh,
    };
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionAccount, props));
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Fault injection is installed AFTER mounting so it cannot break React DOM creation.
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      if (tagName.toLowerCase() === "textarea" && legacyResult === "create-throw") {
        throw new Error("Fixture textarea creation failed");
      }
      const element = originalCreateElement(tagName, options);
      if (element instanceof HTMLTextAreaElement) created.push(element);
      return element;
    });
    expectCopy(false);
  }

  function button(): HTMLButtonElement {
    const rows = Array.from(container.querySelectorAll(".acs-row"));
    const row = rows.find((node) => node.querySelector(".acs-row-lbl")?.textContent?.trim() === t("acsUserId"));
    expect(row, "User ID row must exist").toBeTruthy();
    const buttons = row!.querySelectorAll<HTMLButtonElement>("button.acs-mini");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe("button");
    return buttons[0];
  }

  function expectCopy(copied: boolean) {
    expect(button().textContent?.trim()).toBe(t(copied ? "acsCopied" : "acsCopy"));
  }

  async function click() {
    await act(async () => { button().click(); await Promise.resolve(); await Promise.resolve(); });
  }

  async function advance(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  }

  async function expectSuccessThenReset() {
    expectCopy(true);
    await advance(1199);
    expectCopy(true);
    await advance(1);
    expectCopy(false);
  }

  it.each(cases)("$name", async ({ api, legacy, prior, success }) => {
    await mount();
    if (prior) {
      const priorWrite = vi.fn(async () => {});
      setClipboard(priorWrite);
      await click();
      expect(priorWrite).toHaveBeenCalledTimes(1);
      expect(priorWrite).toHaveBeenCalledWith(UID);
      expectCopy(true);
    }
    legacyResult = legacy;
    const writeText = vi.fn(async () => {
      if (api === "reject") throw new DOMException("Fixture permission denied", "NotAllowedError");
    });
    setClipboard(api === "absent" ? undefined : writeText);
    await click();
    if (api === "absent") expect(writeText).not.toHaveBeenCalled();
    else {
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(UID);
    }
    const usesTextarea = api !== "resolve" && legacy !== "create-throw";
    expect(created).toHaveLength(usesTextarea ? 1 : 0);
    expect(observations).toEqual(usesTextarea ? [{ command: "copy", value: UID, connected: true, start: 0, end: UID.length }] : []);
    for (const textarea of created) expect(textarea.isConnected).toBe(false);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    expectCopy(success);
    if (success) await expectSuccessThenReset();
    else {
      // A still-scheduled prior-success reset must never resurrect a success label.
      await advance(1200);
      expectCopy(false);
    }
  });

  it("pending write confirms only after resolution, with the reset measured from success", async () => {
    await mount();
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    const writeText = vi.fn(() => pending);
    setClipboard(writeText);
    await click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith(UID);
    expectCopy(false);
    await advance(1200);
    expectCopy(false);
    expect(created).toHaveLength(0);
    expect(observations).toEqual([]);
    await act(async () => { resolve(); await pending; });
    expect(observations).toEqual([]);
    expect(created).toHaveLength(0);
    await expectSuccessThenReset();
  });
});
