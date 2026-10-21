import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const signOut = vi.hoisted(() => vi.fn());
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: unknown) => {
    (globalThis as typeof globalThis & { signOutCookieSink?: unknown }).signOutCookieSink = options;
    return { auth: { signOut } };
  },
}));

import { POST } from "@/app/auth/signout/route";

describe("Terminal ordinary sign-out", () => {
  beforeEach(() => {
    signOut.mockReset();
    delete process.env.NEXT_PUBLIC_MM_AUTH_COOKIE_DOMAIN;
    signOut.mockResolvedValue({ error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  });

  it("revokes only the current session and preserves the existing same-origin redirect", async () => {
    const response = await POST(new NextRequest("https://app.mastermind-x.com/auth/signout", { method: "POST" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/login");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("expires parent-domain and host-only chunked session cookies even if Auth fails", async () => {
    process.env.NEXT_PUBLIC_MM_AUTH_COOKIE_DOMAIN = ".mastermind-x.com";
    signOut.mockResolvedValueOnce({ error: { status: 503 } });
    const request = new NextRequest("https://app.mastermind-x.com/auth/signout", {
      method: "POST",
      headers: { Cookie: "sb-project-auth-token.0=chunk; sb-project-auth-token-code-verifier=challenge; unrelated=keep" },
    });
    const response = await POST(request);
    const cookies = response.headers.getSetCookie();
    expect(response.status).toBe(303);
    expect(cookies).toHaveLength(4);
    expect(cookies.filter((c) => /domain=\.?mastermind-x\.com/i.test(c))).toHaveLength(2);
    expect(cookies.filter((c) => !/domain=/i.test(c))).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/max-age=0/i);
      expect(cookie).not.toContain("unrelated");
    }
  });

  it("clears the current cookies when signOut throws instead of redirecting with a live session", async () => {
    signOut.mockRejectedValueOnce(new Error("Auth service offline"));
    const request = new NextRequest("https://app.mastermind-x.com/auth/signout", {
      method: "POST",
      headers: { Cookie: "sb-project-auth-token=old-session" },
    });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(response.headers.getSetCookie().some((c) => c.includes("sb-project-auth-token="))).toBe(true);
  });

});
