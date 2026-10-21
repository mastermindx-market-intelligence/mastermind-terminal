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
});
