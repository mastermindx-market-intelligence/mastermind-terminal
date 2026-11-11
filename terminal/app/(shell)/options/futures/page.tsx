import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLiveOptionsAccessDetail } from "@/lib/entitlement";
import OptionsPaywall from "@/components/OptionsPaywall";
import OptionsServiceUnavailable from "@/components/OptionsServiceUnavailable";
import FuturesWorkspaceMount from "@/components/mounts/FuturesWorkspaceMount";
import { parseFuturesRequest } from "@/lib/futuresRequest";

export const metadata: Metadata = { title: "Futures · Mastermind Terminal", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const revalidate = 0;
export default async function FuturesPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Same page-level paid gate as Options; the development preview exemption is stricter.
  // /api/futures NEVER exempts fixture flags, so this cannot reveal production source data.
  const devPreview = process.env.NODE_ENV === "development" && process.env.FLOW_FIXTURE === "1";
  if (!devPreview) {
    const access = await getLiveOptionsAccessDetail();
    // Authentication denial is not proof of an unentitled Free plan.
    if (access.access === "denied") return <OptionsPaywall verifySession={access.reason === "authentication_denied"} />;
    if (access.access === "unavailable") return <OptionsServiceUnavailable />;
  }
  const input = await searchParams, params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value)) value.forEach(v => params.append(key, v));
    else if (value !== undefined) params.append(key, value);
  }
  const request = parseFuturesRequest(params);
  if (!request) notFound();
  return <FuturesWorkspaceMount initialRequest={request} />;
}
