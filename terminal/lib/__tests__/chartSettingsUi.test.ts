import { describe, expect, it } from "vitest";
import { colorInputHex, commitNumber, parseSettingTemplates, previewNumber } from "@/lib/chartSettingsUi";

describe("native chart color inputs", () => {
  it.each([
    ["#ABC", "#aabbcc"], ["#abcd", "#aabbcc"], ["#ABCDEF", "#abcdef"],
    ["#abcdef09", "#abcdef"], ["rgba(255,255,255,.04)", "#ffffff"],
    ["rgb(12, 34, 56)", "#0c2238"], ["rgb(12 34 56 / 0.5)", "#0c2238"],
    ["rgb(100% 50% 0%)", "#ff8000"], ["rgba(255, 0, 128, 20%)", "#ff0080"],
    ["rgb(999, 0, 0)", "#ff0000"], ["  #abc  ", "#aabbcc"],
  ])("normalizes %s without passing invalid CSS into type=color", (source, hex) => {
    expect(colorInputHex(source)).toBe(hex);
  });
  it.each(["", "not-a-color", "#zzzzzz", "rgba(foo)", "rgb(... 0 1)", "#1"])("uses the supplied fallback for %s", (input) => {
    expect(colorInputHex(input, "#294cff")).toBe("#294cff");
  });
  it("fails safely when both values are invalid", () => expect(colorInputHex("?", "?")).toBe("#000000"));
});

describe("editable chart margins", () => {
  it.each(["", " ", "-", "NaN", "Infinity", "1e309", "-1", "51"])("does not preview incomplete/out-of-range %s", (input) => {
    expect(previewNumber(input, 0, 50)).toBeNull();
  });
  it.each([["0", 0], ["12", 12], ["50", 50], ["2.5", 2.5]])("previews finite %s", (input, number) => {
    expect(previewNumber(String(input), 0, 50)).toBe(number);
  });
  it.each(["", " ", "NaN", "Infinity", "1e309"])("reverts %s instead of changing the chart to zero", (raw) => {
    expect(commitNumber(raw, 12, 0, 50)).toBe(12);
  });
  it("clamps only on commit", () => {
    expect(commitNumber("51", 12, 0, 50)).toBe(50);
    expect(commitNumber("-5", 12, 0, 50)).toBe(0);
  });
});

describe("stored chart setting templates", () => {
  const defaults = { autoScale: true, rightOffsetBars: 12, backgroundType: "solid" };
  it.each([null, "bad json", "[]", "null", "5", '"text"'])("recovers malformed root %s", (raw) => {
    expect(parseSettingTemplates(raw, defaults)).toEqual({});
  });
  it("preserves supported partial templates and ignores unknown fields", () => {
    expect(parseSettingTemplates('{"My chart":{"autoScale":false,"injected":true}}', defaults)).toEqual({ "My chart": { autoScale: false } });
  });
  it("discards arrays, primitive templates, wrong types and non-finite numbers", () => {
    const result = parseSettingTemplates('{"bad":null,"array":[],"string":"wrong","ok":{"autoScale":"true","rightOffsetBars":1e309,"backgroundType":"gradient"}}', defaults);
    expect(result).toEqual({ ok: { backgroundType: "gradient" } });
  });
  it("supports reserved-looking user names without prototype pollution", () => {
    const parsed = parseSettingTemplates('{"__save":{"rightOffsetBars":4},"__proto__":{"autoScale":false}}', defaults);
    expect(Object.hasOwn(parsed, "__save")).toBe(true);
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).autoScale).toBeUndefined();
  });
});
