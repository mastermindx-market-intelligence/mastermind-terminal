import { macroDate, macroNumber, macroRecord, macroText, type MacroRecord } from "./macroDashboard";

export const releaseIdentity = (item: MacroRecord): string => JSON.stringify([item.release, item.release_type, item.period, item.release_date].map(value => macroText(value)));

export function qualifiedForecast(source: MacroRecord, sha: string | null): boolean {
 const authority = macroRecord(source.authority), asof = macroText(source.asof);
 return source.schema === "release_forecast.v2" && source.display_only === true
  && ["can_score", "can_size", "can_trade"].every(key => authority[key] === false)
  && !!asof && /(?:Z|[+-]\d{2}:\d{2})$/.test(asof) && Number.isFinite(Date.parse(asof))
  && !!sha && /^[a-f0-9]{64}$/.test(sha);
}

/** The source owner allows 30 hours. No dashboard/read clock freshens it. */
export function forecastIsOlder(source: MacroRecord, now: Date): boolean {
 const published = Date.parse(String(source.asof));
 return !Number.isFinite(published) || published > now.getTime() || now.getTime() - published > 30 * 3600000;
}

export function forecastContextAligned(item: MacroRecord): boolean {
 const primary = macroText(item.primary_forecast_basis), context = macroText(item.context_metrics_basis);
 return !primary || (context ? context === primary : primary !== "combined_v1_benchmark_augmented");
}

export function forecastInterval(model: MacroRecord): number[] | null {
 if (model.claim_withdrawn || model.mode === "benchmark_only") return null;
 const values = [model.p10, model.p25, model.p50, model.p75, model.p90].map(macroNumber);
 return values.every((value, i) => value !== null && (i === 0 || value >= (values[i - 1] ?? Infinity))) ? values as number[] : null;
}

export function primaryForecast(item: MacroRecord): { model: MacroRecord; point: number | null; blend: boolean; benchmarkOnly: boolean; noData: boolean } {
 const projection = macroRecord(item.projection), blend = item.primary_forecast_basis === "combined_v1_benchmark_augmented";
 const combined = macroRecord(item.combined);
 const model = blend ? combined.display_only === true && combined.authority === false ? combined : {} : projection;
 const benchmarkOnly = projection.mode === "benchmark_only";
 const noData = projection.mode === "no_data" || String(macroRecord(item.pit).reason ?? "").startsWith("no_data");
 return { model: benchmarkOnly || noData ? {} : model, point: benchmarkOnly || noData || model.claim_withdrawn ? null : macroNumber(blend ? model.combined_point : model.point), blend, benchmarkOnly, noData };
}

export function forecastShadowDisplayable(model: MacroRecord, key: string, item: MacroRecord): boolean {
 if (model.claim_withdrawn || model.display_only !== true || ("authority" in model && model.authority !== false)) return false;
 if (key !== "coherent_ridge_v1") return true;
 const receipt = (name: string) => macroRecord(model[name]);
 const sealed = ["input_manifest", "model_receipt", "truth_receipt", "training_receipt", "interval_receipt"].every(name => /^[a-f0-9]{64}$/i.test(String(receipt(name).sha256)));
 return model.schema === "release_cpi_coherent_shadow.v1" && model.status === "shadow_candidate" && model.model === key
  && model.authority === false && model.promotion_authorized === false && model.release === item.release_type
  && model.period === item.period && model.release_date === item.release_date && sealed
  && model.inputs_hash === receipt("input_manifest").sha256 && receipt("input_manifest").release === model.release
  && receipt("model_receipt").model_epoch === model.model_epoch && receipt("truth_receipt").target_epoch === model.target_epoch
  && receipt("training_receipt").input_manifest_sha256 === model.inputs_hash
  && receipt("interval_receipt").training_receipt_sha256 === receipt("training_receipt").sha256;
}

/** A producer-issued display state alone cannot excuse incompatible score bases. */
export function forecastErrorDisplayable(row: MacroRecord, track: MacroRecord): boolean {
 const n = macroNumber(row.clean_n), minimum = macroNumber(track.display_min_n), ci = Array.isArray(row.mae_ours_ci) ? row.mae_ours_ci.map(macroNumber) : [];
 return row.display_state === "display_only" && row.benchmark_only !== true
  && n !== null && minimum !== null && minimum > 0 && n >= minimum
  && macroNumber(row.first_print_matched_n) === n && Array.isArray(row.target_epochs) && row.target_epochs.length === 1
  && macroNumber(row.mae_ours) !== null && ci.length === 2 && ci[0] !== null && ci[1] !== null && ci[0] >= 0 && ci[1] >= ci[0];
}

export function releaseSelection(hash: string): { date: string | null; target: string | null } {
 const values = new URLSearchParams(hash.split("?")[1] ?? "");
 return { date: values.get("date") === "undated" ? "undated" : macroDate(values.get("date")), target: values.get("target")?.slice(0, 600) ?? null };
}
