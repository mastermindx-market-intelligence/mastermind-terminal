// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildMatrixGrid,
  StrikeExpiryMatrix,
  type MatrixMetric,
} from "@/components/shared/StrikeExpiryMatrix";

describe("Positioning matrix table semantics", () => {
  it.each<MatrixMetric>(["hedge", "oi", "vol", "doi"])(
    "does not announce an unnamed header for %s",
    (metric) => {
      const grid = buildMatrixGrid({
        matrix: {
          asof: "2026-11-10",
          expiries: ["2026-11-13", "2026-11-20"],
          strikes: [100, 105],
          cells: [
            { strike: 100, expiry: "2026-11-13", gex: 2e6, call_oi: 10, call_vol: 4, delta_oi: 2 },
            { strike: 105, expiry: "2026-11-20", gex: -1e6, put_oi: 5, put_vol: 3, delta_oi: -1 },
          ],
        },
        spot: 100,
        metric,
      });
      if (!grid) throw new Error("Expected the complete matrix fixture to render");
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(<StrikeExpiryMatrix grid={grid} metric={metric} />);
      const table = container.querySelector("table")!;
      const headers = Array.from(table.querySelectorAll("th"));
      expect(headers.every((header) => Boolean(
        header.textContent?.trim() || header.getAttribute("aria-label")?.trim(),
      ))).toBe(true);
      expect(Array.from(table.querySelectorAll('th[scope="col"]'))
        .map((header) => header.textContent)).toEqual(["11-13", "11-20"]);
      expect(table.tHead!.rows[0].cells).toHaveLength(3);
      const rows = Array.from(table.tBodies[0].rows);
      expect(rows.map((row) => row.cells[0].textContent)).toEqual(["105", "100"]);
      expect(rows.every((row) => row.cells.length === 3)).toBe(true);
      expect(rows.map((row) => Array.from(row.cells).slice(1)
        .map((cell) => Boolean(cell.textContent)))).toEqual([[false, true], [true, false]]);
    },
  );
});

