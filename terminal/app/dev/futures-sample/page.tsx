import { notFound } from "next/navigation";

export default async function FuturesSamplePage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { loadFuturesSampleView } = await import("@/lib/futuresSampleLoader");
  const data = await loadFuturesSampleView();
  if (!data) return <main><h1>Historical sample unavailable</h1><p>The internal source canary has not produced a verified local view. No replacement prices are generated.</p></main>;
  const { default: Sample } = await import("@/components/futures/FuturesPublicSampleLab");
  return <Sample data={data} />;
}
