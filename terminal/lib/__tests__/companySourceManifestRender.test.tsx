// @vitest-environment jsdom
//
// B-PL-6 batch 3 round 5 (ruling R1 / R3a) — RENDERED coverage for the
// company-intelligence source manifest.
//
// Round 4 left `CompanySourceManifest.tsx` returning `source.typed_absence.detail`
// verbatim as the visible <small>, so the AAPL fixture printed a raw record slug plus a
// bare HTTP status code — byte-identical in the English and Chinese frames. Neither the
// string-level suites nor the plain-language guard could see it: the leak was a JSX
// expression, not a string literal, and the guard qualifies only literals and the four
// visible attribute names.
//
// This mounts the real component over the real presenter output. There is no
// @testing-library in this repo, so it uses a direct react-dom/client + act() mount,
// the same method as ThesisWorkspaceLensRail.test.tsx.
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CompanySourceManifest from "@/components/fin/CompanySourceManifest";
import { LangProvider } from "@/lib/i18n";
import { normalizeEventWorkspace } from "@/lib/eventWorkspace";
import { presentEventWorkspace, type EventWorkspacePresentedSource } from "@/lib/eventWorkspacePresent";
import type { CompanyIntelligenceEvent } from "@/lib/companyIntelligence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GOLDEN = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/aapl-event-workspace.json"), "utf8"),
) as unknown;
const EVENT_ID = "evt_cik0000320193_2026q3_results";

// The upstream machine strings the manifest must never put in front of a user.
const UPSTREAM_DETAILS = [
  "aapl-2026q3-call-record was 404 on 2026-08-16",
  "no collector rows were supplied to join the bound filing",
];

function presentedSources(zh: boolean): EventWorkspacePresentedSource[] {
  const workspace = normalizeEventWorkspace(GOLDEN, EVENT_ID);
  expect(workspace, "AAPL workspace fixture normalizes").not.toBeNull();
  return presentEventWorkspace(workspace!, { zh }).sources;
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(sources: EventWorkspacePresentedSource[], lang: "en" | "zh"): HTMLElement {
  document.documentElement.setAttribute("data-lang", lang);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <LangProvider>
        <CompanySourceManifest
          event={{ sources: [] } as unknown as CompanyIntelligenceEvent}
          onOpenTranscript={() => {}}
          v2Sources={sources}
        />
      </LangProvider>,
    );
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  document.documentElement.removeAttribute("data-lang");
});

describe("CompanySourceManifest — a typed absence reads as a sentence (round 5 R1)", () => {
  it("the fixture's two typed-absence sources render English reason sentences, never the upstream detail", () => {
    const sources = presentedSources(false);
    expect(sources.filter((s) => s.typed_absence)).toHaveLength(2);
    const text = mount(sources, "en").textContent ?? "";
    expect(text).toContain("No source document is available.");
    expect(text).toContain("The filing identity cannot be joined.");
    for (const detail of UPSTREAM_DETAILS) expect(text).not.toContain(detail);
    expect(text).not.toContain("aapl-2026q3-call-record");
    expect(text).not.toContain("404");
    expect(text).not.toContain("collector rows");
    expect(text).not.toContain("bound filing");
  });

  it("the same two sources render Chinese reason sentences, with 披露 and never 申报", () => {
    const sources = presentedSources(true);
    const text = mount(sources, "zh").textContent ?? "";
    expect(text).toContain("没有可用的原始文件。");
    expect(text).toContain("无法匹配该披露文件。");
    expect(text).not.toContain("申报");
    for (const detail of UPSTREAM_DETAILS) expect(text).not.toContain(detail);
    expect(text).not.toContain("aapl-2026q3-call-record");
    expect(text).not.toContain("404");
    expect(text).not.toContain("collector rows");
    // and the English sentence must not leak into the Chinese frame either
    expect(text).not.toContain("No source document is available.");
    expect(text).not.toContain("The filing identity cannot be joined.");
  });

  it("the raw slug and the machine detail stay out of every attribute the guard calls visible", () => {
    const el = mount(presentedSources(false), "en");
    const html = el.innerHTML;
    for (const detail of UPSTREAM_DETAILS) expect(html).not.toContain(detail);
    for (const node of Array.from(el.querySelectorAll("[title], [aria-label], [alt], [placeholder]"))) {
      for (const attr of ["title", "aria-label", "alt", "placeholder"]) {
        const value = node.getAttribute(attr);
        if (!value) continue;
        for (const detail of UPSTREAM_DETAILS) expect(value).not.toContain(detail);
      }
    }
  });
});

describe("CompanySourceManifest — no duplicated note (round 5 R3a)", () => {
  it("a byte-replayed source with no typed absence prints its kind label once and no note", () => {
    const replayed = presentedSources(false).filter(
      (s) => s.receipt_state === "byte_replayed" && !s.typed_absence,
    );
    expect(replayed.length).toBeGreaterThan(0);
    const el = mount(replayed, "en");
    const rows = Array.from(el.querySelectorAll(".ci-source-copy"));
    expect(rows).toHaveLength(replayed.length);
    for (const row of rows) {
      const strong = row.querySelector("strong");
      expect(strong).not.toBeNull();
      const label = strong!.textContent ?? "";
      expect(label.length).toBeGreaterThan(0);
      // the whole row must not repeat the label a second time
      expect((row.textContent ?? "").split(label).length - 1).toBe(1);
      expect(row.querySelector("small")).toBeNull();
    }
  });

  it("Chinese behaves the same — one label, no echoed second line", () => {
    const replayed = presentedSources(true).filter(
      (s) => s.receipt_state === "byte_replayed" && !s.typed_absence,
    );
    const el = mount(replayed, "zh");
    for (const row of Array.from(el.querySelectorAll(".ci-source-copy"))) {
      const label = row.querySelector("strong")!.textContent ?? "";
      expect((row.textContent ?? "").split(label).length - 1).toBe(1);
      expect(row.querySelector("small")).toBeNull();
    }
  });

  it("a source whose note says something new still renders it", () => {
    const [first] = presentedSources(false);
    const addressOnly: EventWorkspacePresentedSource = {
      ...first!,
      receipt_state: "address_only",
      typed_absence: null,
    };
    const el = mount([addressOnly], "en");
    const small = el.querySelector(".ci-source-copy small");
    expect(small).not.toBeNull();
    expect(small!.textContent).toBe("The document address is known but the bytes cannot be replayed.");
  });
});
