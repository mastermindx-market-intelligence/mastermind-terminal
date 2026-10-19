import { describe, expect, it } from "vitest";
import {
  LATIN_PROBE_CODE_POINT, familyNames, matchingFaces, paintingFaces, plainFamily, unicodeRangeCovers, type FaceLike,
} from "@/lib/fontFaces";

// The Terminal's font lists and next/font's Inter faces, as the browser reports them (E19).
const FONT_UI = '-apple-system,BlinkMacSystemFont,"Inter", "Inter Fallback","Segoe UI",Roboto,sans-serif';
const FONT_NUM = '"Inter", "Inter Fallback",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif';
const LATIN = "U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+304, U+308, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_AS_AUTHORED = "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const LATIN_EXT = "U+100-2BA, U+2BD-2C5, U+2C7-2CC, U+2CE-2D7, U+2DD-2FF, U+304, U+308, U+329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";
const CYRILLIC = "U+301, U+400-45F, U+490-491, U+4B0-4B1, U+2116";
const EVERYTHING = "U+0-10FFFF";

function face(family: string, unicodeRange: string, status: string): FaceLike {
  return { family, unicodeRange, status };
}

/** `document.fonts` only promises `forEach`; the helper must not need more. */
function fontSet(faces: FaceLike[]) {
  return { forEach: (callback: (face: FaceLike) => void) => { for (const f of faces) callback(f); } };
}

describe("plainFamily / familyNames", () => {
  it("reads family names the way FontFace.family reports them", () => {
    expect(plainFamily(' "Inter Fallback" ')).toBe("inter fallback");
    expect(plainFamily("'Segoe UI'")).toBe("segoe ui");
    expect(plainFamily("Roboto")).toBe("roboto");
  });

  it("collects every family of several lists once, skipping empty entries", () => {
    const names = familyNames([FONT_UI, FONT_NUM, "", " , "]);
    expect([...names]).toEqual(["-apple-system", "blinkmacsystemfont", "inter", "inter fallback", "segoe ui", "roboto", "sans-serif"]);
  });
});

describe("unicodeRangeCovers", () => {
  it("finds Latin 'A' in the Latin subset, authored or browser-normalised, and in the fallback's full range", () => {
    expect(unicodeRangeCovers(LATIN, LATIN_PROBE_CODE_POINT)).toBe(true);
    expect(unicodeRangeCovers(LATIN_AS_AUTHORED, LATIN_PROBE_CODE_POINT)).toBe(true);
    expect(unicodeRangeCovers(EVERYTHING, LATIN_PROBE_CODE_POINT)).toBe(true);
  });

  it("does not find it in the other script subsets Inter ships", () => {
    expect(unicodeRangeCovers(LATIN_EXT, LATIN_PROBE_CODE_POINT)).toBe(false);
    expect(unicodeRangeCovers(CYRILLIC, LATIN_PROBE_CODE_POINT)).toBe(false);
    expect(unicodeRangeCovers("U+1F00-1FFF", LATIN_PROBE_CODE_POINT)).toBe(false);
  });

  it("handles single code points, wildcards and bounds", () => {
    expect(unicodeRangeCovers("U+41", 0x41)).toBe(true);
    expect(unicodeRangeCovers("U+42", 0x41)).toBe(false);
    expect(unicodeRangeCovers("U+4??", 0x430)).toBe(true);
    expect(unicodeRangeCovers("U+4??", 0x41)).toBe(false);
    expect(unicodeRangeCovers("U+??", 0x41)).toBe(true);
    expect(unicodeRangeCovers("U+0-40", 0x41)).toBe(false);
    expect(unicodeRangeCovers("U+41-FF", 0x41)).toBe(true);
    expect(unicodeRangeCovers("u+0-ff", 0x41)).toBe(true);
  });

  it("treats anything unparsable as covering nothing", () => {
    expect(unicodeRangeCovers("", 0x41)).toBe(false);
    expect(unicodeRangeCovers("Latin", 0x41)).toBe(false);
    expect(unicodeRangeCovers("U+", 0x41)).toBe(false);
  });
});

describe("matchingFaces / paintingFaces", () => {
  const fonts = fontSet([
    face("Inter", CYRILLIC, "unloaded"),
    face("Inter", LATIN_EXT, "unloaded"),
    face("Inter", LATIN, "loaded"),
    face("Inter Fallback", EVERYTHING, "error"),
    face("JetBrains Mono", LATIN, "unloaded"),
    face("JetBrains Mono Fallback", EVERYTHING, "unloaded"),
    face("__nextjs-Geist", LATIN, "unloaded"),
  ]);

  it("keeps only the wanted families' faces that cover Latin, in document.fonts order", () => {
    expect(matchingFaces(fonts, [FONT_UI, FONT_NUM]).map((f) => `${f.family}:${f.status}`)).toEqual(["Inter:loaded", "Inter Fallback:error"]);
  });

  it("drops the faces the browser gave up on, so an errored local() fallback cannot end the wait early", () => {
    expect(paintingFaces(fonts, [FONT_UI, FONT_NUM]).map((f) => `${f.family}:${f.status}`)).toEqual(["Inter:loaded"]);
  });

  it("keeps a Latin face that is still loading — that face is exactly what a capture must wait for", () => {
    const slow = fontSet([face("Inter", LATIN, "loaded"), face("Inter Fallback", EVERYTHING, "error"), face("Inter", "U+0-FF", "loading")]);
    expect(paintingFaces(slow, [FONT_UI]).map((f) => f.status)).toEqual(["loaded", "loading"]);
  });

  it("returns nothing for system-only font lists, and nothing when every matching face has errored", () => {
    expect(paintingFaces(fonts, ["system-ui, sans-serif"])).toEqual([]);
    expect(paintingFaces(fontSet([face("Inter Fallback", EVERYTHING, "error")]), [FONT_UI])).toEqual([]);
  });

  it("can probe a different code point", () => {
    expect(matchingFaces(fonts, [FONT_UI], 0x430).map((f) => f.unicodeRange)).toEqual([CYRILLIC, EVERYTHING]);
  });
});
