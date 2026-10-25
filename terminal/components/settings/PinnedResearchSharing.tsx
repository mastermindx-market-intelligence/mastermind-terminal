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
// from empty, never collapsed. A read failure — list or handoff — asserts nothing about state:
// it hides the stale private content and says so, and the common not_found (absent, revoked or
// removed-source look identical from here) is reported as "currently unavailable" with a
// pointer at Refresh, never as an ended share. A mutation is spoken about only from a
// CONFIRMED server answer: when the answer is lost — a transport failure, or an unavailable
// status that cannot prove the effect did not commit — the outcome is UNKNOWN. The UI then
// claims no effect, no revocation and no empty list (the empty sentences are suppressed until
// a read confirms them), clears any painted private content, and leaves reconciliation to the
// existing explicit Refresh — no automatic replay or new reconciler. A confirmed mutation
// keeps its success message even when only the follow-up list refresh fails; that failure is
// shown as its own separate neutral read note instead of overwriting what is known. All async
// work is generation-tagged, so an identity change or unmount invalidates every in-flight
// answer before it can paint.
//
// Lists are paged (200 per collection page) with two INDEPENDENT "load more" buttons, one per
// collection, each appending only the rows it asked for. The lists are not a frozen snapshot:
// shares can be made or revoked while the owner reads, so the copy says a refresh shows new
// arrivals. A failed page keeps every loaded row, its cursor and the revoke controls — it
// never claims an empty list, a complete list or a revocation. A share, revoke, refresh or
// owner change re-positions the collections, and any late page answer for a superseded
// position is discarded, not painted.

import { useCallback, useEffect, useRef, useState } from "react";
import { Group } from "./icons";
import type { SectionProps } from "./types";
import { identityUserId } from "@/lib/accountIdentity";
import { parseScenarioCapture } from "@/lib/investigationScenario";
import SavedScenarioRead from "@/components/research/SavedScenarioRead";
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
    refresh: "Refresh",
    refreshNote: "Lists change as shares are made or revoked — refresh to see new arrivals.",
    loadMoreSent: "Load more shared",
    loadMoreReceived: "Load more received",
    sentShowing: "Showing {n} shared by you.",
    receivedShowing: "Showing {n} shared with you.",
    moreAvailable: "More are available.",
    loadMoreFailed: "Loading more failed. The handoffs already shown are kept — nothing was changed.",
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
    handoffUnavailable: "This handoff is currently unavailable. Use Refresh to check the current shares.",
    revokeMissing: "We could not find that share to revoke. Use Refresh to see the current lists.",
    refreshHidden:
      "Refreshing this handoff failed, so its content is hidden. The share may still be live — open it again to check.",
    unavailable: "Research handoff sharing is not available right now.",
    mutationUnknown:
      "We could not confirm whether that change happened. Nothing was retried — use Refresh to check the current shares.",
    reconcileFailed:
      "The lists could not be refreshed just now — what is shown may be out of date. Use Refresh to try again.",
    staleNote: "This list may be out of date — use Refresh to check the current shares.",
    readFailed: "We could not read your research handoffs just now.",
    ownerChanged: "Your session switched accounts. Reload this page before sharing again.",
    invalid: "Check the investigation and the recipient account ID, then try again.",
    scenarioOpt: "Include the saved scenario inputs and source reference",
    scenarioOptNote:
      "The scenario inputs and the source reference recorded with this exact revision would be shared. No market values are included. Resolving the saved scenario requires the recipient’s current source access and availability of the exact retained source and model version. Resolution is not provided here. Later revisions are never shared.",
    scenarioChecking: "Checking this revision for a saved scenario…",
    scenarioNone: "This revision has no saved scenario reference.",
    scenarioFailed: "The saved scenario could not be verified for this revision, so it cannot be included.",
    scenarioIncluded: "Includes saved scenario reference",
    sharedScenario: "The scenario inputs and source reference for this exact revision are included.",
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
    refresh: "刷新",
    refreshNote: "列表会随共享创建或撤销而变化——刷新即可看到新到达的内容。",
    loadMoreSent: "加载更多我共享的",
    loadMoreReceived: "加载更多共享给我的",
    sentShowing: "已显示你共享的{n}条。",
    receivedShowing: "已显示共享给你的{n}条。",
    moreAvailable: "还有更多。",
    loadMoreFailed: "加载更多失败。已显示的交接保持不变——未更改任何内容。",
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
    handoffUnavailable: "该交接当前不可用。请刷新查看当前共享。",
    revokeMissing: "未找到可撤销的共享。请刷新查看当前列表。",
    refreshHidden: "刷新此交接失败，内容已隐藏。共享可能仍然有效——请重新打开确认。",
    unavailable: "钉选研究共享暂时不可用。",
    mutationUnknown: "无法确认该更改是否已生效。未自动重试——请刷新查看当前共享。",
    reconcileFailed: "暂时无法刷新列表——显示的内容可能已过期。请刷新重试。",
    staleNote: "此列表可能已过期——请刷新查看当前共享。",
    readFailed: "暂时无法读取你的研究交接。",
    ownerChanged: "你的会话已切换账户。请重新加载本页后再共享。",
    invalid: "请检查所选研究与对方账户 ID，然后重试。",
    scenarioOpt: "包含已保存的方案输入与来源引用",
    scenarioOptNote:
      "随此确切修订版本记录的方案输入与来源引用将被一并共享。不包含任何市场数值。解析已保存的方案需要对方当前拥有来源访问权限，且确切保留的来源与模型版本仍可用。此处不提供解析功能。永远不会共享更新的修订版本。",
    scenarioChecking: "正在检查此修订版本是否包含已保存的方案…",
    scenarioNone: "此修订版本没有已保存的方案引用。",
    scenarioFailed: "无法核实此修订版本的已保存方案，因此无法包含。",
    scenarioIncluded: "包含已保存方案引用",
    sharedScenario: "此确切修订版本的方案输入与来源引用已包含在内。",
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
  const [sentCursor, setSentCursor] = useState<string | null>(null);
  const [receivedCursor, setReceivedCursor] = useState<string | null>(null);
  const [pagingSent, setPagingSent] = useState(false);
  const [pagingReceived, setPagingReceived] = useState(false);
  const [picked, setPicked] = useState("");
  const [grantee, setGrantee] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // A SEPARATE line for read failures, so a failed refresh never overwrites a confirmed
  // mutation outcome (and vice versa): msg carries what is KNOWN, readNote carries why the
  // current lists could not be re-checked.
  const [readNote, setReadNote] = useState<string | null>(null);
  // True while the lists may not match the server — an unconfirmed mutation, or a refresh that
  // failed right after a confirmed one. It suppresses the empty-list sentences, which would
  // otherwise claim "no shares" for a state the server never confirmed.
  const [stale, setStale] = useState(false);
  const [openContent, setOpenContent] = useState<OpenContent>(null);
  // The saved-scenario choice is deliberate, per share, and only for a revision the owner has
  // ACTUALLY re-read and parsed here as a valid reference-only capture. Default false keeps the
  // old payload byte-for-byte; a selection or owner change clears it.
  const [includeScenario, setIncludeScenario] = useState(false);
  const [scenario, setScenario] = useState<"idle" | "checking" | "ok" | "none" | "failed">("idle");

  // Every async completion is stamped with the generation that started it. An identity change
  // or unmount bumps the counter, so a stale answer cannot paint into the new owner's pane.
  const genRef = useRef(0);
  const readGenRef = useRef(0);
  const listEpochRef = useRef(0);
  // Sequence guard for the per-revision owner preview: a selection change or an unmount
  // invalidates the in-flight answer before it can enable the opt-in.
  const previewSeq = useRef(0);
  // Where each collection is currently positioned. A paging completion is stamped with the
  // cursor it asked for; a refresh, share or revoke moves the position, so the late answer for
  // the old position is discarded instead of painted. Mirrored outside state on purpose: the
  // check must read the position at completion time, not the one at render time.
  const cursorRef = useRef<{ sent: string | null; received: string | null }>({ sent: null, received: null });
  const pagingRef = useRef<{ sent: boolean; received: boolean }>({ sent: false, received: false });

  const alive = (gen: number): boolean => genRef.current === gen;

  const reset = useCallback((): void => {
    genRef.current += 1;
    listEpochRef.current += 1;
    setPane("closed");
    setOwn([]);
    setSent([]);
    setReceived([]);
    setSentCursor(null);
    setReceivedCursor(null);
    setPagingSent(false);
    setPagingReceived(false);
    cursorRef.current = { sent: null, received: null };
    pagingRef.current = { sent: false, received: false };
    setPicked("");
    setGrantee("");
    setBusy(false);
    setMsg(null);
    setReadNote(null);
    setStale(false);
    setOpenContent(null);
    previewSeq.current += 1;
    setIncludeScenario(false);
    setScenario("idle");
  }, []);

  // Owner change (guest ⇄ account, or account ⇄ account) and unmount both invalidate.
  useEffect(() => {
    reset();
    return () => {
      genRef.current += 1;
      previewSeq.current += 1;
    };
  }, [userId, reset]);

  /** Owner-side verification for the opt-in: the EXACT selected revision is re-read through
   *  the existing /api/investigations endpoint (owner RLS applies) and its stored capture is
   *  parsed as a strict reference-only capture before the choice can even be enabled. A failed
   *  preview, a changed selection or an owner change clears both the private preview verdict
   *  and the opt-in — an unverifiable revision can never be shared with scenario: true, and a
   *  legacy full-value payload simply parses as "none" (it is not a valid reference). */
  useEffect(() => {
    const item = own.find((entry) => entry.id === picked);
    if (!picked || !item) {
      previewSeq.current += 1;
      setScenario("idle");
      setIncludeScenario(false);
      return;
    }
    const seq = ++previewSeq.current;
    setScenario("checking");
    setIncludeScenario(false);
    void (async () => {
      try {
        const response = await fetch(
          `/api/investigations?${new URLSearchParams({ id: item.id, revision: String(item.revision) })}`,
          { cache: "no-store" },
        );
        const body: unknown = await response.json();
        if (seq !== previewSeq.current) return;
        const manifest =
          response.ok && body !== null && typeof body === "object" && !Array.isArray(body)
            && (body as { status?: unknown }).status === "found"
            && (body as { id?: unknown }).id === item.id
            && (body as { revision?: unknown }).revision === item.revision
            && (body as { manifest?: unknown }).manifest !== null
            && typeof (body as { manifest?: unknown }).manifest === "object"
            ? ((body as { manifest: Record<string, unknown> }).manifest) : null;
        const capture = manifest && manifest.scenario_capture !== undefined && manifest.scenario_capture !== null
          ? parseScenarioCapture(manifest.scenario_capture)
          : null;
        setScenario(capture ? "ok" : "none");
      } catch {
        if (seq !== previewSeq.current) return;
        setScenario("failed");
      }
    })();
  }, [picked, own]);

  /** The list read — always the FIRST page, so it re-positions both collections and orphans
   *  any in-flight later page. False means "do not speak about state" — the pane shows why.
   *  `reconcile` marks the follow-up read after a CONFIRMED mutation: if only that read fails,
   *  it must not overwrite the confirmed outcome. The pane stays ready with the known rows,
   *  the failure becomes the separate neutral read note, the lists are marked stale (the
   *  confirmed change may not be reflected yet), and the paging position — which this failed
   *  read was re-positioning — is dropped rather than pretended. */
  const load = useCallback(async (gen: number, reconcile = false): Promise<boolean> => {
    const epoch = ++listEpochRef.current;
    readGenRef.current += 1;
    setOpenContent(null);
    setReadNote(null);
    setStale(false);
    setPane("loading");
    cursorRef.current = { sent: null, received: null };
    pagingRef.current = { sent: false, received: false };
    setPagingSent(false);
    setPagingReceived(false);
    const failed = (ownerChanged: boolean): boolean => {
      if (reconcile && !ownerChanged) {
        setSentCursor(null);
        setReceivedCursor(null);
        setStale(true);
        setPane("ready");
        setReadNote(c.reconcileFailed);
        return false;
      }
      setPane("unavailable");
      setMsg({ kind: "err", text: ownerChanged ? c.ownerChanged : c.unavailable });
      return false;
    };
    try {
      const { result } = await listHandoffs(userId);
      if (!alive(gen) || listEpochRef.current !== epoch) return false;
      if (result.status === "listed") {
        setOwn(result.own);
        setSent(result.sent);
        setReceived(result.received);
        setSentCursor(result.sentNextCursor);
        setReceivedCursor(result.receivedNextCursor);
        cursorRef.current = { sent: result.sentNextCursor, received: result.receivedNextCursor };
        setPicked((current) => (result.own.some((item) => item.id === current) ? current : ""));
        setStale(false);
        setPane("ready");
        return true;
      }
      return failed(false);
    } catch (error) {
      if (!alive(gen) || listEpochRef.current !== epoch) return false;
      return failed(isHandoffOwnerChangeError(error));
    }
  }, [userId, c]);

  /** One keyset page for ONE collection. Appends only rows that collection asked for, keeps
   *  the other collection and every revoke control untouched, and on failure
   *  keeps the loaded rows and the current position — a failed page never claims an empty
   *  list, a completed list or a revocation. */
  const loadMore = useCallback(async (collection: "sent" | "received"): Promise<void> => {
    const gen = genRef.current;
    const epoch = listEpochRef.current;
    const requested = cursorRef.current[collection];
    if (stale || requested === null || pagingRef.current[collection]) return;
    readGenRef.current += 1;
    setOpenContent(null);
    pagingRef.current[collection] = true;
    if (collection === "sent") setPagingSent(true); else setPagingReceived(true);
    setMsg(null);
    setReadNote(null);
    try {
      const { result } = await listHandoffs(
        userId,
        collection === "sent" ? { sentAfter: requested } : { receivedAfter: requested },
      );
      // A stale page — superseded by a refresh, share, revoke or owner change — says nothing.
      if (!alive(gen) || listEpochRef.current !== epoch || cursorRef.current[collection] !== requested) return;
      if (result.status !== "listed") {
        setMsg({ kind: "err", text: c.loadMoreFailed });
        return;
      }
      const rows = collection === "sent" ? result.sent : result.received;
      const nextCursor = collection === "sent" ? result.sentNextCursor : result.receivedNextCursor;
      const merge = (current: HandoffSummary[]): HandoffSummary[] => {
        const known = new Set(current.map((row) => row.grantId));
        return [...current, ...rows.filter((row) => !known.has(row.grantId))];
      };
      // Invalid progress is unavailable, never evidence that the collection ended.
      if (nextCursor !== null && nextCursor <= requested) {
        setMsg({ kind: "err", text: c.loadMoreFailed });
        return;
      }
      const next = nextCursor;
      if (collection === "sent") {
        setSent(merge);
        setSentCursor(next);
      } else {
        setReceived(merge);
        setReceivedCursor(next);
      }
      cursorRef.current = { ...cursorRef.current, [collection]: next };
    } catch (error) {
      if (!alive(gen) || listEpochRef.current !== epoch || cursorRef.current[collection] !== requested) return;
      setMsg({ kind: "err", text: isHandoffOwnerChangeError(error) ? c.ownerChanged : c.loadMoreFailed });
    } finally {
      if (alive(gen) && listEpochRef.current === epoch) {
        pagingRef.current[collection] = false;
        if (collection === "sent") setPagingSent(false); else setPagingReceived(false);
      }
    }
  }, [userId, c, stale]);

  /** An unconfirmed mutation: the server gave no answer that proves the effect either way —
   *  a lost response can hide a commit, and an unavailable status after the effect cannot
   *  disprove one. So: claim no effect, no revocation and no empty list; drop any painted
   *  private content; mark the lists stale; and leave reconciliation to the existing explicit
   *  Refresh. No automatic replay, no new reconciler. */
  function markUncertain() {
    listEpochRef.current += 1;
    pagingRef.current = { sent: false, received: false };
    setPagingSent(false);
    setPagingReceived(false);
    readGenRef.current += 1;
    setOpenContent(null);
    setStale(true);
    setMsg({ kind: "err", text: c.mutationUnknown });
  }

  /** Explicit refresh: both cursors and the read state reset, both collections re-read from
   *  the first page. That is also how new arrivals become visible — the lists are not a
   *  frozen snapshot across pages. */
  async function onRefresh() {
    if (busy) return;
    setMsg(null);
    await load(genRef.current);
  }

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
      // include_scenario is sent ONLY when the owner explicitly opted in AND this exact
      // revision was verified above; the default call stays the old payload.
      const withScenario = includeScenario && scenario === "ok";
      const { result } = await shareHandoff(userId, {
        investigationId: item.id,
        revision: item.revision,
        granteeUserId: trimmed,
        ...(withScenario ? { includeScenario: true } : {}),
      });
      if (!alive(gen)) return;
      // No retries, no local optimism: speak only from the server's own answer.
      if (result.status === "created" || result.status === "already_shared") {
        setGrantee("");
        setMsg({ kind: "ok", text: result.status === "created" ? c.youShared : c.alreadyShared });
        await load(gen, true);
      } else if (result.status === "share_conflict") {
        setMsg({ kind: "err", text: c.conflict });
      } else if (result.status === "not_found") {
        setMsg({ kind: "err", text: c.notFound });
      } else if (result.status === "invalid_payload") {
        setMsg({ kind: "err", text: c.invalid });
      } else if (result.status === "unauthenticated") {
        // Definitive: refused before any effect.
        setMsg({ kind: "err", text: c.unavailable });
      } else {
        // No confirmed answer — the share may or may not exist now.
        markUncertain();
      }
    } catch (error) {
      if (!alive(gen)) return;
      if (isHandoffOwnerChangeError(error)) {
        setMsg({ kind: "err", text: c.ownerChanged });
      } else {
        markUncertain();
      }
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
        await load(gen, true);
      } else if (result.status === "not_found") {
        // No owned grant was found. Claim no revocation; reconcile the lists.
        setMsg({ kind: "err", text: c.revokeMissing });
        await load(gen, true);
      } else if (result.status === "unauthenticated") {
        // Definitive: refused before any effect.
        setMsg({ kind: "err", text: c.readFailed });
      } else {
        // No confirmed answer — the grant may or may not still be shared.
        markUncertain();
      }
    } catch (error) {
      if (!alive(gen)) return;
      if (isHandoffOwnerChangeError(error)) {
        setMsg({ kind: "err", text: c.ownerChanged });
      } else {
        markUncertain();
      }
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
        // The route's one not_found covers absent, revoked and removed-source alike, so this
        // says the handoff is currently unavailable and points at Refresh — it does not claim
        // the share "ended", revocation, or anything else about a grant it cannot see. The
        // row is dropped from the list as before; a later refresh may bring a still-live
        // grant back.
        setReceived((rows) => rows.filter((entry) => entry.grantId !== row.grantId));
        setMsg({ kind: "err", text: c.handoffUnavailable });
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

      {/* Read failures speak on their own line, so they never overwrite a confirmed outcome. */}
      {readNote ? <p className="acs-msg show err" role="status">{readNote}</p> : null}
      {stale ? <p className="acs-note">{c.staleNote}</p> : null}

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
              {scenario === "checking" ? <p className="acs-note" role="status">{c.scenarioChecking}</p>
                : scenario === "failed" ? <p className="acs-msg show err" role="status">{c.scenarioFailed}</p>
                : scenario === "none" ? <p className="acs-note" role="status">{c.scenarioNone}</p>
                : scenario === "ok" ? (
                  <>
                    <label className="acs-row-desc" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={includeScenario}
                        disabled={busy}
                        onChange={(e) => setIncludeScenario(e.target.checked)}
                        aria-label={c.scenarioOpt}
                      />
                      {c.scenarioOpt}
                    </label>
                    <p className="acs-note">{includeScenario ? c.scenarioIncluded : c.scenarioOptNote}</p>
                  </>
                ) : null}
              <div className="acs-btns">
                <button
                  type="button"
                  className="acs-btn primary"
                  onClick={() => void onShare()}
                  disabled={busy || pagingSent || pagingReceived || !picked || !grantee.trim()}
                  aria-label={c.shareBtn}
                >
                  {c.shareBtn}
                </button>
              </div>
            </div>
          </div>

          {/* Lists are not a frozen snapshot; refresh is the explicit way to see new arrivals. */}
          <div className="acs-row">
            <div className="acs-btns" style={{ justifyContent: "flex-start", alignItems: "center" }}>
              <button
                type="button"
                className="acs-btn ghost"
                onClick={() => void onRefresh()}
                disabled={busy}
                aria-label={c.refresh}
              >
                {c.refresh}
              </button>
              <span className="acs-row-desc">{c.refreshNote}</span>
            </div>
          </div>

          <div className="acs-row">
            <div className="acs-row-line">
              <div className="acs-row-main">
                <span className="acs-row-lbl">{c.mineHead}</span>
                {sent.length > 0 ? (
                  <span className="acs-row-desc">
                    {`${c.sentShowing.replace("{n}", String(sent.length))}${sentCursor ? ` ${c.moreAvailable}` : ""}`}
                  </span>
                ) : null}
              </div>
            </div>
            {sent.length === 0 ? (
              stale ? null : <p className="acs-note" style={{ margin: 0 }}>{c.mineEmpty}</p>
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
            {sentCursor ? (
              <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="acs-btn ghost"
                  onClick={() => void loadMore("sent")}
                  disabled={busy || stale || pagingSent}
                  aria-label={c.loadMoreSent}
                >
                  {pagingSent ? t("acsLoading", "Loading…") : c.loadMoreSent}
                </button>
              </div>
            ) : null}
          </div>

          <div className="acs-row">
            <div className="acs-row-line">
              <div className="acs-row-main">
                <span className="acs-row-lbl">{c.theirsHead}</span>
                {received.length > 0 ? (
                  <span className="acs-row-desc">
                    {`${c.receivedShowing.replace("{n}", String(received.length))}${receivedCursor ? ` ${c.moreAvailable}` : ""}`}
                  </span>
                ) : null}
              </div>
            </div>
            {received.length === 0 ? (
              stale ? null : <p className="acs-note" style={{ margin: 0 }}>{c.theirsEmpty}</p>
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
                        {"scenarioCapture" in open ? (
                          <SavedScenarioRead capture={open.scenarioCapture} lang={lang}
                            revision={{ id: open.investigationId, revision: open.revision, grantId: open.grantId }}
                            identity={identity} />
                        ) : null}
                        <p style={{ margin: 0 }}>{c.excludes}</p>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
            {receivedCursor ? (
              <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="acs-btn ghost"
                  onClick={() => void loadMore("received")}
                  disabled={busy || stale || pagingReceived}
                  aria-label={c.loadMoreReceived}
                >
                  {pagingReceived ? t("acsLoading", "Loading…") : c.loadMoreReceived}
                </button>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </Group>
  );
}
