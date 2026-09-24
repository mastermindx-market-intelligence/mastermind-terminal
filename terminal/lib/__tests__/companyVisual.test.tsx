// @vitest-environment jsdom

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import CompanyVisual from "../../components/fin/CompanyVisual";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function render(artworkSrc?: string | null) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(<CompanyVisual ticker="NVDA" artworkSrc={artworkSrc} />);
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("CompanyVisual artwork boundary", () => {
  it("keeps external artwork URLs out and falls back to neutral company identity", () => {
    const node = render("https://images.example.com/nvda.webp");
    const visual = node.querySelector<HTMLElement>("[data-company-visual]");
    expect(visual?.dataset.companyVisual).toBe("fallback");
    expect(visual?.dataset.companyVisualTicker).toBe("NVDA");
    expect(visual?.querySelector("img")).toBeNull();
    expect(visual?.textContent).toContain("NVDA");
  });

  it("accepts optional same-origin artwork without changing the visual's decorative role", () => {
    const node = render("/company-art/NVDA.webp");
    const visual = node.querySelector<HTMLElement>("[data-company-visual]");
    const image = visual?.querySelector<HTMLImageElement>("img");
    expect(visual?.dataset.companyVisual).toBe("artwork");
    expect(image?.getAttribute("src")).toBe("/company-art/NVDA.webp");
    expect(image?.getAttribute("alt")).toBe("");
  });

  it("accepts a data-image asset and never requires an issuer-art network provider", () => {
    const node = render("data:image/png;base64,AAAA");
    const visual = node.querySelector<HTMLElement>("[data-company-visual]");
    expect(visual?.dataset.companyVisual).toBe("artwork");
    expect(visual?.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
  });
});
