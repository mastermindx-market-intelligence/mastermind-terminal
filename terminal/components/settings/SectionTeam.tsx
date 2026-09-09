"use client";
import { useCallback, useEffect, useState } from "react";
import { Group, Msg, Row, SectionHead } from "./icons";
import { acsDate, type DevTeamFixture, type DevTeamMember, type SectionProps } from "./types";
import { INVITE_MESSAGES, TEAM_ROUTE_MESSAGES, type TeamRole } from "@/lib/teams";
import s from "./SectionTeam.module.css";

type RosterMember = DevTeamMember;
type PendingInvite = DevTeamFixture["invites"][number];

function roleKey(role: TeamRole): string {
  if (role === "owner") return "acsRoleOwner";
  if (role === "admin") return "acsRoleAdmin";
  return "acsRoleMember";
}

/**
 * Round-4 ruling R4(k): profiles.display_name is unset for most accounts, so the previous
 * eight-character user-id fallback would routinely paint machine text where a person's name
 * belongs. An unnamed teammate is described in words instead. No name is invented: the row still
 * says only that someone is on the team.
 */
function displayLabel(member: RosterMember, t: (key: string, fallback?: string) => string): string {
  const name = (member.displayName || "").trim();
  return name || t("acsTeamNoName");
}

function fillName(template: string, name: string): string {
  return template.replaceAll("{name}", name);
}

type TransferPhase = "pick" | "confirm" | "conflict";

function routeMessage(body: { message?: unknown; messageZh?: unknown }, lang: "en" | "zh"): string | null {
  const en = typeof body.message === "string" ? body.message : "";
  const zh = typeof body.messageZh === "string" ? body.messageZh : "";
  const text = lang === "zh" ? zh || en : en;
  return text || null;
}

/**
 * The sentence a failed roster read shows, chosen by CAUSE (round-4 ruling R4(h)). Every non-OK
 * answer used to say "Team accounts are not set up on this server yet", which is false for a
 * signed-out session, for a refusal, and for a server error. Both routes already answer with the
 * precise catalogued pair, so that pair is preferred and stays bilingual; the status map is only
 * for an answer that carries no sentence at all (a proxy error page, a network failure).
 */
function rosterFailPair(status: number, body: { message?: unknown; messageZh?: unknown }): [string, string] {
  const en = typeof body.message === "string" ? body.message : "";
  const zh = typeof body.messageZh === "string" ? body.messageZh : "";
  if (en && zh) return [en, zh];
  if (status === 401) return TEAM_ROUTE_MESSAGES.not_signed_in;
  // Only a genuinely absent team schema answers 503 with the not-set-up sentence; a 403, 429 or
  // 500 lands on read_failed below, never on it.
  if (status === 503) return TEAM_ROUTE_MESSAGES.unavailable;
  return TEAM_ROUTE_MESSAGES.read_failed;
}

export default function SectionTeam({
  t,
  lang,
  user,
  onClose,
  devTeam,
}: SectionProps & { devTeam?: DevTeamFixture }) {
  const callerUserId = devTeam?.callerUserId || user?.id || "";
  const [teamId, setTeamId] = useState<string | null>(devTeam?.team?.id ?? null);
  const [callerRole, setCallerRole] = useState<TeamRole | null>(devTeam?.callerRole ?? null);
  const [members, setMembers] = useState<RosterMember[]>(devTeam?.members ?? []);
  const [invites, setInvites] = useState<PendingInvite[]>(devTeam?.invites ?? []);
  const [rosterFail, setRosterFail] = useState<[string, string] | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; kind: "remove" | "leave" } | null>(null);
  const [transfer, setTransfer] = useState<{ phase: TransferPhase; recipientId: string | null } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  // The zero-team sentence must not flash before the first answer arrives, so it waits on this.
  const [loaded, setLoaded] = useState(Boolean(devTeam));
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const loadLive = useCallback(async () => {
    if (devTeam) return;
    const fail = (status: number, body: { message?: unknown; messageZh?: unknown }) => {
      setRosterFail(rosterFailPair(status, body));
      setMembers([]);
    };
    try {
      const teamsRes = await fetch("/api/teams");
      if (!teamsRes.ok) {
        fail(teamsRes.status, await teamsRes.json().catch(() => ({})));
        return;
      }
      const teamsBody = await teamsRes.json();
      const teams = Array.isArray(teamsBody?.teams) ? teamsBody.teams : null;
      if (!teams) {
        fail(teamsRes.status, {});
        return;
      }
      if (teams.length === 0) {
        setRosterFail(null);
        setTeamId(null);
        setCallerRole(null);
        setMembers([]);
        setInvites([]);
        return;
      }
      const team = teams[0];
      setTeamId(typeof team.id === "string" ? team.id : null);
      const membersRes = await fetch(`/api/teams/${encodeURIComponent(team.id)}/members`);
      if (!membersRes.ok) {
        fail(membersRes.status, await membersRes.json().catch(() => ({})));
        return;
      }
      const membersBody = await membersRes.json();
      const rows = Array.isArray(membersBody?.members) ? membersBody.members : null;
      if (!rows) {
        fail(membersRes.status, {});
        return;
      }
      setRosterFail(null);
      setCallerRole(membersBody.callerRole === "owner" || membersBody.callerRole === "admin" || membersBody.callerRole === "member"
        ? membersBody.callerRole
        : null);
      setMembers(
        rows.map((row: Record<string, unknown>) => ({
          userId: String(row.userId || ""),
          role: row.role === "owner" || row.role === "admin" || row.role === "member" ? row.role : "member",
          displayName: typeof row.displayName === "string" ? row.displayName : "",
          createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
        })),
      );
      if (membersBody.callerRole === "owner" || membersBody.callerRole === "admin") {
        const invRes = await fetch(`/api/teams/invitations?teamId=${encodeURIComponent(team.id)}`);
        if (invRes.ok) {
          const invBody = await invRes.json();
          const pending = Array.isArray(invBody?.invites) ? invBody.invites : [];
          setInvites(
            pending.map((row: Record<string, unknown>) => ({
              id: String(row.id || ""),
              email: String(row.email || ""),
              role: row.role === "admin" ? "admin" : "member",
              expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
            })),
          );
        }
      } else {
        setInvites([]);
      }
    } catch {
      // A network failure is not an absent team schema either.
      setRosterFail(TEAM_ROUTE_MESSAGES.read_failed);
      setMembers([]);
    } finally {
      setLoaded(true);
    }
  }, [devTeam]);

  useEffect(() => {
    if (devTeam) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await loadLive();
    })();
    return () => {
      cancelled = true;
    };
  }, [devTeam, loadLive]);

  async function patchRole(target: RosterMember, role: "admin" | "member") {
    if (!teamId || devTeam) return;
    const previous = members;
    setMembers((rows) => rows.map((row) => (row.userId === target.userId ? { ...row, role } : row)));
    setBusyId(target.userId);
    setMsg(null);
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.userId, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMembers(previous);
        setMsg({ kind: "err", text: routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.role_change_failed[lang === "zh" ? 1 : 0] });
        return;
      }
      const nextRole = body?.member?.role === "admin" || body?.member?.role === "member" ? body.member.role : role;
      setMembers((rows) => rows.map((row) => (row.userId === target.userId ? { ...row, role: nextRole } : row)));
      setMsg({ kind: "ok", text: t("acsTeamSaved") });
    } catch {
      setMembers(previous);
      setMsg({ kind: "err", text: TEAM_ROUTE_MESSAGES.role_change_failed[lang === "zh" ? 1 : 0] });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmRemove() {
    if (!confirm || !teamId || devTeam) return;
    const { userId, kind } = confirm;
    setBusyId(userId);
    setMsg(null);
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members?userId=${encodeURIComponent(userId)}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.remove_failed[lang === "zh" ? 1 : 0] });
        return;
      }
      setMembers((rows) => rows.filter((row) => row.userId !== userId));
      setConfirm(null);
      setMsg({ kind: "ok", text: t(kind === "leave" ? "acsTeamLeft" : "acsTeamRemoved") });
    } catch {
      setMsg({ kind: "err", text: TEAM_ROUTE_MESSAGES.remove_failed[lang === "zh" ? 1 : 0] });
    } finally {
      setBusyId(null);
    }
  }

  function applyLocalTransfer(recipientId: string) {
    setMembers((rows) =>
      rows.map((row) => {
        if (row.userId === callerUserId && row.role === "owner") return { ...row, role: "admin" };
        if (row.userId === recipientId) return { ...row, role: "owner" };
        return row;
      }),
    );
    setCallerRole("admin");
  }

  async function postTransfer(recipientId: string) {
    if (!teamId) return;
    const previousMembers = members;
    const previousRole = callerRole;
    applyLocalTransfer(recipientId);
    setTransferBusy(true);
    setMsg(null);
    try {
      if (devTeam) {
        const name = displayLabel(members.find((m) => m.userId === recipientId) || { userId: recipientId, role: "admin", displayName: "", createdAt: null }, t);
        setTransfer(null);
        setMsg({ kind: "ok", text: fillName(t("acsTeamTransferSuccess"), name) });
        return;
      }
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/transfer-ownership`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerUserId: recipientId }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setMembers(previousMembers);
        setCallerRole(previousRole);
        setTransfer({ phase: "conflict", recipientId });
        setMsg({ kind: "err", text: routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.conflict[lang === "zh" ? 1 : 0] });
        return;
      }
      if (!res.ok) {
        setMembers(previousMembers);
        setCallerRole(previousRole);
        setMsg({
          kind: "err",
          text: routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0],
        });
        return;
      }
      const name = displayLabel(
        previousMembers.find((m) => m.userId === recipientId) || {
          userId: recipientId,
          role: "admin",
          displayName: "",
          createdAt: null,
        },
        t,
      );
      setTransfer(null);
      setMsg({ kind: "ok", text: fillName(t("acsTeamTransferSuccess"), name) });
    } catch {
      setMembers(previousMembers);
      setCallerRole(previousRole);
      setMsg({ kind: "err", text: TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0] });
    } finally {
      setTransferBusy(false);
    }
  }

  async function retryTransfer() {
    if (!transfer || transfer.phase !== "conflict" || !transfer.recipientId) return;
    setTransferBusy(true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await postTransfer(transfer.recipientId);
  }

  async function createTeam() {
    if (devTeam) return;
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    setMsg(null);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ kind: "err", text: routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0] });
        return;
      }
      setNewName("");
      await loadLive();
      setMsg({ kind: "ok", text: t("acsTeamCreated") });
    } catch {
      setMsg({ kind: "err", text: TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0] });
    } finally {
      setCreating(false);
    }
  }

  const emptyTeam = members.length === 1 && members[0]?.userId === callerUserId;
  const hasAdmin = members.some((row) => row.role === "admin");
  const transferRecipients = members.filter((row) => row.role !== "owner" && row.userId !== callerUserId);
  const transferRecipient = transfer?.recipientId
    ? members.find((row) => row.userId === transfer.recipientId) || null
    : null;
  const transferRecipientIsAdmin = transferRecipient?.role === "admin";
  // Round-4 ruling R3: a signed-in account on no team is the population default — the Team item is
  // shown to everyone and nothing else in the Terminal creates a team — so this state gets a
  // sentence and a way out, never a titled box with nothing in it.
  const noTeam = loaded && !rosterFail && !teamId && members.length === 0;
  const showInvites = (callerRole === "owner" || callerRole === "admin") && (invites.length > 0 || Boolean(devTeam));
  const [deliveryEn, deliveryZh] = INVITE_MESSAGES.no_email_delivery;
  const delivery = lang === "zh" ? deliveryZh : deliveryEn;

  return (
    <>
      <SectionHead title={t("acsTeam")} sub={t("acsTeamSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        <Group title={t("acsTeamWhatEach")}>
          <Row label={t("acsRoleOwner")} desc={t("acsRoleOwnerWhat")} />
          <Row label={t("acsRoleAdmin")} desc={t("acsRoleAdminWhat")} />
          <Row label={t("acsRoleMember")} desc={t("acsRoleMemberWhat")} />
        </Group>

        {showInvites ? (
          <Group>
            <p className={`acs-note ${s.delivery}`} data-testid="team-delivery">{delivery}</p>
            {invites.map((invite) => (
              <Row
                key={invite.id || invite.email}
                label={invite.email}
                value={
                  <span
                    className={s.roleBadge}
                    data-role={invite.role}
                    data-testid="team-role-badge"
                  >
                    {t(roleKey(invite.role))}
                  </span>
                }
              />
            ))}
          </Group>
        ) : null}

        <Group title={t("acsTeamPeople")}>
          {rosterFail ? <Msg text={rosterFail[lang === "zh" ? 1 : 0]} kind="err" /> : null}
          {noTeam ? (
            <div className={s.noTeam} data-testid="team-none">
              <p className="acs-note">{t("acsTeamNone")}</p>
              <label className={s.createLabel} htmlFor="acs-team-name">
                {t("acsTeamName")}
              </label>
              <input
                id="acs-team-name"
                className="acs-in"
                type="text"
                autoComplete="off"
                maxLength={120}
                value={newName}
                disabled={creating}
                onChange={(event) => setNewName(event.target.value)}
              />
              <div className={s.createBtns}>
                <button
                  type="button"
                  className="acs-btn"
                  data-testid="team-create"
                  disabled={creating || !newName.trim()}
                  onClick={() => void createTeam()}
                >
                  {t("acsTeamCreate")}
                </button>
              </div>
            </div>
          ) : null}
          {!rosterFail && emptyTeam ? <p className="acs-note">{t("acsTeamEmpty")}</p> : null}
          {!rosterFail &&
            members.map((member) => {
              const isYou = member.userId === callerUserId;
              const isOwnerRow = member.role === "owner";
              const canChangeRole = callerRole === "owner" && !isOwnerRow && !isYou;
              const canRemove =
                !isOwnerRow &&
                ((callerRole === "owner" && !isYou) || (callerRole === "admin" && member.role === "member" && !isYou));
              const canLeave = isYou && (callerRole === "admin" || callerRole === "member");
              const canTransfer = callerRole === "owner" && isYou && isOwnerRow && hasAdmin;
              const confirming = confirm?.userId === member.userId;
              return (
                <Row
                  key={member.userId}
                  editing={confirming}
                  label={
                    <span className={s.teamName}>
                      {displayLabel(member, t)}
                      {isYou ? <span className={s.you}>{t("acsTeamYou")}</span> : null}
                    </span>
                  }
                  desc={
                    member.createdAt
                      ? `${t("acsTeamJoined")} ${acsDate(member.createdAt, lang)}`
                      : undefined
                  }
                  value={
                    <span
                      className={`${s.roleBadge}${member.role === "owner" ? ` ${s.roleOwner}` : ""}`}
                      data-role={member.role}
                      data-testid="team-role-badge"
                    >
                      {t(roleKey(member.role))}
                    </span>
                  }
                  control={
                    <span className={s.actions} data-testid="team-actions">
                      {canChangeRole ? (
                        // Round-4 ruling R4(a): the option a row already holds is not offered.
                        // Clicking it could only ever return "That person already has that role."
                        <span className={s.changeRole} data-testid="team-change-role">
                          {member.role !== "admin" ? (
                            <button
                              type="button"
                              className={`acs-btn ghost ${s.btnSm}`}
                              disabled={busyId === member.userId}
                              onClick={() => void patchRole(member, "admin")}
                            >
                              {t("acsMakeAdmin")}
                            </button>
                          ) : null}
                          {member.role !== "member" ? (
                            <button
                              type="button"
                              className={`acs-btn ghost ${s.btnSm}`}
                              disabled={busyId === member.userId}
                              onClick={() => void patchRole(member, "member")}
                            >
                              {t("acsMakeMember")}
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                      {canRemove ? (
                        <button
                          type="button"
                          className={`acs-btn btn-danger ${s.btnSm}`}
                          disabled={busyId === member.userId}
                          onClick={() => setConfirm({ userId: member.userId, kind: "remove" })}
                        >
                          {t("acsTeamRemove")}
                        </button>
                      ) : null}
                      {canLeave ? (
                        <button
                          type="button"
                          className={`acs-btn btn-danger ${s.btnSm}`}
                          disabled={busyId === member.userId}
                          onClick={() => setConfirm({ userId: member.userId, kind: "leave" })}
                        >
                          {t("acsTeamLeave")}
                        </button>
                      ) : null}
                      {canTransfer ? (
                        <button
                          type="button"
                          className={`acs-btn ghost ${s.btnSm}`}
                          data-testid="team-transfer-ownership"
                          disabled={transferBusy}
                          onClick={() => setTransfer({ phase: "pick", recipientId: null })}
                        >
                          {t("acsTeamTransferButton")}
                        </button>
                      ) : null}
                    </span>
                  }
                >
                  {isOwnerRow && !canTransfer ? <p className={s.ownerLocked}>{t("acsOwnerLocked")}</p> : null}
                  {confirming ? (
                    <div className="acs-form">
                      <p className="acs-note">{t(confirm.kind === "leave" ? "acsTeamLeaveAsk" : "acsTeamRemoveAsk")}</p>
                      <div className="acs-btns">
                        <button type="button" className="acs-btn ghost" onClick={() => setConfirm(null)} disabled={busyId === member.userId}>
                          {t("acsCancel")}
                        </button>
                        <button
                          type="button"
                          className="acs-btn btn-danger"
                          onClick={() => void confirmRemove()}
                          disabled={busyId === member.userId}
                        >
                          {t(confirm.kind === "leave" ? "acsTeamLeave" : "acsTeamRemove")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </Row>
              );
            })}
        </Group>

        {transfer ? (
          <div className={s.transferDialog} role="dialog" aria-modal="true" data-testid="team-transfer-dialog">
            {transfer.phase === "pick" ? (
              <>
                <p className={s.transferTitle}>{t("acsTeamTransferTitle")}</p>
                <p className="acs-note">{t("acsTeamTransferAdminNeed")}</p>
                <div className={s.transferList} data-testid="team-transfer-recipients">
                  {transferRecipients.map((row) => {
                    const selected = transfer.recipientId === row.userId;
                    return (
                      <button
                        key={row.userId}
                        type="button"
                        className={`${s.transferChoice}${selected ? ` ${s.transferChoiceOn}` : ""}`}
                        aria-pressed={selected}
                        disabled={transferBusy}
                        onClick={() => setTransfer({ phase: "pick", recipientId: row.userId })}
                      >
                        <span>{displayLabel(row, t)}</span>
                        <span className={s.roleBadge} data-role={row.role}>
                          {t(roleKey(row.role))}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {transferRecipient && !transferRecipientIsAdmin ? (
                  <p className="acs-note">{t("acsTeamTransferNote")}</p>
                ) : null}
                <div className="acs-btns">
                  <button
                    type="button"
                    className="acs-btn ghost"
                    disabled={transferBusy}
                    onClick={() => setTransfer(null)}
                  >
                    {t("acsCancel")}
                  </button>
                  <button
                    type="button"
                    className="acs-btn"
                    data-testid="team-transfer-next"
                    disabled={transferBusy || !transferRecipientIsAdmin}
                    onClick={() => {
                      if (!transfer.recipientId || !transferRecipientIsAdmin) return;
                      setTransfer({ phase: "confirm", recipientId: transfer.recipientId });
                    }}
                  >
                    {t("acsTeamTransferButton")}
                  </button>
                </div>
              </>
            ) : null}
            {transfer.phase === "confirm" && transfer.recipientId ? (
              <>
                <p className={s.transferTitle} data-testid="team-transfer-confirm-title">
                  {fillName(t("acsTeamTransferConfirm"), displayLabel(transferRecipient || {
                    userId: transfer.recipientId,
                    role: "admin",
                    displayName: "",
                    createdAt: null,
                  }, t))}
                </p>
                <p className="acs-note" data-testid="team-transfer-consequence">
                  {t("acsTeamTransferConsequence")}
                </p>
                <div className="acs-btns">
                  <button
                    type="button"
                    className="acs-btn ghost"
                    disabled={transferBusy}
                    onClick={() => setTransfer({ phase: "pick", recipientId: transfer.recipientId })}
                  >
                    {t("acsCancel")}
                  </button>
                  <button
                    type="button"
                    className="acs-btn"
                    data-testid="team-transfer-confirm"
                    disabled={transferBusy}
                    onClick={() => void postTransfer(transfer.recipientId as string)}
                  >
                    {t("acsTeamTransferButton")}
                  </button>
                </div>
              </>
            ) : null}
            {transfer.phase === "conflict" && transfer.recipientId ? (
              <>
                <p className="acs-note" data-testid="team-transfer-conflict">
                  {TEAM_ROUTE_MESSAGES.conflict[lang === "zh" ? 1 : 0]}
                </p>
                <div className="acs-btns">
                  <button
                    type="button"
                    className="acs-btn ghost"
                    disabled={transferBusy}
                    onClick={() => setTransfer(null)}
                  >
                    {t("acsCancel")}
                  </button>
                  <button
                    type="button"
                    className="acs-btn"
                    data-testid="team-transfer-retry"
                    disabled={transferBusy}
                    onClick={() => void retryTransfer()}
                  >
                    {t("acsTeamTransferRetry")}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        <Msg text={msg?.text || ""} kind={msg?.kind || "ok"} />
      </div>
    </>
  );
}
