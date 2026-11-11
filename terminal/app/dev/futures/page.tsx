import { notFound } from "next/navigation";
export default async function FuturesLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const { default: FuturesResearchLab } = await import("@/components/futures/FuturesResearchLab");
  return <FuturesResearchLab />;
}
