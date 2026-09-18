import { describe, expect, it } from "vitest";
import { resolveSnapshotSurface } from "../chartSnapshotTheme";

describe("resolveSnapshotSurface", () => {
  const base = {
    paneBackgroundImage: "none",
    paneBackgroundColor: "rgb(19, 23, 34)",
    chartBackground: "#131722",
    pageBackground: "#0a0b0e",
  };

  it("uses the visible pane surface instead of the page background for the default transparent chart", () => {
    expect(resolveSnapshotSurface(base)).toEqual({
      kind: "solid",
      topColor: "rgb(19, 23, 34)",
      bottomColor: "rgb(19, 23, 34)",
    });
  });

  it("preserves an explicit solid chart background", () => {
    expect(resolveSnapshotSurface({
      ...base,
      backgroundType: "solid",
      backgroundTop: "#20344a",
    })).toEqual({
      kind: "solid",
      topColor: "#20344a",
      bottomColor: "#20344a",
    });
  });

  it("preserves an explicit vertical gradient chart background", () => {
    expect(resolveSnapshotSurface({
      ...base,
      backgroundType: "gradient",
      backgroundTop: "#25364a",
      backgroundBottom: "#111827",
    })).toEqual({
      kind: "gradient",
      topColor: "#25364a",
      bottomColor: "#111827",
    });
  });

  it("inherits the native-shell pane gradient when chart settings stay transparent", () => {
    expect(resolveSnapshotSurface({
      ...base,
      paneBackgroundImage: "linear-gradient(rgb(24, 27, 38) 0%, rgb(19, 22, 33) 100%)",
      paneBackgroundColor: "rgba(0, 0, 0, 0)",
    })).toEqual({
      kind: "gradient",
      topColor: "rgb(24, 27, 38)",
      bottomColor: "rgb(19, 22, 33)",
    });
  });
});
