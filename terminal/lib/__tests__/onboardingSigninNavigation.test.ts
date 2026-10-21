import { describe, expect, it } from "vitest";
import { signedInWorkspacePath } from "@/lib/onboardingSigninNavigation";

describe("post-login same-origin route restoration", () => {
  it("preserves current pathname, query, and chart hash without trusting external targets", () => {
    expect(signedInWorkspacePath("/analysis", "?symbol=NVDA&page=intelligence", "#note=1"))
      .toBe("/analysis?symbol=NVDA&page=intelligence#note=1");
  });
  it("never interprets a network-path or backslash-prefixed pathname as another origin", () => {
    for (const path of ["//outside.example/login", "///outside.example/login", "/\\outside.example/login"]) {
      const url = signedInWorkspacePath(path, "?from=analysis", "#chart");
      expect(url.startsWith("//")).toBe(false);
      expect(new URL(url, "https://app.mastermind-x.com").origin).toBe("https://app.mastermind-x.com");
    }
  });
  it("preserves the dashboard route when no optional URL pieces exist", () => {
    expect(signedInWorkspacePath("/discover", "", "")).toBe("/discover");
  });
});
