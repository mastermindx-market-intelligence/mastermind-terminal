// Portfolio brief — pure render-selection logic for the "Your book today" panel.
//
// The desk composes the brief upstream (macro-api GET /api/portfolio/brief, schema
// portfolio_brief.v1). Every user-facing sentence arrives PRE-LOCALIZED in both EN and
// ZH — this module never re-composes or truncates a fact; it only *selects* the active
// language's string and decides which UI state to render (Law: LLM/desk originates the
// facts, the client only picks and arranges). Keeping this pure and free of React makes
// the language/order/stale/uncovered decisions unit-testable without a DOM.

export type Lang = "en" | "zh";

/** A bilingual string pair as it arrives on the wire. */
export interface Bilingual {
  en: string;
  zh: string;
}

/** One composed sentence line inside a section. */
export type BriefLine = Bilingual;

/** A brief section. `key` is a stable machine id; titles arrive pre-localized. */
export interface BriefSection {
  key: string;
  title_en: string;
  title_zh: string;
  lines: BriefLine[];
}

export interface BriefWeighting {
  mode: string;
  label_en: string;
  label_zh: string;
}

export interface BriefBook {
  n: number;
  covered: number;
  uncovered: string[];
}

/** The population modes the desk can declare (packet amendment A8). */
export type PopulationMode = "positions" | "watchlist_union" | "unspecified";

/**
 * WHICH SET OF NAMES the desk composed the brief over — its own declaration, not our
 * inference (portfolio_brief.v2).
 *
 * `unspecified` is a real, honest value, not a missing one: it means the upstream loader
 * could not establish the population (its Supabase query failed, or no query ran), and
 * the desk says so rather than assuming. It must NEVER be rendered as agreement with
 * whatever the page happens to show.
 */
export interface BriefPopulation {
  mode: PopulationMode;
  label_en: string;
  label_zh: string;
  n: number;
  disclosure_en: string;
  disclosure_zh: string;
}

/**
 * The full portfolio_brief payload (200 response body).
 *
 * `population` is v2 and OPTIONAL here on purpose: a v1 payload (an older API, a stale
 * cache, a proxy that predates the bump) has no such field, and this panel must degrade
 * to the size-only cross-check rather than crash or invent a mode.
 */
export interface PortfolioBrief {
  schema: string;
  asof: string;
  generated_at: string;
  stale: boolean;
  weighting: BriefWeighting;
  book: BriefBook;
  population?: BriefPopulation;
  headline: Bilingual;
  sections: BriefSection[];
}

/** The teaser tier reported by a 403 body. */
export type TeaserTier = "free" | "insider";

/**
 * What the PAGE hosting this panel actually renders (packet amendment A8 — population disclosure).
 *
 * The mismatch this exists to prevent is the one the commissioning census found in production: a
 * page titled Portfolio showing WATCHLIST symbols, with a brief above it composed from a third
 * population, and nothing anywhere saying which set any number described. Since W5 the Terminal's
 * `/portfolio` renders `portfolio_positions` and nothing else, so it declares `positions`.
 *
 * `watchlist_union` is declared by a surface that renders an equal-weighted watchlist instead — the
 * Terminal has no such surface after W5, and the label exists so a future one cannot ship silent.
 */
export type PagePopulation =
  | { kind: "positions"; count: number }
  | { kind: "watchlist_union"; count: number };

export type PopulationDisclosure = {
  kind: PagePopulation["kind"];
  /** Names the page itself is rendering. */
  count: number;
  /** The book size the DESK reports it read, when the payload says. `null` = it did not say. */
  briefCount: number | null;
  /**
   * The desk's OWN declared population (v2), or `null` on a v1 payload that cannot say.
   * This is a statement of fact from the composer, not a guess from counting.
   */
  deskMode: PopulationMode | null;
  /** The desk's pre-localized disclosure sentence, when the payload carries one. */
  deskDisclosure: Bilingual | null;
  /**
   * The desk provably read a different set from the one on screen — never a guess, and never
   * rendered as agreement when the truth is unknown.
   */
  mismatch: boolean;
  /**
   * WHY it mismatched, so the view can say the stronger thing when it has it.
   * `"mode"` — the desk names a different population than the page renders. Conclusive.
   * `"count"` — same declared population (or none declared) but a different number of names.
   * `null` — no mismatch, or nothing to compare against.
   */
  mismatchReason: "mode" | "count" | null;
};

function readPopulation(brief: PortfolioBrief | null): BriefPopulation | null {
  const p = brief?.population;
  if (!p || typeof p !== "object") return null;
  if (p.mode !== "positions" && p.mode !== "watchlist_union" && p.mode !== "unspecified") {
    // An unknown mode from a newer API is not something this build can interpret; treat it
    // as "the desk did not say in terms I understand" rather than rendering a raw token.
    return null;
  }
  return p;
}

/**
 * Reconcile what the PAGE renders against what the DESK says it read.
 *
 * Since W6 the payload declares its own population, so this is a comparison of two
 * statements rather than the size-only heuristic it replaced — that heuristic could miss a
 * same-size different set, which is precisely the case this program exists to prevent (a
 * 9-name watchlist under a 9-position table read as agreement).
 *
 * `unspecified` is deliberately NOT a mismatch: the desk is telling us it does not know,
 * and "we disagree" would be a stronger claim than the evidence supports. The view renders
 * the desk's own `unspecified` sentence, which says the set was not declared.
 */
export function populationDisclosure(
  population: PagePopulation,
  brief: PortfolioBrief | null,
): PopulationDisclosure {
  const reported = brief?.book && typeof brief.book.n === "number" && Number.isFinite(brief.book.n)
    ? brief.book.n
    : null;
  const desk = readPopulation(brief);

  let mismatch = false;
  let mismatchReason: "mode" | "count" | null = null;
  if (desk && desk.mode !== "unspecified" && desk.mode !== population.kind) {
    mismatch = true;
    mismatchReason = "mode";
  } else if (reported !== null && reported !== population.count) {
    mismatch = true;
    mismatchReason = "count";
  }

  return {
    kind: population.kind,
    count: population.count,
    briefCount: reported,
    deskMode: desk ? desk.mode : null,
    deskDisclosure: desk
      ? { en: desk.disclosure_en, zh: desk.disclosure_zh }
      : null,
    mismatch,
    mismatchReason,
  };
}

/**
 * The four terminal states the panel can be in. `hidden` means render nothing
 * (guest / 401) — the page already handles guests, so the brief simply absents itself.
 */
export type BriefState =
  | { kind: "ready"; brief: PortfolioBrief }
  | { kind: "teaser"; tier: TeaserTier | null }
  | { kind: "unavailable" } // 503 / network — one quiet line, never blocks the book
  | { kind: "hidden" }; // 401 / guest — no panel at all
  // (loading is a component concern, not a payload state, so it lives in the view.)

/**
 * The canonical order the desk sections render in. The API sends a fixed-order subset;
 * we re-assert the canonical order so a reordered payload can't scramble the read, and
 * unknown keys fall to the end (forward-compatible with new desk sections).
 */
export const SECTION_ORDER = [
  "exposure",
  "lanes",
  "signals",
  "regime",
  "earnings",
  "filings",
] as const;

/** Pick the active language's string from a bilingual pair. */
export function pickLang(pair: Bilingual, lang: Lang): string {
  return lang === "zh" ? pair.zh : pair.en;
}

/** Pick a section's title in the active language. */
export function sectionTitle(section: BriefSection, lang: Lang): string {
  return lang === "zh" ? section.title_zh : section.title_en;
}

/** Pick the weighting label ("by cost basis" / "按成本权重") in the active language. */
export function weightingLabel(w: BriefWeighting, lang: Lang): string {
  return lang === "zh" ? w.label_zh : w.label_en;
}

/**
 * Return the payload's sections re-sorted into the canonical desk order. Sections with a
 * known key sort by SECTION_ORDER; unknown keys keep their original relative order after
 * the known ones (stable). Sections with no lines are dropped — an empty section is a
 * silent hole in the read, not a fact.
 */
export function orderedSections(brief: PortfolioBrief): BriefSection[] {
  const rank = (key: string): number => {
    const i = (SECTION_ORDER as readonly string[]).indexOf(key);
    return i === -1 ? SECTION_ORDER.length : i;
  };
  return brief.sections
    .filter((s) => Array.isArray(s.lines) && s.lines.length > 0)
    .map((s, i) => ({ s, i })) // carry original index for a stable tiebreak
    .sort((a, b) => rank(a.s.key) - rank(b.s.key) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * Map an HTTP status + optional body into a BriefState. This is the single place the
 * network contract (200 / 401 / 403 / 503) becomes a UI decision, so the view stays dumb
 * and the mapping is testable in isolation.
 *
 * - 200 → ready (caller must supply the parsed brief)
 * - 401 → hidden (guest; the page already handles guests)
 * - 403 → teaser (read tier from the body when present)
 * - anything else (incl. 503, 502, network throw modeled as 0) → unavailable
 */
/** A malformed successful response must not crash the positions workspace. */
export function isPortfolioBrief(value: unknown): value is PortfolioBrief {
  const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown) => typeof v === "string";
  const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  const pair = (v: unknown) => object(v) && text(v.en) && text(v.zh);
  if (!object(value)) return false;
  const v = value;
  return (v.schema === "portfolio_brief.v1" || v.schema === "portfolio_brief.v2")
    && text(v.asof) && text(v.generated_at) && typeof v.stale === "boolean"
    && object(v.weighting) && text(v.weighting.mode) && text(v.weighting.label_en) && text(v.weighting.label_zh)
    && object(v.book) && count(v.book.n) && count(v.book.covered)
    && Array.isArray(v.book.uncovered) && v.book.uncovered.every(text)
    && pair(v.headline) && Array.isArray(v.sections) && v.sections.every(section => object(section)
      && text(section.key) && text(section.title_en) && text(section.title_zh)
      && Array.isArray(section.lines) && section.lines.every(pair))
    && (v.population === undefined || object(v.population)
      && ["positions", "watchlist_union", "unspecified"].includes(String(v.population.mode))
      && count(v.population.n) && text(v.population.label_en) && text(v.population.label_zh)
      && text(v.population.disclosure_en) && text(v.population.disclosure_zh));
}

export function stateForResponse(
  status: number,
  body: unknown,
): BriefState {
  if (status === 200) {
    return isPortfolioBrief(body) ? { kind: "ready", brief: body } : { kind: "unavailable" };
  }
  if (status === 401) {
    return { kind: "hidden" };
  }
  if (status === 403) {
    const tier = readTier(body);
    return { kind: "teaser", tier };
  }
  return { kind: "unavailable" };
}

/** Extract a "free" | "insider" tier from a 403 body, or null when absent/unknown. */
function readTier(body: unknown): TeaserTier | null {
  if (body && typeof body === "object" && "tier" in body) {
    const t = (body as { tier?: unknown }).tier;
    if (t === "free" || t === "insider") return t;
  }
  return null;
}

/**
 * Whether the "no desk coverage yet for: …" honest-null line should show, and the list
 * of tickers it names. Returns null when every held name is covered — no empty disclosure.
 */
export function uncoveredNotice(
  brief: PortfolioBrief,
): { tickers: string[] } | null {
  const u = brief.book?.uncovered;
  if (Array.isArray(u) && u.length > 0) return { tickers: u };
  return null;
}

// ───────────────────────── the canonical-context consumer ─────────────────────────
//
// The opt-in snapshot contract (terminal/docs/verification/portfolio-brief-context-20261102/):
// the Portfolio panel asks for `X-Mastermind-Portfolio-Context: snapshot-v1`, the desk
// answers with a PUBLIC brief PLUS a minimal validated context, and the brief's facts may
// be rendered only when that context names the SAME owner and the SAME canonical book the
// page is showing.
//
// This half of the module is the shared, pure half: the context's shape, the binding's
// shape, and the selection rule that decides whether a response may be rendered. The
// server half (the witness decoder and its compatibility gate) lives in
// lib/portfolioBriefContext.server.ts and never reaches the browser.

/** The opt-in header. Its presence selects a RESPONSE CONTRACT; it grants no authority. */
export const BRIEF_CONTEXT_HEADER = "X-Mastermind-Portfolio-Context";
/** The only supported contract version. */
export const BRIEF_CONTEXT_VERSION = "snapshot-v1";

/**
 * The minimal context the browser is allowed to see.
 *
 * It carries NO holdings, no currency receipts, no notes and no producer rows: only the
 * version it was read under, the server-verified owner it belongs to, the canonical book
 * key it describes, and the population it describes. That is the whole private-boundary
 * surface.
 */
export interface BriefContext {
  version: string;
  owner: string;
  bookKey: string;
  population: "positions";
}

/** A canonical context is well-formed only when it names a real book key. */
export function isBriefContext(value: unknown): value is BriefContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.version === BRIEF_CONTEXT_VERSION
    && typeof v.owner === "string" && v.owner.length > 0
    && typeof v.bookKey === "string" && /^[a-f0-9]{64}$/.test(v.bookKey)
    && v.population === "positions";
}

/**
 * The owner-scoped phase of the CANONICAL READ — the `/api/portfolio?view=positions` read
 * that decides which book the page is entitled to show.
 *
 * `checking` — the read is in flight (or has not started); the book is not yet known.
 * `unavailable` — the read failed; the book is NOT empty, it is unknown. A failed read is
 * never a perpetual "checking" and never an empty book.
 * `qualified` — a canonical read was accepted and its book key is the accepted binding.
 */
export type CanonicalReadPhase = "checking" | "unavailable" | "qualified";

/**
 * The accepted canonical binding: the owner, the canonical book key, and the accepted-read
 * counter that makes each accepted read a NEW identity (so a reread that lands a new book
 * re-reads the brief, while a same-owner presentation change keeps the identity).
 */
export interface BriefBinding {
  owner: string;
  bookKey: string;
  read: number;
}

/**
 * Read a bound response: the PUBLIC brief plus the context that binds it.
 *
 * Returns null unless the response carries a well-formed context AND that context names
 * the SAME owner and the SAME canonical book as the accepted binding. A response without a
 * context — an old producer, a proxy that predates the contract, a malformed body — is
 * NOT a legacy payload to be shown on trust: it is simply not bindable, and the caller
 * renders its honest unavailable state.
 */
export function readBoundBrief(
  value: unknown,
  binding: BriefBinding | null,
): { brief: PortfolioBrief; context: BriefContext } | null {
  if (!binding) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!isBriefContext(v.context)) return null;
  if (v.context.owner !== binding.owner) return null;
  if (v.context.bookKey !== binding.bookKey) return null;
  if (!isPortfolioBrief(value)) return null;
  return { brief: value as PortfolioBrief, context: v.context };
}

/**
 * The STRICT population disclosure — the one the bound Portfolio path uses.
 *
 * The legacy `populationDisclosure` above compares the desk's reported NAME count with the
 * page's POSITION count and calls a difference a mismatch. In the bound path that
 * heuristic is retired: a book of two lots in one name is the SAME book, and the desk's
 * count is a count of NAMES while the page renders POSITION records. Both counts are
 * reported with their own label and no equality is implied.
 */
export interface StrictPopulationDisclosure {
  kind: PagePopulation["kind"];
  /** The canonical POSITION records (lots) the page renders. */
  positions: number;
  /** The desk's own count — unique NAMES, when the payload states one. */
  names: number | null;
  /** The desk's declared population, when the payload states one. */
  deskMode: PopulationMode | null;
  /** The desk's own pre-localized disclosure sentence, when the payload carries one. */
  deskDisclosure: Bilingual | null;
}

export function strictPopulationDisclosure(
  population: PagePopulation,
  brief: PortfolioBrief | null,
): StrictPopulationDisclosure {
  const desk = readPopulation(brief);
  const reported = brief?.book && typeof brief.book.n === "number" && Number.isFinite(brief.book.n)
    ? brief.book.n
    : null;
  return {
    kind: population.kind,
    positions: population.count,
    names: reported,
    deskMode: desk ? desk.mode : null,
    deskDisclosure: desk ? { en: desk.disclosure_en, zh: desk.disclosure_zh } : null,
  };
}
