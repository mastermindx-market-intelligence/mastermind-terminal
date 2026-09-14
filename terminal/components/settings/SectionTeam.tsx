"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Msg, Row, SectionHead } from "./icons";
import { acsDate, type DevTeamFixture, type DevTeamMember, type SectionProps } from "./types";
import { INVITE_TTL_DAYS, TEAM_ROUTE_MESSAGES, noEmailDeliveryLine, type TeamRole } from "@/lib/teams";
import s from "./SectionTeam.module.css";

type RosterMember = DevTeamMember;
type PendingInvite = DevTeamFixture["invites"][number];
/** The link a created invitation answers with. Shown once: the server keeps only its hash. */
type InviteLink = { email: string; role: "admin" | "member"; url: string };

function isKnownRole(role: string | null | undefined): role is TeamRole {
  return role === "owner" || role === "admin" || role === "member";
}

function roleKey(role: string | null | undefined): string {
  if (role === "owner") return "acsRoleOwner";
  if (role === "admin") return "acsRoleAdmin";
  if (role === "member") return "acsRoleMember";
  return "acsRoleUnknown";
}

function fill(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, value);
  }
  return out;
}

function shortUserId(userId: string): string {
  return userId.slice(0, 8);
}

/**
 * Round-6 ruling R8: an unnamed teammate is described as "Name not set" / "未设置名称",
 * then a muted eight-character discriminator of the account id. No name is invented.
 */
function displayLabel(member: RosterMember, t: (key: string, fallback?: string) => string): string {
  const name = (member.displayName || "").trim();
  return name || t("acsTeamNoName");
}

/** Eight-character account id, only when the roster row has no display name (B-F12-8 R8). */
function unnamedShort(member: RosterMember): string | null {
  if ((member.displayName || "").trim()) return null;
  const short = shortUserId(member.userId);
  return short || null;
}

function unnamedAccountMark(
  member: RosterMember,
  t: (key: string, fallback?: string) => string,
) {
  const short = unnamedShort(member);
  if (!short) return null;
  return (
    <span className={s.accountId} aria-label={fill(t("acsTeamAccount"), { short })}>
      {short}
    </span>
  );
}

/** Spoken name for titles and success: display name, or "Name not set" plus the eight-character id. */
function transferSpokenName(member: RosterMember, t: (key: string, fallback?: string) => string): string {
  const label = displayLabel(member, t);
  const short = unnamedShort(member);
  return short ? `${label} ${short}` : label;
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
  const [teamName, setTeamName] = useState((devTeam?.team?.name || "").trim());
  const [teamsCount, setTeamsCount] = useState(devTeam?.team ? 1 : 0);
  const [teamsTruncated, setTeamsTruncated] = useState(false);
  const [callerRole, setCallerRole] = useState<TeamRole | null>(devTeam?.callerRole ?? null);
  const [members, setMembers] = useState<RosterMember[]>(devTeam?.members ?? []);
  const [invites, setInvites] = useState<PendingInvite[]>(devTeam?.invites ?? []);
  const [invitesFail, setInvitesFail] = useState(false);
  const [truncated, setTruncated] = useState(Boolean(devTeam?.truncated));
  const [rosterFail, setRosterFail] = useState<[string, string] | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState<{ userId: string; kind: "remove" | "leave" } | null>(null);
  const [transfer, setTransfer] = useState<{ phase: TransferPhase; recipientId: string | null } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const transferDialogRef = useRef<HTMLDivElement>(null);
  const transferButtonRef = useRef<HTMLButtonElement>(null);
  const transferWasOpen = useRef(false);
  // The zero-team sentence must not flash before the first answer arrives, so it waits on this.
  const [loaded, setLoaded] = useState(Boolean(devTeam));
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<InviteLink | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteCopyFailed, setInviteCopyFailed] = useState(false);

  useEffect(() => {
    if (transfer) {
      if (!transferWasOpen.current) {
        transferWasOpen.current = true;
        const first = transferDialogRef.current?.querySelector<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        );
        first?.focus();
      }
    } else if (transferWasOpen.current) {
      transferWasOpen.current = false;
      transferButtonRef.current?.focus();
    }
  }, [transfer]);

  const loadLive = useCallback(async () => {
    if (devTeam) return;
    const fail = (status: number, body: { message?: unknown; messageZh?: unknown }) => {
      setRosterFail(rosterFailPair(status, body));
      setMembers([]);
      setTruncated(false);
      setInvites([]);
      setInvitesFail(false);
    };
    setInvites([]);
    setInvitesFail(false);
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
        setTeamName("");
        setTeamsCount(0);
        setTeamsTruncated(false);
        setCallerRole(null);
        setMembers([]);
        setInvites([]);
        setInvitesFail(false);
        setTruncated(false);
        return;
      }
      const team = teams[0];
      setTeamId(typeof team.id === "string" ? team.id : null);
      setTeamName(typeof team.name === "string" ? team.name.trim() : "");
      setTeamsCount(teams.length);
      setTeamsTruncated(teamsBody.truncated === true);
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
      setCallerRole(isKnownRole(membersBody.callerRole) ? membersBody.callerRole : null);
      setTruncated(membersBody.truncated === true);
      setMembers(
        rows.map((row: Record<string, unknown>) => ({
          userId: String(row.userId || ""),
          role: isKnownRole(typeof row.role === "string" ? row.role : null) ? row.role : null,
          displayName: typeof row.displayName === "string" ? row.displayName : "",
          createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
        })),
      );
      if (membersBody.callerRole === "owner" || membersBody.callerRole === "admin") {
        try {
          const invRes = await fetch(`/api/teams/invitations?teamId=${encodeURIComponent(team.id)}`);
          if (!invRes.ok) {
            setInvitesFail(true);
            setInvites([]);
          } else {
            const invBody = await invRes.json();
            const pending = Array.isArray(invBody?.invites) ? invBody.invites : [];
            setInvitesFail(false);
            setInvites(
              pending.map((row: Record<string, unknown>) => ({
                id: String(row.id || ""),
                email: String(row.email || ""),
                role: row.role === "admin" ? "admin" : "member",
                expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
              })),
            );
          }
        } catch {
          setInvitesFail(true);
          setInvites([]);
        }
      } else {
        setInvites([]);
        setInvitesFail(false);
      }
    } catch {
      // A network failure is not an absent team schema either.
      setRosterFail(TEAM_ROUTE_MESSAGES.read_failed);
      setMembers([]);
      setTruncated(false);
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

  function rowError(target: RosterMember, message: string): string {
    const name = displayLabel(target, t);
    return lang === "zh" ? `${name}：${message}` : `${name}: ${message}`;
  }

  function addBusy(userId: string) {
    setBusyId((prev) => {
      const next = new Set(prev);
      next.add(userId);
      return next;
    });
  }

  function dropBusy(userId: string) {
    setBusyId((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }

  async function patchRole(target: RosterMember, role: "admin" | "member") {
    if (!teamId || devTeam) return;
    const previousRole = target.role;
    setMembers((rows) => rows.map((row) => (row.userId === target.userId ? { ...row, role } : row)));
    addBusy(target.userId);
    setMsg(null);
    try {
      const res = await fetch(`/api/teams/${encodeURIComponent(teamId)}/members`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: target.userId, role }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMembers((rows) =>
          rows.map((row) => (row.userId === target.userId ? { ...row, role: previousRole } : row)),
        );
        setMsg({
          kind: "err",
          text: rowError(
            target,
            routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.role_change_failed[lang === "zh" ? 1 : 0],
          ),
        });
        return;
      }
      const nextRole = body?.member?.role === "admin" || body?.member?.role === "member" ? body.member.role : role;
      setMembers((rows) => rows.map((row) => (row.userId === target.userId ? { ...row, role: nextRole } : row)));
      setMsg({ kind: "ok", text: t("acsTeamSaved") });
    } catch {
      setMembers((rows) =>
        rows.map((row) => (row.userId === target.userId ? { ...row, role: previousRole } : row)),
      );
      setMsg({
        kind: "err",
        text: rowError(target, TEAM_ROUTE_MESSAGES.role_change_failed[lang === "zh" ? 1 : 0]),
      });
    } finally {
      dropBusy(target.userId);
    }
  }

  async function confirmRemove() {
    if (!confirm || !teamId || devTeam) return;
    const { userId, kind } = confirm;
    addBusy(userId);
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
      // Round-6 ruling R6: a successful self-leave must reload, the same way createTeam
      // does, so the zero-team state renders with acsTeamLeft as the notice.
      if (kind === "leave") {
        await loadLive();
      } else {
        setMembers((rows) => rows.filter((row) => row.userId !== userId));
      }
      setConfirm(null);
      setMsg({ kind: "ok", text: t(kind === "leave" ? "acsTeamLeft" : "acsTeamRemoved") });
    } catch {
      setMsg({ kind: "err", text: TEAM_ROUTE_MESSAGES.remove_failed[lang === "zh" ? 1 : 0] });
    } finally {
      dropBusy(userId);
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
        const name = transferSpokenName(members.find((m) => m.userId === recipientId) || { userId: recipientId, role: "admin", displayName: "", createdAt: null }, t);
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
        setTransfer(null);
        setMsg({
          kind: "err",
          text: routeMessage(body, lang) || TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0],
        });
        return;
      }
      const name = transferSpokenName(
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
      setTransfer(null);
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

  /**
   * MO-PAID-081 (seat ruling W9T_F12_17, link-only): no mail is sent, so the answer to "invite
   * this person" is a link the owner copies and delivers themselves. The raw token exists only in
   * this response — the server stores its hash — which is why the link replaces the form rather
   * than sitting beside it, and why "Invite someone else" starts a new invitation instead of
   * re-showing this one.
   */
  async function createInviteLink() {
    if (!teamId || inviteBusy) return;
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteBusy(true);
    setMsg(null);
    setInviteCopied(false);
    setInviteCopyFailed(false);
    try {
      const res = await fetch("/api/teams/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", teamId, email, role: inviteRole }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        inviteUrl?: unknown;
        invite?: { email?: unknown };
        message?: unknown;
        messageZh?: unknown;
      };
      const url = typeof body?.inviteUrl === "string" ? body.inviteUrl : "";
      if (!res.ok || !url) {
        setInviteLink(null);
        setMsg({ kind: "err", text: routeMessage(body ?? {}, lang) || TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0] });
        return;
      }
      const invited = typeof body.invite?.email === "string" && body.invite.email ? body.invite.email : email;
      setInviteLink({ email: invited, role: inviteRole, url });
      setInviteEmail("");
      setMsg({ kind: "ok", text: t("acsTeamInviteCreated") });
      await loadLive();
    } catch {
      setInviteLink(null);
      setMsg({ kind: "err", text: TEAM_ROUTE_MESSAGES.write_failed[lang === "zh" ? 1 : 0] });
    } finally {
      setInviteBusy(false);
    }
  }

  async function copyInviteLink() {
    if (!inviteLink) return;
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard?.writeText) {
      setInviteCopied(false);
      setInviteCopyFailed(true);
      return;
    }
    try {
      await clipboard.writeText(inviteLink.url);
      setInviteCopied(true);
      setInviteCopyFailed(false);
    } catch {
      // A denied clipboard permission is not a lost link: the field stays selectable and the
      // sentence says what to do instead of claiming a copy that did not happen.
      setInviteCopied(false);
      setInviteCopyFailed(true);
    }
  }

  function resetInviteForm() {
    setInviteLink(null);
    setInviteCopied(false);
    setInviteCopyFailed(false);
    setMsg(null);
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
  const showInvites = (callerRole === "owner" || callerRole === "admin") && (invites.length > 0 || invitesFail);
  // The invitation form is the surface that would otherwise send the mail, so it is also where the
  // dated "we do not send it" line belongs. It waits on `loaded` so it never offers an invitation
  // for a team the first read has not confirmed, and it stays off the failure and zero-team states.
  const canInvite =
    loaded && !rosterFail && !noTeam && Boolean(teamId) && (callerRole === "owner" || callerRole === "admin");

  return (
    <>
      <SectionHead
        title={teamName || t("acsTeam")}
        sub={noTeam ? undefined : t("acsTeamSub")}
        closeLabel={t("acsClose")}
        onClose={onClose}
      />
      <div
        className="acs-body"
        data-testid="team-live"
        data-team-id={teamId || ""}
        data-caller-role={callerRole || ""}
      >
        {!noTeam && teamsCount > 1 && teamName ? (
          <p className="acs-note" data-testid="team-many">
            {fill(t("acsTeamManyPanel"), { n: String(teamsCount), name: teamName })}
          </p>
        ) : null}
        {!noTeam && teamsTruncated ? (
          <p className="acs-note" data-testid="team-list-truncated">
            {t("acsTeamListTruncated")}
          </p>
        ) : null}
        <Group title={t("acsTeamWhatEach")}>
          <Row label={t("acsRoleOwner")} desc={t("acsRoleOwnerWhat")} />
          <Row label={t("acsRoleAdmin")} desc={t("acsRoleAdminWhat")} />
          <Row label={t("acsRoleMember")} desc={t("acsRoleMemberWhat")} />
        </Group>

        {canInvite ? (
          <Group title={t("acsTeamInviteTitle")}>
            <p className="acs-note" data-testid="team-delivery">
              {noEmailDeliveryLine(lang)}
            </p>
            {inviteLink ? (
              <div className={s.inviteLink} data-testid="team-invite-link">
                <label className={s.createLabel} htmlFor="acs-invite-link" data-testid="team-invite-link-label">
                  {fill(t("acsTeamInviteFor"), { email: inviteLink.email })}
                </label>
                <div className={s.linkRow}>
                  <input
                    id="acs-invite-link"
                    className="acs-in"
                    type="text"
                    readOnly
                    value={inviteLink.url}
                    onFocus={(event) => event.currentTarget.select()}
                    data-testid="team-invite-url"
                  />
                  <button
                    type="button"
                    className="acs-btn"
                    data-testid="team-invite-copy"
                    onClick={() => void copyInviteLink()}
                  >
                    {inviteCopied ? t("acsTeamInviteCopied") : t("acsTeamInviteCopy")}
                  </button>
                </div>
                <p className="acs-note" data-testid="team-invite-send">
                  {fill(t("acsTeamInviteSend"), { days: String(INVITE_TTL_DAYS) })}
                </p>
                {inviteCopyFailed ? (
                  <p className="acs-note" data-testid="team-invite-copy-fail">
                    {t("acsTeamInviteCopyFail")}
                  </p>
                ) : null}
                <div className={s.createBtns}>
                  <button
                    type="button"
                    className="acs-btn ghost"
                    data-testid="team-invite-another"
                    disabled={inviteBusy}
                    onClick={resetInviteForm}
                  >
                    {t("acsTeamInviteAnother")}
                  </button>
                </div>
              </div>
            ) : (
              <div className={s.inviteForm} data-testid="team-invite-form">
                <label className={s.createLabel} htmlFor="acs-invite-email">
                  {t("acsTeamInviteEmail")}
                </label>
                <input
                  id="acs-invite-email"
                  className="acs-in"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  maxLength={254}
                  value={inviteEmail}
                  disabled={inviteBusy}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  data-testid="team-invite-email"
                />
                <p className="acs-note">{t("acsTeamInviteEmailHint")}</p>
                <label className={s.createLabel} htmlFor="acs-invite-role">
                  {t("acsTeamInviteRole")}
                </label>
                <select
                  id="acs-invite-role"
                  className={s.sel}
                  value={inviteRole}
                  disabled={inviteBusy}
                  onChange={(event) => setInviteRole(event.target.value === "admin" ? "admin" : "member")}
                  data-testid="team-invite-role"
                >
                  <option value="member">{t("acsRoleMember")}</option>
                  {/* Only the owner grants administrator, so an administrator never sees the option
                      the route would refuse (lib/teams.ts createInvite, owner_only_admin). */}
                  {callerRole === "owner" ? <option value="admin">{t("acsRoleAdmin")}</option> : null}
                </select>
                <div className={s.createBtns}>
                  <button
                    type="button"
                    className="acs-btn"
                    data-testid="team-invite-create"
                    disabled={inviteBusy || !inviteEmail.trim()}
                    onClick={() => void createInviteLink()}
                  >
                    {inviteBusy ? t("acsTeamInviteCreating") : t("acsTeamInviteCreate")}
                  </button>
                </div>
              </div>
            )}
          </Group>
        ) : null}

        {showInvites ? (
          <Group title={t("acsTeamInvites")}>
            {invitesFail ? (
              <p className="acs-note" data-testid="team-invites-fail">
                {t("acsTeamInvitesFail")}
              </p>
            ) : (
              invites.map((invite) => {
                const expiry = acsDate(invite.expiresAt, lang);
                return (
                  <Row
                    key={invite.id || invite.email}
                    label={invite.email}
                    desc={expiry ? fill(t("acsTeamInviteExpires"), { date: expiry }) : t("acsTeamExpiryUnread")}
                    value={
                      <span className={s.inviteBadge} data-testid="team-invite-badge">
                        {t("acsTeamInviteBadge")}
                      </span>
                    }
                  />
                );
              })
            )}
          </Group>
        ) : null}

        <Group title={t("acsTeamPeople")}>
          {rosterFail ? <Msg text={rosterFail[lang === "zh" ? 1 : 0]} kind="err" /> : null}
          {noTeam ? (
            <div className={s.noTeam} data-testid="team-none">
              <p className="acs-note">{t("acsTeamNoneCreate")}</p>
              <label className={s.createLabel} htmlFor="acs-team-name" data-testid="team-name-label">
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
              const known = isKnownRole(member.role);
              const isOwnerRow = member.role === "owner";
              // Round-6 ruling R9(3): an unrecognised role withholds every control.
              const canChangeRole = known && callerRole === "owner" && !isOwnerRow && !isYou;
              const canRemove =
                known &&
                !isOwnerRow &&
                ((callerRole === "owner" && !isYou) || (callerRole === "admin" && member.role === "member" && !isYou));
              const canLeave = known && isYou && (callerRole === "admin" || callerRole === "member");
              const canTransfer = callerRole === "owner" && isYou && isOwnerRow && hasAdmin;
              const confirming = confirm?.userId === member.userId;
              const joined = acsDate(member.createdAt, lang);
              return (
                <Row
                  key={member.userId}
                  userId={member.userId}
                  editing={confirming}
                  label={
                    <span className={s.teamName}>
                      {displayLabel(member, t)}
                      {unnamedAccountMark(member, t)}
                      {isYou ? <span className={s.you}>{t("acsTeamYou")}</span> : null}
                    </span>
                  }
                  desc={joined ? `${t("acsTeamJoined")} ${joined}` : t("acsTeamJoinedUnread")}
                  value={
                    <span
                      className={`${s.roleBadge}${member.role === "owner" ? ` ${s.roleOwner}` : ""}`}
                      data-role={known ? member.role : "unknown"}
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
                              disabled={busyId.has(member.userId)}
                              onClick={() => void patchRole(member, "admin")}
                            >
                              {t("acsMakeAdmin")}
                            </button>
                          ) : null}
                          {member.role !== "member" ? (
                            <button
                              type="button"
                              className={`acs-btn ghost ${s.btnSm}`}
                              disabled={busyId.has(member.userId)}
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
                          disabled={busyId.has(member.userId)}
                          onClick={() => setConfirm({ userId: member.userId, kind: "remove" })}
                        >
                          {t("acsTeamRemove")}
                        </button>
                      ) : null}
                      {canLeave ? (
                        <button
                          type="button"
                          className={`acs-btn btn-danger ${s.btnSm}`}
                          disabled={busyId.has(member.userId)}
                          onClick={() => setConfirm({ userId: member.userId, kind: "leave" })}
                        >
                          {t("acsTeamLeave")}
                        </button>
                      ) : null}
                      {canTransfer ? (
                        <button
                          type="button"
                          ref={transferButtonRef}
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
                  {isOwnerRow && !canTransfer ? (
                    <p className={s.ownerLocked}>
                      {callerRole === "owner" && isYou && !hasAdmin
                        ? t("acsTeamTransferAdminNeed")
                        : t("acsOwnerLocked")}
                    </p>
                  ) : null}
                  {confirming ? (
                    <div className="acs-form">
                      <p className="acs-note">{t(confirm.kind === "leave" ? "acsTeamLeaveAsk" : "acsTeamRemoveAsk")}</p>
                      <div className="acs-btns">
                        <button type="button" className="acs-btn ghost" onClick={() => setConfirm(null)} disabled={busyId.has(member.userId)}>
                          {t("acsCancel")}
                        </button>
                        <button
                          type="button"
                          className="acs-btn btn-danger"
                          onClick={() => void confirmRemove()}
                          disabled={busyId.has(member.userId)}
                        >
                          {t(confirm.kind === "leave" ? "acsTeamLeave" : "acsTeamRemove")}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </Row>
              );
            })}
          {!rosterFail && truncated ? (
            <p className={`acs-note ${s.truncated}`} data-testid="team-truncated">
              {fill(t("acsTeamTruncated"), { n: String(members.length) })}
            </p>
          ) : null}
        </Group>

        {transfer ? (
          <div
            ref={transferDialogRef}
            className={s.transferDialog}
            role="dialog"
            aria-labelledby="team-transfer-dialog-title"
            data-testid="team-transfer-dialog"
          >
            {transfer.phase === "pick" ? (
              <>
                <p className={s.transferTitle} id="team-transfer-dialog-title">
                  {t("acsTeamTransferTitle")}
                </p>
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
                        <span className={s.teamName}>
                          {displayLabel(row, t)}
                          {unnamedAccountMark(row, t)}
                        </span>
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
                <p className={s.transferTitle} id="team-transfer-dialog-title" data-testid="team-transfer-confirm-title">
                  {fillName(t("acsTeamTransferConfirm"), transferSpokenName(transferRecipient || {
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
                <p className="acs-note" id="team-transfer-dialog-title" data-testid="team-transfer-conflict">
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
