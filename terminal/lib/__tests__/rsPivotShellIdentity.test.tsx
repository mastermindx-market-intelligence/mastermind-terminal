import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShellLayout from "@/app/(shell)/layout";
import { fixtureUserId, FIXTURE_STORE_COOKIE } from "@/lib/watchlistsFixtureDb";

const fixture = vi.hoisted(() => ({ jar: new Map<string, string>(), claims: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => fixture.jar.has(name) ? { value: fixture.jar.get(name) } : undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: fixture.claims } }) }));
vi.mock("@/components/chrome/AppShell", () => ({ default: () => null }));

beforeEach(() => {
  fixture.jar.clear(); fixture.claims.mockReset();
  fixture.claims.mockResolvedValue({ data: { claims: { sub: "11111111-1111-4111-8111-111111111111", email: "verified@example.com" } } });
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("research shell fixture stays outside production and unrelated suites", () => {
  it("production ignores both fixture flags and a forged fixture guest cookie", async () => {
    vi.stubEnv("NODE_ENV", "production"); fixture.jar.set("mm_e2e_rs30", "1"); fixture.jar.set("mm_e2e_guest", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "11111111-1111-4111-8111-111111111111", email: "verified@example.com" });
    expect(fixture.claims).toHaveBeenCalledOnce();
  });
  it("unrelated development suites retain their existing verified-claims identity", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "11111111-1111-4111-8111-111111111111", email: "verified@example.com" });
    expect(fixture.claims).toHaveBeenCalledOnce();
  });
  it("only explicitly opted-in development research tests receive the account fixture", async () => {
    vi.stubEnv("NODE_ENV", "development"); fixture.jar.set("mm_e2e_rs30", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: fixtureUserId("default"), email: "fixture@example.com" });
    expect(fixture.claims).not.toHaveBeenCalled();
  });
  it.each(["actor-a", "actor-b", "shared-database::actor-a"])("shares the Terminal synthetic actor for %s", async key => {
    vi.stubEnv("NODE_ENV", "development"); fixture.jar.set("mm_e2e_rs30", "1"); fixture.jar.set(FIXTURE_STORE_COOKIE, key);
    const view = await ShellLayout({ children: null });
    expect(view.props.userId).toBe(fixtureUserId(key)); expect(fixture.claims).not.toHaveBeenCalled();
  });
  it("ignores an opted-in cookie when the fixture flag is disabled", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "0"); fixture.jar.set("mm_e2e_rs30", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props.userId).toBe("11111111-1111-4111-8111-111111111111"); expect(fixture.claims).toHaveBeenCalledOnce();
  });
  it("an opted-in guest remains unnamed and cannot inherit the account fixture", async () => {
    vi.stubEnv("NODE_ENV", "development"); fixture.jar.set("mm_e2e_rs30", "1"); fixture.jar.set("mm_e2e_guest", "1");
    const view = await ShellLayout({ children: null });
    expect(view.props).toMatchObject({ userId: "", email: "" });
    expect(fixture.claims).not.toHaveBeenCalled();
  });
});
