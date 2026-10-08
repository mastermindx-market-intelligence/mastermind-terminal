import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import ShellLayout from "@/app/(shell)/layout";
const auth = vi.hoisted(() => ({ claims: vi.fn(), guest: false }));
vi.mock("@/components/chrome/AppShell", () => ({ default: () => null }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: auth.claims } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => name === "guest" && auth.guest ? { value: "1" } : undefined }) }));
vi.mock("@/lib/layoutsFixtureDb", () => ({ GUEST_COOKIE: "guest" }));
vi.mock("@/lib/watchlistsFixtureDb", () => ({ FIXTURE_STORE_COOKIE: "store", fixtureUserId: (key: string) => "fixture-" + key }));
afterEach(() => { vi.unstubAllEnvs(); auth.guest = false; auth.claims.mockReset(); });
it("ignores fixture identity in production, even with fixture variables present", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.test");
  auth.claims.mockResolvedValue({ data: { claims: { email: "real@example.test", sub: "real-id" } } });
  const result = await ShellLayout({ children: <div /> });
  expect(result.props).toMatchObject({ email: "real@example.test", userId: "real-id" });
});
it.each([false, true])("uses the existing explicit development identity and guest cookie (%s)", async guest => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("TERMINAL_E2E_FIXTURE", "1"); vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.test");
  auth.guest = guest;
  const result = await ShellLayout({ children: <div /> });
  expect(result.props).toMatchObject({ email: guest ? "" : "fixture@example.test", userId: guest ? "" : "fixture-default" });
  expect(auth.claims).not.toHaveBeenCalled();
});
