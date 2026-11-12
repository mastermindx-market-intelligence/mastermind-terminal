import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/auth/callback/route";
import { safeAuthNext, sharedShellSignupRedirect, loginSheetHref } from "@/lib/supabase/redirects";

afterEach(() => { vi.unstubAllEnvs(); });

describe("same-origin auth callback and beta confirmation return", () => {
  it("defaults the beta callback to Today but preserves explicit investigation and reading URLs", async () => {
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    expect((await GET(new NextRequest("https://beta.mastermind-x.com/auth/callback"))).headers.get("location")).toBe("/today");
    for (const next of ["/analysis?symbol=AAPL&ci_event=event-1&ci_generation=g1#source", "/research?doc_id=report-1&source_pdf_sha256="+"a".repeat(64)+"&segment_start=2#reader", "/macro.html"]) {
      const url=new URL("https://beta.mastermind-x.com/auth/callback");url.searchParams.set("next",next);
      expect((await GET(new NextRequest(url))).headers.get("location")).toBe(next);
    }
  });
  it("opens the existing sign-in sheet at a safe explicit context or the profile default", () => {
    expect(loginSheetHref(null,"/today")).toBe("/today?signin=1");
    expect(loginSheetHref("//untrusted.example","/terminal")).toBe("/terminal?signin=1");
    expect(loginSheetHref("/analysis?symbol=AAPL&q=a%20b&q=a+b#source","/today")).toBe("/analysis?symbol=AAPL&q=a%20b&q=a+b&signin=1#source");
  });
  it.each([
    "https://foreign.example/path", "//foreign.example/path", "/\\foreign.example/path",
    "/\t/foreign.example/path", "/\n/foreign.example/path", "terminal", "",
  ])("refuses browser-normalized external or malformed next %j", async (next) => {
    vi.stubEnv("MMX_SHARED_SHELL", "1");
    const url = new URL("https://beta.mastermind-x.com/auth/callback");
    url.searchParams.set("next", next);
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/today");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["/macro.html", "/analysis?symbol=BRK.B", "/reset-password", "/stock.html#NVDA"])(
    "preserves an admitted same-origin next %s", (next) => {
      expect(safeAuthNext(next, "/terminal")).toBe(next);
    },
  );

  it("retains the ordinary app fallback and exact beta flag behavior", async () => {
    vi.stubEnv("MMX_SHARED_SHELL", "0");
    const response = await GET(new NextRequest("https://app.mastermind-x.com/auth/callback?next=//foreign.example"));
    expect(response.headers.get("location")).toBe("/terminal");
  });

  it("routes beta signup through its callback without copying query or hash material", () => {
    const redirect = new URL(sharedShellSignupRedirect("https://beta.mastermind-x.com", "/analysis")!);
    expect(redirect.origin + redirect.pathname).toBe("https://beta.mastermind-x.com/auth/callback");
    expect(redirect.searchParams.get("next")).toBe("/analysis?onboard=resume");
    expect(sharedShellSignupRedirect("https://beta.mastermind-x.com", "/macro.html?access_token=secret#code"))
      .not.toContain("secret");
    expect(sharedShellSignupRedirect("https://beta.mastermind-x.com", "//foreign.example"))
      .toBe("https://beta.mastermind-x.com/auth/callback?next=%2Ftoday%3Fonboard%3Dresume");
  });

  it.each(["https://app.mastermind-x.com", "https://www.mastermind-x.com", "http://localhost:3000",
    "https://beta.mastermind-x.com.foreign.example"])("keeps the existing signup behavior on %s", (origin) => {
    expect(sharedShellSignupRedirect(origin, "/terminal")).toBeUndefined();
  });
});
