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
    identity: { kind: "account", userId: "user-A", email: "a@example.com" },
    email: "a@example.com",
    user: {
      id: "user-A",
      email: "a@example.com",
      createdAt: null,
      lastSignInAt: null,
      provider: "email",
      meta: {},
    },
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

  async function mount(lang: "en" | "zh") {
    await act(async () => {
      root = createRoot(container);
      root!.render(React.createElement(SectionAccount, baseProps(lang)));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function editButtonTexts(): string[] {
    return Array.from(container.querySelectorAll("button.acs-edit")).map((el) => el.textContent || "");
  }

  it("EN: the delete row's own control reads Delete, never the generic Edit", async () => {
    await mount("en");
    const texts = editButtonTexts();
    // name, email, password, delete — in that document order.
    expect(texts).toHaveLength(4);
    expect(texts[3]).toBe("Delete");
    expect(texts[3]).not.toBe("Edit");
  });

  it("ZH: the delete row's own control reads 删除, never the generic 编辑", async () => {
    await mount("zh");
    const texts = editButtonTexts();
    expect(texts).toHaveLength(4);
    expect(texts[3]).toBe("删除");
    expect(texts[3]).not.toBe("编辑");
  });

  it("EN: the name row still reads Edit (unaffected by the delete row's own label)", async () => {
    await mount("en");
    expect(editButtonTexts()[0]).toBe("Edit");
  });

  it("EN: the email and password rows still read Edit (unaffected by the delete row's own label)", async () => {
    await mount("en");
    const texts = editButtonTexts();
    expect(texts[1]).toBe("Edit");
    expect(texts[2]).toBe("Edit");
  });

  it("ZH: the name, email and password rows still read 编辑, never leaking 删除 onto them", async () => {
    await mount("zh");
    const texts = editButtonTexts();
    expect(texts[0]).toBe("编辑");
    expect(texts[1]).toBe("编辑");
    expect(texts[2]).toBe("编辑");
  });

  it("the delete row's control carries the same acs-edit button class as every other row (styling parity, only the label differs)", async () => {
    await mount("en");
    const buttons = Array.from(container.querySelectorAll("button.acs-edit"));
    expect(buttons).toHaveLength(4);
    for (const btn of buttons) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.className).toBe("acs-edit");
    }
  });

  async function openDeleteForm(lang: "en" | "zh") {
    await mount(lang);
    const deleteRowBtn = Array.from(container.querySelectorAll("button.acs-edit")).at(-1);
    expect(deleteRowBtn).toBeTruthy();
    act(() => {
      (deleteRowBtn as HTMLButtonElement).click();
    });
  }

  function deleteConfirmButton(): HTMLButtonElement {
    const buttons = Array.from(container.querySelectorAll(".acs-form button.acs-btn")) as HTMLButtonElement[];
    const confirm = buttons.find((btn) => btn.textContent === "Delete my account" || btn.textContent === "删除我的账户");
    if (!confirm) throw new Error("delete confirm button not found");
    return confirm;
  }

  it("the delete confirm reuses the existing btn-danger class, never the brand-blue primary class", async () => {
    await openDeleteForm("en");
    const confirm = deleteConfirmButton();
    expect(confirm.className.split(/\s+/)).toContain("btn-danger");
    expect(confirm.className.split(/\s+/)).not.toContain("primary");
    expect(confirm.className.split(/\s+/)).toContain("acs-btn");
  });

  it("ZH: the delete confirm still reads 删除我的账户 and still uses btn-danger", async () => {
    await openDeleteForm("zh");
    const confirm = deleteConfirmButton();
    expect(confirm.textContent).toBe("删除我的账户");
    expect(confirm.className.split(/\s+/)).toContain("btn-danger");
    expect(confirm.className.split(/\s+/)).not.toContain("primary");
  });

  it("name/email/password save buttons stay on the primary class (danger is only the deletion confirm)", async () => {
    await mount("en");
    const nameEdit = Array.from(container.querySelectorAll("button.acs-edit"))[0] as HTMLButtonElement;
    act(() => { nameEdit.click(); });
    const save = Array.from(container.querySelectorAll(".acs-form button.acs-btn"))
      .find((btn) => (btn.textContent || "").trim() === "Save") as HTMLButtonElement | undefined;
    expect(save).toBeTruthy();
    expect(save!.className.split(/\s+/)).toContain("primary");
    expect(save!.className.split(/\s+/)).not.toContain("btn-danger");
  });

  it("Sign out uses the existing ghost (neutral secondary) class, not a danger class", async () => {
    await mount("en");
    const signOut = container.querySelector("button.acs-signout-m") as HTMLButtonElement | null;
    expect(signOut).toBeTruthy();
    const classes = signOut!.className.split(/\s+/);
    expect(classes).toContain("acs-btn");
    expect(classes).toContain("ghost");
    expect(classes).not.toContain("btn-danger");
    expect(classes).not.toContain("primary");
  });
});
