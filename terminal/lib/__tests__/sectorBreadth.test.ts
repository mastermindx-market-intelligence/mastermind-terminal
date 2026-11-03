import { describe, expect, it } from "vitest";
import { breadthRegime, breadthOvertakes, type BreadthSector } from "../sectorBreadth";

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

// Participation and trend are independent: a sector can still be narrow as it improves.
describe("sector breadth rotation groups", () => {
  it.each([
    [40, 80, "broad-up"], [90, 80, "broad-down"],
    [10, 40, "narrow-up"], [45, 40, "narrow-down"],
    [30, 50, "even"], [50, 50, "even"], [75, 75, "flat"], [30, 30, "flat"],
  ] as const)("classifies %s → %s without turning a boundary into a signal", (start,end,group) => {
    expect(breadthRegime(peer("s",[start,40,40,40,40,end]),5)).toBe(group);
  });
  it("changes with the selected horizon and withholds a group for a snapshot or missing reading", () => {
    const s=peer("s",[20,40,40,40,80,60]);
    expect(breadthRegime(s,1)).toBe("broad-down");
    expect(breadthRegime(s,5)).toBe("broad-up");
    expect(breadthRegime({...s,history:[]},1)).toBe("unknown");
    expect(breadthRegime({...s,pct:null},5)).toBe("unknown");
  });
});
