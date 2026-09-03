import { isUuid } from "@/lib/theses";

export type AnalysisRoute =
  | { kind: "company"; symbol?: string; page?: string }
  | { kind: "theses"; symbol?: string; thesisId?: string }
  | { kind: "unsupported"; reason: "invalid_view" | "unsupported_view" | "thesis_requires_theses" }
  | { kind: "invalid_thesis" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function optional(value: string | string[] | undefined): string | undefined {
  const selected = first(value);
  return selected === undefined ? undefined : selected;
}

/**
 * The complete public vocabulary for `/analysis`.
 *
 * `view` and `thesis` are identity-bearing switches, so arrays never collapse to a first value.
 * This function runs in the server page before a workspace is selected; malformed thesis links
 * therefore cannot mount a component that might query the store.
 */
export function parseAnalysisRoute(query: SearchParams): AnalysisRoute {
  const view = query.view;
  if (Array.isArray(view) || (typeof view === "string" && !view.trim())) {
    return { kind: "unsupported", reason: "invalid_view" };
  }
  if (view !== undefined && view !== "company" && view !== "theses") {
    return { kind: "unsupported", reason: "unsupported_view" };
  }
  if (query.thesis !== undefined && view !== "theses") {
    return { kind: "unsupported", reason: "thesis_requires_theses" };
  }
  if (view === "theses") {
    if (Array.isArray(query.thesis)) return { kind: "invalid_thesis" };
    if (query.thesis !== undefined && !isUuid(query.thesis)) return { kind: "invalid_thesis" };
    return {
      kind: "theses",
      ...(query.thesis ? { thesisId: query.thesis.toLowerCase() } : {}),
      ...(optional(query.symbol) !== undefined ? { symbol: optional(query.symbol) } : {}),
    };
  }
  return {
    kind: "company",
    ...(optional(query.symbol) !== undefined ? { symbol: optional(query.symbol) } : {}),
    ...(optional(query.page) ?? optional(query.pane)
      ? { page: optional(query.page) ?? optional(query.pane) }
      : {}),
  };
}

/** Browser history must use the identical closed vocabulary as the server entry point. */
export function parseAnalysisSearchParams(searchParams: URLSearchParams): AnalysisRoute {
  const query: SearchParams = {};
  searchParams.forEach((value, key) => {
    const prior = query[key];
    query[key] = prior === undefined ? value : Array.isArray(prior) ? [...prior, value] : [prior, value];
  });
  return parseAnalysisRoute(query);
}
