import { promises as fs } from "fs";
import path from "path";
import type {
  EntryRadarFile,
  EpisodeDisplay,
  FreshnessVerdict,
  LiveEntryEpisode,
  SourceRead,
  Stance,
} from "./types";

export const MAX_STALE_MS = 6 * 60 * 60_000;
export const PACK_MAX_LAG_DAYS = 4;
export const IN_WINDOW_STALE_S = 20 * 60;
export const OUT_OF_WINDOW_STALE_S = 26 * 3600;

export const fixtureCookieName = "mm_e2e_dislo";

type CacheEntry = { mtimeMs: number; file: EntryRadarFile; loadedAt: number };
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

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(db - da) / (24 * 60 * 60 * 1000);
}

export async function readSource(filePath: string, now = Date.now()): Promise<SourceRead> {
  const cached = cache.get(filePath);

  let mtimeMs: number;
  try {
    const st = await fs.stat(filePath);
    mtimeMs = st.mtimeMs;
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    const reason = code === "ENOENT" ? "missing" : "unreadable";
    return staleFallback(filePath, cached, now, reason);
  }

  if (cached && cached.mtimeMs === mtimeMs) {
    return {
      kind: "ok",
      file: cached.file,
      mtimeMs,
      loadedAt: cached.loadedAt,
      servedFromCache: true,
    };
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

  const file = materializeAsof(parsed, now);
  const entry: CacheEntry = { mtimeMs, file, loadedAt: now };
  cache.set(filePath, entry);
  return {
    kind: "ok",
    file,
    mtimeMs,
    loadedAt: now,
    servedFromCache: false,
  };
}

function staleFallback(
  filePath: string,
  cached: CacheEntry | undefined,
  now: number,
  reason: "missing" | "unreadable" | "malformed" | "schema"
): SourceRead {
  if (cached && now - cached.loadedAt <= MAX_STALE_MS) {
    return {
      kind: "ok",
      file: cached.file,
      mtimeMs: cached.mtimeMs,
      loadedAt: cached.loadedAt,
      servedFromCache: true,
    };
  }
  const lastGood =
    cached != null ? { asof: cached.file.asof, at: cached.loadedAt } : null;
  if (cached && now - cached.loadedAt > MAX_STALE_MS) {
    cache.delete(filePath);
  }
  return { kind: "unavailable", reason, lastGood };
}

export function freshness(file: EntryRadarFile, now = Date.now()): FreshnessVerdict {
  const parsed = Date.parse(file.asof);
  const age_s = Number.isNaN(parsed) ? null : Math.round((now - parsed) / 1000);

  const pack_fresh =
    daysBetween(file.pack.as_of, file.session) <= PACK_MAX_LAG_DAYS;

  const threshold =
    file.health?.state === "out_of_window" ? OUT_OF_WINDOW_STALE_S : IN_WINDOW_STALE_S;
  const file_old = age_s !== null && age_s > threshold;

  const stale = !pack_fresh || file_old || age_s === null;

  let reason: FreshnessVerdict["reason"] = "fresh";
  if (age_s === null) reason = "no_asof";
  else if (!pack_fresh) reason = "pack_old";
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

export function displayFor(ep: LiveEntryEpisode): EpisodeDisplay {
  const stance = stanceOf(ep.state);
  let stance_en: string;
  let stance_zh: string;
  if (stance === "forming") {
    stance_en = "Watching — not confirmed yet";
    stance_zh = "观察中——尚未确认";
  } else if (stance === "confirmed") {
    stance_en = "Reclaim confirmed — see when it was knowable";
    stance_zh = "回收已确认——查看可知时间";
  } else {
    stance_en = "Ended — kept for the record";
    stance_zh = "已结束——仅作记录";
  }
  const knowable_at =
    ep.candidate_at ?? ep.last_observed_at ?? ep.first_armed_at ?? null;
  return {
    stance,
    stance_en,
    stance_zh,
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
      if (ka !== kb) return kb.localeCompare(ka);
      if (a.ep.episode_id !== b.ep.episode_id) {
        return a.ep.episode_id.localeCompare(b.ep.episode_id);
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

// Fix staleFallback to delete expired cache - I need to pass filePath to staleFallback
