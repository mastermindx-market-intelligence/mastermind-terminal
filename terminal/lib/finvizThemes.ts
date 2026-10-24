// finvizThemes.ts — pure consumer adapter for the Finviz themes heatmap payload
// Source-qualified: requires data.source === 'finviz-themes' and map_type === 'themes'.
// No network, no I/O, no caching, no side effects.

export const TIMEFRAMES = ['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];
export type Axis = Timeframe | 'members';

export type ThemeMember = {
  ticker: string;
  perf: Record<Timeframe, number | null>;
};

export type ThemeGroup = {
  id: string;
  parentId: string;
  name: string;
  members: ThemeMember[];
  perf: Record<Timeframe, number | null>;
};

export type ThemeParent = {
  id: string;
  name: string;
  nameZh: string;
};

export type ThemePopulation = {
  themes: ThemeParent[];
  groups: ThemeGroup[];
  asOf: string;
  generatedAt: string | null;
  counts: {
    themes: number;
    subthemes: number;
    appearances: number;
    tickers: number;
  };
  manifestMatched: boolean;
  warnings: string[];
};

// ---------- internal helpers ----------

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const EXPECTED_SOURCE = 'finviz-themes';
const EXPECTED_MAP_TYPE = 'themes';

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v)
  );
}

function coercePerf(raw: unknown, available: Set<string>): Record<Timeframe, number | null> {
  // Build a record keyed by Timeframe; every TF is REQUIRED as a key.
  // Unknown/nonfinite/non-number => null (never zero, never coerce).
  const out = {} as Record<Timeframe, number | null>;
  const perfRaw = isPlainRecord(raw) ? raw : {};
  for (const tf of TIMEFRAMES) {
    const v = perfRaw[tf];
    out[tf] = available.has(tf) && isFiniteNumber(v) ? v : null;
  }
  return out;
}

function isValidTicker(s: unknown): s is string {
  return typeof s === 'string' && TICKER_RE.test(s);
}

function checkManifestCounts(
  manifest: unknown,
  actualCounts: { themes: number; subthemes: number; appearances: number; tickers: number }
): { matched: boolean; reason: string | null } {
  if (!isPlainRecord(manifest)) {
    return { matched: false, reason: 'manifest not an object' };
  }
  const c = manifest['counts'];
  if (!isPlainRecord(c)) {
    return { matched: false, reason: 'manifest.counts not an object' };
  }
  const fields: Array<keyof typeof actualCounts> = ['themes', 'subthemes', 'appearances', 'tickers'];
  for (const f of fields) {
    const got = c[f];
    if (!isFiniteNumber(got)) {
      return { matched: false, reason: `manifest.counts.${f} not a finite number` };
    }
    if (got !== actualCounts[f]) {
      return {
        matched: false,
        reason: `manifest.counts.${f} mismatch: expected ${actualCounts[f]}, got ${got}`,
      };
    }
  }
  return { matched: true, reason: null };
}

// ---------- public API ----------

export function normalizeFinviz(data: unknown, manifest?: unknown): ThemePopulation {
  if (!isPlainRecord(data)) {
    throw new Error('normalizeFinviz: data is not an object');
  }
  // 1) Source identity gate (reject 49-house-group source substitution)
  if (data['source'] !== EXPECTED_SOURCE) {
    throw new Error(
      `normalizeFinviz: source identity rejected, expected '${EXPECTED_SOURCE}', got ${JSON.stringify(data['source'])}`
    );
  }
  if (data['map_type'] !== EXPECTED_MAP_TYPE) {
    throw new Error(
      `normalizeFinviz: map_type identity rejected, expected '${EXPECTED_MAP_TYPE}', got ${JSON.stringify(data['map_type'])}`
    );
  }

  if (data['size_basis'] !== 'count') {
    throw new Error('normalizeFinviz: size_basis must be count');
  }

  // 2) asof / generated_utc clocks — verbatim
  const asof = data['asof'];
  if (typeof asof !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asof) || !Number.isFinite(Date.parse(asof)) || new Date(asof).toISOString().slice(0, 10) !== asof) {
    throw new Error("normalizeFinviz: missing or invalid 'asof'");
  }
  const generatedRaw = data['generated_utc'];
  const generatedAt = typeof generatedRaw === 'string' && generatedRaw.length > 0 ? generatedRaw : null;

  // 3) sectors / timeframes
  const sectorsRaw = data['sectors'];
  const timeframesRaw = data['timeframes'];
  if (!Array.isArray(sectorsRaw)) {
    throw new Error("normalizeFinviz: 'sectors' not an array");
  }
  if (!Array.isArray(timeframesRaw)) {
    throw new Error("normalizeFinviz: 'timeframes' not an array");
  }

  const sectorByKey = new Map<string, { en: string; zh: string }>();
  const seenParentKeys = new Set<string>();
  for (const s of sectorsRaw) {
    if (!isPlainRecord(s)) {
      throw new Error("normalizeFinviz: sector entry not an object");
    }
    const k = s['key'];
    const en = s['en'];
    const zh = s['zh'];
    if (typeof k !== 'string' || !k.trim() || k.length > 128) {
      throw new Error("normalizeFinviz: sector missing 'key'");
    }
    if (typeof en !== 'string') {
      throw new Error(`normalizeFinviz: sector '${k}' missing 'en'`);
    }
    if (typeof zh !== 'string') {
      throw new Error(`normalizeFinviz: sector '${k}' missing 'zh'`);
    }
    if (seenParentKeys.has(k)) {
      throw new Error(`normalizeFinviz: duplicate parent key '${k}'`);
    }
    seenParentKeys.add(k);
    sectorByKey.set(k, { en, zh });
  }

  const seenTfKeys = new Set<string>();
  const available = new Set<string>();
  for (const tf of timeframesRaw) {
    if (!isPlainRecord(tf)) {
      throw new Error("normalizeFinviz: timeframe entry not an object");
    }
    const k = tf['key'];
    if (typeof k !== 'string') {
      throw new Error("normalizeFinviz: timeframe missing 'key'");
    }
    if (seenTfKeys.has(k)) {
      throw new Error(`normalizeFinviz: duplicate timeframe key '${k}'`);
    }
    seenTfKeys.add(k);
    if (tf['available'] === true) available.add(k);
  }
  // Every TF declared must be one of the frozen API set
  for (const tf of TIMEFRAMES) {
    if (!seenTfKeys.has(tf)) {
      throw new Error(`normalizeFinviz: required timeframe '${tf}' missing from source`);
    }
  }

  // 4) tiles
  const tilesRaw = data['tiles'];
  if (!Array.isArray(tilesRaw)) {
    throw new Error("normalizeFinviz: 'tiles' not an array");
  }
  // n_tiles must match tiles.length
  const nTilesDecl = data['n_tiles'];
  if (!isFiniteNumber(nTilesDecl)) {
    throw new Error("normalizeFinviz: 'n_tiles' missing or non-finite");
  }
  if (nTilesDecl !== tilesRaw.length) {
    throw new Error(
      `normalizeFinviz: n_tiles mismatch: declared ${nTilesDecl}, actual ${tilesRaw.length}`
    );
  }

  // 5) Group (subtheme) construction
  const seenGroupIds = new Set<string>();
  const groups: ThemeGroup[] = [];
  // Track which sector keys are referenced so we can detect orphans
  const referencedSectors = new Set<string>();
  // Track tickers for counts
  const uniqueTickerSet = new Set<string>();
  let appearances = 0;

  for (const tile of tilesRaw) {
    if (!isPlainRecord(tile)) {
      throw new Error('normalizeFinviz: tile entry not an object');
    }
    const t = tile['t'];
    const name = tile['name'];
    const sector = tile['sector'];
    const size = tile['size'];
    const members = tile['members'];

    if (typeof t !== 'string' || !t.trim() || t.length > 128) {
      throw new Error("normalizeFinviz: tile missing 't'");
    }
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error(`normalizeFinviz: tile '${t}' missing 'name'`);
    }
    if (typeof sector !== 'string') {
      throw new Error(`normalizeFinviz: tile '${t}' missing 'sector'`);
    }
    if (!sectorByKey.has(sector)) {
      throw new Error(`normalizeFinviz: tile '${t}' has orphan parent sector '${sector}'`);
    }
    if (!isFiniteNumber(size)) {
      throw new Error(`normalizeFinviz: tile '${t}' missing numeric 'size'`);
    }
    if (!Array.isArray(members)) {
      throw new Error(`normalizeFinviz: tile '${t}' missing 'members' array`);
    }
    if (size !== members.length) {
      throw new Error(
        `normalizeFinviz: tile '${t}' size mismatch: declared ${size}, actual ${members.length}`
      );
    }

    const id = `finviz:subtheme:${t}`;
    if (seenGroupIds.has(id)) {
      throw new Error(`normalizeFinviz: duplicate group id '${id}'`);
    }
    seenGroupIds.add(id);

    const parentId = `finviz:theme:${sector}`;
    referencedSectors.add(sector);

    // Member processing — never dedupe silently: reject duplicate tickers within group
    const seenMemberInGroup = new Set<string>();
    const memberOut: ThemeMember[] = [];
    for (const m of members) {
      if (!isPlainRecord(m)) {
        throw new Error(`normalizeFinviz: tile '${t}' has non-object member entry`);
      }
      const ticker = m['t'];
      if (!isValidTicker(ticker)) {
        throw new Error(
          `normalizeFinviz: tile '${t}' has invalid ticker ${JSON.stringify(ticker)}`
        );
      }
      if (seenMemberInGroup.has(ticker)) {
        throw new Error(
          `normalizeFinviz: duplicate member '${ticker}' within group '${t}'`
        );
      }
      seenMemberInGroup.add(ticker);
      uniqueTickerSet.add(ticker);
      appearances += 1;
      memberOut.push({
        ticker,
        perf: coercePerf(m['perf'], available),
      });
    }

    // Group perf — never zero/coerce unknown/nonfinite
    const groupPerf = coercePerf(tile['perf'], available);

    groups.push({
      id,
      parentId,
      name,
      members: memberOut,
      perf: groupPerf,
    });
  }

  // 6) Validate n_members (declared unique tickers)
  const nMembersDecl = data['n_members'];
  if (!isFiniteNumber(nMembersDecl)) {
    throw new Error("normalizeFinviz: 'n_members' missing or non-finite");
  }
  if (nMembersDecl !== uniqueTickerSet.size) {
    throw new Error(
      `normalizeFinviz: n_members mismatch: declared ${nMembersDecl}, actual ${uniqueTickerSet.size}`
    );
  }

  // 7) Parent roster — every sector in source must be referenced by at least one tile
  for (const s of sectorsRaw) {
    if (!isPlainRecord(s)) continue;
    const k = s['key'];
    if (typeof k !== 'string') continue;
    if (!referencedSectors.has(k)) {
      throw new Error(`normalizeFinviz: orphan parent '${k}' declared in sectors but no tile references it`);
    }
  }
  const themes: ThemeParent[] = [];
  const seenThemeIds = new Set<string>();
  // Iterate sector entries in source order to retain display order
  for (const s of sectorsRaw) {
    if (!isPlainRecord(s)) continue;
    const k = s['key'];
    if (typeof k !== 'string') continue;
    const id = `finviz:theme:${k}`;
    if (seenThemeIds.has(id)) {
      throw new Error(`normalizeFinviz: duplicate theme id '${id}'`);
    }
    seenThemeIds.add(id);
    const en = s['en'];
    const zh = s['zh'];
    if (typeof en !== 'string' || typeof zh !== 'string') {
      throw new Error(`normalizeFinviz: sector '${k}' missing 'en' or 'zh'`);
    }
    themes.push({ id, name: en, nameZh: zh });
  }

  const actualCounts = {
    themes: themes.length,
    subthemes: groups.length,
    appearances,
    tickers: uniqueTickerSet.size,
  };

  // 8) Manifest validation
  const warnings: string[] = [];
  let manifestMatched = false;
  if (manifest === undefined || manifest === null) {
    warnings.push('manifest missing — internal counts not owner-validated');
  } else {
    const m = checkManifestCounts(manifest, actualCounts);
    if (!m.matched) {
      throw new Error(`normalizeFinviz: manifest validation failed: ${m.reason}`);
    }
    manifestMatched = true;
  }

  // 9) Emit parent order warning if duplicates/missing
  // (already caught above; keep a hook for future checks)

  return {
    themes,
    groups,
    asOf: asof,
    generatedAt,
    counts: actualCounts,
    manifestMatched,
    warnings,
  };
}

// Visibility filter — case-folded, parent + ticker + group name.
// parentId '' means "all parents"; '' is the convention for "any".
export function visibleGroups(
  pop: ThemePopulation,
  query: string,
  parentId: string
): ThemeGroup[] {
  const q = query.trim().toLowerCase();
  const parentFilter = parentId.length === 0 ? null : parentId;
  const out: ThemeGroup[] = [];
  for (const g of pop.groups) {
    if (parentFilter !== null && g.parentId !== parentFilter) continue;
    if (q.length === 0) {
      out.push(g);
      continue;
    }
    // Case-folded match on group name, parent name, or any ticker
    const groupNameHit = g.name.toLowerCase().includes(q);
    let parentNameHit = false;
    // parentId encodes the source sector key as a suffix; resolve via pop.themes
    const parentKey = g.parentId.startsWith('finviz:theme:')
      ? g.parentId.slice('finviz:theme:'.length)
      : '';
    const parent = pop.themes.find((t) => t.id === g.parentId);
    if (parent) {
      parentNameHit = parent.name.toLowerCase().includes(q) || parent.nameZh.toLowerCase().includes(q);
    } else if (parentKey) {
      // Defensive: fall back to the raw key
      parentNameHit = parentKey.toLowerCase().includes(q);
    }
    let tickerHit = false;
    for (const m of g.members) {
      if (m.ticker.toLowerCase().includes(q)) {
        tickerHit = true;
        break;
      }
    }
    if (groupNameHit || parentNameHit || tickerHit) {
      out.push(g);
    }
  }
  return out;
}

// Metric reader — null on unknown / nonfinite / non-number, never zero/coerce.
export function metric(group: ThemeGroup, axis: Axis): number | null {
  if (axis === 'members') {
    return group.members.length;
  }
  const v = group.perf[axis];
  return isFiniteNumber(v) ? v : null;
}

// Bubble plot projection — every group carries the same axes for fair comparison.
// "unavailable" counts groups where the requested metric is null for either axis.
export function bubblePoints(
  groups: ThemeGroup[],
  x: Axis,
  y: Axis
): { points: { group: ThemeGroup; x: number; y: number }[]; unavailable: number } {
  const points: { group: ThemeGroup; x: number; y: number }[] = [];
  let unavailable = 0;
  for (const g of groups) {
    const xv = metric(g, x);
    const yv = metric(g, y);
    if (xv === null || yv === null) {
      unavailable += 1;
      continue;
    }
    points.push({ group: g, x: xv, y: yv });
  }
  return { points, unavailable };
}

// (no extra exports — strict API freeze)
