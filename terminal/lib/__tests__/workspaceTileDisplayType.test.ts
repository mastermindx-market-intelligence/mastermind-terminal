// Reviewer ruling N17: WorkspaceTile's `type` prop is never re-validated after a tolerant migration
// (reviewer ruling M5) casts a stored row through `as WorkspaceEnvelope` — a hostile/corrupted row
// can carry any JSON value there. `displayType` is the one function deciding what actually reaches
// the DOM: a non-string becomes the plain word "unknown" (never `[object Object]`/`String()`
// coercion), and any string is capped at 32 chars so a hostile payload cannot turn the tile into a
// wall of text. Importing straight from the component file (not a separate lib module) — this is a
// pure function with no JSX/hook execution at import time, so no jsdom/React-rendering is needed.
import { describe, expect, it } from "vitest";
import { displayType } from "@/components/WorkspaceTile";

describe("WorkspaceTile displayType — bounds and guards a hostile widget type (reviewer ruling N17)", () => {
  it("passes a short, ordinary string through unchanged", () => {
    expect(displayType("screener")).toBe("screener");
    expect(displayType("chart")).toBe("chart");
  });

  it("truncates a 2000-char string to 32 chars", () => {
    const hostile = "x".repeat(2000);
    const result = displayType(hostile);
    expect(result).toHaveLength(32);
    expect(result).toBe("x".repeat(32));
  });

  it("truncates a string exactly at the 32-char boundary correctly (31/32/33)", () => {
    expect(displayType("y".repeat(31))).toBe("y".repeat(31));
    expect(displayType("y".repeat(32))).toBe("y".repeat(32));
    expect(displayType("y".repeat(33))).toBe("y".repeat(32));
  });

  it("an object type renders 'unknown', never [object Object]", () => {
    expect(displayType({ evil: true })).toBe("unknown");
    expect(displayType([1, 2, 3])).toBe("unknown");
  });

  it("null/undefined/number/boolean all render 'unknown'", () => {
    expect(displayType(null)).toBe("unknown");
    expect(displayType(undefined)).toBe("unknown");
    expect(displayType(123)).toBe("unknown");
    expect(displayType(true)).toBe("unknown");
  });
});
