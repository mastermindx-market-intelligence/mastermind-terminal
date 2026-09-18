import type { WatchlistSymbolRow } from "@/lib/watchlistSelection";

/** Rows before the first divider live in the root run. It has no visible header. */
export const WATCHLIST_ROOT_SECTION = "";

export function watchlistSectionOrder(
  rows: readonly WatchlistSymbolRow[],
  declared: readonly string[] = [],
): string[] {
  const out: string[] = [];
  for (const section of declared) {
    const clean = section.trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  for (const row of rows) {
    const clean = row.section.trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out;
}

export function watchlistVisualOrder(
  rows: readonly WatchlistSymbolRow[],
  sections: readonly string[],
  collapsed: ReadonlySet<string> = new Set(),
): string[] {
  const out = rows
    .filter((row) => row.section === WATCHLIST_ROOT_SECTION)
    .map((row) => row.symbol);
  for (const section of sections) {
    if (collapsed.has(section)) continue;
    out.push(...rows.filter((row) => row.section === section).map((row) => row.symbol));
  }
  return out;
}

/** Keep the stored symbol stream aligned with the visible divider order. */
export function orderWatchlistRowsBySections(
  rows: readonly WatchlistSymbolRow[],
  sections: readonly string[],
): WatchlistSymbolRow[] {
  const out = rows
    .filter((row) => row.section === WATCHLIST_ROOT_SECTION)
    .map((row) => ({ ...row }));
  for (const section of watchlistSectionOrder(rows, sections)) {
    out.push(...rows.filter((row) => row.section === section).map((row) => ({ ...row })));
  }
  return out;
}

/**
 * Insert a real divider immediately above `symbol`. The selected symbol and the
 * rest of its current run move below the new divider; symbol order never changes.
 */
export function insertWatchlistSectionBefore(
  rows: readonly WatchlistSymbolRow[],
  sections: readonly string[],
  symbol: string,
  newSection: string,
): { rows: WatchlistSymbolRow[]; sections: string[]; movedSymbols: string[] } | null {
  const name = newSection.trim();
  if (!name || sections.includes(name)) return null;
  const anchor = rows.find((row) => row.symbol === symbol);
  if (!anchor) return null;

  const run = rows.filter((row) => row.section === anchor.section);
  const at = run.findIndex((row) => row.symbol === symbol);
  if (at < 0) return null;
  const movedSymbols = run.slice(at).map((row) => row.symbol);
  const moved = new Set(movedSymbols);
  const nextRows = rows.map((row) => moved.has(row.symbol) ? { ...row, section: name } : { ...row });
  const after = anchor.section === WATCHLIST_ROOT_SECTION ? -1 : sections.indexOf(anchor.section);
  const nextSections = [...sections];
  nextSections.splice(Math.max(0, after + 1), 0, name);
  return { rows: nextRows, sections: nextSections, movedSymbols };
}

/**
 * Remove only the divider. Its following run merges into the preceding run, or
 * into the unsectioned root when the removed divider was first. Symbols survive
 * in exactly the same visual order.
 */
export function removeWatchlistSection(
  rows: readonly WatchlistSymbolRow[],
  sections: readonly string[],
  section: string,
): { rows: WatchlistSymbolRow[]; sections: string[]; movedSymbols: string[]; targetSection: string } | null {
  const at = sections.indexOf(section);
  if (at < 0) return null;
  const targetSection = at > 0 ? sections[at - 1]! : WATCHLIST_ROOT_SECTION;
  // Old saves can have a declared divider order that differs from the raw row
  // array. Flatten through the visible stream before merging so removing a
  // divider can never jump its symbols ahead of the preceding block.
  const ordered = orderWatchlistRowsBySections(rows, sections);
  const movedSymbols = ordered.filter((row) => row.section === section).map((row) => row.symbol);
  const nextRows = ordered.map((row) => row.section === section ? { ...row, section: targetSection } : { ...row });
  return {
    rows: nextRows,
    sections: sections.filter((value) => value !== section),
    movedSymbols,
    targetSection,
  };
}

export function moveWatchlistSection(
  sections: readonly string[],
  section: string,
  target: string | null,
): string[] {
  const from = sections.indexOf(section);
  if (from < 0) return [...sections];
  const next = sections.filter((value) => value !== section);
  if (target === null) return [section, ...next];
  const to = sections.indexOf(target);
  if (to < 0) return [...sections];
  next.splice(to, 0, section);
  return next;
}


export type WatchlistDragDestination = {
  section: string;
  targetSymbol: string | null;
  edge: "before" | "after" | "start";
};

/**
 * Move a visible selection as one indivisible block. The caller supplies the
 * symbols in current visual order; source array order never gets to reorder a
 * discontiguous selection behind the user's back.
 */
export function moveWatchlistDragGroup(
  rows: readonly WatchlistSymbolRow[],
  sections: readonly string[],
  draggedSymbols: readonly string[],
  destination: WatchlistDragDestination,
): WatchlistSymbolRow[] {
  const ordered = orderWatchlistRowsBySections(rows, sections);
  const bySymbol = new Map(ordered.map((row) => [row.symbol, row]));
  const seen = new Set<string>();
  const dragged = draggedSymbols
    .filter((symbol) => !seen.has(symbol) && seen.add(symbol))
    .map((symbol) => bySymbol.get(symbol))
    .filter((row): row is WatchlistSymbolRow => !!row);

  if (!dragged.length) return ordered;
  const draggedSet = new Set(dragged.map((row) => row.symbol));
  if (destination.targetSymbol && draggedSet.has(destination.targetSymbol)) return ordered;

  const rest = ordered.filter((row) => !draggedSet.has(row.symbol));
  const block = dragged.map((row) => ({ ...row, section: destination.section }));
  let insertAt = -1;

  if (destination.targetSymbol) {
    const targetAt = rest.findIndex((row) => row.symbol === destination.targetSymbol);
    if (targetAt < 0) return ordered;
    insertAt = targetAt + (destination.edge === "after" ? 1 : 0);
  } else {
    insertAt = rest.findIndex((row) => row.section === destination.section);
    if (insertAt < 0) {
      const visualSections = [WATCHLIST_ROOT_SECTION, ...watchlistSectionOrder(rows, sections)];
      const targetRank = visualSections.indexOf(destination.section);
      insertAt = rest.findIndex((row) => visualSections.indexOf(row.section) > targetRank);
      if (insertAt < 0) insertAt = rest.length;
    }
  }

  rest.splice(insertAt, 0, ...block);
  return rest;
}
