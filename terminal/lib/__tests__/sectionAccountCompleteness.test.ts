// @vitest-environment jsdom
//
// B-F12-B5-3b heal round: null/empty provider, guest team-line/fetch, 401 and
// timeout of GET /api/teams. Mounts the real SectionAccount (no doubles).
// canChangePassword already fails closed for null/"" at SectionAccount.tsx;
// these tests cover the mount path that used to invent provider "email".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SectionAccount from "@/components/settings/SectionAccount";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";
import type { AcsUser } from "@/components/settings/SettingsProvider";
import { GUEST_IDENTITY, accountIdentity } from "@/lib/accountIdentity";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function emailUser(overrides: Partial<AcsUser> = {}): AcsUser {
  return {
    id: "user-A",
    email: "a@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    lastSignInAt: "2026-09-01T00:00:00.000Z",
    provider: "email",
    meta: {},
    ...overrides,
  };
}

function signedInProps(lang: "en" | "zh", user: AcsUser): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: accountIdentity(user.id, user.email),
    email: user.email,
    user,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

function guestProps(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: GUEST_IDENTITY,
    email: "",
    user: null,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

describe("SectionAccount provider gate and team fetch (B-F12-B5-3b heal)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let teamsImpl: (init?: RequestInit) => Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    teamsImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        teams: [{ id: "t-1", name: "Acme", role: "owner" }],
        truncated: false,
      }),
    });
    fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/account/deletion")) {
        return { ok: true, status: 200, json: async () => ({ requests: [] }) };
      }
      if (url.includes("/api/teams")) {
        return teamsImpl(init);
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
    vi.useRealTimers();
  });

  async function mount(props: SectionProps) {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(SectionAccount, props));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function passwordRow(): HTMLElement | undefined {
    return Array.from(container.querySelectorAll(".acs-row")).find((row) => {
      const lbl = (row.querySelector(".acs-row-lbl")?.textContent || "").trim();
      return lbl === "Password" || lbl === "密码";
    }) as HTMLElement | undefined;
  }

  function teamCalls(): unknown[] {
    return fetchSpy.mock.calls.filter((c) => String(c[0]).includes("/api/teams"));
  }

  it("null provider: honest unknown-password sentence, login method Not known, no masked value", async () => {
    await mount(signedInProps("en", emailUser({ provider: null })));
    const row = passwordRow();
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain(
      "We could not tell how you signed in, so the password cannot be changed here.",
    );
    expect(row!.querySelector("button.acs-edit")).toBeNull();
    expect(row!.querySelector(".acs-row-val")).toBeNull();
    expect(container.textContent).toContain("Not known");
    expect(container.textContent).not.toContain("Email");
  });

  it("empty-string provider does not fall through to the email password form", async () => {
    await mount(signedInProps("en", emailUser({ provider: "" })));
    const row = passwordRow();
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain(
      "We could not tell how you signed in, so the password cannot be changed here.",
    );
    expect(row!.querySelector("button.acs-edit")).toBeNull();
    expect(row!.querySelector(".acs-row-val")).toBeNull();
    expect(container.textContent).toContain("Not known");
  });

  it("guest: no team fetch, no team line, still the honest password row", async () => {
    await mount(guestProps("en"));
    expect(teamCalls()).toHaveLength(0);
    expect(container.textContent).not.toContain("Loading your team");
    expect(container.textContent).not.toContain("You are not on a team");
    expect(container.textContent).not.toContain("You are the owner");
    const row = passwordRow();
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain(
      "We could not tell how you signed in, so the password cannot be changed here.",
    );
    expect(row!.querySelector(".acs-row-val")).toBeNull();
  });

  it("a 401 for a signed-in user maps the team line to unavailable", async () => {
    teamsImpl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "UNAUTHENTICATED" }),
    });
    await mount(signedInProps("en", emailUser()));
    expect(teamCalls().length).toBeGreaterThan(0);
    expect(container.textContent).toContain("We could not check your team right now.");
  });

  it("a 10s abort of GET /api/teams maps the team line to unavailable", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    teamsImpl = (_init) =>
      new Promise((_, reject) => {
        _init?.signal?.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    await mount(signedInProps("en", emailUser()));
    expect(teamCalls().length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("We could not check your team right now.");
  });

  it("google provider still uses the no-password sentence, never the unknown-provider sentence", async () => {
    await mount(signedInProps("en", emailUser({ provider: "google" })));
    const row = passwordRow();
    expect(row!.textContent).toContain(
      "You signed in without a password, so there is nothing to change here.",
    );
    expect(row!.textContent).not.toContain("We could not tell how you signed in");
    expect(row!.querySelector(".acs-row-val")).toBeNull();
  });
});
