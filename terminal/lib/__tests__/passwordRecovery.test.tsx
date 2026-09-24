// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  getUser: vi.fn(),
  updateUser: vi.fn(),
}));
const nav = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav,
}));

import StepAccount from "@/components/onboarding/StepAccount";
import ResetPasswordPage from "@/app/reset-password/page";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  mode: "signin" as const,
  firstName: "",
  lastName: "",
  email: "admin@mastermind-x.com",
  password: "known-password",
  plan: "pro" as const,
  period: "annual" as const,
  prefs: { market_focus: [], trade_types: [], theme_pref: "dark" as const },
  set: vi.fn(),
  onModeSwitch: vi.fn(),
  onConfirmPending: vi.fn(),
  onAdvance: vi.fn(),
};

describe("password recovery from the canonical sign-in sheet", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    auth.signInWithPassword.mockReset();
    auth.signUp.mockReset();
    auth.resetPasswordForEmail.mockReset();
    auth.getUser.mockReset();
    auth.updateUser.mockReset();
    nav.refresh.mockReset();
    nav.replace.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = undefined;
    container.remove();
  });

  async function render(props = baseProps) {
    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(StepAccount, props));
    });
  }

  it("sends a same-origin PKCE reset link without disclosing account existence", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await render();

    const reset = container.querySelector('[data-testid="password-reset-request"]') as HTMLButtonElement;
    expect(reset).toBeTruthy();

    await act(async () => { reset.click(); });

    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
      "admin@mastermind-x.com",
      { redirectTo: `${window.location.origin}/auth/callback?next=%2Freset-password` },
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "If that email is registered, we sent a password-reset link.",
    );
  });

  it("requires an email before requesting recovery", async () => {
    await render({ ...baseProps, email: "" });
    const reset = container.querySelector('[data-testid="password-reset-request"]') as HTMLButtonElement;

    await act(async () => { reset.click(); });

    expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Enter your email first.");
  });

  it("replaces Supabase's raw invalid-credentials error with a recoverable message", async () => {
    auth.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", message: "Invalid login credentials" },
    });
    await render();

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Email or password didn’t match. Try again or reset your password.",
    );
    expect(container.textContent).not.toContain("Invalid login credentials");
  });
});


describe("reset-password page", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    auth.getUser.mockReset();
    auth.updateUser.mockReset();
    nav.refresh.mockReset();
    nav.replace.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = undefined;
    container.remove();
  });

  it("accepts a valid recovery session and updates the password through Supabase", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    auth.updateUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(ResetPasswordPage));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    const inputs = Array.from(container.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(inputs[0], "a-new-password-123");
      inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(inputs[1], "a-new-password-123");
      inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    });

    const form = container.querySelector("form") as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(auth.updateUser).toHaveBeenCalledWith({ password: "a-new-password-123" });
    expect(container.textContent).toContain("Password updated");
    expect(nav.refresh).toHaveBeenCalledTimes(1);
  });

  it("fails closed when there is no recovery session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { message: "Auth session missing" } });

    await act(async () => {
      root = createRoot(container);
      root.render(React.createElement(ResetPasswordPage));
      await Promise.resolve();
    });
    await act(async () => { await Promise.resolve(); });

    expect(container.textContent).toContain("This reset link is invalid or expired.");
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});
