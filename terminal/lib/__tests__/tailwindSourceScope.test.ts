// tailwindSourceScope.test.ts — `next build` runs app/globals.css through @tailwindcss/postcss
// with the terminal directory as its cwd, and Tailwind's automatic source detection reads every
// file there that no ignore rule excludes. public/data is the generated market-data cache (about
// 89k files on the VPS) and no committed ignore file covers it, so the deploy build scanned all of
// it inside that one PostCSS step. The step then outlasted Turbopack's 5-minute worker deadline
// and panicked the build. globals.css opts the directory out with `@source not`.
//
// This runs the real plugin over the real stylesheet and tree, the way the build does, and reads
// which files were scanned from the dependency message the plugin reports for each one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, sep } from "path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const TERMINAL = join(__dirname, "..", "..");
const GLOBALS = join(TERMINAL, "app", "globals.css");

describe("Tailwind source detection", () => {
  it("scans the app's source but none of the public/data market-data cache", async () => {
    const result = await postcss([tailwindcss({ base: TERMINAL })]).process(readFileSync(GLOBALS, "utf8"), { from: GLOBALS });
    const scanned = result.messages.filter((m) => m.type === "dependency").map((m) => m.file as string);

    expect(scanned).toContain(join(TERMINAL, "app", "layout.tsx"));
    expect(scanned.filter((f) => f.startsWith(join(TERMINAL, "public", "data") + sep))).toEqual([]);
  }, 30_000);
});
