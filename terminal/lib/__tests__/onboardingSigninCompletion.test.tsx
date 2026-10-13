// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StepAccount from "@/components/onboarding/StepAccount";

const auth = vi.hoisted(() => ({ signin: vi.fn(), signup: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  auth: { signInWithPassword: auth.signin, signUp: auth.signup },
}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: auth.refresh }) }));
vi.mock("@/lib/i18n", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/onboarding/oauth", () => ({ startGoogleOAuth: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let signedIn: ReturnType<typeof vi.fn>;
let advance: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
let switchMode: ReturnType<typeof vi.fn>;

function mount(mode: "signin" | "signup" = "signin") {
  act(() => root.render(<StepAccount
    mode={mode} firstName="" lastName="" email="fixture@example.com" password="fixture-only-password"
    plan="free" period="annual" prefs={{ market_focus: [], trade_types: [], theme_pref: "dark" }}
    set={set} onModeSwitch={switchMode} onConfirmPending={vi.fn()}
    onAdvance={advance} onSignedIn={signedIn}
  />));
}

async function submit() {
  await act(async () => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  signedIn = vi.fn(); advance = vi.fn(); set = vi.fn(); switchMode = vi.fn();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("password sign-in completion", () => {
  it("finishes a successful sign-in even when the server email is already populated", async () => {
    auth.signin.mockResolvedValue({ error: null });
    mount(); await submit();
    expect(signedIn).toHaveBeenCalledTimes(1);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(advance).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({ password: "" });
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it("keeps the sheet open and shows an ordinary authentication failure", async () => {
    auth.signin.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    mount(); await submit();
    expect(signedIn).not.toHaveBeenCalled();
    expect(auth.refresh).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Invalid login credentials");
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it("does not claim completion while the authentication request is pending", async () => {
    let resolve!: (value: { error: null }) => void;
    auth.signin.mockReturnValue(new Promise(r => { resolve = r; }));
    mount(); await submit();
    expect(signedIn).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    const modeButton = [...host.querySelectorAll("button")].find(b => b.textContent === "obToSignup")!;
    expect(modeButton.disabled).toBe(true);
    act(() => modeButton.click());
    expect(switchMode).not.toHaveBeenCalled();
    await act(async () => resolve({ error: null }));
    expect(signedIn).toHaveBeenCalledTimes(1);
    expect(modeButton.disabled).toBe(false);
  });

  it("preserves signup's advance-to-preferences flow", async () => {
    auth.signup.mockResolvedValue({ data: { session: {} }, error: null });
    mount("signup"); await submit();
    expect(advance).toHaveBeenCalledTimes(1);
    expect(signedIn).not.toHaveBeenCalled();
  });
});
