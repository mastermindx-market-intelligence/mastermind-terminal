import { finite } from "./portfolioMoney";
export type SessionPrint = { price: number; currency: "USD"; print_session: "pre" | "post"; change_pct: number;
  as_of_ms: number; valid_until_ms: number; freshness: "live" | "delayed" };
export function sessionPrint(value: unknown, now: number): SessionPrint | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<SessionPrint> & { market_session?: string; completed_regular_reference?: { price?: unknown; session_date?: string } };
  if (p.currency !== "USD" || !finite(p.price) || p.price <= 0 || !finite(p.change_pct) ||
      (p.print_session !== "pre" && p.print_session !== "post") || p.market_session !== p.print_session ||
      !finite(p.completed_regular_reference?.price) || p.completed_regular_reference.price <= 0 ||
      !p.completed_regular_reference.session_date?.match(/^\d{4}-\d{2}-\d{2}$/) ||
      !finite(p.as_of_ms) || p.as_of_ms <= 0 || p.as_of_ms > now || !finite(p.valid_until_ms) || now >= p.valid_until_ms ||
      (p.freshness !== "live" && p.freshness !== "delayed")) return null;
  return p as SessionPrint;
}
