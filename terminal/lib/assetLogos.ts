const BADGE_URI_PREFIX = "data:image/svg+xml;charset=utf-8,";

function badgeGlyph(raw: string): string {
  const clean = raw
    .trim()
    .replace(/-USD$/i, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  const safe = clean || "?";
  const width = /^\d/.test(safe) || safe.length <= 3 ? 3 : 2;
  return safe.slice(0, width);
}

function badgeDataUri(raw: string): string {
  const glyph = badgeGlyph(raw);
  const fontSize = glyph.length === 1 ? 34 : glyph.length === 2 ? 27 : 21;
  const letterSpacing = glyph.length === 3 ? -0.8 : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="33" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="${letterSpacing}">${glyph}</text></svg>`;
  return `${BADGE_URI_PREFIX}${encodeURIComponent(svg)}`;
}

export function assetLogoPath(symbol: string, _market?: string): string {
  return badgeDataUri(symbol);
}

export function assetInitial(symbol: string): string {
  return badgeGlyph(symbol)[0] || "?";
}
