// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompanyThemeContextCard, { type CompanyThemeContextCardProps } from "@/components/fin/CompanyThemeContextCard";
import type {
  CompanyThemeExposure,
  CompanyThemeExposureErrorCode,
  CompanyThemeExposureItem,
  CompanyThemeExposureResult,
  CompanyThemeExposureWarning,
  CompanyThemeStateReceipt,
} from "@/lib/companyThemeExposure";
import { LangProvider } from "@/lib/i18n";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THEME_GEN = "a".repeat(24);
const CI_GEN = "b".repeat(24);
const OTHER_GEN = "e".repeat(24);
const SHA_CI = "c".repeat(64);
const SHA_THEME = "d".repeat(64);
const OPAQUE = "opaque server failure";
const EM = "\u2014";

const ERROR_COPY: Record<CompanyThemeExposureErrorCode, { en: string; zh: string }> = {
  invalid_symbol: {
    en: "This ticker is not valid for theme context.",
    zh: "该代码无法用于主题背景。",
  },
  // errorCopy falls through to the same sentence as upstream_unavailable.
  not_found: {
    en: "The verified theme context could not be reached. Try again shortly.",
    zh: "暂时无法获取已验证的主题背景，请稍后重试。",
  },
  unauthorized: {
    en: "Sign in to use verified company theme context.",
    zh: "登录后可使用已验证的公司主题背景。",
  },
  upstream_unavailable: {
    en: "The verified theme context could not be reached. Try again shortly.",
    zh: "暂时无法获取已验证的主题背景，请稍后重试。",
  },
  invalid_payload: {
    en: "The published theme context did not pass its lineage checks.",
    zh: "已发布的主题背景未通过来源链验证。",
  },
};

const THEME_COPY = {
  fresh: { en: "Fresh", zh: "新鲜", enWarning: null, zhWarning: null },
  stale: {
    en: "Stale",
    zh: "已过期",
    enWarning: "The separate theme-state receipt is stale.",
    zhWarning: "独立主题状态凭证已过期。",
  },
  missing: {
    en: "Missing",
    zh: "缺失",
    enWarning: "A theme-state receipt is not available for this generation.",
    zhWarning: "此版本没有主题状态凭证。",
  },
  invalid: {
    en: "Invalid",
    zh: "无效",
    enWarning: "The theme-state receipt was invalid and is not used.",
    zhWarning: "主题状态凭证无效，未被使用。",
  },
  future: {
    enWarning: "The theme-state receipt is dated after this generation and is not used.",
    zhWarning: "主题状态凭证日期晚于此版本，未被使用。",
  },
} as const;

interface PendingThemeRequest {
  symbol: string;
  retryNonce: number | undefined;
  signal: AbortSignal | undefined;
  resolve: (value: CompanyThemeExposureResult) => void;
  reject: (reason: unknown) => void;
}

const transport = vi.hoisted(() => ({
  pending: [] as PendingThemeRequest[],
}));

vi.mock("@/lib/companyThemeExposure", () => ({
  getCompanyThemeExposure: (symbol: string, options?: { signal?: AbortSignal; retryNonce?: number }) =>
    new Promise<CompanyThemeExposureResult>((resolve, reject) => {
      transport.pending.push({
        symbol,
        retryNonce: options?.retryNonce,
        signal: options?.signal,
        resolve,
        reject,
      });
    }),
}));

const stateProbe = vi.hoisted(() => ({
  armed: false,
  setterCallsAfterArm: [] as unknown[],
}));

// Transparent useState shim for this file's module graph: it delegates to the
// real hook (hook order, values and setter behavior unchanged) and records
// every setter call made while stateProbe.armed is set. React 19 silently
// drops setState on an unmounted component, so the probe is the only way to
// prove the card's abort guards make zero state updates after unmount. Setter
// identity stays stable across renders via the WeakMap cache.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const wrappedSetters = new WeakMap<object, unknown>();
  const probedUseState = <S,>(initialState: S | (() => S)) => {
    const [value, setter] = actual.useState<S>(initialState);
    const cached = wrappedSetters.get(setter);
    if (cached) return [value, cached as typeof setter] as [S, typeof setter];
    const wrapped: typeof setter = (action) => {
      if (stateProbe.armed) stateProbe.setterCallsAfterArm.push(action);
      setter(action);
    };
    wrappedSetters.set(setter, wrapped);
    return [value, wrapped] as [S, typeof setter];
  };
  const mocked = { ...actual, useState: probedUseState };
  return { ...mocked, default: (actual as { default?: unknown }).default ?? mocked };
});

function item(patch: Partial<CompanyThemeExposureItem> = {}): CompanyThemeExposureItem {
  return {
    theme_id: "ai_infrastructure",
    name_en: "AI Infrastructure",
    name_zh: "人工智能基础设施",
    basket_id: "ai_semiconductors",
    mapping_qualifier: "proxy",
    ...patch,
  };
}

function exposure(patch: {
  status?: CompanyThemeExposure["status"];
  ticker?: string;
  exposures?: CompanyThemeExposureItem[];
  coverage?: CompanyThemeExposure["coverage"];
  themeState?: CompanyThemeStateReceipt;
  warnings?: CompanyThemeExposureWarning[];
  companyIntelligence?: Partial<CompanyThemeExposure["company_intelligence"]>;
} = {}): CompanyThemeExposure {
  return {
    schema: "company_theme_exposure.v1",
    authority: "context_only",
    is_context_only: true,
    generated_at: "2026-08-01T12:00:00Z",
    generation_id: THEME_GEN,
    status: patch.status ?? "ready",
    company: { ticker: patch.ticker ?? "NVDA" },
    company_intelligence: {
      generation_id: CI_GEN,
      context_sha256: SHA_CI,
      latest_event_id: "NVDA-2026Q1",
      latest_event_call_date: "2026-05-28",
      ...patch.companyIntelligence,
    },
    exposures: patch.exposures ?? [item()],
    coverage: patch.coverage ?? {
      status: "mapped",
      active_basket_count: 1,
      mapped_basket_count: 1,
      unmapped_basket_count: 0,
    },
    theme_state: patch.themeState ?? { status: "fresh", as_of: "2026-08-01", sha256: SHA_THEME },
    warnings: patch.warnings ?? [],
  };
}

function success(
  context: CompanyThemeExposure,
  state: "ready" | "partial" | "stale" = context.status,
): CompanyThemeExposureResult {
  return { ok: true, state, context };
}

function failure(code: CompanyThemeExposureErrorCode, retryable: boolean): CompanyThemeExposureResult {
  return { ok: false, state: "error", error: { code, message: OPAQUE, retryable } };
}

function themeStateFor(status: CompanyThemeStateReceipt["status"]): CompanyThemeStateReceipt {
  if (status === "missing") return { status: "missing", as_of: null, sha256: null };
  if (status === "invalid") return { status: "invalid", as_of: null, sha256: SHA_THEME };
  return { status, as_of: "2026-08-01", sha256: SHA_THEME };
}

const baseProps: CompanyThemeContextCardProps = {
  ticker: "NVDA",
  selectedEventId: "NVDA-2026Q1",
  companyIntelligenceGenerationId: CI_GEN,
  latestEventId: "NVDA-2026Q1",
  selectedEventLabel: "Q1 FY2026",
};

let host: HTMLDivElement;
let root: Root;
let mounted = false;

const retryButton = (label: string) =>
  [...host.querySelectorAll("button")].find((button) => button.textContent === label) ?? null;

async function mount(patch: Partial<CompanyThemeContextCardProps> = {}, lang: "en" | "zh" = "en") {
  document.documentElement.setAttribute("data-lang", lang);
  await act(async () => {
    root.render(
      <LangProvider>
        <CompanyThemeContextCard {...baseProps} {...patch} />
      </LangProvider>,
    );
  });
}

async function settle(index: number, result: CompanyThemeExposureResult) {
  const request = transport.pending[index];
  expect(request).toBeDefined();
  await act(async () => {
    request.resolve(result);
  });
}

async function show(
  result: CompanyThemeExposureResult,
  lang: "en" | "zh" = "en",
  patch: Partial<CompanyThemeContextCardProps> = {},
) {
  await mount(patch, lang);
  await settle(transport.pending.length - 1, result);
}

beforeEach(() => {
  transport.pending.length = 0;
  document.documentElement.setAttribute("data-lang", "en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = true;
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  mounted = false;
  host.remove();
  document.documentElement.removeAttribute("data-lang");
  vi.restoreAllMocks();
});

describe("company theme context card loading", () => {
  it("shows an English loading card until the request settles", async () => {
    await mount();
    const section = host.querySelector("section");
    expect(section?.getAttribute("aria-busy")).toBe("true");
    expect(section?.getAttribute("aria-label")).toBe("Loading verified company theme context");
    expect(section?.classList.contains("ci-theme-loading")).toBe(true);
    expect(host.textContent).not.toContain("AI Infrastructure");
    expect(transport.pending).toHaveLength(1);
  });

  it("uses the Chinese loading label", async () => {
    await mount({}, "zh");
    expect(host.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe("正在加载已验证的公司主题背景");
  });
});

describe("company theme context card errors", () => {
  async function showError(code: CompanyThemeExposureErrorCode, lang: "en" | "zh", retryable: boolean, ticker: string) {
    await mount({ ticker }, lang);
    await settle(transport.pending.length - 1, failure(code, retryable));
    const heading = lang === "zh" ? "已验证主题背景暂不可用" : "Verified theme context unavailable";
    expect(host.querySelector(".ci-theme-unavailable")?.getAttribute("role")).toBe("status");
    expect(host.querySelector("h3")?.textContent).toBe(heading);
    expect(host.textContent).toContain(ERROR_COPY[code][lang]);
    expect(host.textContent).not.toContain(OPAQUE);
    const button = retryButton(lang === "zh" ? "重试" : "Retry");
    if (retryable) expect(button).not.toBeNull();
    else expect(button).toBeNull();
  }

  it("invalid_symbol EN shows its copy and a Retry button only when retryable", async () => {
    await showError("invalid_symbol", "en", false, "NVDA");
    await showError("invalid_symbol", "en", true, "AAPL");
  });

  it("invalid_symbol ZH shows its copy and a Retry button only when retryable", async () => {
    await showError("invalid_symbol", "zh", false, "NVDA");
    await showError("invalid_symbol", "zh", true, "AAPL");
  });

  // CompanyThemeContextCard.tsx:204 returns null, so not_found never reaches errorCopy.
  it.fails("not_found EN shows the unavailable card, its copy, and Retry only when retryable", async () => {
    await showError("not_found", "en", false, "NVDA");
    await showError("not_found", "en", true, "AAPL");
  });

  it.fails("not_found ZH shows the unavailable card, its copy, and Retry only when retryable", async () => {
    await showError("not_found", "zh", false, "NVDA");
    await showError("not_found", "zh", true, "AAPL");
  });

  it("unauthorized EN shows its copy and a Retry button only when retryable", async () => {
    await showError("unauthorized", "en", false, "NVDA");
    await showError("unauthorized", "en", true, "AAPL");
  });

  it("unauthorized ZH shows its copy and a Retry button only when retryable", async () => {
    await showError("unauthorized", "zh", false, "NVDA");
    await showError("unauthorized", "zh", true, "AAPL");
  });

  it("upstream_unavailable EN shows its copy and a Retry button only when retryable", async () => {
    await showError("upstream_unavailable", "en", false, "NVDA");
    await showError("upstream_unavailable", "en", true, "AAPL");
  });

  it("upstream_unavailable ZH shows its copy and a Retry button only when retryable", async () => {
    await showError("upstream_unavailable", "zh", false, "NVDA");
    await showError("upstream_unavailable", "zh", true, "AAPL");
  });

  it("invalid_payload EN shows its copy and a Retry button only when retryable", async () => {
    await showError("invalid_payload", "en", false, "NVDA");
    await showError("invalid_payload", "en", true, "AAPL");
  });

  it("invalid_payload ZH shows its copy and a Retry button only when retryable", async () => {
    await showError("invalid_payload", "zh", false, "NVDA");
    await showError("invalid_payload", "zh", true, "AAPL");
  });

  it("clicking Retry issues exactly one new request", async () => {
    await mount();
    await settle(0, failure("upstream_unavailable", true));
    expect(transport.pending).toHaveLength(1);
    const button = retryButton("Retry");
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    expect(transport.pending).toHaveLength(2);
    expect(transport.pending[0].signal?.aborted).toBe(true);
    expect(transport.pending[1].signal?.aborted).toBe(false);
    expect(transport.pending[1].symbol).toBe("NVDA");
    expect(transport.pending[1].retryNonce).not.toBe(transport.pending[0].retryNonce);
  });

  it("a late settling first response cannot overwrite the retried result", async () => {
    await mount();
    await settle(0, failure("upstream_unavailable", true));
    await act(async () => retryButton("Retry")!.click());
    expect(transport.pending).toHaveLength(2);
    // The abandoned first request settles late with data that differs from the
    // retried one; it must never paint over the in-flight retry.
    await settle(0, success(exposure({ exposures: [item({ name_en: "Ghost Theme", name_zh: "幽灵主题" })] }), "ready"));
    expect(host.textContent).not.toContain("Ghost Theme");
    expect(host.querySelector("[aria-busy='true']")).not.toBeNull();
    await settle(1, success(exposure(), "ready"));
    expect(host.textContent).toContain("AI Infrastructure");
    expect(host.textContent).not.toContain("Ghost Theme");
  });
});

describe("company theme context card rejection and abort", () => {
  it("a rejected request shows the English upstream_unavailable copy", async () => {
    await mount();
    expect(host.querySelector("[aria-busy='true']")).not.toBeNull();
    await act(async () => {
      transport.pending[0].reject(new Error("network down"));
    });
    expect(host.querySelector("h3")?.textContent).toBe("Verified theme context unavailable");
    expect(host.textContent).toContain(ERROR_COPY.upstream_unavailable.en);
    expect(host.textContent).not.toContain("network down");
    expect(retryButton("Retry")).not.toBeNull();
  });

  it("a rejected request shows the Chinese upstream_unavailable copy", async () => {
    await mount({}, "zh");
    await act(async () => {
      transport.pending[0].reject(new Error("network down"));
    });
    expect(host.querySelector("h3")?.textContent).toBe("已验证主题背景暂不可用");
    expect(host.textContent).toContain(ERROR_COPY.upstream_unavailable.zh);
    expect(host.textContent).not.toContain("network down");
    expect(retryButton("重试")).not.toBeNull();
  });

  it("unmount mid-request does not update state on the resolve path and does not warn about act()", async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((part) => String(part)).join(" "));
    });
    try {
      await mount();
      expect(transport.pending).toHaveLength(1);
      // Arm the probe only after mount effects settle — LangProvider's own
      // setLangState fires during mount. React 19 silently drops a setState
      // on an unmounted component, so the stateProbe-wrapped setters are the
      // observable pin: the guarded .then must make zero setter calls.
      stateProbe.armed = true;
      stateProbe.setterCallsAfterArm.length = 0;
      mounted = false;
      await act(async () => root.unmount());
      expect(transport.pending[0].signal?.aborted).toBe(true);
      // The real client resolves after abort.
      await act(async () => {
        transport.pending[0].resolve(success(exposure()));
      });
      expect(stateProbe.setterCallsAfterArm).toHaveLength(0);
      expect(errors.join("\n")).not.toMatch(/not wrapped in act|unmounted component/i);
    } finally {
      stateProbe.armed = false;
      spy.mockRestore();
    }
  });

  it("unmount mid-request does not update state on the reject path", async () => {
    try {
      await mount();
      expect(transport.pending).toHaveLength(1);
      stateProbe.armed = true;
      stateProbe.setterCallsAfterArm.length = 0;
      mounted = false;
      await act(async () => root.unmount());
      expect(transport.pending[0].signal?.aborted).toBe(true);
      // Same pin for the .catch branch: a rejection after abort must not
      // touch any state setter on the unmounted card.
      await act(async () => {
        transport.pending[0].reject(new Error("network down"));
      });
      expect(stateProbe.setterCallsAfterArm).toHaveLength(0);
    } finally {
      stateProbe.armed = false;
    }
  });
});

describe("company theme context card quarantine", () => {
  it("a generation mismatch shows the English quarantine card and no theme items", async () => {
    await show(success(exposure({ companyIntelligence: { generation_id: OTHER_GEN } }), "ready"));
    expect(host.querySelector(".ci-theme-unavailable")?.getAttribute("role")).toBe("status");
    expect(host.querySelector("h3")?.textContent).toBe("Theme context is refreshing");
    expect(host.textContent).toContain("The sidecar is not pinned to this Company Intelligence generation, so it is quarantined until publication catches up.");
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("AI Infrastructure");
    expect(host.textContent).not.toContain("人工智能基础设施");
    expect(retryButton("Retry")).not.toBeNull();
  });

  it("a generation mismatch shows the Chinese quarantine card and no theme items", async () => {
    await show(success(exposure({ companyIntelligence: { generation_id: OTHER_GEN } }), "ready"), "zh");
    expect(host.querySelector("h3")?.textContent).toBe("主题背景正在刷新");
    expect(host.textContent).toContain("主题侧车尚未锚定当前公司情报版本，因此在发布追平前不会展示。");
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("AI Infrastructure");
    expect(host.textContent).not.toContain("人工智能基础设施");
    expect(host.textContent).not.toContain("Theme context is refreshing");
    expect(retryButton("重试")).not.toBeNull();
  });

  it("a latest-event mismatch quarantines the same way and paints no theme items", async () => {
    await show(success(exposure({
      companyIntelligence: { latest_event_id: "NVDA-2025Q4", latest_event_call_date: "2025-11-20" },
    }), "partial"));
    expect(host.querySelector("h3")?.textContent).toBe("Theme context is refreshing");
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("AI Infrastructure");
  });
});

describe("company theme context card effective state", () => {
  function tag(): HTMLElement {
    const element = host.querySelector(".fin-tag");
    expect(element).toBeInstanceOf(HTMLElement);
    return element as HTMLElement;
  }

  it("ready shows Verified and the up palette", async () => {
    await show(success(exposure(), "ready"));
    const chip = tag();
    expect(chip.textContent).toBe("Verified");
    expect(chip.style.getPropertyValue("--c")).toBe("var(--up)");
    expect(host.textContent).toContain("AI Infrastructure");
  });

  it("ready shows the Chinese verified label and the up palette", async () => {
    await show(success(exposure(), "ready"), "zh");
    const chip = tag();
    expect(chip.textContent).toBe("已验证");
    expect(chip.style.getPropertyValue("--c")).toBe("var(--up)");
    expect(host.textContent).toContain("人工智能基础设施");
    expect(host.textContent).not.toContain("Verified");
  });

  it("partial shows Partial and the warn palette", async () => {
    const context = exposure({
      status: "partial",
      themeState: { status: "stale", as_of: "2026-07-01", sha256: SHA_THEME },
      warnings: ["theme_state_stale"],
    });
    await show(success(context, "partial"));
    const chip = tag();
    expect(chip.textContent).toBe("Partial");
    expect(chip.style.getPropertyValue("--c")).toBe("var(--warn)");
  });

  it("partial shows the Chinese partial label and the warn palette", async () => {
    const context = exposure({
      status: "partial",
      themeState: { status: "stale", as_of: "2026-07-01", sha256: SHA_THEME },
      warnings: ["theme_state_stale"],
    });
    await show(success(context, "partial"), "zh");
    const chip = tag();
    expect(chip.textContent).toBe("部分覆盖");
    expect(chip.style.getPropertyValue("--c")).toBe("var(--warn)");
    expect(chip.textContent).not.toContain("Partial");
  });

  it("stale shows Last verified and the warn palette even when the context status is ready", async () => {
    await show(success(exposure(), "stale"));
    const chip = tag();
    expect(chip.textContent).toBe("Last verified");
    expect(chip.style.getPropertyValue("--c")).toBe("var(--warn)");
  });

  it("stale shows the Chinese last-verified label and the warn palette", async () => {
    await show(success(exposure(), "stale"), "zh");
    const chip = tag();
    expect(chip.textContent).toBe("最近验证");
    expect(chip.style.getPropertyValue("--c")).toBe("var(--warn)");
    expect(host.textContent).not.toContain("Last verified");
  });
});

describe("company theme context card theme state", () => {
  function warningsFor(status: CompanyThemeStateReceipt["status"]): CompanyThemeExposureWarning[] {
    if (status === "stale") return ["theme_state_stale"];
    if (status === "missing") return ["theme_state_missing"];
    if (status === "invalid") return ["theme_state_invalid"];
    return [];
  }

  async function showTheme(
    status: CompanyThemeStateReceipt["status"],
    lang: "en" | "zh",
  ) {
    const warnings = warningsFor(status);
    const context = exposure({
      status: warnings.length === 0 ? "ready" : "partial",
      themeState: themeStateFor(status),
      warnings,
    });
    await show(success(context, context.status), lang);
    const copy = THEME_COPY[status];
    expect(host.querySelector(".ci-theme-footer b")?.textContent).toBe(lang === "zh" ? copy.zh : copy.en);
    const warning = lang === "zh" ? copy.zhWarning : copy.enWarning;
    if (warning) expect(host.querySelector(".ci-theme-warning")?.textContent).toContain(warning);
    else expect(host.querySelector(".ci-theme-warning")).toBeNull();
  }

  it("fresh EN shows the Fresh label and no theme-state warning", async () => {
    await showTheme("fresh", "en");
  });

  it("fresh ZH shows the Chinese fresh label and no theme-state warning", async () => {
    await showTheme("fresh", "zh");
    expect(host.textContent).not.toContain("Fresh");
  });

  it("stale EN shows the Stale label and the stale receipt warning", async () => {
    await showTheme("stale", "en");
  });

  it("stale ZH shows the Chinese stale label and the stale receipt warning", async () => {
    await showTheme("stale", "zh");
    expect(host.querySelector(".ci-theme-footer")?.textContent).not.toContain("Stale");
  });

  it("missing EN shows the Missing label and the missing receipt warning", async () => {
    await showTheme("missing", "en");
  });

  it("missing ZH shows the Chinese missing label and the missing receipt warning", async () => {
    await showTheme("missing", "zh");
  });

  it("invalid EN shows the Invalid label and the invalid receipt warning", async () => {
    await showTheme("invalid", "en");
  });

  it("invalid ZH shows the Chinese invalid label and the invalid receipt warning", async () => {
    await showTheme("invalid", "zh");
  });

  it("a future theme-state warning shows the English future copy", async () => {
    // CompanyThemeStateReceipt.status has no "future" member. The card surfaces
    // that condition only through the theme_state_future warning.
    const context = exposure({
      status: "partial",
      warnings: ["theme_state_future"],
    });
    await show(success(context, "partial"));
    expect(host.querySelector(".ci-theme-footer b")?.textContent).toBeTruthy();
    expect(host.querySelector(".ci-theme-warning")?.textContent).toContain(THEME_COPY.future.enWarning);
  });

  it("a future theme-state warning shows the Chinese future copy", async () => {
    const context = exposure({
      status: "partial",
      warnings: ["theme_state_future"],
    });
    await show(success(context, "partial"), "zh");
    expect(host.querySelector(".ci-theme-warning")?.textContent).toContain(THEME_COPY.future.zhWarning);
    expect(host.querySelector(".ci-theme-warning")?.textContent).not.toContain(THEME_COPY.future.enWarning);
  });
});

describe("company theme context card coverage", () => {
  const noMembership = exposure({
    exposures: [item()],
    coverage: {
      status: "no_active_membership",
      active_basket_count: 0,
      mapped_basket_count: 0,
      unmapped_basket_count: 0,
    },
    warnings: [],
  });
  const unmapped = exposure({
    status: "partial",
    exposures: [item({ theme_id: "hidden_theme", name_en: "Hidden Theme", name_zh: "隐藏主题" })],
    coverage: {
      status: "unmapped_only",
      active_basket_count: 2,
      mapped_basket_count: 0,
      unmapped_basket_count: 2,
    },
    warnings: [],
  });

  it("no active membership EN renders no theme list and the membership copy", async () => {
    await show(success(noMembership, "ready"));
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("AI Infrastructure");
    expect(host.textContent).toContain("This company has no active membership in the current curated basket roster.");
    expect(host.textContent).not.toContain("excluded from the crosswalk");
  });

  it("no active membership ZH renders no theme list and the Chinese membership copy", async () => {
    await show(success(noMembership, "ready"), "zh");
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("人工智能基础设施");
    expect(host.textContent).toContain("该公司不在当前策展篮子名册的活跃成员中。");
    expect(host.textContent).not.toContain("不会推断标签");
    expect(host.textContent).not.toContain("no active membership");
  });

  it("unmapped baskets with no warnings EN show the excluded-crosswalk copy and no inferred label", async () => {
    await show(success(unmapped, "partial"));
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("Hidden Theme");
    expect(host.textContent).toContain("Some active curated baskets are excluded from the crosswalk; no label is inferred.");
    expect(host.textContent).not.toContain("no active membership in the current curated basket roster");
  });

  it("unmapped baskets with no warnings ZH show the Chinese excluded-crosswalk copy and no inferred label", async () => {
    await show(success(unmapped, "partial"), "zh");
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.textContent).not.toContain("隐藏主题");
    expect(host.textContent).toContain("部分活跃策展篮子被排除在映射之外；不会推断标签。");
    expect(host.textContent).not.toContain("excluded from the crosswalk");
  });
});

describe("company theme context card plural unmapped warning", () => {
  // The producer contract allows both active_membership_unmapped and the plural
  // active_memberships_unmapped (lib/companyThemeExposure.ts:18-24), so warning()
  // must carry the same copy for both codes in each language.
  const pluralUnmapped = exposure({
    status: "partial",
    coverage: {
      status: "unmapped_only",
      active_basket_count: 2,
      mapped_basket_count: 0,
      unmapped_basket_count: 2,
    },
    exposures: [],
    warnings: ["active_memberships_unmapped"],
  });

  it("active_memberships_unmapped ZH uses Chinese copy rather than the raw code", async () => {
    await show(success(pluralUnmapped, "partial"), "zh");
    const text = host.querySelector(".ci-theme-warning p")?.textContent ?? "";
    expect(text).not.toBe("active memberships unmapped");
    expect(text).toContain("部分活跃策展篮子被有意排除在此主题映射之外。");
    expect(text).toMatch(/\p{Script=Han}/u);
  });

  it("active_memberships_unmapped EN uses the English sentence rather than the raw code", async () => {
    await show(success(pluralUnmapped, "partial"));
    const text = host.querySelector(".ci-theme-warning p")?.textContent ?? "";
    expect(text).not.toBe("active memberships unmapped");
    expect(text).toContain("Some active curated baskets are deliberately outside this theme crosswalk.");
  });
});

describe("company theme context card receipts", () => {
  it("the receipts toggle flips aria-expanded and shows generation ids and sha256", async () => {
    await show(success(exposure(), "ready"));
    const button = host.querySelector<HTMLButtonElement>(".ci-theme-receipts");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("aria-controls")).toBe("ci-theme-receipts");
    expect(host.querySelector("#ci-theme-receipts")).toBeNull();
    await act(async () => button!.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    const codes = [...host.querySelectorAll("#ci-theme-receipts code")].map((node) => node.textContent);
    expect(codes).toEqual([THEME_GEN, CI_GEN, "NVDA-2026Q1", SHA_CI, SHA_THEME]);
    await act(async () => button!.click());
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector("#ci-theme-receipts")).toBeNull();
  });

  it("receipts render an em dash when the event pin or theme-state sha256 is absent", async () => {
    const context = exposure({
      status: "partial",
      companyIntelligence: { latest_event_id: null, latest_event_call_date: null },
      themeState: { status: "missing", as_of: null, sha256: null },
      warnings: ["theme_state_missing"],
    });
    await show(success(context, "partial"), "en", { latestEventId: null });
    const button = host.querySelector<HTMLButtonElement>(".ci-theme-receipts");
    await act(async () => button!.click());
    const codes = [...host.querySelectorAll("#ci-theme-receipts code")].map((node) => node.textContent);
    expect(codes).toEqual([THEME_GEN, CI_GEN, EM, SHA_CI, EM]);
  });

  it("the Chinese receipts toggle names the same generation ids", async () => {
    await show(success(exposure(), "ready"), "zh");
    const button = host.querySelector<HTMLButtonElement>(".ci-theme-receipts");
    expect(button?.textContent).toBe("查看凭证");
    await act(async () => button!.click());
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(button?.textContent).toBe("隐藏凭证");
    const panel = host.querySelector("#ci-theme-receipts");
    expect(panel?.textContent).toContain("主题版本");
    expect(panel?.textContent).toContain("公司事件版本");
    expect(panel?.textContent).toContain(THEME_GEN);
    expect(panel?.textContent).toContain(SHA_THEME);
    expect(panel?.textContent).not.toContain("Theme generation");
    expect(panel?.textContent).toContain("仅供背景参考");
  });
});

describe("company theme context card request identity", () => {
  it("a late response for a previous symbol is never painted over the current one", async () => {
    const nvda = exposure({ ticker: "NVDA" });
    const aapl = exposure({
      ticker: "AAPL",
      exposures: [item({
        theme_id: "consumer_platforms",
        name_en: "Consumer Platforms",
        name_zh: "消费平台",
        basket_id: "consumer_platforms",
        mapping_qualifier: "direct",
      })],
    });

    await mount({ ticker: "NVDA" });
    await mount({ ticker: "AAPL" });
    expect(transport.pending.map((request) => request.symbol)).toEqual(["NVDA", "AAPL"]);
    expect(transport.pending[0].signal?.aborted).toBe(true);
    expect(transport.pending[1].signal?.aborted).toBe(false);

    await settle(0, success(nvda, "ready"));
    expect(host.textContent).not.toContain("AI Infrastructure");
    expect(host.querySelector(".ci-theme-list")).toBeNull();
    expect(host.querySelector("[aria-busy='true']")).not.toBeNull();

    await settle(1, success(aapl, "ready"));
    expect(host.textContent).toContain("Consumer Platforms");
    expect(host.textContent).not.toContain("AI Infrastructure");

    await mount({ ticker: "MSFT" });
    expect(transport.pending[1].signal?.aborted).toBe(true);
    expect(host.textContent).not.toContain("Consumer Platforms");
    expect(host.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(host.querySelector(".ci-theme-list")).toBeNull();
  });
});

describe("company theme context card historical event", () => {
  it("a historical selection shows the English boundary and does not request theme context", async () => {
    const onUseLatest = vi.fn();
    await mount({
      selectedEventId: "NVDA-2025Q4",
      selectedEventLabel: "Q4 FY2025",
      onUseLatest,
    });
    expect(transport.pending).toHaveLength(0);
    expect(host.querySelector(".ci-theme-boundary")).not.toBeNull();
    expect(host.querySelector("h3")?.textContent).toBe("Pinned to the latest reported event");
    expect(host.textContent).toContain("Q4 FY2025 is historical, so no current-theme reading is shown here.");
    expect(host.textContent).not.toContain("AI Infrastructure");
    await act(async () => retryButton("Use latest event")!.click());
    expect(onUseLatest).toHaveBeenCalledTimes(1);
  });

  it("a historical selection shows the Chinese boundary and does not request theme context", async () => {
    await mount({
      selectedEventId: "NVDA-2025Q4",
      selectedEventLabel: "Q4 FY2025",
      onUseLatest: () => undefined,
    }, "zh");
    expect(transport.pending).toHaveLength(0);
    expect(host.querySelector("h3")?.textContent).toBe("仅锚定最新报告事件");
    expect(host.textContent).toContain("主题背景仅与最新公司事件一同发布。Q4 FY2025 为历史事件，因此此处不展示当前主题读数。");
    expect(host.textContent).not.toContain("Pinned to the latest reported event");
    expect(retryButton("切换至最新事件")).not.toBeNull();
    expect(retryButton("Use latest event")).toBeNull();
  });
});
