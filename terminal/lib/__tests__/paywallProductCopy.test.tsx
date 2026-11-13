// @vitest-environment jsdom
// Ruling D10: /prophet and /prophet/evaluation are gated by the SAME
// terminal_live_options entitlement as /options, but the gate must pitch the
// product the visitor is actually standing on. These tests render the REAL
// route pages (only identity/entitlement reads mocked) through the REAL
// OptionsPaywall component, so they pin the wording a signed-out visitor sees
// — and pin that the Options routes' wording did not move.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LangProvider } from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  access: vi.fn(),
  accessDetail: vi.fn(),
  notFound: vi.fn(() => { throw Error("not found"); }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/shared-shell/memberIdentity", () => ({ readShellMember: mocks.member }));
vi.mock("@/lib/entitlement", () => ({
  getLiveOptionsAccess: mocks.access,
  getLiveOptionsAccessDetail: mocks.accessDetail,
}));

import ProphetPage from "../../app/(shell)/prophet/page";
import ProphetEvaluationPage from "../../app/(shell)/prophet/evaluation/page";
import OptionsPage from "../../app/(shell)/options/page";

let element: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv("MMX_SHARED_SHELL", "1");
  document.documentElement.setAttribute("data-lang", "en");
  // The anonymous state a signed-out visitor is actually in.
  mocks.member.mockReset().mockResolvedValue({ state: "guest" });
  mocks.access.mockReset().mockResolvedValue("allowed");
  // Non-auth denial on /options → the plans card, not the session-recovery card.
  mocks.accessDetail.mockReset().mockResolvedValue({ access: "denied", reason: "plan" });
  element = document.createElement("div");
  document.body.appendChild(element);
  root = createRoot(element);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  element.remove();
  vi.unstubAllEnvs();
});

async function renderRoute(page: () => Promise<React.ReactElement>): Promise<string> {
  await act(async () => { root.render(<LangProvider>{await page()}</LangProvider>); });
  return element.textContent ?? "";
}

describe("the entitlement gate names the product it gates (D10)", () => {
  it.each([
    ["/prophet", ProphetPage],
    ["/prophet/evaluation", ProphetEvaluationPage],
  ])("%s pitches Prophet, not the Options desk", async (_route, page) => {
    const text = await renderRoute(page);
    expect(text).toContain("Unlock the Prophet desk");
    // D12/E5: one body sentence — what Prophet is, which plan it needs.
    expect(text).toContain("managed-pick research desk");
    expect(text).toContain("needs an Essential or Pro plan");
    // D12/E5: the bullets describe only what a member sees today — the
    // #1460 sector journey replaced the Options Alpha research lane, and
    // the geometry bullet is plain words (entry/stop/targets).
    expect(text).toContain("entry, stop and target levels");
    expect(text).toContain("Sector journey");
    // The other product's name, pitch and feature bullets must be absent.
    expect(text).not.toContain("Unlock the Options desk");
    expect(text).not.toContain("Option chains & greeks");
    expect(text).not.toContain("Gamma exposure (GEX)");
    expect(text).not.toContain("Options Alpha");
    // The plan CTA the entitlement actually sells stays on the card.
    expect(text).toContain("Start 7-day free trial");
    expect(text).toContain("Essential · Pro");
  });

  it("/options keeps its own wording, unchanged", async () => {
    const text = await renderRoute(OptionsPage);
    expect(text).toContain("Unlock the Options desk");
    expect(text).toContain("Live order-flow tape");
    expect(text).not.toContain("Unlock the Prophet desk");
    expect(text).not.toContain("managed-pick research desk");
  });

  it.each([
    ["/prophet", ProphetPage],
    ["/prophet/evaluation", ProphetEvaluationPage],
  ])("%s renders the Chinese Prophet wording under zh", async (_route, page) => {
    document.documentElement.setAttribute("data-lang", "zh");
    const text = await renderRoute(page);
    expect(text).toContain("解锁 Prophet 预言台");
    expect(text).toContain("主动选股研究台");
    expect(text).toContain("需订阅 Essential 或 Pro 计划");
    expect(text).toContain("行业旅程");
    expect(text).not.toContain("解锁期权终端");
    expect(text).not.toContain("期权链与希腊字母");
    expect(text).not.toContain("期权阿尔法");
  });
});
