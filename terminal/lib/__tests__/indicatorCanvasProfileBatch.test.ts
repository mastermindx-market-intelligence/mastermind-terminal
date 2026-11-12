// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderPrims } from "@/lib/indicator-canvas/render";
import type { CoordMapper, ProfilePrim, SuiteRenderBundle } from "@/lib/indicator-canvas/types";

const m: CoordMapper = { xi:i=>i*10, y:p=>200-p*10, W:400, H:220, i0:0, i1:20, barW:10 };

function bundle(profile: ProfilePrim): SuiteRenderBundle {
  return { prims:[profile], tooltips:new Map(), candlePaint:[], events:[], tables:[] };
}

describe("indicator-canvas profile batching", () => {
  it("batches only unlabeled vertically-disjoint bins and keeps labeled bins in-order", () => {
    const wrap=document.createElement("div");
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    wrap.appendChild(svg); document.body.appendChild(wrap);
    const p:ProfilePrim={
      kind:"profile",id:"p",side:"right",maxPx:100,
      bins:[
        {p1:1,p2:2,frac:.5,color:"red",alpha:.4,overlayFrac:.2,overlayColor:"green"},
        {p1:2,p2:3,frac:.8,color:"red",alpha:.4,overlayFrac:.3,overlayColor:"green"},
        {p1:3,p2:4,frac:.6,color:"blue",alpha:.5,overlayFrac:.25,overlayColor:"green",label:"60%"},
        {p1:4,p2:5,frac:.7,color:"red",alpha:.4,overlayFrac:.1,overlayColor:"green"},
        {p1:5,p2:6,frac:.4,color:"blue",alpha:.5,overlayFrac:.2,overlayColor:"green"},
      ],
    };
    renderPrims(svg,bundle(p),m);

    const children=[...svg.querySelector("g")!.children];
    const tags=children.map(el=>el.tagName.toLowerCase());
    // First two unlabeled bins collapse to base+overlay paths. The labeled middle bin remains
    // rect, rect, text. Final two unlabeled bins collapse again, preserving the label boundary.
    expect(tags).toEqual(["path","path","rect","rect","text","path","path","path"]);
    const paths=children.filter(el=>el.tagName.toLowerCase()==="path");
    expect(paths.reduce((n,p)=>n+((p.getAttribute("d")||"").match(/M/g)?.length??0),0)).toBe(8);
    expect(children[2].getAttribute("fill")).toBe("blue");
    expect(children[3].getAttribute("fill")).toBe("green");
    expect(children[4].textContent).toBe("60%");
    wrap.remove();
  });

  it("falls back to individual rects when projected bins overlap", () => {
    const wrap=document.createElement("div");
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    wrap.appendChild(svg); document.body.appendChild(wrap);
    const p:ProfilePrim={
      kind:"profile",id:"p2",side:"right",maxPx:80,
      bins:[
        {p1:1,p2:3,frac:.5,color:"red",alpha:.4},
        {p1:2,p2:4,frac:.8,color:"red",alpha:.4},
      ],
    };
    renderPrims(svg,bundle(p),m);
    expect(svg.querySelectorAll("path")).toHaveLength(0);
    expect(svg.querySelectorAll("rect")).toHaveLength(2);
    wrap.remove();
  });
});
