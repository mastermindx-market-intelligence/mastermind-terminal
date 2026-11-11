/**
 * Fixture-mode query engine for `prophet.sector_members/v1` (see
 * lib/prophetSectorMembers.ts for the contract decoder).
 *
 * ONE implementation of the contract's query semantics — search-before-paging,
 * state filter, deterministic sort, offset/limit window, page echo — shared by
 * the BFF fixture branch (FLOW_FIXTURE/TERMINAL_E2E_FIXTURE) and by Playwright
 * browser-level stubs, so the journey never depends on a second, drifting copy
 * of the rules. The function is pure: it never reads the network or disk; the
 * caller supplies the decoded fixture body (read from the committed
 * `public/data/prophet_sector_members_fixture/` files) and gets a new response
 * object back. Fixtures are synthetic (design-spec numbers); when Macro's real
 * captures land they replace these files and this engine is unchanged.
 */
import {
  PROPHET_MEMBER_STATES, prophetMemberStateRank, SECTOR_MEMBERS_DEFAULT_LIMIT,
  SECTOR_MEMBERS_MAX_LIMIT, SECTOR_MEMBERS_QUERY,
  type ProphetMemberState,
} from "./prophetSectorMembers";

export const SECTOR_MEMBERS_FIXTURE_DIR = "public/data/prophet_sector_members_fixture";
export const fixtureGroupFile = (groupId: string): string => `group_${groupId}.json`;
export const fixtureSymbolFile = (symbol: string): string => `symbol_${symbol}.json`;

export type FixtureSectorMembersQuery = {
  group?: string; symbol?: string; offset?: number; limit?: number;
  q?: string | null; state?: string | null;
};

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const clone = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/**
 * Apply the contract's query semantics to a full fixture body. Returns the
 * response tuple `{status, body}` exactly as the BFF would answer:
 *   - index mode (no group, no symbol): the fixture as-is.
 *   - group mode: q filters symbol/name BEFORE paging; state filters
 *     prophet.state; sort is state rank then symbol; `page` echoes the query.
 *   - symbol mode: the fixture as-is.
 *   - unknown group/symbol → 404; malformed query → 422 (fail-closed, like the
 *     real endpoint).
 */
export function applyFixtureSectorMembersQuery(
  body: unknown,
  query: FixtureSectorMembersQuery = {},
): { status: number; body: unknown } {
  const group = query.group ?? null;
  const symbol = query.symbol ?? null;
  if (group !== null && symbol !== null) {
    return { status: 422, body: { code: "invalid_query", reason: "group and symbol are exclusive" } };
  }
  if (group !== null && !/^[a-z][a-z0-9_-]{0,79}$/.test(group)) {
    return { status: 422, body: { code: "invalid_query", reason: "malformed group id" } };
  }
  if (symbol !== null && !/^[A-Z][A-Z0-9.-]{0,31}$/.test(symbol)) {
    return { status: 422, body: { code: "invalid_query", reason: "malformed symbol" } };
  }
  if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0 || query.offset > 1_000_000)) {
    return { status: 422, body: { code: "invalid_query", reason: "malformed offset" } };
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > SECTOR_MEMBERS_MAX_LIMIT)) {
    return { status: 422, body: { code: "invalid_query", reason: "malformed limit" } };
  }
  const q = query.q ?? null;
  if (q !== null && !SECTOR_MEMBERS_QUERY.test(q)) {
    return { status: 422, body: { code: "invalid_query", reason: "malformed q" } };
  }
  const state = query.state ?? null;
  if (state !== null && !(PROPHET_MEMBER_STATES as readonly string[]).includes(state)) {
    return { status: 422, body: { code: "invalid_query", reason: "malformed state" } };
  }

  if (group === null && symbol === null) return { status: 200, body: clone(body) };
  if (symbol !== null) return { status: 200, body: clone(body) };

  if (!record(body) || body.mode !== "group" || !Array.isArray(body.members)) {
    return { status: 404, body: { code: "unknown_group", reason: group } };
  }

  const needle = q === null ? null : q.toLowerCase();
  const matching = (body.members as Record<string, unknown>[]).filter(member => {
    const prophet = record(member.prophet) ? member.prophet : null;
    if (state !== null && (!prophet || prophet.state !== state)) return false;
    if (needle === null) return true;
    const symbolText = typeof member.symbol === "string" ? member.symbol.toLowerCase() : "";
    const nameText = typeof member.name === "string" ? member.name.toLowerCase() : "";
    return symbolText.includes(needle) || nameText.includes(needle);
  });
  // Deterministic contract sort: state rank, then symbol.
  const rank = (m: Record<string, unknown>): number => {
    const prophet = record(m.prophet) ? m.prophet as Record<string, unknown> : null;
    const state = prophet !== null && typeof prophet.state === "string"
      && (PROPHET_MEMBER_STATES as readonly string[]).includes(prophet.state) ? prophet.state : "unavailable";
    return prophetMemberStateRank(state as ProphetMemberState);
  };
  matching.sort((a, b) => {
    const rankA = rank(a);
    const rankB = rank(b);
    if (rankA !== rankB) return rankA - rankB;
    return String(a.symbol).localeCompare(String(b.symbol));
  });

  const offset = query.offset ?? 0;
  const limit = query.limit ?? SECTOR_MEMBERS_DEFAULT_LIMIT;
  const window = matching.slice(offset, offset + limit);
  const nextOffset = offset + window.length < matching.length ? offset + window.length : null;

  const out = clone(body) as Record<string, unknown>;
  out.members = window;
  out.page = { offset, limit, total_matching: matching.length, next_offset: nextOffset, q, state };
  return { status: 200, body: out };
}
