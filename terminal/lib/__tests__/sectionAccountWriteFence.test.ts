// @vitest-environment jsdom
//
// Round-3 R2: a foreign-only save through the real fence must not put the
// developer string "no owned key in patch" on the settings pane. The pane
// shows the translated acsErrGen sentence in both languages.
//
// No @testing-library/react — same createRoot + act harness as
// sectionAccountDeleteButtonLabel.test.ts.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";

const fenceMode = vi.hoisted(() => ({ foreignOnly: true }));

vi.mock("@/lib/accountPrefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accountPrefs")>();
  return {
    ...actual,
    sendScopedAccountWrite: (
      send: (data: Record<string, unknown>) => Promise<{ error?: unknown } | void>,
      patch: unknown,
    ) => actual.sendScopedAccountWrite(
      send,
      fenceMode.foreignOnly ? { alert_email_optin: true, tz: "UTC" } : patch,
    ),
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      updateUser: vi.fn(async () => ({ error: null })),
    },
  }),
}));

import SectionAccount from "@/components/settings/SectionAccount";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function baseProps(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "guest" },
    email: "a@example.com",
    user: {
      id: "u1",
      email: "a@example.com",
      createdAt: null,
      lastSignInAt: null,
      provider: "email",
      meta: { display_name: "Ada" },
    },
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

describe("SectionAccount — a foreign-only save through the real fence never shows the developer text", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchSpy: ReturnType<typeof vi.fn> | undefined;

  beforeEach(() => {
    fenceMode.foreignOnly = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ requests: [] }) })) as unknown as typeof fetchSpy;
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  async function saveNameAndReadMsg(lang: "en" | "zh"): Promise<string> {
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccount, baseProps(lang)));
    });
    const nameEdit = Array.from(container.querySelectorAll("button.acs-edit"))[0] as HTMLButtonElement;
    await act(async () => { nameEdit.click(); });
    const input = container.querySelector("input.acs-in") as HTMLInputElement;
    await act(async () => {
      input.value = "Bea";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = Array.from(container.querySelectorAll(".acs-form button.acs-btn"))
      .find((btn) => {
        const text = (btn.textContent || "").trim();
        return text === "Save" || text === "保存";
      }) as HTMLButtonElement;
    await act(async () => { save.click(); });
    const msg = container.querySelector(".acs-msg") as HTMLElement | null;
    return (msg?.textContent || "").trim();
  }

  it("EN: the pane shows the acsErrGen sentence and never the developer text", async () => {
    const text = await saveNameAndReadMsg("en");
    expect(text).toBe(LEX.acsErrGen[0]);
    expect(text).not.toContain("no owned key in patch");
  });

  it("ZH: the pane shows the acsErrGen sentence and never the developer text", async () => {
    const text = await saveNameAndReadMsg("zh");
    expect(text).toBe(LEX.acsErrGen[1]);
    expect(text).not.toContain("no owned key in patch");
  });
});
