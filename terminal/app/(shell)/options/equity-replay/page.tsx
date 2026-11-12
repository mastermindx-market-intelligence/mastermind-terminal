import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLiveOptionsAccessDetail } from "@/lib/entitlement";
import OptionsPaywall from "@/components/OptionsPaywall";
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";
import IexDepthReplayMount from "@/components/mounts/IexDepthReplayMount";

export const metadata: Metadata = { title: "Equity depth replay · Mastermind Terminal", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EquityReplayPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Same existing Options page admission as Futures. The incumbent large-trades
  // API performs its own authentication and source-admission checks.
  const devPreview = process.env.NODE_ENV === "development" && process.env.FLOW_FIXTURE === "1";
  if (!devPreview) {
    const access = await getLiveOptionsAccessDetail();
    // Only a verified subscription denial may show a genuine upgrade offer.
    if (access.access === "denied") return <OptionsPaywall verifySession={access.reason === "authentication_denied"} />;
    if (access.access === "unavailable") return <OptionsServiceUnavailable />;
  }
  const query = await searchParams;
  if (Object.keys(query).some(k => k !== "symbol") || Array.isArray(query.symbol)) notFound();
  const symbol = query.symbol ?? "NVDA";
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,7}$/.test(symbol)) notFound();
  return <IexDepthReplayMount initialSymbol={symbol} />;
}
