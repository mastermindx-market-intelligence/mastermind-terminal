"use client";
// Pinned research handoffs inside Settings > Sharing (packet b-f12-handoff-consumer).
//
// A SEPARATE lane from the watchlist block above it: it shares only the section frame. The
// block starts COLLAPSED, so opening the Sharing section fetches nothing — the list RPC runs
// only after the owner explicitly opens the disclosure.
//
// What is shared, said plainly in the consent copy: the saved question and its next steps for
// ONE exact revision. Reference attachments and review notes are excluded; a later revision of
// the investigation never reaches the recipient. The owner picks one saved title + exact
// revision and one recipient account UUID; the recipient can open and read that content; the
// owner can revoke. Revocation is terminal.
//
// Honesty rules carried over from the watchlist section: unavailable and failed are distinct
// from empty, never collapsed; a CONFIRMED 404 ends a share in the UI, while a failed refresh
// asserts nothing — it hides the stale private content and says so; after an uncertain
// mutation nothing is claimed and no retry is fired — state is re-read only on explicit
// reload. All async work is generation-tagged, so an identity change or unmount invalidates
// every in-flight answer before it can paint.

import { useCallback, useEffect, useRef, useState } from "react";
import { Group } from "./icons";
import type { SectionProps } from "./types";
import { identityUserId } from "@/lib/accountIdentity";
import {
  isHandoffOwnerChangeError,
  listHandoffs,
  readHandoff,
  revokeHandoff,
  shareHandoff,
  type HandoffOwnItem,
  type HandoffReadPayload,
  type HandoffSummary,
} from "@/lib/researchHandoffs";

type Lang = SectionProps["lang"];

/** Local bilingual copy. The section reuses the shared acs-* classes and this pane's own
 *  strings — the shared LEX table has no research-handoff entries, and adding them is another
 *  packet's path. EN/ZH pairs live here, together, where the copy can be reviewed as copy. */
const COPY: Record<Lang, Record<string, string>> = {
  en: {
    head: "Pinned research handoffs",
    sub: "Share one saved investigation's question and next steps — read only.",
    open: "Open pinned research sharing",
    consent:
      "Sharing sends the saved question and its next steps for the exact revision you pick. Reference attachments and review notes are not included, and newer revisions are never picked up — the recipient sees this revision only.",
    pick: "Choose an investigation",
    account: "Recipient account ID",
    accountHint: "The account UUID shown on their Settings page. Sharing by email is not available.",
    shareBtn: "Share read-only",
    mineHead: "Shared by you",
    theirsHead: "Shared with you",
    mineEmpty: "You have not shared an investigation yet.",
    theirsEmpty: "No investigation has been shared with you yet.",
    revoke: "Revoke",
    revoked: "Share revoked.",
    youShared: "Shared. The recipient sees the pinned revision only.",
    alreadyShared: "This investigation at this revision is already shared with that account.",
    conflict:
      "That investigation is already shared with this account at a different revision. Revoke that share first if you want to change it.",
    notFound: "We could not find that investigation or account.",
    readBtn: "Read shared content",
    hideBtn: "Hide shared content",
    pinned: "Pinned to revision {n}.",
    excludes: "Reference attachments and review notes are not included.",
    nextQuestion: "Next question",
    nextObservation: "Next observation",
    gone: "This share has ended.",
    refreshHidden:
      "Refreshing this handoff failed, so its content is hidden. The share may still be live — open it again to check.",
    unavailable: "Research handoff sharing is not available right now. Nothing was changed.",
    readFailed: "We could not read your research handoffs just now.",
    writeFailed: "We could not save that change.",
    ownerChanged: "Your session switched accounts. Reload this page before sharing again.",
    invalid: "Check the investigation and the recipient account ID, then try again.",
  },
  zh: {
    head: "钉选研究交接",
    sub: "共享一个已保存研究的提问与后续步骤——仅可查看。",
    open: "展开钉选研究共享",
    consent:
      "共享会发送你所选修订版本中已保存的提问及其后续步骤。不包含参考附件与复盘记录，也不会跟进更新的修订版本——对方只能看到这一个修订版本。",
    pick: "选择一个研究",
    account: "对方账户 ID",
    accountHint: "对方设置页显示的账户 UUID。目前不支持通过邮箱共享。",
    shareBtn: "共享（仅可查看）",
    mineHead: "我共享的",
    theirsHead: "共享给我的",
    mineEmpty: "你还没有共享过研究。",
    theirsEmpty: "还没有研究共享给你。",
    revoke: "撤销",
    revoked: "共享已撤销。",
    youShared: "已共享。对方只能看到钉选的修订版本。",
    alreadyShared: "该研究的这一修订版本已共享给该账户。",
    conflict: "该研究已以此账户共享，但修订版本不同。如需更改，请先撤销原共享。",
    notFound: "找不到该研究或该账户。",
    readBtn: "查看共享内容",
    hideBtn: "收起共享内容",
    pinned: "钉选在修订版本{n}。",
    excludes: "不包含参考附件与复盘记录。",
    nextQuestion: "下一个提问",
    nextObservation: "下一步观察",
    gone: "该共享已结束。",
    refreshHidden: "刷新此交接失败，内容已隐藏。共享可能仍然有效——请重新打开确认。",
    unavailable: "钉选研究共享暂时不可用。未更改任何内容。",
    readFailed: "暂时无法读取你的研究交接。",
    writeFailed: "无法保存该更改。",
    ownerChanged: "你的会话已切换账户。请重新加载本页后再共享。",
    invalid: "请检查所选研究与对方账户 ID，然后重试。",
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function lastFour(id: string): string {
  return id.slice(-4);
}

type PaneState = "closed" | "loading" | "ready" | "unavailable" | "failed";
type OpenContent = { grantId: string; payload: HandoffReadPayload } | { grantId: string; gone: true } | null;

export default function PinnedResearchSharing(props: Pick<SectionProps, "t" | "lang" | "identity">) {
  // A new owner gets a fresh state tree in the same render, before effects can run.
  return <PinnedResearchSharingOwner key={identityUserId(props.identity)} {...props} />;
}

function PinnedResearchSharingOwner({ t, lang, identity }: Pick<SectionProps, "t" | "lang" | "identity">) {
  const c = COPY[lang];
  const userId = identityUserId(identity);
  const isAccount = identity.kind === "account";

  const [pane, setPane] = useState<PaneState>("closed");
  const [own, setOwn] = useState<HandoffOwnItem[]>([]);
  const [sent, setSent] = useState<HandoffSummary[]>([]);
  const [received, setReceived] = useState<HandoffSummary[]>([]);
  const [picked, setPicked] = useState("");
  const [grantee, setGrantee] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openContent, setOpenContent] = useState<OpenContent>(null);

  // Every async completion is stamped with the generation that started it. An identity change
  // or unmount bumps the counter, so a stale answer cannot paint into the new owner's pane.
  const genRef = useRef(0);
  const readGenRef = useRef(0);

  const alive = (gen: number): boolean => genRef.current === gen;

  const reset = useCallback((): void => {
    genRef.current += 1;
    setPane("closed");
    setOwn([]);
    setSent([]);
    setReceived([]);
    setPicked("");
    setGrantee("");
    setBusy(false);
    setMsg(null);
    setOpenContent(null);
  }, []);

  // Owner change (guest ⇄ account, or account ⇄ account) and unmount both invalidate.
  useEffect(() => {
    reset();
    return () => {
      genRef.current += 1;
    };
  }, [userId, reset]);

  /** The list read. False means "do not speak about state" — the pane already shows why. */
  const load = useCallback(async (gen: number): Promise<boolean> => {
    readGenRef.current += 1;
    setOpenContent(null);
    setPane("loading");
    try {
      const { result } = await listHandoffs(userId);
      if (!alive(gen)) return false;
      if (result.status === "listed") {
        setOwn(result.own);
        setSent(result.sent);
        setReceived(result.received);
        setPicked((current) => (result.own.some((item) => item.id === current) ? current : ""));
        setPane("ready");
        return true;
      }
      setPane("unavailable");
      setMsg({ kind: "err", text: c.unavailable });
      return false;
    } catch (error) {
      if (!alive(gen)) return false;
      const changed = isHandoffOwnerChangeError(error);
      setPane("unavailable");
      setMsg({ kind: "err", text: changed ? c.ownerChanged : c.unavailable });
      return false;
    }
  }, [userId, c]);

  function onOpenPane() {
    if (pane !== "closed" || !isAccount) return;
    setMsg(null);
    void load(genRef.current);
  }

  async function onShare() {
    if (busy || !isAccount) return;
    const item = own.find((entry) => entry.id === picked);
    const trimmed = grantee.trim().toLowerCase();
    if (!item || !UUID_RE.test(trimmed)) {
      setMsg({ kind: "err", text: c.invalid });
      return;
    }
    setBusy(true);
    setMsg(null);
    const gen = genRef.current;
    try {
      const { result } = await shareHandoff(userId, { investigationId: item.id, revision: item.revision, granteeUserId: trimmed });
      if (!alive(gen)) return;
      // No retries, no local optimism: speak only from the server's own answer.
      if (result.status === "created" || result.status === "already_shared") {
        setGrantee("");
        setMsg({ kind: "ok", text: result.status === "created" ? c.youShared : c.alreadyShared });
        await load(gen);
      } else if (result.status === "share_conflict") {
        setMsg({ kind: "err", text: c.conflict });
      } else if (result.status === "not_found") {
        setMsg({ kind: "err", text: c.notFound });
      } else if (result.status === "invalid_payload") {
        setMsg({ kind: "err", text: c.invalid });
      } else {
        setMsg({ kind: "err", text: c.unavailable });
      }
    } catch (error) {
      if (!alive(gen)) return;
      setMsg({ kind: "err", text: isHandoffOwnerChangeError(error) ? c.ownerChanged : c.writeFailed });
    } finally {
      if (alive(gen)) setBusy(false);
    }
  }

  async function onRevoke(row: HandoffSummary) {
    if (busy || !isAccount) return;
    setBusy(true);
    setMsg(null);
    const gen = genRef.current;
    try {
      const { result } = await revokeHandoff(userId, row.grantId);
      if (!alive(gen)) return;
      if (result.status === "revoked") {
        setMsg({ kind: "ok", text: c.revoked });
        await load(gen);
      } else if (result.status === "not_found") {
        // Already absent on the server: converge the pane, say nothing about success.
        setMsg({ kind: "err", text: c.gone });
        await load(gen);
      } else {
        setMsg({ kind: "err", text: result.status === "unauthenticated" ? c.readFailed : c.unavailable });
      }
    } catch (error) {
      if (!alive(gen)) return;
      setMsg({ kind: "err", text: isHandoffOwnerChangeError(error) ? c.ownerChanged : c.writeFailed });
    } finally {
      if (alive(gen)) setBusy(false);
    }
  }

  async function onRead(row: HandoffSummary) {
    if (!isAccount) return;
    if (openContent && openContent.grantId === row.grantId && !("gone" in openContent)) {
      readGenRef.current += 1;
      setOpenContent(null);
      return;
    }
    setMsg(null);
    setOpenContent(null);
    const readGen = ++readGenRef.current;
    const gen = genRef.current;
    try {
      const { result } = await readHandoff(userId, row.grantId);
      if (!alive(gen) || readGenRef.current !== readGen) return;
      if (result.status === "found") {
        setOpenContent({ grantId: row.grantId, payload: result.handoff });
        return;
      }
      // No private content survives a failed or ended read.
      setOpenContent(null);
      if (result.status === "not_found") {
        setReceived((rows) => rows.filter((entry) => entry.grantId !== row.grantId));
        setMsg({ kind: "err", text: c.gone });
      } else {
        setMsg({ kind: "err", text: c.refreshHidden });
      }
    } catch (error) {
      if (!alive(gen) || readGenRef.current !== readGen) return;
      setOpenContent(null);
      setMsg({ kind: "err", text: isHandoffOwnerChangeError(error) ? c.ownerChanged : c.refreshHidden });
    }
  }

  const opening = pane === "loading";
  const blocked = pane === "unavailable" || pane === "failed";

  // ── Collapsed: one disclosure button, no data, no fetch. ──────────────────────────────────
  if (pane === "closed") {
    return (
      <Group title={c.head}>
        <div className="acs-row">
          <div className="acs-row-line">
            <div className="acs-row-main">
              <span className="acs-row-lbl">{c.head}</span>
              <span className="acs-row-desc">{c.sub}</span>
            </div>
          </div>
          <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="acs-btn ghost"
              onClick={onOpenPane}
              disabled={!isAccount}
              aria-expanded={false}
              aria-label={c.open}
            >
              {c.open}
            </button>
          </div>
          {msg ? <p className={msg.kind === "ok" ? "acs-msg show ok" : "acs-msg show err"} role="status">{msg.text}</p> : null}
        </div>
      </Group>
    );
  }

  // ── Open ─────────────────────────────────────────────────────────────────────────────────
  return (
    <Group title={c.head}>
      <p className="acs-note" style={{ margin: 0 }}>{c.consent}</p>

      {msg ? <p className={msg.kind === "ok" ? "acs-msg show ok" : "acs-msg show err"} role="status">{msg.text}</p> : null}

      {opening ? <p className="acs-note" style={{ margin: 0 }} role="status">{t("acsLoading", "Loading…")}</p> : null}

      {blocked ? (
        <div className="acs-row">
          <p className="acs-note" style={{ margin: 0 }}>{c.unavailable}</p>
          <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="acs-btn ghost"
              onClick={() => {
                setMsg(null);
                void load(genRef.current);
              }}
              aria-label={c.open}
            >
              {c.open}
            </button>
          </div>
        </div>
      ) : pane === "ready" ? (
        <>
          {/* Owner: pick ONE saved title + exact revision, and ONE recipient account. */}
          <div className="acs-row">
            <div className="acs-form" style={{ display: "block" }}>
              <label className="acs-row-desc" htmlFor="rsr-pick-inv">{c.pick}</label>
              <select
                id="rsr-pick-inv"
                className="acs-in"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
                aria-label={c.pick}
                disabled={busy || own.length === 0}
              >
                <option value="">{c.pick}</option>
                {own.map((item) => (
                  <option key={item.id} value={item.id}>{`${item.title} — r${item.revision}`}</option>
                ))}
              </select>
              <label className="acs-row-desc" htmlFor="rsr-account">{c.account}</label>
              <input
                id="rsr-account"
                className="acs-in"
                value={grantee}
                onChange={(e) => setGrantee(e.target.value)}
                aria-label={c.account}
                autoComplete="off"
                disabled={busy}
              />
              <p className="acs-note">{c.accountHint}</p>
              <p className="acs-note">{c.excludes}</p>
              <div className="acs-btns">
                <button
                  type="button"
                  className="acs-btn primary"
                  onClick={() => void onShare()}
                  disabled={busy || !picked || !grantee.trim()}
                  aria-label={c.shareBtn}
                >
                  {c.shareBtn}
                </button>
              </div>
            </div>
          </div>

          <div className="acs-row">
            <span className="acs-row-lbl">{c.mineHead}</span>
            {sent.length === 0 ? (
              <p className="acs-note" style={{ margin: 0 }}>{c.mineEmpty}</p>
            ) : (
              sent.map((row) => (
                <div className="acs-row" key={row.grantId}>
                  <div className="acs-row-line">
                    <div className="acs-row-main">
                      <span className="acs-row-lbl">{row.title}</span>
                      <span
                        className="acs-row-desc"
                        title={`${c.account}: ${row.granteeUserId}`}
                      >
                        {`${c.pinned.replace("{n}", String(row.revision))} ${t("shrSharedWithAccount", "Shared with the account ending {n}.").replace("{n}", lastFour(row.granteeUserId))}`}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="acs-btn ghost"
                      onClick={() => void onRevoke(row)}
                      disabled={busy}
                      aria-label={`${c.revoke} — ${row.title}`}
                    >
                      {c.revoke}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="acs-row">
            <span className="acs-row-lbl">{c.theirsHead}</span>
            {received.length === 0 ? (
              <p className="acs-note" style={{ margin: 0 }}>{c.theirsEmpty}</p>
            ) : (
              received.map((row) => {
                const open = openContent && openContent.grantId === row.grantId && !("gone" in openContent) ? openContent.payload : null;
                return (
                  <div className="acs-row" key={row.grantId}>
                    <div className="acs-row-line">
                      <div className="acs-row-main">
                        <span className="acs-row-lbl">{row.title}</span>
                        <span className="acs-row-desc">{c.pinned.replace("{n}", String(row.revision))}</span>
                      </div>
                      <span className="acs-chip" aria-label={t("shrReadOnlyBadge", "Read only")}>{t("shrReadOnlyBadge", "Read only")}</span>
                    </div>
                    <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
                      <button
                        type="button"
                        className="acs-btn ghost"
                        onClick={() => void onRead(row)}
                        aria-expanded={!!open}
                        aria-label={open ? c.hideBtn : c.readBtn}
                      >
                        {open ? c.hideBtn : c.readBtn}
                      </button>
                    </div>
                    {open ? (
                      <div className="acs-note" style={{ marginTop: 8 }}>
                        <p style={{ margin: "0 0 4px" }}><strong>{open.intent.title}</strong></p>
                        <p style={{ margin: "0 0 4px" }}>{open.intent.question}</p>
                        {open.continuation.nextQuestion ? (
                          <p style={{ margin: "0 0 4px" }}>{`${c.nextQuestion}: ${open.continuation.nextQuestion}`}</p>
                        ) : null}
                        {open.continuation.nextObservation ? (
                          <p style={{ margin: "0 0 4px" }}>{`${c.nextObservation}: ${open.continuation.nextObservation}`}</p>
                        ) : null}
                        <p style={{ margin: 0 }}>{c.excludes}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </Group>
  );
}
