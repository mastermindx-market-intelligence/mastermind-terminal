"use client";

import { useState } from "react";
import { assetInitial, assetLogoPath, companyBrandLogoSources } from "@/lib/assetLogos";

export default function AssetLogo({
  symbol,
  name,
  market,
  color = "#64748b",
  size = 24,
  className = "",
  brand = false,
  brandToken,
}: {
  symbol: string;
  name?: string | null;
  market?: string | null;
  color?: string;
  size?: number;
  className?: string;
  /** Opt-in artwork for the company search; all other mounts stay offline. */
  brand?: boolean;
  /** Existing Macro publishable token loaded once by Shared Search. */
  brandToken?: string;
}) {
  const fallback = assetLogoPath(symbol, market || undefined);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const candidates = brand ? companyBrandLogoSources(symbol, market, name, brandToken || undefined) : [];
  const remoteSource = candidates.find((candidate) => !failedSources.includes(candidate));
  const src = remoteSource ?? fallback;
  const isRemote = !!remoteSource;

  return (
    <span
      className={`asset-logo ${className}`.trim()}
      style={{ width: size, height: size, backgroundColor: color }}
      title={name || symbol}
      aria-hidden="true"
    >
      <span className="asset-logo-fallback">{brand ? symbol.trim().slice(0, 2).toUpperCase() : assetInitial(symbol)}</span>
      {/* Local SVG badge remains available if no remote image succeeds. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy={isRemote ? "origin" : undefined}
        style={isRemote && loadedSource !== src ? { visibility: "hidden" } : undefined}
        onLoad={() => { if (isRemote) setLoadedSource(src); }}
        onError={(event) => {
          if (isRemote) {
            setFailedSources((failed) => failed.includes(src) ? failed : [...failed, src]);
          } else {
            event.currentTarget.hidden = true;
          }
        }}
      />
    </span>
  );
}
