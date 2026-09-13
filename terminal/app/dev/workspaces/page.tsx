"use client";
// Production-gated harness for B-F12-B5-2 crops. Mounts the real LayoutMenu with seeded props.
// /dev/ is excluded from the plain-language guard; the strings under test live in LayoutMenu and i18n.

import { useEffect, useMemo, useState } from "react";
import { notFound, useSearchParams } from "next/navigation";
import LayoutMenu, { type LayoutFeedback, type SavedWorkspace } from "@/components/LayoutMenu";
import { applyLang } from "@/lib/i18n";

const TEAM = { id: "team-desk", name: "Desk", role: "owner" as const };
const MEMBER_TEAM = { id: "team-desk", name: "Desk", role: "member" as const };

const MINE: SavedWorkspace = {
  id: "ws-mine",
  name: "Open",
  config: {},
  updated_at: "2026-09-09T00:00:00.000Z",
  userId: "u-owner",
  teamId: null,
  visibility: "private",
  rowState: "ok",
  sharing: "private",
  teamName: null,
  mine: true,
  canEdit: true,
};

const SHARED: SavedWorkspace = {
  id: "ws-shared",
  name: "Morning board",
  config: {},
  updated_at: "2026-09-09T00:00:00.000Z",
  userId: "u-owner",
  teamId: TEAM.id,
  visibility: "team",
  rowState: "ok",
  sharing: "team",
  teamName: TEAM.name,
  mine: true,
  canEdit: true,
};

const SHARED_RO: SavedWorkspace = { ...SHARED, mine: false, canEdit: false };

const noop = () => {};

export default function WorkspacesHarness() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Harness />;
}

function Harness() {
  const q = useSearchParams();
  const lang = q.get("lang") === "zh" ? "zh" : "en";
  const state = q.get("state") || "team-grouped";
  useEffect(() => { applyLang(lang); }, [lang]);

  const [pending, setPending] = useState<{ id: string; to: "team" | "private"; teamName: string; teamId?: string } | null>(
    state === "share-confirm" ? { id: MINE.id, to: "team", teamName: TEAM.name, teamId: TEAM.id } : null,
  );
  const [feedback] = useState<LayoutFeedback>({ kind: "idle" });

  const seeded = useMemo(() => {
    if (state === "member-read-only") {
      return {
        layouts: [SHARED_RO, { ...MINE, name: "Only me", id: "ws-member-mine" }],
        teams: [MEMBER_TEAM],
      };
    }
    return { layouts: [SHARED, MINE], teams: [TEAM] };
  }, [state]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: 24 }}>
      <div className="pop show" style={{ position: "relative", width: 360, maxWidth: "100%" }} data-ws-harness={state}>
        <LayoutMenu
          status="ready"
          layouts={seeded.layouts}
          name=""
          onNameChange={noop}
          onSave={noop}
          saving={false}
          feedback={feedback}
          deleteError={null}
          onLoad={noop}
          onDelete={noop}
          onRetry={noop}
          onSignUp={noop}
          brainInWorkspace={false}
          onToggleBrainDock={noop}
          onRename={noop}
          onDuplicate={noop}
          onExport={noop}
          onImport={noop}
          staleName={null}
          onUseSuggested={noop}
          onReloadLatest={noop}
          onSaveAsCopy={noop}
          isOpen
          unclaimedFields={[]}
          unsupportedWidgets={[]}
          teams={seeded.teams}
          teamRead={{ ok: true }}
          pendingShare={pending}
          onShare={(layout, teamId) => setPending({ id: layout.id, to: "team", teamName: TEAM.name, teamId })}
          onUnshare={(layout) => setPending({ id: layout.id, to: "private", teamName: layout.teamName || TEAM.name })}
          onConfirmShare={() => setPending(null)}
          onCancelShare={() => setPending(null)}
        />
      </div>
    </div>
  );
}
