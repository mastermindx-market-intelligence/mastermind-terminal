import { describe, expect, it } from "vitest";
import { signedInWorkspacePath } from "@/lib/onboardingSigninNavigation";

describe("post-login same-origin route restoration", () => {
  it("preserves current pathname, query, and chart hash without trusting external targets", () => {
    expect(signedInWorkspacePath("/analysis", "?symbol=NVDA&page=intelligence", "#note=1"))
      .toBe("/analysis?symbol=NVDA&page=intelligence#note=1");
  });
  it("preserves the dashboard route when no optional URL pieces exist", () => {
    expect(signedInWorkspacePath("/discover", "", "")).toBe("/discover");
  });
});
