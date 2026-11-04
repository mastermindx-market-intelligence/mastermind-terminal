import { canonicalChartSymbol } from "../terminalBoot";

export const EPISODE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/;

export function canonicalEpisodeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return EPISODE_ID_RE.test(trimmed) ? trimmed : null;
}

export function episodeChartHref(sym: unknown, episodeId: unknown): string | null {
  const s = canonicalChartSymbol(sym);
  const id = canonicalEpisodeId(episodeId);
  if (s === null || id === null) return null;
  return `/terminal?sym=${encodeURIComponent(s)}&episode=${encodeURIComponent(id)}`;
}
