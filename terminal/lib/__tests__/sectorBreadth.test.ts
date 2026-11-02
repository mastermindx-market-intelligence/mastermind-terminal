import { describe, expect, it } from "vitest";
import { breadthOvertakes, type BreadthSector } from "../sectorBreadth";

function peer(id: string, history: number[]): BreadthSector {
  return {row:{id}, pct: history[5] ?? null, history, adv:null, dec:null, flat:null, matched:null, eligible:null};
}

describe("observed five-session sector overtakes", () => {
  it("requires a reversal from the start and a strict lead at both final closes", () => {
    const selected = peer("selected",[40, 44, 50, 52, 60, 70]);
    const overtaken = peer("overtaken",[50, 51, 52, 53, 54, 55]);
    const late = peer("one-close-flip",[45, 50, 52, 54, 65, 65]);
    const tied = peer("started-tied",[40, 42, 44, 45, 46, 50]);
    const missing = peer("low-coverage",[]);
    const fellBehind = peer("fell-behind",[30, 45, 55, 60, 65, 75]);
    expect(breadthOvertakes(selected,[selected,overtaken,late,tied,missing,fellBehind]))
      .toEqual({ahead:[overtaken.row],behind:[fellBehind.row]});
    expect(breadthOvertakes(missing,[selected])).toEqual({ahead:[],behind:[]});
  });
});
