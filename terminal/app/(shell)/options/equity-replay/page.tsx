import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLiveOptions } from "@/lib/entitlement";
import OptionsPaywall from "@/components/OptionsPaywall";
import IexDepthReplayMount from "@/components/mounts/IexDepthReplayMount";

export const metadata: Metadata = { title: "Equity depth replay · Mastermind Terminal", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EquityReplayPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Same existing Options page admission as Futures. The incumbent large-trades
  // API performs its own authentication and source-admission checks.
  let allowed = process.env.NODE_ENV === "development" && process.env.FLOW_FIXTURE === "1";
  if (!allowed) { try { allowed = await hasLiveOptions(); } catch { /* deny */ } }
  if (!allowed) return <OptionsPaywall />;
  const query = await searchParams;
  if (Object.keys(query).some(k => k !== "symbol") || Array.isArray(query.symbol)) notFound();
  const symbol = query.symbol ?? "NVDA";
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,7}$/.test(symbol)) notFound();
  return <IexDepthReplayMount initialSymbol={symbol} />;
}
