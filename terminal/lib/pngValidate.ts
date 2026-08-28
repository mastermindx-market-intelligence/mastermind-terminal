// ── PNG structural validation for the snapshot ingress boundary ────────────────────────────────
//
// The upload route accepted ANY bytes. It buffered whatever arrived, checked only the length, and
// PUT the result to R2 under a `.png` key with `content-type: image/png`. A JavaScript file, a ZIP,
// an HTML document, or a 4 MB blob of zeros all became a "chart snapshot" served from our own
// bucket domain — a free, anonymous, CDN-fronted file host with our name on it.
//
// A declared MIME type is not evidence: the client writes it. This module reads the bytes.
//
// It parses STRUCTURE, not pixels — signature, chunk framing, IHDR legality, terminal IEND. That is
// what makes it cheap and total: no decoder, no allocation proportional to image size, no
// decompression, so a decompression bomb has nothing to bomb. It is a gate on what may be stored
// and served as an image, not a guarantee that the image is beautiful.

/** Stable, non-leaking failure codes. The client never sees provider or parser detail. */
export type PngRejection =
  | "not_png"          // signature, framing, or a required chunk is wrong
  | "bad_dimensions"   // zero, negative, or beyond the accepted bounds
  | "bad_header";      // an IHDR field carries a value the format does not define

export type PngCheck =
  | { ok: true; width: number; height: number }
  | { ok: false; code: PngRejection };

// 8-byte PNG signature. The \r\n and \x1a bytes are the format's own transfer-corruption canaries.
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// A chart snapshot from this app is at most a few thousand pixels a side. These bounds exist to
// refuse a header claiming 2^31 pixels — cheap to declare, ruinous for anything that later decodes
// it — not to be generous.
export const MAX_EDGE = 20_000;
export const MAX_PIXELS = 60_000_000;

// Legal (bitDepth, colourType) pairs, per the PNG spec's IHDR table. Anything else is malformed,
// and accepting it means storing a file no decoder agrees on.
const ALLOWED_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16], // greyscale
  2: [8, 16],          // truecolour
  3: [1, 2, 4, 8],     // indexed
  4: [8, 16],          // greyscale + alpha
  6: [8, 16],          // truecolour + alpha
};

/**
 * Validate PNG structure. Pure and synchronous — no allocation proportional to the image.
 *
 * Deliberately strict about ORDER: IHDR must be the first chunk and IEND must be the last, which is
 * what stops a valid PNG header being used as a envelope for arbitrary trailing payload.
 */
export function validatePng(bytes: Uint8Array): PngCheck {
  // Signature (8) + IHDR length/type/body/crc (4+4+13+4) = 33 bytes before anything else is possible.
  if (bytes.length < 33) return { ok: false, code: "not_png" };

  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) return { ok: false, code: "not_png" };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, false); // PNG is big-endian throughout
  const type = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

  // ── IHDR must come first and be exactly 13 bytes ──
  if (u32(8) !== 13) return { ok: false, code: "not_png" };
  if (type(12) !== "IHDR") return { ok: false, code: "not_png" };

  const width = u32(16);
  const height = u32(20);
  // Read as unsigned; the spec forbids 0 and reserves the high bit, so >2^31 is out of range.
  if (width === 0 || height === 0) return { ok: false, code: "bad_dimensions" };
  if (width > MAX_EDGE || height > MAX_EDGE) return { ok: false, code: "bad_dimensions" };
  if (width * height > MAX_PIXELS) return { ok: false, code: "bad_dimensions" };

  const bitDepth = bytes[24];
  const colourType = bytes[25];
  const compression = bytes[26];
  const filter = bytes[27];
  const interlace = bytes[28];

  const depths = ALLOWED_DEPTHS[colourType];
  if (!depths || !depths.includes(bitDepth)) return { ok: false, code: "bad_header" };
  // The spec defines exactly one compression method and one filter method, and two interlace modes.
  if (compression !== 0 || filter !== 0) return { ok: false, code: "bad_header" };
  if (interlace !== 0 && interlace !== 1) return { ok: false, code: "bad_header" };

  // ── Walk the chunk chain to the end ──
  // Every chunk is length(4) + type(4) + data(length) + crc(4). Following the declared lengths is
  // what proves the file is fully framed rather than a valid header with junk stapled behind it.
  let offset = 8;
  let sawIend = false;
  while (offset + 8 <= bytes.length) {
    const len = u32(offset);
    // A length that overruns the buffer means truncated or lying — either way not a stored image.
    // The 2^31 guard keeps `offset + 12 + len` from overflowing into a false pass.
    if (len > 0x7fffffff) return { ok: false, code: "not_png" };
    const next = offset + 12 + len;
    if (next > bytes.length) return { ok: false, code: "not_png" };

    if (type(offset + 4) === "IEND") {
      // IEND carries no data and must be the final chunk — nothing may follow it.
      if (len !== 0) return { ok: false, code: "not_png" };
      sawIend = true;
      if (next !== bytes.length) return { ok: false, code: "not_png" };
      break;
    }
    offset = next;
  }

  if (!sawIend) return { ok: false, code: "not_png" };
  return { ok: true, width, height };
}
