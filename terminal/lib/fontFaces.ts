/**
 * The font faces a piece of canvas text is really painted with (E19 review capture).
 *
 * Canvas text never waits for a web font, so a capture has to load its faces first. Loading them by
 * family (`document.fonts.load("600 16px Inter, ...")`) is not enough: next/font declares a
 * size-adjusted `local()` fallback face ("Inter Fallback") beside the Inter subset faces, that face
 * is in status "error" wherever the local font is absent (the Linux CI runners, likely Android), and
 * `FontFaceSet.load()` rejects as soon as any matching face errors — before the Latin Inter face has
 * arrived. `document.fonts.ready` is no help either: it only covers loads the page's own text has
 * started (reading it forces a layout, which starts those), never a face that only canvas text
 * paints with. So the capture waits on the faces themselves: those of the wanted families whose
 * `unicode-range` covers the Latin text it paints, skipping faces the browser cannot use. The
 * Playwright probe in `e2e/chart-capture-review.spec.ts` carries the same selection inline (an init
 * script cannot import); keep the two in step.
 */

/** "A" — the chart header and the provenance strip are basic Latin letters, digits and punctuation. */
export const LATIN_PROBE_CODE_POINT = 0x41;

/** The part of a `FontFace` this module reads; structural so tests need no browser. */
export type FaceLike = { family: string; unicodeRange: string; status: string };

/** A family name as `FontFace.family` reports it: trimmed, unquoted, case-folded. */
export function plainFamily(name: string): string {
  return name.trim().replace(/^["']|["']$/g, "").toLowerCase();
}

/** Every family named in one or more `font-family` lists (`"Inter", "Inter Fallback", sans-serif`). */
export function familyNames(lists: Iterable<string>): Set<string> {
  const names = new Set<string>();
  for (const list of lists) {
    for (const name of list.split(",")) {
      const plain = plainFamily(name);
      if (plain) names.add(plain);
    }
  }
  return names;
}

/** Whether a `unicode-range` descriptor (`U+0-FF, U+131, U+4??`) covers the code point. A face with no
 * descriptor reports `U+0-10FFFF`. Anything unparsable covers nothing. */
export function unicodeRangeCovers(range: string, codePoint: number): boolean {
  return range.split(",").some((part) => {
    const m = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(part.trim());
    if (!m) return false;
    const lo = parseInt(m[1].replace(/\?/g, "0"), 16);
    const hi = m[2] ? parseInt(m[2], 16) : parseInt(m[1].replace(/\?/g, "F"), 16);
    return lo <= codePoint && codePoint <= hi;
  });
}

/** The faces of the listed families that cover the code point, in `document.fonts` order — errored
 * faces included, so a caller can see what the browser gave up on. */
export function matchingFaces<T extends FaceLike>(
  faces: { forEach(callback: (face: T) => void): void },
  familyLists: Iterable<string>,
  codePoint: number = LATIN_PROBE_CODE_POINT,
): T[] {
  const wanted = familyNames(familyLists);
  const out: T[] = [];
  faces.forEach((face) => {
    if (wanted.has(plainFamily(face.family)) && unicodeRangeCovers(face.unicodeRange, codePoint)) out.push(face);
  });
  return out;
}

/** The faces the text is painted with: the matching faces the browser can still use. A face in
 * status "error" paints nothing, and waiting on it would only end the wait early. */
export function paintingFaces<T extends FaceLike>(
  faces: { forEach(callback: (face: T) => void): void },
  familyLists: Iterable<string>,
  codePoint: number = LATIN_PROBE_CODE_POINT,
): T[] {
  return matchingFaces(faces, familyLists, codePoint).filter((face) => face.status !== "error");
}
