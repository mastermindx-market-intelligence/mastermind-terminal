import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import ShellLayout from "@/app/(shell)/layout";
import { fixtureUserId } from "@/lib/watchlistsFixtureDb";

const auth = vi.hoisted(() => ({ claims: vi.fn(), guest: false, signedFixture: false }));
vi.mock("@/components/chrome/AppShell", () => ({ default: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: auth.claims } }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "mm_e2e_rs30" && auth.signedFixture) return { value: "1" };
      if (name === "mm_e2e_guest" && auth.guest) return { value: "1" };
      return undefined;
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  auth.guest = false;
  auth.signedFixture = false;
  auth.claims.mockReset();
});

it("ignores all fixture variables and cookies in production and verifies real account claims", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.test");
  auth.signedFixture = true;
  auth.guest = true;
  auth.claims.mockResolvedValue({ data: { claims: { email: "real@example.test", sub: "22222222-2222-4222-8222-222222222222" } } });
  const result = await ShellLayout({ children: <div /> });
  expect(result.props).toMatchObject({ email: "real@example.test", userId: "22222222-2222-4222-8222-222222222222" });
  expect(auth.claims).toHaveBeenCalledOnce();
});

it("does not grant dev fixture identity from environment variables without exact opt-in cookie", async () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.test");
  auth.guest = true;
  auth.signedFixture = false;
  auth.claims.mockResolvedValue({ data: { claims: { email: "verified@example.test", sub: "33333333-3333-4333-8333-333333333333" } } });
  const result = await ShellLayout({ children: <div /> });
  expect(result.props).toMatchObject({ email: "verified@example.test", userId: "33333333-3333-4333-8333-333333333333" });
  expect(auth.claims).toHaveBeenCalledOnce();
});

it.each([false, true])("accepts the existing development-only fixture opt-in and guest cookie (%s)", async guest => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TERMINAL_E2E_FIXTURE", "1");
  vi.stubEnv("TERMINAL_E2E_EMAIL", "fixture@example.test");
  auth.signedFixture = true;
  auth.guest = guest;
  const result = await ShellLayout({ children: <div /> });
  expect(result.props).toMatchObject({
    email: guest ? "" : "fixture@example.test",
    userId: guest ? "" : fixtureUserId("default"),
  });
  expect(auth.claims).not.toHaveBeenCalled();
});
