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


// Brand artwork for the Shared Shell company search. Ordinary watchlist/Discover
// AssetLogo instances intentionally keep their zero-network SVG badges.
// Reuse Macro's exchange-aware ticker lookup and quota-independent icon CDN;
// Logo.dev is only an optional fallback when a publishable image token is deployed.
// Never substitute a US ticker for a different listing (BABA vs 9988.HK).
const LOGO_DEV_TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN?.trim() ?? "";
const PUBLISHABLE_TOKEN = /^pk_[A-Za-z0-9_-]{8,128}$/;
const COMPANY_TICKER = /^[A-Z0-9][A-Z0-9.-]{0,23}$/;

export const companyLogoDevEnabled = PUBLISHABLE_TOKEN.test(LOGO_DEV_TOKEN);

export function normalizeCompanyLogoTicker(value: string, venue?: string | null): string | null {
  let ticker = value.trim().toUpperCase();
  if (!COMPANY_TICKER.test(ticker)) return null;
  ticker = ticker.replace(/\.TSE$/, ".TO").replace(/\.LN$/, ".L")
    .replace(/\.SH$/, ".SS").replace(/\.AU$/, ".AX").replace(/\.JP$/, ".T");
  const exchange = (venue ?? "").trim().toUpperCase().replace(/[\s_-]/g, "");

  if (/^(HK|HKEX|HKG|HONGKONG)$/.test(exchange)) {
    ticker = ticker.replace(/\.HK$/, "");
    if (/^\d{1,4}$/.test(ticker)) ticker = ticker.padStart(4, "0");
    ticker += ".HK";
  } else if (/^(TSX|TSE|TORONTO|CA|CANADA)$/.test(exchange) && !/\.(TO|V)$/.test(ticker)) {
    ticker += ".TO";
  } else if (/^(TSXV)$/.test(exchange) && !ticker.endsWith(".V")) {
    ticker += ".V";
  } else if (/^(LSE|LON|LONDON|UK|UNITEDKINGDOM)$/.test(exchange) && !ticker.endsWith(".L")) {
    ticker += ".L";
  } else if (/^(SSE|SHA|SHANGHAI|SZSE|SHENZHEN|CN|CHINA)$/.test(exchange) && /^\d{6}$/.test(ticker)) {
    ticker += /^(5|6|9)/.test(ticker) || exchange === "SSE" ? ".SS" : ".SZ";
  }
  return COMPANY_TICKER.test(ticker) ? ticker : null;
}

/**
 * Ordered image-only candidates. Only visible search rows request them (native
 * image lazy loading), and callers keep the local SVG monogram as the last
 * fallback. No network call or API key is needed to render the search dialog.
 * The optional Logo.dev key is a public pk_ image-CDN token, never an sk_ key.
 */
export function companyBrandLogoSources(
  symbol: string,
  venue?: string | null,
  name?: string | null,
  token: string = LOGO_DEV_TOKEN,
): string[] {
  const ticker = normalizeCompanyLogoTicker(symbol, venue);
  if (!ticker) return [];
  const openIcon = "https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/"
    + encodeURIComponent(ticker) + ".png";
  if (!PUBLISHABLE_TOKEN.test(token.trim())) return [openIcon];

  const query = new URLSearchParams({
    token: token.trim(), theme: "dark", size: "64",
    format: "png", retina: "true", fallback: "404",
  }).toString();
  const lookup = "https://img.logo.dev/ticker/" + encodeURIComponent(ticker) + "?" + query;
  const cleanName = name?.trim() ?? "";
  const nameLookup = cleanName && cleanName.toUpperCase() !== symbol.trim().toUpperCase()
    && cleanName.length <= 100 && !/[\x00-\x1f\x7f]/.test(cleanName)
    ? "https://img.logo.dev/name/" + encodeURIComponent(cleanName) + "?" + query
    : null;

  // International listing IDs are stronger than company names or US aliases.
  // For US equities keep the already-used open icon set ahead of quota-limited
  // Logo.dev; for international markets prefer the exchange-aware provider.
  const international = ticker.includes(".") || /^(HKEX|HKG|LSE|LON|TSX|TSXV|SSE|SZSE)$/.test((venue ?? "").toUpperCase());
  return international
    ? [lookup, ...(nameLookup ? [nameLookup] : []), openIcon]
    : [openIcon, lookup, ...(nameLookup ? [nameLookup] : [])];
}
