// @vitest-environment jsdom
// [GAP-CENSUS] Census + receipt tests, one describe per acceptance-matrix row:
//   Q01-A01: Each planned suite -> Appears in collected/executed test manifest, not only in path filters.
//   Q01-A03: Independent transform oracle -> Detects injected offset/sign/scale mutation.
//   C01-A03: Unused vendor API -> Not copied into the project contract solely for apparent completeness.
//   G00-A03: Manifest says ^5.2.0 -> Resolved lockfile version and actual CI runtime are recorded separately.
//
// Committed receipts live in lib/__tests__/fixtures/chart-engine/gap-census/:
//   collected-files.json         regenerate from terminal/ with exactly:
//                                npx vitest list --filesOnly --json > lib/__tests__/fixtures/chart-engine/gap-census/collected-files.json
//   api-census.json              caller/row census for every api.ts interface member (grep + TS compiler API)
//   q01-a03-mutant-receipts.txt  offset/sign/scale mutant receipts against the transform oracle
//   g00-a03-versions.json        manifest spec / lockfile resolved / runtime loaded as separate keys
//
// G00-A03 never imports "lightweight-charts": it reads package.json and package-lock.json with fs and
// resolves the installed module's OWN package.json. That is not an importer of vendor code, so the
// chartEngineBoundary.test.ts allowlist ratchet is untouched.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCanvasEngine, createManualScheduler } from "@/lib/chart-engine/canvas";
import type { EngineSeriesRow } from "@/lib/chart-engine/api";

const TESTS_DIR = path.resolve(__dirname);
const TERMINAL_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(TESTS_DIR, "fixtures", "chart-engine", "gap-census");
const MANIFEST_FILE = path.join(FIXTURE_DIR, "collected-files.json");
const API_CENSUS_FILE = path.join(FIXTURE_DIR, "api-census.json");
const MUTANT_RECEIPT_FILE = path.join(FIXTURE_DIR, "q01-a03-mutant-receipts.txt");
const VERSIONS_FILE = path.join(FIXTURE_DIR, "g00-a03-versions.json");
const COVERAGE_FILE = path.join(REPO_ROOT, "docs", "chart-engine", "acceptance_coverage_2026-10-12.json");
const API_FILE = path.join(TERMINAL_DIR, "lib", "chart-engine", "api.ts");
const ORACLE_FILE = path.join(TESTS_DIR, "chartEngineCanvasScaleTruth.test.ts");
const VITEST_CONFIG_FILE = path.join(TERMINAL_DIR, "vitest.config.ts");
const BASE_SHA = "dd78c1e250b7c13560620f1c3a9ea5b66e29455e";
const ORACLE_TITLE = "painted close y matches priceToCoordinate in %s mode within 1 CSS px";

// ── small structural readers ────────────────────────────────────────────────────
function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
// Accepts an absolute path (vitest --filesOnly emits those), a repo-root relative path
// ("terminal/lib/...", the shape the coverage census uses) or a terminal-relative path
// ("lib/__tests__/...") and returns one repo-root relative posix path.
function toRepoRelative(p: string): string {
  const posix = p.split(/[\\/]/).join("/");
  if (path.isAbsolute(posix)) return path.relative(REPO_ROOT, posix).split(path.sep).join("/");
  if (posix.startsWith("terminal/")) return posix;
  if (fs.existsSync(path.join(TERMINAL_DIR, posix))) return `terminal/${posix}`;
  return path.relative(REPO_ROOT, path.resolve(TERMINAL_DIR, posix)).split(path.sep).join("/");
}
function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

// Minimal glob matcher for the four patterns vitest.config.ts actually uses ("**", "*", "{a,b}").
// The authoritative collection evidence is collected-files.json (produced by vitest itself); this
// matcher only proves the planned suites are inside the configured include and outside the exclude.
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function globToRegExp(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      i++;
      if (pattern[i + 1] === "/") {
        i++;
        out += "(?:.*/)?";
      } else {
        out += ".*";
      }
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "{") {
      const end = pattern.indexOf("}", i);
      const alts = end === -1 ? [] : pattern.slice(i + 1, end).split(",");
      out += end === -1 ? escapeRe(ch) : `(?:${alts.map(escapeRe).join("|")})`;
      if (end !== -1) i = end;
    } else {
      out += escapeRe(ch);
    }
  }
  return new RegExp(`^${out}$`);
}
function matchesAny(relFromTerminal: string, patterns: string[]): boolean {
  return patterns.some((p) => globToRegExp(p).test(relFromTerminal));
}
// vitest 2.1.9 configDefaults.exclude, mirrored as data: importing "vitest/config" inside a jsdom
// suite pulls in vite -> esbuild, which aborts on jsdom's TextEncoder/Uint8Array invariant. Verified
// against node_modules/vitest/dist/config.cjs at BASE_SHA. vitest.config.ts declares no exclude of
// its own, so these defaults are the ones in force.
const VITEST_DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/cypress/**",
  "**/.{idea,git,cache,output,temp}/**",
  "**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*",
];
// Read the pattern literals out of vitest.config.ts. The authoritative "vitest collected this suite"
// evidence is collected-files.json (produced by vitest's own matcher); this only proves the planned
// suites sit inside the configured include and outside the configured exclude.
function configPatterns(key: "include" | "exclude"): string[] {
  const src = fs.readFileSync(VITEST_CONFIG_FILE, "utf8");
  const block = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(src);
  if (!block) return key === "exclude" ? VITEST_DEFAULT_EXCLUDE : [];
  const own = [...block[1].matchAll(/"([^"]+)"|'([^']+)'/g)].map((m) => m[1] ?? m[2] ?? "");
  if (key === "exclude" && own.length === 0) return VITEST_DEFAULT_EXCLUDE;
  return own;
}

// ── Q01-A01 inputs ──────────────────────────────────────────────────────────────
function coverageSuiteFiles(): string[] {
  const items = Array.isArray(asRecord(readJson(COVERAGE_FILE)).items)
    ? (asRecord(readJson(COVERAGE_FILE)).items as unknown[])
    : [];
  const files: string[] = [];
  for (const item of items) {
    for (const t of Array.isArray(asRecord(item).tests) ? (asRecord(item).tests as unknown[]) : []) {
      const f = asString(asRecord(t).file);
      if (f) files.push(toRepoRelative(f));
    }
  }
  return uniqueSorted(files);
}
function gapSuitesOnDisk(): string[] {
  return uniqueSorted(
    fs
      .readdirSync(TESTS_DIR)
      .filter((n) => /^chartEngineGap.*\.test\.tsx?$/.test(n))
      .map((n) => toRepoRelative(path.join(TESTS_DIR, n))),
  );
}
function plannedSuites(): string[] {
  return uniqueSorted([...coverageSuiteFiles(), ...gapSuitesOnDisk()]);
}
function collectedManifest(): string[] {
  const raw = readJson(MANIFEST_FILE);
  const list = Array.isArray(raw) ? raw : asStringArray(asRecord(raw).files).map((f) => f);
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string") out.push(toRepoRelative(entry));
    else out.push(toRepoRelative(asString(asRecord(entry).file)));
  }
  return uniqueSorted(out.filter(Boolean));
}

type ManifestAudit = {
  missingOnDisk: string[];
  notIncluded: string[];
  excluded: string[];
  notCollected: string[];
  manifestEntriesMissingOnDisk: string[];
};
function auditPlannedSuites(input: {
  planned: string[];
  manifest: string[];
  include: string[];
  exclude: string[];
}): ManifestAudit {
  const collected = new Set(input.manifest);
  const missingOnDisk: string[] = [];
  const notIncluded: string[] = [];
  const excluded: string[] = [];
  const notCollected: string[] = [];
  for (const suite of input.planned) {
    if (!fs.existsSync(path.join(REPO_ROOT, suite))) missingOnDisk.push(suite);
    const rel = suite.startsWith("terminal/") ? suite.slice("terminal/".length) : suite;
    if (!matchesAny(rel, input.include)) notIncluded.push(suite);
    if (matchesAny(rel, input.exclude)) excluded.push(suite);
    if (!collected.has(suite)) notCollected.push(suite);
  }
  const manifestEntriesMissingOnDisk = input.manifest.filter((f) => !fs.existsSync(path.join(REPO_ROOT, f)));
  return {
    missingOnDisk: uniqueSorted(missingOnDisk),
    notIncluded: uniqueSorted(notIncluded),
    excluded: uniqueSorted(excluded),
    notCollected: uniqueSorted(notCollected),
    manifestEntriesMissingOnDisk: uniqueSorted(manifestEntriesMissingOnDisk),
  };
}

// ── Q01-A03 inputs: independent price→coordinate recompute ──────────────────────
const ORACLE_CANDLES: EngineSeriesRow[] = [
  { time: 1_700_000_000, open: 10, high: 12, low: 9, close: 11 },
  { time: 1_700_000_060, open: 11, high: 20, low: 10, close: 18 },
  { time: 1_700_000_120, open: 18, high: 19, low: 14, close: 15 },
];
const ORACLE_RANGE = { from: 8, to: 20 };
const ORACLE_MARGINS = { top: 0.25, bottom: 0.125 };
const ORACLE_CLOSE_INDEX = 1;
const ORACLE_CLOSE = 18;

// Recomputed here from the pane height, the margins and the range we set through the contract —
// never by calling the engine's own transform. Mirrors the LWC coordinate convention:
// y grows downward, the internal band is [topPx, height-1-bottomPx].
function independentY(price: number, heightPx: number): number {
  const topPx = ORACLE_MARGINS.top * heightPx;
  const bottomPx = ORACLE_MARGINS.bottom * heightPx;
  const internalHeight = heightPx - topPx - bottomPx;
  const ratio = (price - ORACLE_RANGE.from) / (ORACLE_RANGE.to - ORACLE_RANGE.from);
  return heightPx - 1 - (bottomPx + ratio * (internalHeight - 1));
}

type CtxCall = { method: string; args: unknown[] };
type FakeCtx = CanvasRenderingContext2D & { __calls: CtxCall[] };
const ctxByCanvas = new WeakMap<HTMLCanvasElement, FakeCtx>();

function makeFakeCtx(): FakeCtx {
  const calls: CtxCall[] = [];
  const props: Record<string, unknown> = {};
  const ctx: Record<string, unknown> = {
    __calls: calls,
    measureText: (text: string) => ({ width: String(text).length * 7 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  for (const m of [
    "setTransform", "fillRect", "clearRect", "drawImage", "beginPath", "moveTo", "lineTo", "stroke",
    "fill", "save", "restore", "scale", "translate", "rect", "arc", "clip", "closePath", "fillText",
    "strokeRect", "setLineDash",
  ]) {
    ctx[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
    };
  }
  for (const p of ["fillStyle", "strokeStyle", "lineWidth", "font", "textAlign", "textBaseline", "globalAlpha"]) {
    Object.defineProperty(ctx, p, {
      get: () => props[p],
      set: (v: unknown) => {
        calls.push({ method: `set:${p}`, args: [v] });
        props[p] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx as unknown as FakeCtx;
}

function bodyRectTops(calls: CtxCall[], color: string, xCss: number): number | null {
  let armed = false;
  let best: { y: number; dist: number } | null = null;
  for (const c of calls) {
    if (c.method === "set:fillStyle") armed = c.args[0] === color;
    else if (armed && c.method === "rect") {
      const x = Number(c.args[0]);
      const w = Number(c.args[2]);
      const dist = Math.abs(x + w / 2 - xCss);
      if (best == null || dist < best.dist) best = { y: Number(c.args[1]), dist };
    }
  }
  return best && best.dist < 8 ? best.y : null;
}

function buildFixedScaleEngine() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const scheduler = createManualScheduler();
  const engine = createCanvasEngine(container, {
    width: 240,
    height: 200,
    devicePixelRatio: 1,
    scheduler,
  });
  const s = engine.addSeries("candles", { upColor: "up-body", downColor: "down-body" });
  s.setData(ORACLE_CANDLES);
  s.priceScale().applyOptions({ autoScale: false, scaleMargins: ORACLE_MARGINS });
  s.priceScale().setVisibleRange(ORACLE_RANGE);
  engine.timeScale().setVisibleLogicalRange({ from: 0, to: 3 });
  scheduler.flush();
  return { container, engine, s, scheduler };
}

// ── C01-A03 inputs: TS compiler API member census ───────────────────────────────
function enumerateContractMembers(source: string): string[] {
  const sf = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const members: string[] = [];
  sf.forEachChild((node) => {
    if (!ts.isInterfaceDeclaration(node)) return;
    const exported = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) return;
    for (const member of node.members) {
      if (!ts.isMethodSignature(member) && !ts.isPropertySignature(member)) continue;
      if (!member.name || !ts.isIdentifier(member.name)) continue;
      members.push(`${node.name.text}.${member.name.text}`);
    }
  });
  return uniqueSorted(members);
}
type CensusEntry = { callers: string[]; rows: string[] };
function readApiCensus(): Record<string, CensusEntry> {
  const out: Record<string, CensusEntry> = {};
  for (const [key, value] of Object.entries(asRecord(readJson(API_CENSUS_FILE)))) {
    out[key] = { callers: asStringArray(asRecord(value).callers), rows: asStringArray(asRecord(value).rows) };
  }
  return out;
}
const callerText = new Map<string, string | null>();
function callerFileText(file: string): string | null {
  if (!callerText.has(file)) {
    const abs = path.join(REPO_ROOT, file);
    callerText.set(file, fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null);
  }
  return callerText.get(file) ?? null;
}
function callerSupportsMember(file: string, member: string): boolean {
  const text = callerFileText(file);
  if (text === null) return false;
  if (text.includes(`.${member}(`)) return true;
  return new RegExp(`\\.${member}(?![A-Za-z0-9_$])`).test(text);
}
type CensusAudit = {
  missingFromCensus: string[];
  extraInCensus: string[];
  unsupportedMembers: string[];
  unknownRowIds: string[];
};
function auditCensus(
  members: string[],
  census: Record<string, CensusEntry>,
  knownRowIds: Set<string>,
): CensusAudit {
  const memberSet = new Set(members);
  const missingFromCensus = members.filter((m) => !(m in census));
  const extraInCensus = Object.keys(census)
    .filter((k) => !memberSet.has(k))
    .sort();
  const unsupportedMembers: string[] = [];
  const unknownRowIds = new Set<string>();
  for (const key of members) {
    const entry = census[key] ?? { callers: [], rows: [] };
    const member = key.slice(key.indexOf(".") + 1);
    const hasCaller = entry.callers.some((f) => callerSupportsMember(f, member));
    const validRows = entry.rows.filter((r) => knownRowIds.has(r));
    for (const r of entry.rows) if (!knownRowIds.has(r)) unknownRowIds.add(r);
    if (!hasCaller && validRows.length === 0) unsupportedMembers.push(key);
  }
  return {
    missingFromCensus,
    extraInCensus,
    unsupportedMembers: unsupportedMembers.sort(),
    unknownRowIds: [...unknownRowIds].sort(),
  };
}
function coverageRowIds(): Set<string> {
  const items = asRecord(readJson(COVERAGE_FILE)).items;
  const ids = new Set<string>();
  for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
    const id = asString(asRecord(item).id);
    if (id) ids.add(id);
  }
  return ids;
}

// ── G00-A03 inputs: three separate version facts ────────────────────────────────
type VersionFacts = { manifestSpec: string; lockResolved: string; lockUrl: string; runtimeLoaded: string };
function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) } : null;
}
function satisfiesCaret(spec: string, version: string): boolean {
  const want = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(spec.trim());
  const got = parseVersion(version);
  if (!want || !got) return false;
  const base = { major: Number(want[1]), minor: Number(want[2]), patch: Number(want[3]) };
  if (got.major !== base.major) return false;
  if (got.minor !== base.minor) return got.minor > base.minor;
  return got.patch >= base.patch;
}
function versionAudit(facts: VersionFacts): { emptyFields: string[]; unsatisfied: string[]; mismatch: string[] } {
  const emptyFields = (Object.keys(facts) as Array<keyof VersionFacts>).filter((k) => facts[k].trim() === "");
  const unsatisfied = satisfiesCaret(facts.manifestSpec, facts.lockResolved)
    ? []
    : [`lockResolved ${facts.lockResolved || "(empty)"} does not satisfy manifestSpec ${facts.manifestSpec || "(empty)"}`];
  const mismatch =
    facts.runtimeLoaded === facts.lockResolved
      ? []
      : [`runtimeLoaded ${facts.runtimeLoaded || "(empty)"} != lockResolved ${facts.lockResolved || "(empty)"}`];
  return { emptyFields, unsatisfied, mismatch };
}
// The installed package's OWN package.json, resolved through Node's resolver (no import of vendor
// code). "lightweight-charts" has an exports map with only an `import` condition for ".", so the
// bare specifier cannot be require-resolved; "./package.json" is exported and resolves exactly.
function runtimePackageJsonFile(): string {
  const req = createRequire(import.meta.url);
  try {
    return req.resolve("lightweight-charts/package.json");
  } catch {
    let dir = path.dirname(req.resolve("lightweight-charts"));
    for (;;) {
      const candidate = path.join(dir, "package.json");
      if (fs.existsSync(candidate) && asString(asRecord(readJson(candidate)).name) === "lightweight-charts") {
        return candidate;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return "";
      dir = parent;
    }
  }
}
function runtimeLoadedVersion(): string {
  const file = runtimePackageJsonFile();
  return file ? asString(asRecord(readJson(file)).version) : "";
}
function liveVersionFacts(): VersionFacts {
  const pkg = asRecord(readJson(path.join(TERMINAL_DIR, "package.json")));
  const lock = asRecord(readJson(path.join(TERMINAL_DIR, "package-lock.json")));
  const entry = asRecord(asRecord(lock.packages)["node_modules/lightweight-charts"]);
  return {
    manifestSpec: asString(asRecord(pkg.dependencies)["lightweight-charts"]),
    lockResolved: asString(entry.version),
    lockUrl: asString(entry.resolved),
    runtimeLoaded: runtimeLoadedVersion(),
  };
}

describe("Q01-A01: Each planned suite", () => {
  const include = configPatterns("include");
  const exclude = configPatterns("exclude");

  it("collected manifest membership: every planned suite appears in collected-files.json, not only in the include globs", () => {
    expect(include.length, "vitest.config include patterns").toBeGreaterThan(0);
    const planned = plannedSuites();
    expect(planned.length, "planned suite count").toBeGreaterThan(0);
    const audit = auditPlannedSuites({ planned, manifest: collectedManifest(), include, exclude });
    expect(audit.notCollected, "planned suites absent from the collected manifest").toEqual([]);
  });

  it("planned suites exist on disk and are inside vitest.config include and outside its exclude", () => {
    const audit = auditPlannedSuites({
      planned: plannedSuites(),
      manifest: collectedManifest(),
      include,
      exclude,
    });
    expect(audit.missingOnDisk, "planned suites missing on disk").toEqual([]);
    expect(audit.notIncluded, "planned suites not matched by include").toEqual([]);
    expect(audit.excluded, "planned suites matched by exclude").toEqual([]);
  });

  it("collected-files.json is non-empty, repo-relative, and every entry exists on disk", () => {
    const manifest = collectedManifest();
    expect(manifest.length, "collected manifest entries").toBeGreaterThan(0);
    expect(
      manifest.filter((f) => !f.startsWith("terminal/")),
      "manifest entries that are not repo-root relative",
    ).toEqual([]);
    const audit = auditPlannedSuites({ planned: [], manifest, include, exclude });
    expect(audit.manifestEntriesMissingOnDisk, "manifest entries missing on disk").toEqual([]);
    expect(manifest, "manifest is sorted and duplicate-free").toEqual(uniqueSorted(manifest));
  });

  it("the manifest audit names exactly an injected fake planned suite and a dropped manifest entry", () => {
    const planned = plannedSuites();
    const manifest = collectedManifest();
    const fake = "terminal/lib/__tests__/chartEngineGapNoSuchSuite.test.ts";
    const dropped = planned.find((p) => manifest.includes(p));
    expect(dropped, "a planned suite present in the manifest").toBeTruthy();
    const audit = auditPlannedSuites({
      planned: [...planned, fake],
      manifest: manifest.filter((m) => m !== dropped),
      include,
      exclude,
    });
    expect(audit.missingOnDisk).toEqual([fake]);
    expect(audit.notCollected).toEqual(uniqueSorted([fake, dropped as string]));
    expect(audit.notIncluded).toEqual([]);
    expect(audit.excluded).toEqual([]);
  });
});

describe("Q01-A03: Independent transform oracle", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, type: string) {
      if (type !== "2d") return null;
      let ctx = ctxByCanvas.get(this);
      if (!ctx) {
        ctx = makeFakeCtx();
        ctxByCanvas.set(this, ctx);
      }
      return ctx;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("priceToCoordinate equals an independent recompute from pane height, margins and the visible range", () => {
    const { engine, s } = buildFixedScaleEngine();
    const heightPx = engine.paneSize(0).height;
    expect(heightPx, "pane plot height").toBeGreaterThan(1);
    expect(s.priceScale().options().scaleMargins, "margins the oracle recomputes from").toEqual(ORACLE_MARGINS);
    expect(s.priceScale().getVisibleRange(), "range the oracle recomputes from").toEqual(ORACLE_RANGE);
    for (const price of [ORACLE_RANGE.from, 12.5, ORACLE_CLOSE, ORACLE_RANGE.to]) {
      const y = s.priceToCoordinate(price);
      expect(y, `priceToCoordinate(${price})`).not.toBeNull();
      expect(
        Math.abs((y as number) - independentY(price, heightPx)),
        `priceToCoordinate(${price}) vs independent recompute at height ${heightPx}`,
      ).toBeLessThanOrEqual(1e-6);
    }
    engine.destroy();
  });

  it("coordinateToPrice inverts the independent recompute (no shared-transform blind spot)", () => {
    const { engine, s } = buildFixedScaleEngine();
    const heightPx = engine.paneSize(0).height;
    for (const price of [ORACLE_RANGE.from, 12.5, ORACLE_CLOSE, ORACLE_RANGE.to]) {
      const back = s.coordinateToPrice(independentY(price, heightPx));
      expect(back, `coordinateToPrice(independentY(${price}))`).not.toBeNull();
      expect(Math.abs((back as number) - price), `round trip of ${price}`).toBeLessThanOrEqual(1e-6);
    }
    engine.destroy();
  });

  it("painted candle body y matches the independent recompute within 1 CSS px", () => {
    const { engine, s } = buildFixedScaleEngine();
    const heightPx = engine.paneSize(0).height;
    const x = engine.timeScale().logicalToCoordinate(ORACLE_CLOSE_INDEX);
    expect(x, "logicalToCoordinate of the known bar").not.toBeNull();
    const pane = engine.chartElement().querySelector("canvas[data-mm-pane-canvas]") as HTMLCanvasElement;
    const ctx = pane?.getContext("2d") as FakeCtx | null;
    const painted = ctx ? bodyRectTops(ctx.__calls, "up-body", x as number) : null;
    expect(painted, "painted body top for the known bar").not.toBeNull();
    expect(
      Math.abs((painted as number) - independentY(ORACLE_CLOSE, heightPx)),
      "painted body top vs independent recompute",
    ).toBeLessThanOrEqual(1);
    engine.destroy();
    expect(s.kind).toBe("candles");
  });

  it("the committed receipt names the OFFSET, SIGN and SCALE mutants, the mutated transform and the oracle title", () => {
    expect(fs.existsSync(MUTANT_RECEIPT_FILE), "q01-a03-mutant-receipts.txt exists").toBe(true);
    const receipt = fs.readFileSync(MUTANT_RECEIPT_FILE, "utf8");
    expect(receipt, "receipt names the mutated function").toContain("coordinateOfDisplay");
    expect(receipt, "receipt names the mutated file").toContain("terminal/lib/chart-engine/canvas/scales.ts");
    expect(receipt, "receipt records BASE_SHA").toContain(BASE_SHA);
    for (const mutant of ["MUTANT OFFSET", "MUTANT SIGN", "MUTANT SCALE"]) {
      expect(receipt, `receipt records ${mutant}`).toContain(mutant);
      const section = receipt.slice(receipt.indexOf(mutant));
      expect(section.slice(0, section.indexOf("MUTANT ", 1) === -1 ? undefined : section.indexOf("MUTANT ", 1)), `${mutant} has a RED/GREEN verdict`).toMatch(/VERDICT/);
    }
    expect(receipt, "receipt cites the oracle test title").toContain(ORACLE_TITLE);
    expect(receipt, "receipt cites the oracle file").toContain("chartEngineCanvasScaleTruth.test.ts");
  });

  it("the oracle test title cited by the receipt still exists in chartEngineCanvasScaleTruth.test.ts", () => {
    const oracle = fs.readFileSync(ORACLE_FILE, "utf8");
    expect(oracle, "cited oracle title present (receipt cannot rot)").toContain(ORACLE_TITLE);
    expect(oracle, "cited oracle describe present").toContain("one autoscale truth (G2)");
  });
});

describe("C01-A03: Unused vendor API", () => {
  const apiSource = fs.readFileSync(API_FILE, "utf8");
  const members = enumerateContractMembers(apiSource);
  const census = readApiCensus();
  const rowIds = coverageRowIds();

  it("api-census.json keys equal every member of every exported interface in api.ts", () => {
    expect(members.length, "enumerated api.ts interface members").toBeGreaterThan(0);
    expect(rowIds.size, "acceptance row ids in the coverage census").toBeGreaterThan(0);
    const audit = auditCensus(members, census, rowIds);
    expect(audit.missingFromCensus, "members absent from api-census.json").toEqual([]);
    expect(audit.extraInCensus, "census keys that are not api.ts members").toEqual([]);
  });

  it("every contract member has a consumer caller or an acceptance row id (no completeness-only surface)", () => {
    const audit = auditCensus(members, census, rowIds);
    expect(
      audit.unsupportedMembers,
      "members with neither a caller file containing .<member>( nor a row id in the coverage census",
    ).toEqual([]);
    expect(audit.unknownRowIds, "census row ids absent from the coverage census").toEqual([]);
  });

  it("the census audit names an injected fake member and a member stripped of its callers and rows", () => {
    const fake = "ChartEngine.bogusCensusProbe";
    const stripped = "ChartEngine.inventory";
    const mutated: Record<string, CensusEntry> = { ...census, [fake]: { callers: [], rows: [] } };
    mutated[stripped] = { callers: [], rows: [] };
    const audit = auditCensus([...members, fake], mutated, rowIds);
    expect(audit.missingFromCensus).toEqual([]);
    expect(audit.extraInCensus).toEqual([]);
    expect(audit.unsupportedMembers).toEqual([fake, stripped].sort());
    const droppedCaller: Record<string, CensusEntry> = {
      ...census,
      [stripped]: { callers: ["terminal/does/not/exist.tsx"], rows: [] },
    };
    expect(auditCensus(members, droppedCaller, rowIds).unsupportedMembers).toEqual([stripped]);
  });
});

describe("G00-A03: Manifest says ^5.2.0", () => {
  const facts = liveVersionFacts();
  const fixture = asRecord(readJson(VERSIONS_FILE));

  it("manifest spec, lockfile resolved version and loaded runtime version are three separate non-empty facts", () => {
    console.log(
      `G00-A03 ${JSON.stringify({
        manifestSpec: facts.manifestSpec,
        lockResolved: facts.lockResolved,
        lockUrl: facts.lockUrl,
        runtimeLoaded: facts.runtimeLoaded,
        node: process.version,
      })}`,
    );
    const audit = versionAudit(facts);
    expect(audit.emptyFields, "empty version facts read at runtime").toEqual([]);
    for (const key of ["manifestSpec", "lockResolved", "runtimeLoaded", "ciRuntime"]) {
      expect(Object.prototype.hasOwnProperty.call(fixture, key), `committed receipt has its own "${key}" key`).toBe(true);
      expect(asString(fixture[key]).trim(), `committed receipt "${key}" is non-empty`).not.toBe("");
    }
    expect(asString(fixture.ciRuntime), "CI runtime is recorded separately from the local runtime").not.toBe(
      asString(fixture.runtimeLoaded),
    );
  });

  it("lockResolved satisfies manifestSpec ^5.2.0 and runtimeLoaded equals lockResolved", () => {
    expect(facts.manifestSpec, "manifest dependency spec").toBe("^5.2.0");
    const audit = versionAudit(facts);
    expect(audit.unsatisfied, "lockfile version outside the manifest spec").toEqual([]);
    expect(audit.mismatch, "loaded runtime differs from the locked version").toEqual([]);
    expect(asString(fixture.lockResolved), "committed receipt matches the lockfile at this head").toBe(facts.lockResolved);
    expect(asString(fixture.manifestSpec), "committed receipt matches package.json at this head").toBe(facts.manifestSpec);
    expect(asString(fixture.runtimeLoaded), "committed receipt runtime equals its own lock version").toBe(
      asString(fixture.lockResolved),
    );
  });

  it("the semver audit rejects an in-memory lock of 5.1.0 and a runtime of 5.3.0", () => {
    expect(satisfiesCaret("^5.2.0", "5.2.0")).toBe(true);
    expect(satisfiesCaret("^5.2.0", "5.9.1")).toBe(true);
    expect(satisfiesCaret("^5.2.0", "5.1.9")).toBe(false);
    expect(satisfiesCaret("^5.2.0", "6.0.0")).toBe(false);
    const staleLock = versionAudit({ ...facts, lockResolved: "5.1.0", runtimeLoaded: "5.1.0" });
    expect(staleLock.unsatisfied).toEqual(["lockResolved 5.1.0 does not satisfy manifestSpec ^5.2.0"]);
    const driftedRuntime = versionAudit({ ...facts, runtimeLoaded: "5.3.0" });
    expect(driftedRuntime.mismatch).toEqual(["runtimeLoaded 5.3.0 != lockResolved 5.2.0"]);
  });
});
