// @vitest-environment jsdom
// Render the real dialogs, focus hook, lexicon, capture and planner. Only language selection
// and persistence boundaries are mocked: these tests must never write browser/account data.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudyTemplateSaveDialog from "@/components/studyTemplates/StudyTemplateSaveDialog";
import StudyTemplateLibraryDialog from "@/components/studyTemplates/StudyTemplateLibraryDialog";
import { studyTemplatesText } from "@/lib/studyTemplatesLex";
import { templateFromState } from "@/lib/studyTemplates";
import type { StudyState } from "@/lib/studyInstances";
import type { AccountStudyTemplate } from "@/lib/studyTemplatesClient";

const boundary = vi.hoisted(() => ({
  lang: "en" as "en" | "zh",
  create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  deviceSave: vi.fn(), deviceRename: vi.fn(), deviceDelete: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: boundary.lang }) }));
vi.mock("@/lib/studyTemplatesClient", () => ({
  createAccountTemplate: boundary.create,
  updateAccountTemplate: boundary.update,
  deleteAccountTemplate: boundary.remove,
}));
vi.mock("@/lib/chartTemplates", () => ({
  readDeviceTemplates: () => ({ status: "ok", templates: [], unreadable: 0 }),
  saveDeviceTemplate: boundary.deviceSave,
  renameDeviceTemplate: boundary.deviceRename,
  deleteDeviceTemplate: boundary.deviceDelete,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const draft = "中文草稿";
const state: StudyState = { inds: ["rsi"], indParams: {}, hidden: [] };
const template: AccountStudyTemplate = {
  ...templateFromState(state).body,
  v: 2, id: "fixture", name: "Original", revision: 1, newer: false,
  createdAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:00Z",
};
let host: HTMLDivElement;
let root: Root;
let close: ReturnType<typeof vi.fn>;
let saved: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  boundary.create.mockResolvedValue({ ok: true, template: { ...template, name: draft } });
  boundary.update.mockResolvedValue({ ok: true, template: { ...template, name: draft, revision: 2 } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  close = vi.fn();
  saved = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function inputAt(selector: string) {
  const input = host.querySelector<HTMLInputElement>(selector);
  expect(input).not.toBeNull();
  return input!;
}
function enterDraft(input: HTMLInputElement) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, draft);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(input.value).toBe(draft);
}
function press(input: Element, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape", bubbles: true, cancelable: true, ...init,
  });
  act(() => input.dispatchEvent(event));
  return event;
}
function noWrites() {
  for (const fn of [boundary.create, boundary.update, boundary.remove,
    boundary.deviceSave, boundary.deviceRename, boundary.deviceDelete]) {
    expect(fn).not.toHaveBeenCalled();
  }
}
function openSave() {
  act(() => root.render(<StudyTemplateSaveDialog signedIn studyState={state}
    onClose={close} onSaved={saved} onFailedAfterClose={vi.fn()} />));
  expect(host.querySelector("h3")?.textContent).toBe(studyTemplatesText(boundary.lang, "stplSaveTitle"));
  const input = inputAt("#study-template-name");
  enterDraft(input);
  return input;
}
function openRename() {
  act(() => root.render(<StudyTemplateLibraryDialog
    account={{ status: "ok", templates: [template], unreadable: 0, truncated: false }}
    studyState={state} planContext={{ guestLimit: null, userTier: "free" }}
    initialSelection={{ source: "account", id: template.id }} onClose={close}
    onReloadAccount={vi.fn()} onAccountChanged={saved} onApply={vi.fn()}
    onSaveCurrent={vi.fn()} onToast={vi.fn()} />));
  const rename = [...host.querySelectorAll("button")].find(
    button => button.textContent === studyTemplatesText(boundary.lang, "stplRename"),
  );
  expect(rename).toBeDefined();
  act(() => rename!.click());
  const input = inputAt("#study-template-rename");
  enterDraft(input);
  return input;
}
async function submit(input: HTMLInputElement) {
  // Explicit form submission, not a claim about browser implicit Enter submission.
  await act(async () => {
    input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
const composingKeys = [
  { label: "isComposing", isComposing: true, keyCode: 27 },
  { label: "legacy keyCode 229", isComposing: false, keyCode: 229 },
];

for (const lang of ["en", "zh"] as const) {
  describe(`${lang} study-template Escape ownership`, () => {
    beforeEach(() => { boundary.lang = lang; });
    for (const { label, ...key } of composingKeys) {
      it(`Save retains the draft and permits subsequent save with ${label}`, async () => {
        const input = openSave();
        expect(document.activeElement).toBe(input);
        expect(press(input, key).defaultPrevented).toBe(false);
        expect(inputAt("#study-template-name")).toBe(input);
        expect(input.value).toBe(draft);
        expect(close).not.toHaveBeenCalled();
        noWrites();
        await submit(input);
        expect(boundary.create).toHaveBeenCalledOnce();
        expect(boundary.create).toHaveBeenCalledWith(draft, templateFromState(state).body);
        expect(saved).toHaveBeenCalledOnce();
        expect(close).not.toHaveBeenCalled();
      });
      it(`Library retains the rename draft and permits subsequent save with ${label}`, async () => {
        const input = openRename();
        expect(press(input, key).defaultPrevented).toBe(false);
        expect(inputAt("#study-template-rename")).toBe(input);
        expect(input.value).toBe(draft);
        expect(close).not.toHaveBeenCalled();
        noWrites();
        await submit(input);
        expect(boundary.update).toHaveBeenCalledOnce();
        expect(boundary.update).toHaveBeenCalledWith(template.id, 1, { name: draft });
        expect(host.querySelector("#study-template-rename")).toBeNull();
        expect(saved).toHaveBeenCalledOnce();
        expect(close).not.toHaveBeenCalled();
      });
    }
    it("Save still closes on ordinary Escape after composition cancellation", () => {
      const input = openSave();
      press(input, { isComposing: true });
      expect(close).not.toHaveBeenCalled();
      expect(press(input, { isComposing: false, keyCode: 27 }).defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      noWrites();
    });
    it("ordinary Library Escape cancels only rename, then closes the outer dialog", () => {
      const input = openRename();
      expect(press(input, { isComposing: false, keyCode: 27 }).defaultPrevented).toBe(true);
      expect(host.querySelector("#study-template-rename")).toBeNull();
      expect(host.querySelector("#study-template-preview-title")?.textContent).toBe(template.name);
      expect(close).not.toHaveBeenCalled();
      expect(press(host.querySelector('[role="dialog"]')!).defaultPrevented).toBe(true);
      expect(close).toHaveBeenCalledOnce();
      noWrites();
    });
    it("Library returns to ordinary local cancellation after composition ends", () => {
      const input = openRename();
      press(input, { keyCode: 229 });
      expect(inputAt("#study-template-rename")).toBe(input);
      press(input);
      expect(host.querySelector("#study-template-rename")).toBeNull();
      expect(close).not.toHaveBeenCalled();
      noWrites();
    });
    it("Enter is not consumed by either Escape handler", () => {
      const input = openRename();
      expect(press(input, { key: "Enter", keyCode: 13 }).defaultPrevented).toBe(false);
      expect(inputAt("#study-template-rename")).toBe(input);
      expect(close).not.toHaveBeenCalled();
      noWrites();
    });
  });
}
