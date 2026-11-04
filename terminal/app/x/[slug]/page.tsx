import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { snapshotImageUrl, readSnapshotAvailability } from "@/lib/snapshotAvailability";
import SnapshotFrame from "../SnapshotFrame";
import SnapshotImage from "./SnapshotImage";

const TITLE = "Chart Snapshot — Mastermind Terminal";
const DESCRIPTION = "Shared chart snapshot from Mastermind Terminal";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const image = snapshotImageUrl(slug);
  if (!image) return { title: TITLE, description: DESCRIPTION };
  return {
    title: TITLE, description: DESCRIPTION,
    openGraph: { title: TITLE, description: DESCRIPTION, images: [{ url: image }], type: "website" },
    twitter: { card: "summary_large_image", title: TITLE, images: [image] },
  };
}

export default async function SnapshotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const image = snapshotImageUrl(slug);
  if (!image) notFound();
  const availability = await readSnapshotAvailability(slug);
  if (availability === "missing") notFound();
  return <SnapshotFrame><SnapshotImage key={image} src={image} available={availability === "available"} /></SnapshotFrame>;
}
