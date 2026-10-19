// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type { CloudPrim, CoordMapper, SuiteRenderBundle } from "@/lib/indicator-canvas/types";

function bundle(cloud: CloudPrim): SuiteRenderBundle {
  return { prims:[cloud], tooltips:new Map(), candlePaint:[], events:[], tables:[] };
}

const cloud: CloudPrim = {
  kind:"cloud",
  id:"c",
  upper:Array.from({length:7},(_,i)=>({i,p:8})),
  lower:Array.from({length:7},(_,i)=>({i,p:4})),
  segColors:["red","red","blue","red","red","blue"],
  fillAlpha:.2,
};

describe("indicator-canvas cloud batching", () => {
  it("packs repeated disjoint color runs into one compound path per color", () => {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    document.body.appendChild(svg);
    const m:CoordMapper={xi:i=>i*10,y:p=>100-p,W:100,H:100,i0:0,i1:6,barW:10};
    renderPrims(svg,bundle(cloud),m);

    expect(svg.querySelectorAll("polygon"), "one polygon per color run is the node-cost defect").toHaveLength(0);
    const paths=[...svg.querySelectorAll("path")];
    expect(paths).toHaveLength(2);
    const keyed=new Map(paths.map(p=>[p.getAttribute("fill"),p.getAttribute("d")||""]));

    const red=keyed.get("red")||"";
    const blue=keyed.get("blue")||"";
    expect((red.match(/M/g)||[])).toHaveLength(2);
    expect((blue.match(/M/g)||[])).toHaveLength(2);
    expect(red).toContain("M0 92L10 92L20 92L20 96L10 96L0 96Z");
    expect(red).toContain("M30 92L40 92L50 92L50 96L40 96L30 96Z");
    expect(blue).toContain("M20 92L30 92L30 96L20 96Z");
    expect(blue).toContain("M50 92L60 92L60 96L50 96Z");
    for(const path of paths) expect(path.getAttribute("fill-opacity")).toBe("0.2");
    svg.remove();
  });

  it("keeps historical polygon order when projected X is non-monotonic", () => {
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    document.body.appendChild(svg);
    const m:CoordMapper={
      xi:i=>i===3?15:i*10,
      y:p=>100-p,W:100,H:100,i0:0,i1:6,barW:10,
    };
    renderPrims(svg,bundle(cloud),m);
    expect(svg.querySelectorAll("path")).toHaveLength(0);
    expect([...svg.querySelectorAll("polygon")].map(p=>p.getAttribute("fill")))
      .toEqual(["red","blue","red","blue"]);
    svg.remove();
  });
});
