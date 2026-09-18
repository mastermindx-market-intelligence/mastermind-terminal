"use client";

import { assetInitial, assetLogoPath } from "@/lib/assetLogos";

export default function AssetLogo({
  symbol,
  name,
  market,
  color = "#64748b",
  size = 24,
  className = "",
}: {
  symbol: string;
  name?: string | null;
  market?: string | null;
  color?: string;
  size?: number;
  className?: string;
}) {
  const src = assetLogoPath(symbol, market || undefined);

  return (
    <span
      className={`asset-logo ${className}`.trim()}
      style={{ width: size, height: size, backgroundColor: color }}
      title={name || symbol}
      aria-hidden="true"
    >
      <span className="asset-logo-fallback">{assetInitial(symbol)}</span>
      {/* Local data-SVG badges have no quota or network dependency. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}
