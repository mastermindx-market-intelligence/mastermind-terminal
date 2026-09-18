import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fixtureUserId, FIXTURE_STORE_COOKIE } from "../watchlistsFixtureDb";
import { GUEST_COOKIE } from "../layoutsFixtureDb";
const auth = vi.hoisted(() => ({ claims: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: auth.claims } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: auth.cookie }) }));
vi.mock("@/components/chrome/AppShell", () => ({ default: () => null }));
import ShellLayout from "../../app/(shell)/layout";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  vi.stubEnv("TERMINAL_E2E_EMAIL", "responsive@example.com");
  auth.cookie.mockReturnValue({ value: "support-context-proof" });
  auth.claims.mockResolvedValue({ data: { claims: { email: "real@example.com", sub: "real-subject" } } });
  auth.claims.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

it("uses the existing cookie-scoped fixture owner in the non-chart test shell", async () => {
  const el = await ShellLayout({ children: null });
  expect(el.props.userId).toBe(fixtureUserId("support-context-proof"));
  expect(el.props.email).toBe("responsive@example.com");
  expect(auth.claims).not.toHaveBeenCalled();
});
it("never enables the fixture owner in production, even when flags are set", async () => {
  vi.stubEnv("NODE_ENV", "production");
  const el = await ShellLayout({ children: null });
  expect(el.props.userId).toBe("real-subject");
  expect(el.props.email).toBe("real@example.com");
  expect(auth.claims).toHaveBeenCalledTimes(1);
});
it("keeps real identity resolution when the fixture flag is absent", async () => {
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "0");
  const el = await ShellLayout({ children: null });
  expect(el.props.userId).toBe("real-subject");
  expect(auth.claims).toHaveBeenCalledTimes(1);
});
it("honors the existing explicit guest cookie in the fixture shell", async () => {
  auth.cookie.mockImplementation((name: string) => name === GUEST_COOKIE ? { value: "1" } : name === FIXTURE_STORE_COOKIE ? { value: "support-context-proof" } : undefined);
  const el = await ShellLayout({ children: null });
  expect(el.props.email).toBe("");
  expect(el.props.userId).toBe("");
  expect(auth.claims).not.toHaveBeenCalled();
});
