// @vitest-environment jsdom
//
// BLOCKER 1 / MAJOR 3 (PR #555 round-2): LayoutMenu used `onTeam = teams.length > 0`, so a
// live GET with `teamRead.ok: false` and `teams: []` hid the team heading and the unavailable
// banner. A per-team select failure (teams still present) also rendered `wsTeamEmpty` beside
// the banner. RED-first: these cases fail on the previous head and pass only once the menu
// keeps the team group as unavailable, never as empty or absent.
//
// No @testing-library/react in this repo — react-dom/client createRoot + react act.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import React from "react";
import LayoutMenu, { type LayoutMenuProps, type SavedWorkspace } from "@/components/LayoutMenu";
import { LangProvider } from "@/lib/i18n";
import { SHARED_WORKFLOW_MESSAGES } from "@/lib/teamSharedWorkflow";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PRIVATE: SavedWorkspace = {
  id: "priv-1",
  name: "Solo",
  config: {},
  updated_at: "2026-01-02T00:00:00.000Z",
  rowState: "ok",
  sharing: "private",
  teamId: null,
  teamName: null,
  mine: true,
  canEdit: true,
};

const noop = () => {};

function baseProps(overrides: Partial<LayoutMenuProps> = {}): LayoutMenuProps {
  return {
    status: "ready",
    layouts: [PRIVATE],
    name: "",
    onNameChange: noop,
    onSave: noop,
    saving: false,
    feedback: { kind: "idle" },
    deleteError: null,
    onLoad: noop,
    onDelete: noop,
    onRetry: noop,
    onSignUp: noop,
    brainInWorkspace: false,
    onToggleBrainDock: noop,
    onRename: noop,
    onDuplicate: noop,
    onExport: noop,
    onImport: noop,
    staleName: null,
    onUseSuggested: noop,
    onReloadLatest: noop,
    onSaveAsCopy: noop,
    isOpen: true,
    unclaimedFields: [],
    unsupportedWidgets: [],
    ...overrides,
  };
}

describe("LayoutMenu — team-directory failure is unavailable, never absent or empty", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    root = undefined;
    container.remove();
  });

  function mount(overrides: Partial<LayoutMenuProps> = {}) {
    act(() => {
      root = createRoot(container);
      root!.render(
        React.createElement(
          LangProvider,
          null,
          React.createElement(LayoutMenu, baseProps(overrides)),
        ),
      );
    });
  }

  it("a team-directory failure still shows the team heading and the unavailable banner when teams is empty", () => {
    mount({
      teams: [],
      teamRead: { ok: false, message: SHARED_WORKFLOW_MESSAGES.team_read_unavailable[0] },
    });
    expect(container.querySelector('[data-ws-group-hd="team"]')).not.toBeNull();
    expect(container.querySelector("[data-ws-team-read-fail]")?.textContent).toBe(
      SHARED_WORKFLOW_MESSAGES.team_read_unavailable[0],
    );
    expect(container.querySelector("[data-ws-team-empty]")).toBeNull();
    expect(container.textContent).toContain("Shared with your team");
    expect(container.textContent).not.toContain("Your team has not shared a workspace yet.");
  });

  it("a team-read failure with teams still present does not render the empty-team sentence", () => {
    mount({
      teams: [{ id: "team-a", name: "Desk", role: "owner" }],
      teamRead: { ok: false, message: SHARED_WORKFLOW_MESSAGES.team_read_unavailable[0] },
    });
    expect(container.querySelector('[data-ws-group-hd="team"]')).not.toBeNull();
    expect(container.querySelector("[data-ws-team-read-fail]")).not.toBeNull();
    expect(container.querySelector("[data-ws-team-empty]")).toBeNull();
    expect(container.textContent).not.toContain("Your team has not shared a workspace yet.");
  });

  it("a signed-in person on no team still sees only their own library, with no team heading", () => {
    mount({ teams: [], teamRead: { ok: true } });
    expect(container.querySelector('[data-ws-group-hd="team"]')).toBeNull();
    expect(container.querySelector("[data-ws-team-read-fail]")).toBeNull();
    expect(container.querySelector("[data-ws-team-empty]")).toBeNull();
    expect(container.textContent).toContain("Solo");
    expect(container.textContent).not.toContain("Shared with your team");
  });
});
