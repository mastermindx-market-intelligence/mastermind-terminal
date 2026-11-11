/**
 * prophetPopulationFilters.ts — the two URL keys our Prophet population block
 * owns on the SECTOR workspace page (Prophet × Sector Intelligence, M3).
 *
 * The sector workspace's own address state (`writeSectorState` in
 * lib/sectorIntelligence.ts) sets and deletes only its own keys, so a
 * prophet-prefixed key rides along untouched through every workspace
 * URL-rewrite — that survival is pinned by test, not assumed. This module is
 * the ONLY writer/reader of these keys: the population block translates
 * between them and its filter state, and nothing else in the app knows them.
 *
 * Value grammar (bounded by construction — same bounds the wire decoder
 * enforces, from lib/sectorPopulation.ts):
 *   - prophetPopulationGroup: one group id, POPULATION_GROUP_ID
 *     (/^[a-z][a-z0-9_-]{0,79}$/) — present only when a group is selected.
 *   - prophetPopulationQ: the applied search, POPULATION_QUERY
 *     (/^[\w .&'-]{1,64}$/) — present only when a search is applied.
 * An absent, empty or out-of-grammar value reads as the default (all groups /
 * no search): a mistyped or hostile query never selects a reader-facing
 * filter.
 */
import { POPULATION_GROUP_ID, POPULATION_QUERY } from "./sectorPopulation";

export const PROPHET_POPULATION_GROUP_KEY = "prophetPopulationGroup";
export const PROPHET_POPULATION_Q_KEY = "prophetPopulationQ";

export type ProphetPopulationFilters = { group: string | null; q: string | null };

/** The block's admissible filters from a page's query string. Invalid or
 * absent values fall back to null (the page's own default), never to a
 * partially-applied value. */
export function readProphetPopulationFilters(params: URLSearchParams): ProphetPopulationFilters {
  const group = params.get(PROPHET_POPULATION_GROUP_KEY);
  const q = params.get(PROPHET_POPULATION_Q_KEY);
  return {
    group: group !== null && POPULATION_GROUP_ID.test(group) ? group : null,
    q: q !== null && POPULATION_QUERY.test(q) ? q : null,
  };
}

/** The page address with ONLY our two keys set to the given filters (null
 * removes the key): every other parameter — the sector workspace's own state,
 * `tab`, anything foreign — is preserved with its value untouched. The
 * surrounding workspace's URL writes cannot be relied on to carry a key it
 * does not know, so our write must be surgical in both directions. */
export function prophetPopulationHref(
  pathname: string,
  params: URLSearchParams,
  filters: ProphetPopulationFilters,
): string {
  const url = new URL(pathname, "https://population.local");
  params.forEach((value, key) => {
    if (key !== PROPHET_POPULATION_GROUP_KEY && key !== PROPHET_POPULATION_Q_KEY) {
      url.searchParams.set(key, value);
    }
  });
  if (filters.group !== null) url.searchParams.set(PROPHET_POPULATION_GROUP_KEY, filters.group);
  if (filters.q !== null) url.searchParams.set(PROPHET_POPULATION_Q_KEY, filters.q);
  const search = url.searchParams.toString();
  return search === "" ? url.pathname : `${url.pathname}?${search}`;
}
