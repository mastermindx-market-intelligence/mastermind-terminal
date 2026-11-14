export type ImportedHolding = { accountId: string; accountName: string; securityId: string; symbol: string | null; name: string;
  quantity: number; value: number | null; price: number | null; currency: string | null; asOf: string | null; type: string | null };
type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
const identity = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200;
const numeric = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
function index(rows: unknown, field: string) {
  if (!Array.isArray(rows)) throw new Error("Incomplete brokerage snapshot");
  const result = new Map<string, Row>();
  for (const row of rows) {
    if (!record(row) || !identity(row[field]) || result.has(row[field])) throw new Error("Invalid brokerage identity");
    result.set(row[field],row);
  }
  return result;
}
/** Admit a complete provider snapshot before changing any previously imported positions. */
export function brokerageSnapshot(raw: unknown, itemId: string): ImportedHolding[] {
  if (!record(raw) || !record(raw.item) || raw.item.item_id !== itemId || !Array.isArray(raw.holdings)) throw new Error("Incomplete brokerage snapshot");
  const accounts = index(raw.accounts,"account_id"), securities = index(raw.securities,"security_id");
  const seen = new Set<string>();
  return raw.holdings.map(row => {
    if (!record(row) || !identity(row.account_id) || !identity(row.security_id) || numeric(row.quantity) === null) throw new Error("Invalid holding");
    const account = accounts.get(row.account_id), security = securities.get(row.security_id);
    const key = JSON.stringify([row.account_id,row.security_id]);
    if (!account || !security || seen.has(key)) throw new Error("Unreconciled holding");
    seen.add(key);
    const symbol = typeof security.ticker_symbol === "string" && /^[A-Z0-9][A-Z0-9.:-]{0,30}$/.test(security.ticker_symbol) ? security.ticker_symbol : null;
    return { accountId:row.account_id, securityId:row.security_id, symbol, name:typeof security.name === "string" ? security.name : symbol || "Security",
      accountName:typeof account.name === "string" ? account.name : "Investment account", quantity:row.quantity as number,
      value:numeric(row.institution_value), price:numeric(row.institution_price),
      currency:typeof row.iso_currency_code === "string" && /^[A-Z]{3}$/.test(row.iso_currency_code) ? row.iso_currency_code : null,
      asOf:typeof row.institution_price_datetime === "string" ? row.institution_price_datetime :
        typeof row.institution_price_as_of === "string" ? row.institution_price_as_of : null,
      type:typeof security.type === "string" ? security.type : null };
  });
}
