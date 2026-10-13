import { useCallback } from "react";
import { useT } from "./i18n";
const KEYS = {
  title: "futuresWsTitle",
  subtitle: "futuresWsSubtitle",
  back: "futuresWsBack",
  chart: "futuresWsChart",
  instrument: "futuresWsInstrument",
  interval: "futuresWsInterval",
  rows: "futuresWsRows",
  mapping: "futuresWsMapping",
  ratio: "futuresWsRatio",
  basis: "futuresWsBasis",
  expiry: "futuresWsExpiry",
  all: "futuresWsAll",
  zero: "futuresWsZero",
  later: "futuresWsLater",
  replay: "futuresWsReplay",
  latest: "futuresWsLatest",
  refresh: "futuresWsRefresh",
  minute: "futuresWsMinute",
  minutes: "futuresWsMinutes",
  ticks: "futuresWsTicks",
  depth: "futuresWsDepth",
  footprint: "futuresWsFootprint",
  chartView: "futuresWsChartView",
  gamma: "futuresWsGamma",
  cvd: "futuresWsCvd",
  zoom: "futuresWsZoom",
  loading: "futuresWsLoading",
  volume: "futuresWsVolume",
  delta: "futuresWsDelta",
  unknown: "futuresWsUnknown",
  realtime: "futuresWsRealtime",
  delayed: "futuresWsDelayed",
  historical: "futuresWsHistorical",
  source_unavailable: "futuresWsSourceUnavailable",
  source_restricted: "futuresWsSourceRestricted",
  source_invalid: "futuresWsSourceInvalid",
  stale_source: "futuresWsStaleSource",
  no_replay_frame: "futuresWsNoReplayFrame",
  access_required: "futuresWsAccessRequired",
  invalid_request: "futuresWsInvalidRequest",
  source: "futuresWsSource",
  through: "futuresWsThrough",
  gammaMissing: "futuresWsGammaMissing",
  cashClosed: "futuresWsCashClosed",
  gammaHeading: "futuresWsGammaHeading",
  strike: "futuresWsStrike",
  level: "futuresWsLevel",
  notice: "futuresWsNotice",
  expiryNotice: "futuresWsExpiryNotice",
  replayNotice: "futuresWsReplayNotice",
  esPair: "futuresWsEsPair",
  nqPair: "futuresWsNqPair",
} as const;
export type FuturesCopyKey = keyof typeof KEYS;
export function useFuturesText() {
  const t = useT();
  return useCallback((key: FuturesCopyKey): string => t(KEYS[key]), [t]);
}
export const publicFuturesReason = (value: unknown): FuturesCopyKey => typeof value === "string" &&
  ["source_unavailable", "source_restricted", "source_invalid", "stale_source", "no_replay_frame", "access_required", "invalid_request"].includes(value)
  ? value as FuturesCopyKey : "source_unavailable";
