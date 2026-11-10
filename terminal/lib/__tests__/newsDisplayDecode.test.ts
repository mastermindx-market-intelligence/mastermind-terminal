// Security regression for the feed-text entity decoder in lib/newsDisplay.ts.
//
// The decoder runs at a plain React text boundary: it decodes the entities a feed
// body carries and leaves every other byte alone. It is not an HTML parser, it
// never builds markup, and it must never resolve an inherited prototype key.
//
// This suite runs in plain Node (no jsdom pragma): a decoder that reached for
// DOMParser or the DOM would have nothing to lean on here, which is the point.
import { describe, expect, it } from "vitest";

import { decodeNewsText } from "@/lib/newsDisplay";

describe("decodeNewsText — named entities", () => {
  it.each([
    ["&amp;", "&"],
    ["&apos;", "'"],
    ["&quot;", '"'],
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&nbsp;", "\u00a0"],
  ])("decodes %s", (raw, expected) => {
    expect(decodeNewsText(raw)).toBe(expected);
  });

  it("decodes inside a sentence and leaves the rest of the text alone", () => {
    expect(decodeNewsText("NVIDIA &amp; AMD &mdash; chips"))
      .toBe("NVIDIA & AMD &mdash; chips");
  });
});

describe("decodeNewsText — numeric entities", () => {
  it.each([
    ["&#65;", "A"],
    ["&#x41;", "A"],
    ["&#X41;", "A"],
    ["&#x1f680;", "\u{1f680}"],
    ["&#128640;", "\u{1f680}"],
  ])("decodes %s", (raw, expected) => {
    expect(decodeNewsText(raw)).toBe(expected);
  });
});

describe("decodeNewsText — unknown, malformed and prototype entities stay literal", () => {
  it.each([
    ["&mdash;", "an unknown named entity"],
    ["&AMP;", "an upper-case name is not in the table"],
    ["&amp", "a named entity without its semicolon"],
    ["&;", "an empty entity"],
    ["&", "a bare ampersand"],
    ["&#xZZ;", "a non-hexadecimal numeric entity"],
    ["&#;", "an empty numeric entity"],
    ["&#-1;", "a negative numeric entity"],
    ["&constructor;", "a prototype key"],
    ["&toString;", "an inherited prototype key"],
    ["&hasOwnProperty;", "another inherited prototype key"],
    ["&__proto__;", "a prototype key with underscores"],
  ])("leaves %s literal (%s)", (raw) => {
    expect(decodeNewsText(raw)).toBe(raw);
  });
});

describe("decodeNewsText — out-of-range code points stay literal", () => {
  it.each([
    ["&#0;", "the null code point"],
    ["&#x0;", "the null code point in hexadecimal"],
    ["&#xD800;", "a high surrogate"],
    ["&#xDFFF;", "a low surrogate"],
    ["&#55296;", "a high surrogate in decimal"],
    ["&#1114112;", "one past the last code point"],
    ["&#x110000;", "one past the last code point in hexadecimal"],
    ["&#99999999999;", "a number far past the last code point"],
  ])("leaves %s literal (%s)", (raw) => {
    expect(decodeNewsText(raw)).toBe(raw);
  });
});

describe("decodeNewsText — one pass, plain text, no markup", () => {
  it("decodes a nested entity only once", () => {
    expect(decodeNewsText("&amp;lt;")).toBe("&lt;");
    expect(decodeNewsText("&amp;amp;")).toBe("&amp;");
  });

  it("returns decoded angle brackets as characters, never as markup", () => {
    expect(decodeNewsText("&lt;script&gt;alert(1)&lt;/script&gt;"))
      .toBe("<script>alert(1)</script>");
  });

  it("leaves a string without entities exactly as it was", () => {
    const raw = "Nvidia raises outlook — 3 & counting";
    expect(decodeNewsText(raw)).toBe(raw);
  });

  it("decodes in plain Node, with no DOM to lean on", () => {
    expect(typeof document).toBe("undefined");
    expect(decodeNewsText("&amp;")).toBe("&");
  });
});
