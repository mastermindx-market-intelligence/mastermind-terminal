import { describe, expect, it } from "vitest";
import { sameElements } from "@/lib/elementStableList";

describe("sameElements", () => {
  const a = { id: "a" }, b = { id: "b" };

  it("is true only for the very same objects in the same order", () => {
    expect(sameElements([a, b], [a, b])).toBe(true);
    expect(sameElements([], [])).toBe(true);
  });

  it("treats an equal-looking copy, a reorder, an addition or a removal as a change", () => {
    expect(sameElements([a, b], [{ ...a }, b])).toBe(false);
    expect(sameElements([a, b], [b, a])).toBe(false);
    expect(sameElements([a], [a, b])).toBe(false);
    expect(sameElements([a, b], [a])).toBe(false);
  });
});
