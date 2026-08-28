import { notFound } from "next/navigation";
import type { Metadata } from "next";
// Public R2 base URL for snapshots (CDN-backed, no auth required) — shared constant,
// see lib/upstreams.ts
import { R2_BASE } from "@/lib/upstreams";
import { BrandLockup } from "@/components/BrandMark";
import { isSnapshotSlug } from "@/lib/snapshotSlug";

function imgUrl(slug: string): string {
  return `${R2_BASE}/snapshots/${slug}.png`;
}

const TITLE = "Chart Snapshot — Mastermind Terminal";
const DESCRIPTION = "Shared chart snapshot from Mastermind Terminal";

// ── Next.js generateMetadata — produces OG tags for Discord/Twitter/Slack unfurls ──
// This runs BEFORE the page, and its output is what third-party unfurlers fetch. It used to build
// the image URL from the raw path segment with no validation at all, so an arbitrary string reached
// external services in our markup while the page's own check sat further down, unreached.
// Same predicate as the page now, from one module.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  if (!isSnapshotSlug(slug)) return { title: TITLE, description: DESCRIPTION };

  const image = imgUrl(slug);
  return {
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      images: [{ url: image, width: 1400, height: 900 }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      images: [image],
    },
  };
}

// ── verify the image exists before rendering ──
async function imageExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function SnapshotPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isSnapshotSlug(slug)) notFound();

  const image = imgUrl(slug);
  const exists = await imageExists(image);
  if (!exists) notFound();

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0b0e",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* The canonical lockup. This page used to hand-copy BrandMark's geometry and re-implement
          the wordmark inline, with the gradient id changed to dodge a collision — a third copy of
          the same M-path in the codebase, and one nobody would remember to update. */}
      <div style={{ marginBottom: 16 }}>
        <BrandLockup />
      </div>
      <div style={{
        maxWidth: "min(1400px, calc(100vw - 32px))",
        width: "100%",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt="Chart snapshot"
          style={{ display: "block", width: "100%", height: "auto" }}
        />
      </div>
      <div style={{ marginTop: 16, color: "#5a616f", fontSize: 12 }}>
        Created with{" "}
        <a href="/" style={{ color: "#4d82ff", textDecoration: "none" }}>Mastermind Terminal</a>
      </div>
    </div>
  );
}
