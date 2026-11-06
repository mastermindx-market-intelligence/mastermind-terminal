import { describe, expect, it } from "vitest";
import { researchOutline, sourcePageDestinations } from "../shared-shell/researchOutline";
const outline = [
  { segment_index: 0, page_start: 1, page_end: 1 },
  { segment_index: 1, page_start: 1, page_end: 1 },
  { segment_index: 2, page_start: 2, page_end: 3 },
];
describe("supplied Research source-page outline", () => {
  it("keeps the old backend distinct from a valid empty document", () => {
    expect(researchOutline(undefined, 3, outline.slice(0, 2))).toBeUndefined();
    expect(researchOutline([], 0, [])).toEqual([]);
    expect(researchOutline(null, 0, [])).toBeNull();
  });
  it("accepts a complete exact range map and keeps only source-page destinations", () => {
    expect(researchOutline(outline, 3, outline.slice(1))).toEqual(outline);
    expect(sourcePageDestinations(outline)).toEqual([outline[0], outline[2]]);
  });
  it.each([
    [], outline.slice(0, 2), [outline[1], outline[0], outline[2]],
    [outline[0], outline[0], outline[2]],
    [outline[0], outline[1], { ...outline[2], page_start: -1 }],
    [outline[0], outline[1], { ...outline[2], page_end: 1 }],
    [outline[0], outline[1], { ...outline[2], page_start: 1.5 }],
    [outline[0], outline[1], { ...outline[2], segment_index: "2" }],
  ].map(candidate => ({ candidate })))("rejects supplied partial, reordered or malformed maps", ({ candidate }) => {
    expect(researchOutline(candidate, 3, outline.slice(0, 1))).toBeNull();
  });
  it("requires positive source-ordered pages while preserving repeats and overlaps", () => {
    const valid = [{segment_index:0,page_start:1,page_end:2},{segment_index:1,page_start:1,page_end:3},{segment_index:2,page_start:2,page_end:3}];
    expect(researchOutline(valid,3,valid)).toEqual(valid);
    expect(researchOutline([{segment_index:0,page_start:0,page_end:1}],1,[])).toBeNull();
    expect(researchOutline([{segment_index:0,page_start:2,page_end:3},{segment_index:1,page_start:1,page_end:3}],2,[])).toBeNull();
    expect(researchOutline([{segment_index:0,page_start:1,page_end:3},{segment_index:1,page_start:2,page_end:2}],2,[])).toBeNull();
  });
  it("rejects a map that disagrees with any visible source segment", () => {
    expect(researchOutline(outline, 3, [{ segment_index: 2, page_start: 3, page_end: 3 }])).toBeNull();
    expect(researchOutline(outline, 3, [{ segment_index: 3, page_start: 2, page_end: 3 }])).toBeNull();
  });
});
