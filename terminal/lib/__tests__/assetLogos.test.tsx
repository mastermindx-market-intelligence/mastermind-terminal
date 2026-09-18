// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import AssetLogo from "@/components/AssetLogo";
import { assetLogoPath } from "@/lib/assetLogos";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function decodedSvg(src: string): string {
  const marker = "data:image/svg+xml;charset=utf-8,";
  expect(src.startsWith(marker)).toBe(true);
  return decodeURIComponent(src.slice(marker.length));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("asset logos stay local and quota-independent", () => {
  it("generates deterministic local SVG badges for equities, ETFs, and crypto", () => {
    const cases = [
      ["NVDA", "NASDAQ", "NV"],
      ["MSFT", "NASDAQ", "MS"],
      ["QQQ", "ETF", "QQQ"],
      ["BTC-USD", "Crypto", "BTC"],
      ["ETH-USD", "Crypto", "ETH"],
    ] as const;

    for (const [symbol, market, glyph] of cases) {
      const src = assetLogoPath(symbol, market);
      expect(src).not.toMatch(/^https?:/);
      expect(src).not.toContain("logo.dev");
      expect(decodedSvg(src)).toContain(`>${glyph}<`);
    }

  });

  it("renders the watchlist logo image from a data URI while preserving the row color", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root!.render(<AssetLogo symbol="NVDA" name="NVIDIA Corp" market="NASDAQ" color="#76b900" size={18} />);
    });

    const logo = host.querySelector<HTMLElement>(".asset-logo");
    const image = host.querySelector<HTMLImageElement>(".asset-logo img");
    expect(logo?.style.backgroundColor).toBe("rgb(118, 185, 0)");
    expect(image?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  });

  it("does not leave Logo.dev in the CSP or paint a white tile over the instrument color", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const nextConfig = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");

    expect(nextConfig).not.toContain("img.logo.dev");
    expect(css).toMatch(/\.asset-logo img\{[^}]*background:inherit[^}]*padding:0/);
    expect(css).toMatch(/\.status-symbol-logo img\{[^}]*background:inherit[^}]*padding:0/);
  });
});
