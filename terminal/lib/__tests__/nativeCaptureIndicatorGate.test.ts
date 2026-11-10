import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Box = { x: number; y: number; width: number; height: number };
type Producer = {
  cropBoxes(page: unknown, boxes: Box[], outPath: string, pad: number): Promise<void>;
};
const producers: [string, Producer][] = [
  ["GEX", require("../../e2e/tools/capture_gex_levels_heatmap_load_failure.cjs")],
  ["EOD", require("../../e2e/tools/capture_eod_heatmap_flowdesk_load_failure.cjs")],
];

function fixture(indicators: number | Error) {
  const events: string[] = [];
  const screenshots: unknown[] = [];
  const page = {
    viewportSize: () => ({ width: 390, height: 844 }),
    waitForTimeout: async (milliseconds: number) => { events.push(`wait:${milliseconds}`); },
    locator: (selector: string) => {
      expect(selector).toBe("[data-nextjs-dev-tools-button]");
      return { count: async () => {
        events.push("inspect");
        if (indicators instanceof Error) throw indicators;
        return indicators;
      } };
    },
    evaluate: async () => { throw new Error("Capture must not remove or hide the DOM"); },
    screenshot: async (options: unknown) => { events.push("screenshot"); screenshots.push(options); },
  };
  return { page, events, screenshots };
}

for (const [name, producer] of producers) {
  describe(`${name} accepted native crop verifies the unmodified DOM first`, () => {
    const boxes = [{ x: 20, y: 30, width: 100, height: 80 }];

    it("refuses a mounted dev indicator before writing any screenshot", async () => {
      const { page, events, screenshots } = fixture(1);
      await expect(producer.cropBoxes(page, boxes, "frame.png", 4)).rejects.toThrow("TERMINAL_E2E_FIXTURE gate failed");
      expect(events).toEqual(["wait:400", "inspect"]);
      expect(screenshots).toEqual([]);
    });

    it("captures the unchanged crop after observing no dev indicator", async () => {
      const { page, events, screenshots } = fixture(0);
      await producer.cropBoxes(page, boxes, "frame.png", 4);
      expect(events).toEqual(["wait:400", "inspect", "screenshot"]);
      expect(screenshots).toEqual([{
        path: "frame.png",
        clip: { x: 16, y: 26, width: 108, height: 88 },
        animations: "disabled",
      }]);
    });

    it("refuses a screenshot when indicator inspection itself fails", async () => {
      const { page, screenshots } = fixture(new Error("DOM read failed"));
      await expect(producer.cropBoxes(page, boxes, "frame.png", 4)).rejects.toThrow("DOM read failed");
      expect(screenshots).toEqual([]);
    });
  });
}
