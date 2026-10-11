import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShellLayout from "@/app/(shell)/layout";

const fixture = vi.hoisted(() => ({ jar: new Map<string, string>(), claims: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => fixture.jar.has(name) ? { value: fixture.jar.get(name) } : undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: fixture.claims } }) }));
vi.mock("@/components/chrome/AppShell", () => ({ default: () => null }));

beforeEach(() => {
  fixture.jar.clear(); fixture.claims.mockReset();
  fixture.claims.mockResolvedValue({ data: { claims: { sub: "verified-subject", email: "verified@example.com" } } });
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("research shell fixture stays outside production and unrelated suites", () => {
  it("production ignores both fixture flags and a forged fixture guest cookie", async () => {
    vi.stubEnv("NODE_ENV", "production"); fixture.jar.set("mm_e2e_rs30", "1"); fixture.jar.set("mm_e2e_guest", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "verified-subject", email: "verified@example.com" });
    expect(fixture.claims).toHaveBeenCalledOnce();
  });
  it("unrelated development suites retain their existing verified-claims identity", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "verified-subject", email: "verified@example.com" });
    expect(fixture.claims).toHaveBeenCalledOnce();
  });
  it("only explicitly opted-in development research tests receive the account fixture", async () => {
    vi.stubEnv("NODE_ENV", "development"); fixture.jar.set("mm_e2e_rs30", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "terminal-responsive-fixture", email: "fixture@example.com" });
    expect(fixture.claims).not.toHaveBeenCalled();
  });
  it("an opted-in guest remains unnamed and cannot inherit the account fixture", async () => {
    vi.stubEnv("NODE_ENV", "development"); fixture.jar.set("mm_e2e_rs30", "1"); fixture.jar.set("mm_e2e_guest", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "", email: "" });
    expect(fixture.claims).not.toHaveBeenCalled();
  });
});
