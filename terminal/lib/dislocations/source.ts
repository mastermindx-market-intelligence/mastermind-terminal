import { promises as fs } from "fs";
import path from "path";
import type {
  EntryRadarFile,
  EpisodeDisplay,
  FreshnessVerdict,
  LiveEntryEpisode,
  SourceFallbackReason,
  SourceRead,
  Stance,
} from "./types";

export const MAX_STALE_MS = 6 * 60 * 60_000;
export const PACK_MAX_LAG_DAYS = 4;
export const IN_WINDOW_STALE_S = 20 * 60;
export const OUT_OF_WINDOW_STALE_S = 26 * 3600;

export const fixtureCookieName = "mm_e2e_dislo";

type CacheEntry = { mtimeMs: number; raw: EntryRadarFile; loadedAt: number };
const cache = new Map<string, CacheEntry>();

export function liveDir(): string {
  return process.env.MACRO_LIVE_DIR || "/var/lib/macro-live/public/live";
}

export function resolveSourcePath(cookieValue: string | undefined): string {
  const fixtureRe = /^[a-z0-9_-]{1,40}$/;
  if (process.env.TERMINAL_E2E_FIXTURE === "1" && cookieValue && fixtureRe.test(cookieValue)) {
    return path.join(process.cwd(), "fixtures", "dislocations", `${cookieValue}.json`);
  }
  return path.join(liveDir(), "entry_radar.json");
}

function isFixturePath(filePath: string): boolean {
  return filePath.includes(`${path.sep}fixtures${path.sep}dislocations${path.sep}`);
}

export function validateFile(raw: unknown): raw is EntryRadarFile {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.schema !== "entry_radar.live/v1") return false;
  if (typeof o.asof !== "string") return false;
  if (typeof o.session !== "string") return false;
  const pack = o.pack;
  if (!pack || typeof pack !== "object") return false;
  if (typeof (pack as Record<string, unknown>).as_of !== "string") return false;
  if (o.episodes !== undefined && !Array.isArray(o.episodes)) return false;
  return true;
}

export function materializeAsof(file: EntryRadarFile, now = Date.now()): EntryRadarFile {
  const asof = file.asof;
  if (asof === "@now") {
    return { ...file, asof: new Date(now).toISOString() };
  }
  const m = /^@now-(\d+)s$/.exec(asof);
  if (m) {
    const offsetMs = Number(m[1]) * 1000;
    return { ...file, asof: new Date(now - offsetMs).toISOString() };
  }
  return file;
}

function packLagDays(session: string, packAsOf: string): number {
  const ds = Date.parse(`${session}T00:00:00Z`);
  const dp = Date.parse(`${packAsOf}T00:00:00Z`);
  if (Number.isNaN(ds) || Number.isNaN(dp)) return Infinity;
  return (ds - dp) / (24 * 60 * 60 * 1000);
}

function serveFromCache(entry: CacheEntry, now: number, filePath: string): SourceRead {
  const file = materializeAsof(entry.raw, now);
  return {
    kind: "ok",
    file,
    mtimeMs: entry.mtimeMs,
    loadedAt: entry.loadedAt,
    servedFromCache: true,
    fallback_reason: null,
  };
}

export async function readSource(filePath: string, now = Date.now()): Promise<SourceRead> {
  const cached = cache.get(filePath);

  let mtimeMs: number;
  try {
    const st = await fs.stat(filePath);
    mtimeMs = st.mtimeMs;
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    const reason: SourceFallbackReason = code === "ENOENT" ? "missing" : "unreadable";
    return staleFallback(filePath, cached, now, reason);
  }

  if (cached && cached.mtimeMs === mtimeMs) {
    if (isFixturePath(filePath)) {
      const file = materializeAsof(cached.raw, now);
      return {
        kind: "ok",
        file,
        mtimeMs,
        loadedAt: cached.loadedAt,
        servedFromCache: true,
        fallback_reason: null,
      };
    }
    return serveFromCache(cached, now, filePath);
  }

  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return staleFallback(filePath, cached, now, "unreadable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return staleFallback(filePath, cached, now, "malformed");
  }

  if (!validateFile(parsed)) {
    return staleFallback(filePath, cached, now, "schema");
  }

  const rawFile = parsed as EntryRadarFile;
  const entry: CacheEntry = { mtimeMs, raw: rawFile, loadedAt: now };
  cache.set(filePath, entry);
  const file = materializeAsof(rawFile, now);
  return {
    kind: "ok",
    file,
    mtimeMs,
    loadedAt: now,
    servedFromCache: false,
    fallback_reason: null,
  };
}

function staleFallback(
  filePath: string,
  cached: CacheEntry | undefined,
  now: number,
  reason: SourceFallbackReason
): SourceRead {
  if (cached && now - cached.loadedAt <= MAX_STALE_MS) {
    const file = materializeAsof(cached.raw, now);
    return {
      kind: "ok",
      file,
      mtimeMs: cached.mtimeMs,
      loadedAt: cached.loadedAt,
      servedFromCache: true,
      fallback_reason: reason,
    };
  }
  const lastGood =
    cached != null
      ? { asof: materializeAsof(cached.raw, cached.loadedAt).asof, at: cached.loadedAt }
      : null;
  if (cached && now - cached.loadedAt > MAX_STALE_MS) {
    cache.delete(filePath);
  }
  return { kind: "unavailable", reason, lastGood };
}

export function freshness(file: EntryRadarFile, now = Date.now()): FreshnessVerdict {
  const parsed = Date.parse(file.asof);
  const age_s = Number.isNaN(parsed) ? null : Math.round((now - parsed) / 1000);

  const lag = packLagDays(file.session, file.pack.as_of);
  let pack_fresh = lag >= 0 && lag <= PACK_MAX_LAG_DAYS;

  const threshold =
    file.health?.state === "out_of_window" ? OUT_OF_WINDOW_STALE_S : IN_WINDOW_STALE_S;
  const file_old = age_s !== null && age_s > threshold;

  const stale = !pack_fresh || file_old || age_s === null;

  let reason: FreshnessVerdict["reason"] = "fresh";
  if (age_s === null) reason = "no_asof";
  else if (lag < 0) reason = "pack_asof_after_session";
  else if (lag > PACK_MAX_LAG_DAYS) reason = "pack_old";
  else if (file_old) reason = "file_old";

  return { stale, pack_fresh, age_s, reason };
}

export function stanceOf(state: string): Stance {
  switch (state) {
    case "PROBING":
    case "ARMED":
    case "TURNING":
      return "forming";
    case "CANDIDATE":
      return "confirmed";
    case "RESOLVED":
    case "EXPIRED":
    case "INVALIDATED":
      return "ended";
    default:
      return "forming";
  }
}

const DELAY_EN = "Delayed data (≈15 min)" as const;
const DELAY_ZH = "延迟数据（约15分钟）" as const;

const ET_HM = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/New_York",
});

function stanceStrings(state: string): { stance_en: string; stance_zh: string } {
  switch (state) {
    case "PROBING":
    case "ARMED":
      return { stance_en: "Washout, no turn yet", stance_zh: "洗盘中，尚未转向" };
    case "TURNING":
      return { stance_en: "Turn forming, not held", stance_zh: "转向形成，未站稳" };
    case "CANDIDATE":
      return { stance_en: "Reclaim held", stance_zh: "收复已站稳" };
    case "INVALIDATED":
      return { stance_en: "Turn failed", stance_zh: "转向失败" };
    case "EXPIRED":
      return { stance_en: "Ran out of session", stance_zh: "本节已到时" };
    case "RESOLVED":
      return { stance_en: "Window closed", stance_zh: "观察期结束" };
    default:
      return { stance_en: "Status unavailable", stance_zh: "状态不可用" };
  }
}

function watchingLines(risk_geometry: Record<string, unknown>): {
  watching_en: string | null;
  watching_zh: string | null;
} {
  try {
    const levelRaw = risk_geometry.invalidation_level;
    const untilRaw = risk_geometry.time_budget_until;
    if (typeof untilRaw !== "string") {
      return { watching_en: null, watching_zh: null };
    }
    const level =
      typeof levelRaw === "number" ? levelRaw : typeof levelRaw === "string" ? Number(levelRaw) : NaN;
    if (!Number.isFinite(level)) {
      return { watching_en: null, watching_zh: null };
    }
    const parsed = Date.parse(untilRaw);
    if (Number.isNaN(parsed)) {
      return { watching_en: null, watching_zh: null };
    }
    const hhmm = ET_HM.format(parsed);
    const levelStr = level.toFixed(2);
    return {
      watching_en: `Turn fails below ${levelStr} · budget to ${hhmm} ET`,
      watching_zh: `跌破 ${levelStr} 即失效 · 预算至 ${hhmm} 美东`,
    };
  } catch {
    return { watching_en: null, watching_zh: null };
  }
}

export function displayFor(ep: LiveEntryEpisode): EpisodeDisplay {
  const stance = stanceOf(ep.state);
  const { stance_en, stance_zh } = stanceStrings(ep.state);
  const { watching_en, watching_zh } = watchingLines(ep.risk_geometry ?? {});
  const knowable_at =
    ep.candidate_at ?? ep.last_observed_at ?? ep.first_armed_at ?? null;
  return {
    stance,
    stance_en,
    stance_zh,
    watching_en,
    watching_zh,
    knowable_at,
    delay_badge_en: DELAY_EN,
    delay_badge_zh: DELAY_ZH,
  };
}

function sortKey(ep: LiveEntryEpisode): string {
  return ep.last_observed_at ?? ep.candidate_at ?? ep.first_armed_at ?? "";
}

export function sortNewestFirst(eps: LiveEntryEpisode[]): LiveEntryEpisode[] {
  return eps
    .map((ep, i) => ({ ep, i }))
    .sort((a, b) => {
      const ka = sortKey(a.ep);
      const kb = sortKey(b.ep);
      if (ka !== kb) return ka < kb ? 1 : -1;
      if (a.ep.episode_id !== b.ep.episode_id) {
        return a.ep.episode_id < b.ep.episode_id ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map(({ ep }) => ep);
}

export function knowableAtMax(eps: LiveEntryEpisode[]): string | null {
  let max: string | null = null;
  for (const ep of eps) {
    const k = ep.candidate_at ?? ep.last_observed_at ?? ep.first_armed_at ?? null;
    if (k && (max === null || k > max)) max = k;
  }
  return max;
}

export function resetDislocationsSourceCacheForTests(): void {
  cache.clear();
}
