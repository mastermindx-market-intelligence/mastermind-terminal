// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SignupGate from "@/components/gates/SignupGate";

const mocked = vi.hoisted(() => ({ recover: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/supabase/sessionRecovery", () => ({
  recoverMemberSession: mocked.recover,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: vi.fn() } }),
}));
vi.mock("@/components/onboarding/OnboardingProvider", () => ({
  useOnboarding: () => ({ open: mocked.open }),
}));
vi.mock("@/lib/i18n", () => ({
  useT: () => (key: string) => key,
  useLang: () => ({ lang: "en" }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

async function mount() {
  await act(async () => {
    root.render(<SignupGate surface="analysis" />);
    await Promise.resolve();
    await Promise.resolve();
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe("member gate session recovery", () => {
  it("does not advertise signup until a guest is confirmed", async () => {
    let resolve!: (v: string) => void;
    mocked.recover.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    await mount();
    expect(host.textContent).toContain("Restoring your account");
    expect(host.textContent).not.toContain("sgCta");
    await act(async () => resolve("guest"));
    expect(host.textContent).toContain("sgCta");
  });

  it("does not leak gated content or mislabel a transient authentication failure as signed out", async () => {
    mocked.recover.mockResolvedValueOnce("unavailable").mockResolvedValueOnce("guest");
    await mount();
    expect(host.textContent).toContain("We couldn’t verify your session");
    expect(host.textContent).not.toContain("sgCta");
    const retry = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Try again");
    expect(retry).toBeDefined();
    await act(async () => { retry!.click(); await Promise.resolve(); });
    expect(mocked.recover).toHaveBeenLastCalledWith(expect.objectContaining({ manualRetry: true }));
    expect(host.textContent).toContain("sgCta");
  });

  it("keeps the signup gate hidden during verified session restoration", async () => {
    mocked.recover.mockResolvedValueOnce("restoring");
    await mount();
    expect(host.textContent).toContain("Restoring your account");
    expect(host.textContent).not.toContain("sgCta");
  });
});
