// @vitest-environment jsdom
//
// B4-terminal b1 — the not_found empty state for CompanyThemeContextCard.
//
// The card used to `return null` on a not_found sidecar, which hid it entirely.
// This mounts the real component with only the fetcher mocked (the direct
// react-dom/client + act() mount idiom of companySourceManifestRender.test.tsx;
// there is no @testing-library in this repo) and pins the compact empty state,
// the untouched invalid treatment, and the unchanged status union.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import CompanyThemeContextCard from "@/components/fin/CompanyThemeContextCard";
import { LangProvider } from "@/lib/i18n";
import {
  COMPANY_THEME_EXPOSURE_SCHEMA,
  getCompanyThemeExposure,
  type CompanyThemeExposure,
  type CompanyThemeExposureResult,
  type CompanyThemeStateReceipt,
} from "@/lib/companyThemeExposure";

vi.mock("@/lib/companyThemeExposure", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/companyThemeExposure")>()),
  getCompanyThemeExposure: vi.fn(),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const STATUS_UNION_UNCHANGED: Equal<CompanyThemeStateReceipt["status"], "fresh" | "stale" | "missing" | "invalid"> = true;

const NOT_FOUND: CompanyThemeExposureResult = {
  ok: false,
  state: "error",
  error: { code: "not_found", message: "No theme context", retryable: false },
};

function makeContext(themeStatus: CompanyThemeStateReceipt["status"], asOf: string | null): CompanyThemeExposure {
  return {
    schema: COMPANY_THEME_EXPOSURE_SCHEMA,
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-10-01T00:00:00.000Z",
    generation_id: "gen-theme-1",
    status: "ready",
    company: { ticker: "NVDA" },
    company_intelligence: {
      generation_id: "gen-ci-1",
      context_sha256: "a".repeat(64),
      latest_event_id: "evt-1",
      latest_event_call_date: null,
    },
    exposures: [
      { theme_id: "theme-acc", name_en: "AI accelerators", name_zh: "AI 加速器", basket_id: "b-acc", mapping_qualifier: "direct" },
    ],
    coverage: { status: "mapped", active_basket_count: 1, mapped_basket_count: 1, unmapped_basket_count: 0 },
    theme_state: { status: themeStatus, as_of: asOf, sha256: null },
    warnings: [],
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function teardown() {
  if (root) act(() => { root!.unmount(); });
  host?.remove();
  host = null;
  root = null;
}

async function mountCard(lang: "en" | "zh"): Promise<HTMLElement> {
  document.documentElement.setAttribute("data-lang", lang);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <LangProvider>
        <CompanyThemeContextCard
          ticker="NVDA"
          selectedEventId="evt-1"
          companyIntelligenceGenerationId="gen-ci-1"
          latestEventId="evt-1"
          selectedEventLabel="Q2 FY27"
        />
      </LangProvider>,
    );
  });
  await act(async () => {});
  return host;
}

afterEach(() => {
  teardown();
  document.documentElement.removeAttribute("data-lang");
  vi.mocked(getCompanyThemeExposure).mockReset();
});

describe("CompanyThemeContextCard not_found empty state", () => {
  it("renders the compact empty state in English", async () => {
    vi.mocked(getCompanyThemeExposure).mockResolvedValue(NOT_FOUND);
    const mounted = await mountCard("en");

    const sections = mounted.querySelectorAll("section.ci-theme-card.ci-theme-empty");
    expect(sections.length).toBe(1);
    const section = sections[0]!;
    expect(section.querySelector(".ci-theme-kicker")?.textContent).toBe("CURRENT THEME CONTEXT");
    expect(section.querySelector("p")?.textContent).toBe(
      "No theme context for this company yet. It appears here once the company is mapped to a tracked theme.",
    );
    expect(mounted.querySelector("button")).toBeNull();
    expect(mounted.querySelector('[role="status"]')).toBeNull();
    expect(mounted.querySelector("[aria-live]")).toBeNull();
  });

  it("renders the compact empty state in Chinese", async () => {
    vi.mocked(getCompanyThemeExposure).mockResolvedValue(NOT_FOUND);
    const mounted = await mountCard("zh");

    const sections = mounted.querySelectorAll("section.ci-theme-card.ci-theme-empty");
    expect(sections.length).toBe(1);
    const section = sections[0]!;
    expect(section.querySelector(".ci-theme-kicker")?.textContent).toBe("当前主题背景");
    expect(section.querySelector("p")?.textContent).toBe("该公司暂无主题背景；纳入跟踪主题后会显示在这里。");
    expect(mounted.textContent).not.toContain("No theme context for this company yet");
  });

  it("keeps the existing invalid-status treatment in EN and ZH", async () => {
    for (const lang of ["en", "zh"] as const) {
      vi.mocked(getCompanyThemeExposure).mockResolvedValue({
        ok: true,
        state: "ready",
        context: makeContext("invalid", "2099-01-01"),
      });
      const mounted = await mountCard(lang);
      expect(mounted.querySelector(".ci-theme-footer b")?.textContent).toBe(lang === "zh" ? "无效" : "Invalid");
      expect(mounted.querySelector('time[datetime="2099-01-01"]')).not.toBeNull();
      expect(mounted.querySelector("section.ci-theme-empty")).toBeNull();
      teardown();
      document.documentElement.removeAttribute("data-lang");
    }
  });

  it("keeps the theme-state status union and footer labels unchanged", async () => {
    expect(STATUS_UNION_UNCHANGED).toBe(true);
    const cases: Array<[CompanyThemeStateReceipt["status"], string]> = [
      ["fresh", "Fresh"],
      ["stale", "Stale"],
      ["missing", "Missing"],
      ["invalid", "Invalid"],
    ];
    for (const [status, label] of cases) {
      vi.mocked(getCompanyThemeExposure).mockResolvedValue({
        ok: true,
        state: "ready",
        context: makeContext(status, status === "invalid" ? "2099-01-01" : "2026-09-30"),
      });
      const mounted = await mountCard("en");
      expect(mounted.querySelector(".ci-theme-footer b")?.textContent, status).toBe(label);
      teardown();
      document.documentElement.removeAttribute("data-lang");
    }
  });
});
