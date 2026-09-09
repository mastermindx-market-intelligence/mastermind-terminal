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

function displayLabel(member: RosterMember): string {
  const name = (member.displayName || "").trim();
  return name || member.userId.slice(0, 8);
}

function routeMessage(body: { message?: unknown; messageZh?: unknown }, lang: "en" | "zh"): string | null {
  const en = typeof body.message === "string" ? body.message : "";
  const zh = typeof body.messageZh === "string" ? body.messageZh : "";
  const text = lang === "zh" ? zh || en : en;
  return text || null;
}

export default function SectionTeam({
  t,
  lang,
  user,
  onClose,
  devTeam,
}: SectionProps & { devTeam?: DevTeamFixture }) {
  const callerUserId = devTeam?.callerUserId || user?.id || "";
  const [teamId, setTeamId] = useState<string | null>(devTeam?.team.id ?? null);
  const [callerRole, setCallerRole] = useState<TeamRole | null>(devTeam?.callerRole ?? null);
  const [members, setMembers] = useState<RosterMember[]>(devTeam?.members ?? []);
  const [invites, setInvites] = useState<PendingInvite[]>(devTeam?.invites ?? []);
  const [unavailable, setUnavailable] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; kind: "remove" | "leave" } | null>(null);

  const loadLive = useCallback(async () => {
    if (devTeam) return;
    try {
      const teamsRes = await fetch("/api/teams");
      if (teamsRes.status === 503) {
        setUnavailable(true);
        setMembers([]);
        return;
      }
      if (!teamsRes.ok) {
        setUnavailable(true);
        setMembers([]);
        return;
      }
      const teamsBody = await teamsRes.json();
      const teams = Array.isArray(teamsBody?.teams) ? teamsBody.teams : null;
      if (!teams) {
        setUnavailable(true);
        setMembers([]);
        return;
      }
      if (teams.length === 0) {
        setTeamId(null);
        setCallerRole(null);
        setMembers([]);
        setInvites([]);
        return;
      }
      const team = teams[0];
      setTeamId(typeof team.id === "string" ? team.id : null);
      const membersRes = await fetch(`/api/teams/${encodeURIComponent(team.id)}/members`);
      if (membersRes.status === 503 || !membersRes.ok) {
        setUnavailable(true);
        setMembers([]);
        return;
      }
      const membersBody = await membersRes.json();
      const rows = Array.isArray(membersBody?.members) ? membersBody.members : null;
      if (!rows) {
        setUnavailable(true);
        setMembers([]);
        return;
      }
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
      setUnavailable(true);
      setMembers([]);
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

  const emptyTeam = members.length === 1 && members[0]?.userId === callerUserId;
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
          {unavailable ? (
            <Msg text={TEAM_ROUTE_MESSAGES.unavailable[lang === "zh" ? 1 : 0]} kind="err" />
          ) : null}
          {!unavailable && emptyTeam ? <p className="acs-note">{t("acsTeamEmpty")}</p> : null}
          {!unavailable &&
            members.map((member) => {
              const isYou = member.userId === callerUserId;
              const isOwnerRow = member.role === "owner";
              const canChangeRole = callerRole === "owner" && !isOwnerRow && !isYou;
              const canRemove =
                !isOwnerRow &&
                ((callerRole === "owner" && !isYou) || (callerRole === "admin" && member.role === "member" && !isYou));
              const canLeave = isYou && (callerRole === "admin" || callerRole === "member");
              const confirming = confirm?.userId === member.userId;
              return (
                <Row
                  key={member.userId}
                  editing={confirming}
                  label={
                    <span className={s.teamName}>
                      {displayLabel(member)}
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
                        <span className={s.changeRole} data-testid="team-change-role">
                          <button
                            type="button"
                            className={`acs-btn ghost ${s.btnSm}`}
                            disabled={busyId === member.userId}
                            onClick={() => void patchRole(member, "admin")}
                          >
                            {t("acsMakeAdmin")}
                          </button>
                          <button
                            type="button"
                            className={`acs-btn ghost ${s.btnSm}`}
                            disabled={busyId === member.userId}
                            onClick={() => void patchRole(member, "member")}
                          >
                            {t("acsMakeMember")}
                          </button>
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
                    </span>
                  }
                >
                  {isOwnerRow ? <p className={s.ownerLocked}>{t("acsOwnerLocked")}</p> : null}
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

        <Msg text={msg?.text || ""} kind={msg?.kind || "ok"} />
      </div>
    </>
  );
}
