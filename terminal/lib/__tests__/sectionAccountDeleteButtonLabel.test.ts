// @vitest-environment jsdom
//
// Review MAJOR (round 2, "the delete row's own control, not the generic Edit"): the
// "Delete my account" row used to reuse `editBtn(kind)`'s default `acsEdit` label
// ("Edit"/"编辑"), which reads as editing the account rather than deleting it — the
// reviewer's committed-crop evidence showed this literally on the delete row. The prior
// pass fixed it (editBtn(kind, labelKey), the delete row passing "acsDeleteBtn") and
// verified it live via one manual dev-server accessibility-tree read, but committed no
// automated test — META-CEO B ruling r3 Minor-1 requires that RED-first coverage be
// committed. This file is that coverage: it mounts the REAL SectionAccount component
// (no test double for editBtn/Row/Group) and reads its rendered button text, in both
// languages, for every editable row — so a future regression that reverts the delete
// row back to the generic "Edit"/"编辑" (or that accidentally leaks "Delete"/"删除" onto
// an unrelated row) fails here, not just in a manual crop review.
//
// No @testing-library/react in this repo (vitest.config.ts's `include` is
// lib/__tests__/**/*.test.ts only, no .test.tsx precedent) — this uses react-dom/client's
// createRoot + react's act directly (both already direct dependencies), written as .ts with
// React.createElement instead of JSX so it matches the existing include glob without widening it.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import SectionAccount from "@/components/settings/SectionAccount";
import { LEX } from "@/lib/i18n";
import type { SectionProps } from "@/components/settings/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeT(lang: "en" | "zh") {
  return (key: string, fallback?: string) => {
    const e = LEX[key];
    return e ? e[lang === "zh" ? 1 : 0] : (fallback ?? key);
  };
}

function baseProps(lang: "en" | "zh"): SectionProps {
  return {
    t: makeT(lang),
    lang,
    identity: { kind: "guest" },
    email: "a@example.com",
    user: null,
    onClose: () => {},
    onPatchMeta: () => {},
    onRefreshUser: async () => {},
  };
}

describe("SectionAccount editBtn labels (review MAJOR round 2: acsDeleteBtn vs acsEdit)", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let fetchSpy: ReturnType<typeof vi.fn> | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    // The mount effect calls GET /api/account/deletion; stub it so the effect resolves
    // to "no filed request" instead of throwing into an unhandled rejection.
    fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ requests: [] }) })) as unknown as typeof fetchSpy;
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = undefined;
    container.remove();
  });

  function mount(lang: "en" | "zh") {
    act(() => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccount, baseProps(lang)));
    });
  }

  function editButtonTexts(): string[] {
    return Array.from(container.querySelectorAll("button.acs-edit")).map((el) => el.textContent || "");
  }

  it("EN: the delete row's own control reads Delete, never the generic Edit", () => {
    mount("en");
    const texts = editButtonTexts();
    // name, email, password, delete — in that document order.
    expect(texts).toHaveLength(4);
    expect(texts[3]).toBe("Delete");
    expect(texts[3]).not.toBe("Edit");
  });

  it("ZH: the delete row's own control reads 删除, never the generic 编辑", () => {
    mount("zh");
    const texts = editButtonTexts();
    expect(texts).toHaveLength(4);
    expect(texts[3]).toBe("删除");
    expect(texts[3]).not.toBe("编辑");
  });

  it("EN: the name row still reads Edit (unaffected by the delete row's own label)", () => {
    mount("en");
    expect(editButtonTexts()[0]).toBe("Edit");
  });

  it("EN: the email and password rows still read Edit (unaffected by the delete row's own label)", () => {
    mount("en");
    const texts = editButtonTexts();
    expect(texts[1]).toBe("Edit");
    expect(texts[2]).toBe("Edit");
  });

  it("ZH: the name, email and password rows still read 编辑, never leaking 删除 onto them", () => {
    mount("zh");
    const texts = editButtonTexts();
    expect(texts[0]).toBe("编辑");
    expect(texts[1]).toBe("编辑");
    expect(texts[2]).toBe("编辑");
  });

  it("the delete row's control carries the same acs-edit button class as every other row (styling parity, only the label differs)", () => {
    mount("en");
    const buttons = Array.from(container.querySelectorAll("button.acs-edit"));
    expect(buttons).toHaveLength(4);
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.className).toBe("acs-edit");
    }
  });
});
