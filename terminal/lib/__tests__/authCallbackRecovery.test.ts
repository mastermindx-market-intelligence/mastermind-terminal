import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeCodeForSession = vi.hoisted(() => vi.fn());

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "@/app/auth/callback/route";
import { PASSWORD_RECOVERY_COOKIE, PASSWORD_RECOVERY_MAX_AGE_SECONDS } from "@/lib/passwordRecovery";

describe("auth callback password-recovery proof", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fixture-anon";
  });

  it("issues a short-lived HttpOnly recovery marker only after a successful exchange", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    const response = await GET(new NextRequest(
      "https://app.mastermind-x.com/auth/callback?code=recovery-code&next=%2Freset-password",
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/reset-password");
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain(`${PASSWORD_RECOVERY_COOKIE}=1`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toContain("Path=/reset-password");
    expect(cookie).toContain(`Max-Age=${PASSWORD_RECOVERY_MAX_AGE_SECONDS}`);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("never issues the recovery marker for an ordinary auth destination", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
    const response = await GET(new NextRequest(
      "https://app.mastermind-x.com/auth/callback?code=oauth-code&next=%2Fterminal",
    ));

    expect(response.headers.get("location")).toBe("/terminal");
    expect(response.headers.get("set-cookie") || "").not.toContain(`${PASSWORD_RECOVERY_COOKIE}=1`);
  });

  it("fails closed on exchange error and does not mint recovery proof", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: { message: "bad code" } });
    const response = await GET(new NextRequest(
      "https://app.mastermind-x.com/auth/callback?code=bad-code&next=%2Freset-password",
    ));

    expect(response.headers.get("location")).toBe("/login?error=oauth");
    expect(response.headers.get("set-cookie") || "").not.toContain(`${PASSWORD_RECOVERY_COOKIE}=1`);
  });
});
