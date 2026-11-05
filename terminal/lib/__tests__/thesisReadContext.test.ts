import { afterEach, describe, expect, it } from "vitest";
import { currentThesisReadSelection, installThesisReadSource } from "../thesisReadContext";
const thesis = "11111111-1111-4111-8111-111111111111";
const v1 = "22222222-2222-4222-8222-222222222222";
const v2 = "33333333-3333-4333-8333-333333333333";
let clear = () => {};
afterEach(() => clear());
describe("owned selected-version snapshot", () => {
  it("no ready selection is omitted", () => { clear = installThesisReadSource(() => null); expect(currentThesisReadSelection()).toBeNull(); });
  it("a frozen turn survives later history selection", () => {
    let version = v1;
    clear = installThesisReadSource(() => ({ thesis_id: thesis, version_id: version }));
    const first = currentThesisReadSelection(); version = v2;
    expect(first).toEqual({thesis_id:thesis,version_id:v1}); expect(Object.isFrozen(first)).toBe(true);
    expect(currentThesisReadSelection()?.version_id).toBe(v2);
  });
  it("old owner cleanup cannot clear replacement, new owner cleanup clears", () => {
    const old = installThesisReadSource(() => ({thesis_id:thesis,version_id:v1}));
    clear = installThesisReadSource(() => ({thesis_id:thesis,version_id:v2})); old();
    expect(currentThesisReadSelection()?.version_id).toBe(v2); clear(); expect(currentThesisReadSelection()).toBeNull();
  });
  it("malformed identities fail closed", () => {
    clear = installThesisReadSource(() => ({thesis_id:"bad",version_id:v1})); expect(currentThesisReadSelection()).toBeNull();
  });
});
