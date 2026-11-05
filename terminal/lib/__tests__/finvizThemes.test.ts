// finvizThemes.test.ts — Vitest unit tests for the consumer adapter.
// Self-contained: no external fixtures, no network. Tiny synthetic Finviz shape only.

import { describe, it, expect } from 'vitest';
import {
  TIMEFRAMES,
  normalizeFinviz,
  visibleGroups,
  bubblePoints,
  metric,
  type ThemePopulation,
} from '../finvizThemes';

// ---------- helpers: tiny synthetic Finviz-shaped fixture ----------

type TileIn = {
  t: string;
  name: string;
  sector: string;
  size?: number;
  perf?: Record<string, number | null>;
  members: Array<{ t: string; perf?: Record<string, number | null> }>;
};

type FixtureIn = {
  source?: string;
  size_basis?: string;
  map_type?: string;
  asof?: string;
  generated_utc?: string;
  n_tiles?: number;
  n_members?: number;
  sectors?: Array<{ key: string; en: string; zh: string }>;
  timeframes?: Array<{ key: string; available?: boolean }>;
  tiles?: TileIn[];
};

function baseFixture(): FixtureIn {
  return {
    source: 'finviz-themes',
    size_basis: 'count',
    map_type: 'themes',
    asof: '2026-10-07',
    generated_utc: '2026-10-07 19:59',
    sectors: [
      { key: 'Artificial Intelligence', en: 'Artificial Intelligence', zh: '人工智能' },
      { key: 'Semiconductors', en: 'Semiconductors', zh: '半导体' },
    ],
    timeframes: TIMEFRAMES.map((k) => ({ key: k, available: true })),
    tiles: [],
    n_tiles: 0,
    n_members: 0,
  };
}

function perfAll(value: number | null): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const tf of TIMEFRAMES) out[tf] = value;
  return out;
}

function buildFixture(opts: {
  tiles?: TileIn[];
  sectors?: FixtureIn['sectors'];
  source?: string;
  map_type?: string;
  asof?: string;
  generated_utc?: string | null;
  drop?: { n_tiles?: boolean; n_members?: boolean };
} = {}): unknown {
  const f = baseFixture();
  if (opts.source !== undefined) f.source = opts.source;
  if (opts.map_type !== undefined) f.map_type = opts.map_type;
  if (opts.asof !== undefined) f.asof = opts.asof;
  if (opts.generated_utc !== undefined) f.generated_utc = opts.generated_utc as string | undefined;
  if (opts.sectors !== undefined) f.sectors = opts.sectors;
  if (opts.tiles !== undefined) f.tiles = opts.tiles;
  // Auto-fill size on every tile from its members length (size is not
  // domain-meaningful here — the adapter validates size === members.length).
  for (const tile of f.tiles ?? []) {
    if (tile.size === undefined) tile.size = tile.members.length;
  }
  // Auto-derive n_tiles / n_members unless caller overrides
  if (opts.drop?.n_tiles) {
    delete f.n_tiles;
  } else {
    f.n_tiles = (f.tiles ?? []).length;
  }
  if (opts.drop?.n_members) {
    delete f.n_members;
  } else {
    const tk = new Set<string>();
    for (const t of f.tiles ?? []) for (const m of t.members) tk.add(m.t);
    f.n_members = tk.size;
  }
  return f;
}

function aiTile(t: string, members: string[]): TileIn {
  return {
    t,
    name: t,
    sector: 'Artificial Intelligence',
    perf: perfAll(1.0),
    members: members.map((tk) => ({ t: tk, perf: perfAll(0.5) })),
  };
}

function validFixture() {
  return buildFixture({
    tiles: [
      aiTile('aicompute', ['NVDA', 'AMD']),
      aiTile('aimodels', ['NVDA', 'GOOGL']),
      {
        t: 'semimemory',
        name: 'Memory',
        sector: 'Semiconductors',
        perf: perfAll(2.0),
        members: [
          { t: 'MU', perf: perfAll(1.7) },
          { t: 'SNDK', perf: perfAll(3.1) },
        ],
      },
    ],
  });
}

// ---------- happy path ----------

describe('normalizeFinviz — happy path', () => {
  it('accepts a well-formed tiny fixture', () => {
    const pop = normalizeFinviz(validFixture());
    expect(pop.themes).toHaveLength(2);
    expect(pop.groups).toHaveLength(3);
    expect(pop.asOf).toBe('2026-10-07');
    expect(pop.generatedAt).toBe('2026-10-07 19:59');
    expect(pop.manifestMatched).toBe(false);
    expect(pop.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/manifest/i)])
    );
    expect(pop.counts.themes).toBe(2);
    expect(pop.counts.subthemes).toBe(3);
    expect(pop.counts.tickers).toBe(5);
    // appearances: NVDA in aicompute + NVDA in aimodels = 2; AMD = 1; GOOGL = 1; MU = 1; SNDK = 1 => 6
    expect(pop.counts.appearances).toBe(6);
  });

  it('produces source-qualified stable IDs', () => {
    const pop = normalizeFinviz(validFixture());
    for (const g of pop.groups) {
      expect(g.id).toMatch(/^finviz:subtheme:[a-z0-9]+$/);
      expect(g.parentId).toMatch(/^finviz:theme:.+$/);
    }
    for (const t of pop.themes) {
      expect(t.id).toMatch(/^finviz:theme:.+$/);
      expect(t.nameZh).toBeTruthy();
    }
  });

  it('preserves generated_utc verbatim — never treated as freshness', () => {
    const f = validFixture();
    (f as Record<string, unknown>)['generated_utc'] = '2026-01-01 00:00';
    const pop = normalizeFinviz(f);
    expect(pop.generatedAt).toBe('2026-01-01 00:00');
    expect(pop.generatedAt).not.toBe(pop.asOf);
  });

  it('allows the same ticker across different subthemes', () => {
    const pop = normalizeFinviz(validFixture());
    const aimodels = pop.groups.find((g) => g.id === 'finviz:subtheme:aimodels');
    const tickers = aimodels?.members.map((m) => m.ticker) ?? [];
    expect(tickers).toContain('NVDA'); // also in aicompute
  });
});

// ---------- malformed cases — every rule rejects ----------

describe('normalizeFinviz — source identity', () => {
  it('rejects the 49-house-group source', () => {
    const f = buildFixture({ source: '49 house group source' });
    expect(() => normalizeFinviz(f)).toThrow(/source identity rejected/);
  });

  it('rejects unknown source', () => {
    const f = buildFixture({ source: 'something-else' });
    expect(() => normalizeFinviz(f)).toThrow(/source identity rejected/);
  });

  it('rejects wrong map_type', () => {
    const f = buildFixture({ map_type: 'groups' });
    expect(() => normalizeFinviz(f)).toThrow(/map_type identity rejected/);
  });
});

describe('normalizeFinviz — empty / missing / wrong type', () => {
  it('rejects null', () => {
    expect(() => normalizeFinviz(null)).toThrow();
  });
  it('rejects undefined', () => {
    expect(() => normalizeFinviz(undefined)).toThrow();
  });
  it('rejects array', () => {
    expect(() => normalizeFinviz([])).toThrow();
  });
  it('rejects empty object (no source key)', () => {
    expect(() => normalizeFinviz({})).toThrow();
  });
  it('rejects missing asof', () => {
    const f = validFixture();
    delete (f as Record<string, unknown>)['asof'];
    expect(() => normalizeFinviz(f)).toThrow(/asof/);
  });
});

describe('normalizeFinviz — duplicate / orphan / invalid detection', () => {
  it('rejects duplicate parent keys in sectors list', () => {
    const f = buildFixture({
      sectors: [
        { key: 'Artificial Intelligence', en: 'AI', zh: '人工智能' },
        { key: 'Artificial Intelligence', en: 'AI 2', zh: '人工智能2' },
      ],
      tiles: [aiTile('aicompute', ['NVDA'])],
    });
    expect(() => normalizeFinviz(f)).toThrow(/duplicate parent key/);
  });

  it('rejects orphan parents (sector declared but no tile references it)', () => {
    const f = buildFixture({
      sectors: [
        { key: 'Artificial Intelligence', en: 'Artificial Intelligence', zh: '人工智能' },
        { key: 'Lonely Sector', en: 'Lonely', zh: '孤' },
      ],
      tiles: [aiTile('aicompute', ['NVDA'])],
    });
    expect(() => normalizeFinviz(f)).toThrow(/orphan parent/);
  });

  it('rejects tile referencing an unknown sector (orphan parent from tile side)', () => {
    const f = buildFixture({
      tiles: [
        aiTile('aicompute', ['NVDA']),
        {
          t: 'ghost',
          name: 'Ghost',
          sector: 'NotInSectors',
          perf: perfAll(1),
          members: [{ t: 'X', perf: perfAll(1) }],
        },
      ],
    });
    expect(() => normalizeFinviz(f)).toThrow(/orphan parent sector/);
  });

  it('rejects duplicate tile.t (duplicate group IDs)', () => {
    const f = buildFixture({
      tiles: [aiTile('aicompute', ['NVDA']), aiTile('aicompute', ['AMD'])],
    });
    expect(() => normalizeFinviz(f)).toThrow(/duplicate group id/);
  });

  it('rejects duplicate member ticker within the same group', () => {
    const f = buildFixture({
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: perfAll(1),
          members: [
            { t: 'NVDA', perf: perfAll(0.5) },
            { t: 'NVDA', perf: perfAll(0.5) },
          ],
        },
      ],
    });
    expect(() => normalizeFinviz(f)).toThrow(/duplicate member 'NVDA' within group/);
  });

  it('rejects invalid ticker names', () => {
    const f = buildFixture({
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: perfAll(1),
          members: [{ t: 'lowercase-bad', perf: perfAll(0.5) }],
        },
      ],
    });
    expect(() => normalizeFinviz(f)).toThrow(/invalid ticker/);
  });

  it('rejects ticker with embedded whitespace', () => {
    const f = buildFixture({
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: perfAll(1),
          members: [{ t: 'AA PL', perf: perfAll(0.5) }],
        },
      ],
    });
    expect(() => normalizeFinviz(f)).toThrow(/invalid ticker/);
  });

  it('accepts tickers with class-share dot (e.g. BRK.B)', () => {
    const f = buildFixture({
      sectors: [
        { key: 'Artificial Intelligence', en: 'Artificial Intelligence', zh: '人工智能' },
      ],
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: perfAll(1),
          members: [{ t: 'BRK.B', perf: perfAll(0.5) }],
        },
      ],
    });
    expect(() => normalizeFinviz(f)).not.toThrow();
  });
});

describe('normalizeFinviz — n_tiles / n_members mismatch', () => {
  it('rejects n_tiles mismatch', () => {
    const f = buildFixture({ tiles: [aiTile('aicompute', ['NVDA'])] });
    (f as Record<string, unknown>)['n_tiles'] = 99;
    expect(() => normalizeFinviz(f)).toThrow(/n_tiles mismatch/);
  });

  it('rejects n_members mismatch (declared != actual unique tickers)', () => {
    const f = buildFixture({
      tiles: [aiTile('aicompute', ['NVDA', 'AMD']), aiTile('aimodels', ['GOOGL'])],
    });
    // Override n_members to a wrong number
    (f as Record<string, unknown>)['n_members'] = 99;
    expect(() => normalizeFinviz(f)).toThrow(/n_members mismatch/);
  });

  it('rejects missing n_tiles', () => {
    const f = buildFixture({ tiles: [aiTile('aicompute', ['NVDA'])], drop: { n_tiles: true } });
    expect(() => normalizeFinviz(f)).toThrow(/n_tiles/);
  });
});

// ---------- counts arithmetic overlapping membership ----------

describe('normalizeFinviz — counts arithmetic', () => {
  it('counts overlapping membership correctly (tickers < appearances)', () => {
    const pop = normalizeFinviz(validFixture());
    expect(pop.counts.tickers).toBeLessThan(pop.counts.appearances);
    // NVDA appears in 2 groups
    const appearances = pop.groups.reduce(
      (acc, g) => acc + g.members.filter((m) => m.ticker === 'NVDA').length,
      0
    );
    expect(appearances).toBe(2);
  });
});

// ---------- manifest validation ----------

describe('normalizeFinviz — manifest validation', () => {
  it('missing manifest => manifestMatched=false + clear warning', () => {
    const pop = normalizeFinviz(validFixture());
    expect(pop.manifestMatched).toBe(false);
    expect(pop.warnings.find((w) => /manifest/i.test(w))).toBeTruthy();
  });

  it('matching manifest => manifestMatched=true, no manifest warning', () => {
    const pop = normalizeFinviz(
      validFixture(),
      { counts: { themes: 2, subthemes: 3, appearances: 6, tickers: 5 } }
    );
    expect(pop.manifestMatched).toBe(true);
    expect(pop.warnings.find((w) => /manifest/i.test(w))).toBeUndefined();
  });

  it('mismatching manifest counts => throws', () => {
    expect(() =>
      normalizeFinviz(validFixture(), {
        counts: { themes: 1, subthemes: 3, appearances: 6, tickers: 5 },
      })
    ).toThrow(/manifest validation failed/);
  });

  it('manifest with non-numeric count => throws', () => {
    expect(() =>
      normalizeFinviz(validFixture(), {
        counts: { themes: 'two', subthemes: 3, appearances: 6, tickers: 5 },
      })
    ).toThrow(/manifest validation failed/);
  });

  it('undefined manifest (explicit) behaves like missing', () => {
    const pop = normalizeFinviz(validFixture(), undefined);
    expect(pop.manifestMatched).toBe(false);
    expect(pop.warnings.length).toBeGreaterThan(0);
  });
});

// ---------- metric, bubblePoints, visibleGroups ----------

describe('metric / bubblePoints — null discipline', () => {
  it('metric returns null for unknown / nonfinite / missing perf', () => {
    const pop = normalizeFinviz(validFixture());
    const tile = pop.groups[0];
    // Sanity: a populated TF returns the number
    expect(metric(tile, '1D')).toBe(tile.perf['1D']);
    // 'members' is the count
    expect(metric(tile, 'members')).toBe(tile.members.length);
  });

  it('bubblePoints projects all-valid groups', () => {
    const pop = normalizeFinviz(validFixture());
    const res = bubblePoints(pop.groups, '1D', '1W');
    expect(res.unavailable).toBe(0);
    expect(res.points).toHaveLength(pop.groups.length);
    for (const p of res.points) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(p.x).toBe(metric(p.group, '1D'));
      expect(p.y).toBe(metric(p.group, '1W'));
    }
  });

  it('bubblePoints with members axis — groups always available', () => {
    const pop = normalizeFinviz(validFixture());
    const res = bubblePoints(pop.groups, 'members', 'members');
    expect(res.unavailable).toBe(0);
    expect(res.points).toHaveLength(pop.groups.length);
  });

  it('single null mutation excludes exactly one bubble but leaves Table/Matrix roster intact', () => {
    const pop = normalizeFinviz(validFixture());
    // Mutate exactly one group's 1W perf to null
    pop.groups[1].perf['1W'] = null;
    const bp = bubblePoints(pop.groups, '1D', '1W');
    expect(bp.unavailable).toBe(1);
    expect(bp.points).toHaveLength(pop.groups.length - 1);
    // The mutated group MUST be the excluded one
    const excluded = pop.groups[1];
    const includedIds = new Set(bp.points.map((p) => p.group.id));
    expect(includedIds.has(excluded.id)).toBe(false);
    // Table/Matrix roster still has every group (visibleGroups uses parent/filter only)
    const table = visibleGroups(pop, '', '');
    expect(table).toHaveLength(pop.groups.length);
    // metric still returns null on the mutated axis — never zero
    expect(metric(excluded, '1W')).toBeNull();
  });

  it('non-numeric perf inputs are coerced to null, not zero', () => {
    const f = buildFixture({
      sectors: [
        { key: 'Artificial Intelligence', en: 'Artificial Intelligence', zh: '人工智能' },
      ],
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: { ...perfAll(1), '1D': 'not-a-number' as unknown as number },
          members: [{ t: 'NVDA', perf: perfAll(0.5) }],
        },
      ],
    });
    const pop = normalizeFinviz(f);
    expect(metric(pop.groups[0], '1D')).toBeNull();
    // The other TFs are still finite
    expect(metric(pop.groups[0], '1W')).toBe(1);
  });

  it('NaN perf is coerced to null', () => {
    const f = buildFixture({
      sectors: [
        { key: 'Artificial Intelligence', en: 'Artificial Intelligence', zh: '人工智能' },
      ],
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: { ...perfAll(1), '1D': Number.NaN as unknown as number },
          members: [{ t: 'NVDA', perf: perfAll(0.5) }],
        },
      ],
    });
    const pop = normalizeFinviz(f);
    expect(metric(pop.groups[0], '1D')).toBeNull();
  });

  it('Infinity perf is coerced to null', () => {
    const f = buildFixture({
      sectors: [
        { key: 'Artificial Intelligence', en: 'Artificial Intelligence', zh: '人工智能' },
      ],
      tiles: [
        {
          t: 'aicompute',
          name: 'Compute',
          sector: 'Artificial Intelligence',
          perf: { ...perfAll(1), '1D': Number.POSITIVE_INFINITY as unknown as number },
          members: [{ t: 'NVDA', perf: perfAll(0.5) }],
        },
      ],
    });
    const pop = normalizeFinviz(f);
    expect(metric(pop.groups[0], '1D')).toBeNull();
  });
});

// ---------- visibleGroups: query / parent parity ----------

describe('visibleGroups — query / parent parity', () => {
  function popFor(): ThemePopulation {
    return normalizeFinviz(validFixture());
  }

  it('empty query + empty parentId returns all groups', () => {
    const pop = popFor();
    const all = pop.groups.length;
    expect(visibleGroups(pop, '', '')).toHaveLength(all);
  });

  it('parent filter restricts to that parent only', () => {
    const pop = popFor();
    const ai = pop.themes.find((t) => t.name === 'Artificial Intelligence')!;
    const semi = pop.themes.find((t) => t.name === 'Semiconductors')!;
    expect(visibleGroups(pop, '', ai.id)).toHaveLength(2);
    expect(visibleGroups(pop, '', semi.id)).toHaveLength(1);
    expect(visibleGroups(pop, '', 'finviz:theme:DoesNotExist')).toHaveLength(0);
  });

  it('case-folded query on group name', () => {
    const pop = popFor();
    const r = visibleGroups(pop, 'COMPUTE', '');
    expect(r).toHaveLength(1);
    expect(r[0].name).toBe('aicompute');
  });

  it('case-folded query on parent name (en)', () => {
    const pop = popFor();
    const r = visibleGroups(pop, 'semiconductors', '');
    expect(r).toHaveLength(1);
    expect(r[0].parentId).toBe('finviz:theme:Semiconductors');
  });

  it('case-folded query on parent name (zh)', () => {
    const pop = popFor();
    const r = visibleGroups(pop, '半导体', '');
    expect(r).toHaveLength(1);
  });

  it('case-folded query on ticker', () => {
    const pop = popFor();
    // NVDA appears in two groups
    const r = visibleGroups(pop, 'nvda', '');
    expect(r).toHaveLength(2);
    for (const g of r) {
      expect(g.members.some((m) => m.ticker === 'NVDA')).toBe(true);
    }
  });

  it('query + parent: only groups in the parent that match the query', () => {
    const pop = popFor();
    const ai = pop.themes.find((t) => t.name === 'Artificial Intelligence')!;
    const r = visibleGroups(pop, 'nvda', ai.id);
    // aicompute (NVDA) + aimodels (NVDA) — both in AI
    expect(r).toHaveLength(2);
  });

  it('query + parent: cross-parent query is filtered out by parent', () => {
    const pop = popFor();
    const semi = pop.themes.find((t) => t.name === 'Semiconductors')!;
    // No NVDA in semiconductors
    const r = visibleGroups(pop, 'nvda', semi.id);
    expect(r).toHaveLength(0);
  });

  it('table/matrix roster never shrinks on perf null — only visibility filter', () => {
    const pop = popFor();
    pop.groups.forEach((g) => (g.perf['1W'] = null));
    const all = visibleGroups(pop, '', '');
    expect(all).toHaveLength(pop.groups.length);
    // bubbles for 1W vs 1D should be entirely unavailable
    const bp = bubblePoints(pop.groups, '1D', '1W');
    expect(bp.unavailable).toBe(pop.groups.length);
    expect(bp.points).toHaveLength(0);
  });

  it('parents and group roster retained if one perf null (no member discard)', () => {
    const pop = popFor();
    const before = pop.groups.map((g) => g.members.length);
    pop.groups.forEach((g) => (g.perf['1D'] = null));
    const after = pop.groups.map((g) => g.members.length);
    expect(after).toEqual(before);
    expect(pop.themes.length).toBe(2);
  });
});

// ---------- API freeze: TIMEFRAMES ----------

describe('TIMEFRAMES constant', () => {
  it('matches the frozen order', () => {
    expect([...TIMEFRAMES]).toEqual(['1D', '1W', 'MTD', '1M', '3M', '6M', 'YTD', '1Y']);
  });
});


describe('owner admission boundaries', () => {
  it('refuses a non-count magnitude rather than presenting it as membership', () => {
    const data = validFixture() as Record<string, unknown>;
    data.size_basis = 'marketcap';
    expect(() => normalizeFinviz(data)).toThrow(/size_basis/);
  });
  it('honors unavailable timeframes even when residual numbers remain', () => {
    const data = validFixture() as Record<string, unknown>;
    data.timeframes = TIMEFRAMES.map(key => ({ key, available: key !== '1W' }));
    const pop = normalizeFinviz(data);
    expect(bubblePoints(pop.groups, '1W', '1M')).toEqual({ points: [], unavailable: pop.groups.length });
    expect(pop.groups[0].members[0].perf['1W']).toBeNull();
    expect(visibleGroups(pop, '', '')).toHaveLength(3);
  });
  it.each(['2026-02-30', 'unknown', '2026-10-07T12:00:00Z'])('rejects invalid market date %s', asof => {
    const data = validFixture() as Record<string, unknown>;
    data.asof = asof;
    expect(() => normalizeFinviz(data)).toThrow(/asof/);
  });
});
