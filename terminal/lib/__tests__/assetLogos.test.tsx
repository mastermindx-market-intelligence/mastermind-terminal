// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import AssetLogo from "@/components/AssetLogo";
import { assetLogoPath, companyBrandLogoSources, normalizeCompanyLogoTicker } from "@/lib/assetLogos";

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

  it("limits optional brand artwork to the two existing Macro image origins without altering default badges", () => {
    const css = readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const nextConfig = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");

    const imagePolicy = nextConfig.split("\n").find((line) => line.includes('"img-src'));
    expect(imagePolicy).toContain("https://cdn.jsdelivr.net");
    expect(imagePolicy).toContain("https://img.logo.dev");
    expect(nextConfig).not.toMatch(/"connect-src [^"]*logo\.dev/);
    expect(css).toMatch(/\.asset-logo img\{[^}]*background:inherit[^}]*padding:0/);
    expect(css).toMatch(/\.status-symbol-logo img\{[^}]*background:inherit[^}]*padding:0/);
  });

  it("resolves exchange-aware brand sources without ever substituting another listing", () => {
    const pk = "pk_test_public_only_12345";
    expect(normalizeCompanyLogoTicker("NVDA", "NASDAQ")).toBe("NVDA");
    expect(normalizeCompanyLogoTicker("9988.HK", "HKEX")).toBe("9988.HK");
    expect(normalizeCompanyLogoTicker("700", "HKEX")).toBe("0700.HK");
    expect(normalizeCompanyLogoTicker("KGF.L", "United Kingdom")).toBe("KGF.L");
    expect(normalizeCompanyLogoTicker("9988.HK", "NASDAQ")).toBe("9988.HK");
    expect(normalizeCompanyLogoTicker("AAPL<script>", "NASDAQ")).toBeNull();

    const us = companyBrandLogoSources("NVDA", "NASDAQ", "NVIDIA Corp", pk);
    const hk = companyBrandLogoSources("9988.HK", "HKEX", "Alibaba", pk);
    const uk = companyBrandLogoSources("KGF.L", "United Kingdom", "Kingfisher Plc", pk);
    expect(us[0]).toBe("https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/NVDA.png");
    expect(us[1]).toContain("/ticker/NVDA?");
    expect(hk[0]).toContain("/ticker/9988.HK?");
    expect(hk[0]).not.toContain("/ticker/BABA?");
    expect(uk[0]).toContain("/ticker/KGF.L?");
    expect(hk[1]).toContain("/name/Alibaba?");
    expect(companyBrandLogoSources("9988.HK", "HKEX", "Alibaba", ""))
      .toEqual(["https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/9988.HK.png"]);
    expect(companyBrandLogoSources("NVDA", "NASDAQ", "NVIDIA Corp", "sk_not_public"))
      .toHaveLength(1);
    expect(companyBrandLogoSources("not/a/ticker", "NYSE", "Invalid", pk)).toEqual([]);
  });

  it("uses only explicit search-brand optics and falls back to the local badge on missing art", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(<AssetLogo brand symbol="9988.HK" market="HKEX" name="Alibaba" color="#18202c" size={44} />);
    });
    const logo = host.querySelector<HTMLElement>(".asset-logo");
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute("title")).toBe("Alibaba");
    expect(logo?.querySelector(".asset-logo-fallback")?.textContent).toBe("99");
    let image = host.querySelector<HTMLImageElement>(".asset-logo img")!;
    expect(image.getAttribute("src")).toMatch(/^https:\/\//);
    for (let n = 0; n < 5 && image.getAttribute("src")?.startsWith("https:"); n++) {
      act(() => { image.dispatchEvent(new Event("error")); });
      image = host.querySelector<HTMLImageElement>(".asset-logo img")!;
    }
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(logo?.querySelector(".asset-logo-fallback")?.textContent).toBe("99");
  });

});
