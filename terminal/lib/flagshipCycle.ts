type Data = Record<string, unknown>;
const isObject = (v: unknown): v is Data => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length <= 4096 ? v : null;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
export type Turn = { date: string; kind: "peak" | "trough"; tentative: boolean | null; note: string | null };
export type Band = { name: string; tier: "measured" | "frame"; turns: Turn[]; asof: string | null;
  source: string | null; monthly: boolean; stale: boolean; osc: {x:number;v:number}[];
  projection: { low: string; mid: string; high: string; kind: string; overdue: boolean } | null };
export type CycleModel = { notes: string | null; latest: string | null; cards: { id:string; name:string; bands:Band[] }[] };
function parseBand(raw: unknown): Band {
  if (!isObject(raw) || (raw.tier !== "measured" && raw.tier !== "frame") || !str(raw.band) ||
    !Array.isArray(raw.turns) || raw.turns.length > 10000) throw Error("Invalid cycle band");
  const measured = raw.tier === "measured";
  const turns = raw.turns.map((t): Turn => {
    if (!isObject(t) || (t.k !== "peak" && t.k !== "trough")) throw Error("Invalid turning point");
    const date = str(measured && raw.freq !== "M" ? t.date : t.t);
    if (!date || !/^\d{4}-\d{2}(-\d{2})?$/.test(date)) throw Error("Missing turn date");
    return {date, kind:t.k, tentative:measured && typeof t.provisional === "boolean" ? t.provisional : null,
      note:measured ? null : str(t.e)};
  });
  const proj = isObject(raw.proj) ? raw.proj : null;
  const osc = measured && Array.isArray(raw.osc) ? raw.osc.flatMap(p =>
    isObject(p) && num(p.x) !== null && num(p.v) !== null ? [{x:p.x as number,v:p.v as number}] : []) : [];
  const low = str(proj?.low), mid = str(proj?.central), high = str(proj?.high), kind = str(proj?.nextTurn);
  return {name:String(raw.band), tier:raw.tier, turns, asof:str(raw.series_last), source:str(raw.ref),
    monthly:raw.freq === "M", stale:raw.stale === true, osc,
    projection:measured && low && mid && high && (kind === "peak" || kind === "trough") ?
      {low,mid,high,kind,overdue:proj?.overdue === true} : null};
}
export function parseCycleModel(value: unknown): CycleModel | null {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.order) || !value.order.length ||
    value.order.length > 256 || new Set(value.order).size !== value.order.length || !isObject(value.cycles)) return null;
  const source = value.cycles;
  try {
    const cards = value.order.map(id => {
      if (typeof id !== "string" || !/^[a-z0-9-]{1,64}$/.test(id)) throw Error("Invalid cycle");
      const card = source[id];
      if (!isObject(card) || card.id !== id || !str(card.short) || !Array.isArray(card.bands) ||
        !card.bands.length || card.bands.length > 12) throw Error("Invalid cycle");
      return { id, name:String(card.short), bands:card.bands.map(parseBand) };
    });
    return {cards,notes:str(value.notes_as_of),latest:str(value.tape_as_of)};
  } catch {return null;}
}
