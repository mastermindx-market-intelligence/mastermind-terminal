import { describe, expect, it } from "vitest";
import { sharedShellActiveKey } from "@/lib/sharedShellNavigation";

describe("Shared Shell native job identity", () => {
  it("selects the actual native Today destination", () => {
    expect(sharedShellActiveKey("/today")).toBe("shellToday");
  });

  it.each([
    "/crypto.html",
    "/vector.html",
    "/vector_allocation.html",
    "/macro.html",
    "/commodities.html",
    "/bonds.html",
    "/theme_tree.html",
    "/",
    "/today-report.html",
    "/future-tool.html",
  ])("does not present an unrelated tool as the native Today page: %s", path => {
    expect(sharedShellActiveKey(path)).toBe("");
  });
});
