"use client";

/**
 * BriefSharingReview — the authenticated Terminal consumer for exact single-team,
 * view-only sharing of ONE delivered brief (/briefs/[deliveryId]/sharing).
 *
 * SOURCE CONTRACT (fixed by the parent run; implemented by another source worker):
 * `@/lib/briefDeliverySharing` owns the wire types and the decoders. This file
 * imports — never re-implements — them, and treats a null (or throwing) decode as
 * "this response is not a sharing review", not as licence to invent one. The names
 * below are the agreed export names: decodeSharingReview / decodeSharingReceipt /
 * SharingReview / Receipt.
 *
 * No subscription/source id reaches the UI, and no grant is created, revoked or
 * claimed here: a share is ONE POST the server accepts or refuses; the page's
 * address carries the exact pre-send correlation hash before that POST; and
 * "shared" is claimed only from a read-only receipt that MATCHES that same hash
 * with current access. No polling, no timers, no localStorage, no send retry.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLang } from "@/lib/i18n";
import { useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { isUuid } from "@/lib/briefs";
import {
  decodeSharingReceipt,
  decodeSharingReview,
  type Receipt,
  type SharingReview,
} from "@/lib/briefDeliverySharing";
import s from "./brief-sharing.module.css";

type Lang = "en" | "zh";

/** UI copy as readonly [en, zh] pairs; a surface renders ONE locale, never a mix. */
const COPY = {
  eyebrow: ["Terminal", "终端"],
  heading: ["Share the brief?", "分享这份简报？"],
  lede: ["Which team should see this brief?", "哪个团队可以看到这份简报？"],
  back: ["Back to alerts", "返回提醒"],
  chooseTeam: ["Team", "团队"],
  chooseTeamBlank: ["Select a team", "请选择团队"],
  review: ["Review sharing", "查看分享状态"],
  reviewing: ["Reviewing…", "查看中…"],
  share: ["Share with team", "与团队分享"],
  sharing: ["Sharing…", "分享中…"],
  keepPrivate: ["Keep private", "保持私有"],
  noteOtherWork: ["Other project work continues while you decide.", "你可以先处理其他项目工作，之后再决定。"],
  openBrief: ["Open brief", "打开简报"],
  closeBrief: ["Close brief", "收起简报"],
  technical: ["Technical detail", "技术信息"],
  slotLabel: ["Brief slot", "简报时段"],
  artifactAsOf: ["Artifact as of", "产物截至"],
  contentDigest: ["Content digest", "内容摘要"],
  sharingAddress: ["Sharing address", "分享地址"],
  marketRead: ["Market read", "市场解读"],
  monitors: ["Monitors", "监控项"],
  alreadyShared: ["This brief is already shared.", "这份简报已经分享。"],
  notShareable: ["This brief can't be shared from this page right now.", "这份简报目前无法从此页面分享。"],
  teamsUnavailable: ["Your teams could not be loaded right now.", "暂时无法加载你的团队。"],
  retryTeams: ["Try again", "重试"],
  lockedNote: [
    "This page addresses one original sharing, so the team choice and sending are off.",
    "此页面针对一次原有分享，因此不能更改团队或再次发送。",
  ],
  checkOriginal: ["Check original sharing", "检查原有分享"],
  checking: ["Checking…", "检查中…"],
  sharedTitle: ["Shared with your team.", "已与你的团队分享。"],
  audiencePolicy: ["View only · Current team membership controls access. Later members can view this brief; removed members lose access. This does not share the subscription or underlying target.", "只读 · 访问由团队当前成员资格控制。新加入成员可以查看简报，已移除成员失去访问权。此操作不分享订阅或底层目标。"],
  accessActive: ["The view-only grant is active for current team members. This receipt does not show who opened the brief.", "只读授权目前对团队现有成员生效。此回执不表示已有成员打开简报。"],
  recordedTitle: ["Sharing recorded; current access not established.", "分享已记录；尚未确认当前访问。"],
  notObservedNote: [
    "No sharing record is visible yet. The outcome is not confirmed. Check this original sharing again; do not send another request.",
    "尚未看到分享记录，结果仍未确认。请再次检查这次原有分享，不要重新发送请求。",
  ],
  conflictNote: ["The sharing on record doesn't match what this page expects.", "已记录的分享与此页面所预期的不一致。"],
  grantMismatchNote: [
    "The grant on record doesn't match this brief's current sharing address.",
    "已记录的授权与此简报当前的分享地址不一致。",
  ],
  matchedNoAccess: [
    "A grant matches this address, but its current team access is not active.",
    "有授权匹配此地址，但你的团队当前访问未启用。",
  ],
  receiptUnreadable: ["The sharing receipt could not be read.", "无法读取分享回执。"],
  unknownTitle: ["We couldn't confirm what happened.", "无法确认结果。"],
  unknownNote: [
    "Nothing further was sent. The sharing address for this attempt stays in the page address, and nothing here claims a share.",
    "没有再发送任何内容。本次尝试的分享地址保留在页面地址中，此处不声明任何分享。",
  ],
  errDenied: ["This brief can't be shared with that team from your account.", "你的账户无法与该团队分享这份简报。"],
  errConflict: ["That request conflicts with the sharing on record.", "该请求与已记录的分享冲突。"],
  errUnavailable: ["Briefs could not load right now. Try again in a moment.", "暂时无法加载简报，请稍后再试。"],
  errInvalid: ["That request was not complete. Check the fields and try again.", "请求不完整。请检查填写项后重试。"],
  errEffectUnknown: ["This sharing address isn't recorded for this brief.", "此简报没有记录这个分享地址。"],
  errUnexpected: ["The request was not completed here. Check the original sharing status.", "请求未在此处完成。请检查原有分享状态。"],
  checkingIdentity: ["Checking your account…", "正在核对账户…"],
  addressUnavailable: ["The original sharing address could not be retained. Nothing was sent.", "无法保留原有分享地址，未发送任何内容。"],
  signInPrompt: ["Sign in to share a brief.", "登录后即可分享简报。"],
  sessionEnded: ["Your session ended. Sign in to continue.", "登录状态已结束。请重新登录继续。"],
  signIn: ["Sign in", "登录"],
} as const;

type CopyKey = keyof typeof COPY;

const pick = (key: CopyKey, lang: Lang): string => COPY[key][lang === "zh" ? 1 : 0];

/** SHA-64 hex — the exact shape of a pre-send sharing correlation address. */
const SHA64_RE = /^[0-9a-f]{64}$/;

const sharingRoute = (deliveryId: string) => `/api/briefs/deliveries/${encodeURIComponent(deliveryId)}/sharing`;

type TeamOption = { id: string; name: string };
type ErrorCode = "effect_unknown" | "denied" | "conflict" | "unavailable" | "invalid_input";
type SendState = "idle" | "sending" | "recorded" | "refused" | "unknown";

const isAbortError = (error: unknown): boolean =>
  !!error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** A decoder is the source contract, so a throw is handled exactly like a null. */
function safeDecode<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** Route codes never reach the screen; each maps to one plain sentence. */
function errorKind(raw: unknown): ErrorCode {
  if (!!raw && typeof raw === "object" && !Array.isArray(raw)) {
    const code = (raw as { code?: unknown }).code;
    if (code === "effect_unknown" || code === "denied" || code === "conflict" || code === "unavailable" || code === "invalid_input") {
      return code;
    }
  }
  return "unavailable";
}

export type BriefSharingReviewProps = {
  deliveryId: string;
  principalId: string;
  /** A sharing address this page was opened with — it disables every fresh send. */
  initialExpectedEffect?: string | null;
};

export function BriefSharingReview({ deliveryId, principalId, initialExpectedEffect = null }: BriefSharingReviewProps) {
  const identity = useShellIdentity();
  const { lang } = useLang();
  const language: Lang = lang === "zh" ? "zh" : "en";
  // The auth uuid is the ONE ownership key. The shell's email stays presentation-only.
  const identityKey = identity.kind === "account" ? identity.userId : "";
  // Same-render masking: any change of user, delivery or principal remounts the whole
  // consumer below, so nothing read or sent for the previous principal survives into
  // the next render — a late promise lands on an unmounted tree, where it can
  // neither render nor send.
  const guard = useReadingScope(identityKey === principalId ? principalId : "");
  if (!guard.ready) return <section className={s.wrap} data-brief-sharing="" data-brief-sharing-state="signed-out" aria-live="polite"><p>{pick(!identityKey ? "signInPrompt" : guard.ended ? "sessionEnded" : guard.unavailable ? "errUnavailable" : "checkingIdentity", language)}</p></section>;
  const lifecycleKey = `${identityKey}|${principalId}|${deliveryId}`;
  return (
    <BriefSharingReviewLifecycle
      key={lifecycleKey}
      deliveryId={deliveryId}
      principalId={principalId}
      identityKey={identityKey}
      initialExpectedEffect={initialExpectedEffect}
      lang={language}
    />
  );
}

function BriefSharingReviewLifecycle({
  deliveryId,
  principalId,
  identityKey,
  initialExpectedEffect,
  lang,
}: {
  deliveryId: string;
  principalId: string;
  identityKey: string;
  initialExpectedEffect: string | null;
  lang: Lang;
}) {
  const t = useCallback((key: CopyKey) => pick(key, lang), [lang]);

  // A valid current principal: the shell uuid must be THE principal this page was
  // mounted for, and both route ids must be well formed before anything is read.
  const identityValid = identityKey !== "" && identityKey === principalId && isUuid(principalId) && isUuid(deliveryId);

  // The original sharing address this page was opened with, when it is well formed.
  // It disables every fresh send and every team change; only a read of the original
  // receipt is offered.
  const [address] = useState(() => {
    const url = new URL(window.location.href);
    const saved = url.searchParams.getAll("expected_effect_sha256");
    const canonical = `/briefs/${deliveryId}/sharing`;
    // Only the canonical route may carry a retained operation. No duplicate or
    // malformed address can become a fresh send after identity departure.
    if (saved.length > 0 && (url.pathname !== canonical || saved.length !== 1 || !SHA64_RE.test(saved[0]))) return { invalid: true, hash: null };
    if (initialExpectedEffect !== null && !SHA64_RE.test(initialExpectedEffect)) return { invalid: true, hash: null };
    if (saved.length && initialExpectedEffect && saved[0] !== initialExpectedEffect) return { invalid: true, hash: null };
    return { invalid: false, hash: saved[0] ?? initialExpectedEffect };
  });
  const principalValid = identityValid && !address.invalid;
  const lockedHash = address.hash;
  const [addressError, setAddressError] = useState(false);

  const [teams, setTeams] = useState<TeamOption[] | null>(null);
  const [teamsAttempt, setTeamsAttempt] = useState(0);
  const [teamsUnavailable, setTeamsUnavailable] = useState(false);
  const [teamId, setTeamId] = useState("");
  const [review, setReview] = useState<SharingReview | null>(null);
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewError, setReviewError] = useState<ErrorCode | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptError, setReceiptError] = useState<ErrorCode | null>(null);
  const [receiptPending, setReceiptPending] = useState(false);
  const [receiptRead, setReceiptRead] = useState(false);
  const [sendState, setSendState] = useState<SendState>("idle");
  const [sendRefusal, setSendRefusal] = useState<ErrorCode | null>(null);
  const [effectUsed, setEffectUsed] = useState<string | null>(null);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);

  const sentRef = useRef(false);
  const aliveRef = useRef(true);
  const readsRef = useRef<Set<AbortController>>(new Set());

  const clearPrivate = useCallback(() => {
    setTeams(null);
    setTeamsUnavailable(false);
    setTeamId("");
    setReview(null);
    setReviewPending(false);
    setReviewError(null);
    setReceipt(null);
    setReceiptError(null);
    setReceiptPending(false);
    setReceiptRead(false);
    setSendState("idle");
    setSendRefusal(null);
    setEffectUsed(null);
    setBodyOpen(false);
    setSessionEnded(true);
    // sentRef is deliberately NOT reset: a spent send stays spent.
  }, []);

  // Reads are aborted when this consumer goes away — by unmount or by a
  // principal/delivery rotation above it — and a POST that outlives it neither
  // renders nor reaches the reconcile read.
  useEffect(() => {
    aliveRef.current = true;
    const reads = readsRef.current;
    return () => {
      aliveRef.current = false;
      for (const ctrl of reads) ctrl.abort();
      reads.clear();
    };
  }, []);

  // Identity-scoped teams, read once. No polling, no roster counts.
  useEffect(() => {
    if (!principalValid) return;
    const ctrl = new AbortController();
    readsRef.current.add(ctrl);
    fetch("/api/teams", { credentials: "same-origin", cache: "no-store", signal: ctrl.signal })
      .then(async (response) => {
        if (ctrl.signal.aborted) return;
        if (response.status === 401) {
          clearPrivate();
          return;
        }
        if (!response.ok) {
          setTeamsUnavailable(true);
          return;
        }
        const raw = await safeJson(response);
        if (ctrl.signal.aborted) return;
        const list = Array.isArray((raw as { teams?: unknown } | null)?.teams) ? (raw as { teams: unknown[] }).teams : [];
        const options: TeamOption[] = [];
        for (const row of list) {
          if (!row || typeof row !== "object") continue;
          const id = (row as { id?: unknown }).id;
          const name = (row as { name?: unknown }).name;
          if (typeof id === "string" && isUuid(id) && typeof name === "string" && name.trim() !== "") options.push({ id, name });
        }
        setTeams(options);
        setTeamsUnavailable(false);
      })
      .catch((error: unknown) => {
        if (!ctrl.signal.aborted && !isAbortError(error)) setTeamsUnavailable(true);
      })
      .finally(() => {
        readsRef.current.delete(ctrl);
      });
    return () => {
      ctrl.abort();
      readsRef.current.delete(ctrl);
    };
  }, [principalValid, teamsAttempt, clearPrivate]);

  const reloadTeams = useCallback(() => {
    setTeamsUnavailable(false);
    setTeamsAttempt((attempt) => attempt + 1);
  }, []);

  const readReceipt = useCallback(
    async (expectedEffect: string) => {
      const ctrl = new AbortController();
      readsRef.current.add(ctrl);
      setReceiptPending(true);
      try {
        const url = `${sharingRoute(deliveryId)}?expected_effect_sha256=${encodeURIComponent(expectedEffect)}`;
        const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (response.status === 401) {
          clearPrivate();
          return;
        }
        const raw = await safeJson(response);
        if (ctrl.signal.aborted) return;
        if (!response.ok) {
          setReceipt(null);
          setReceiptError(errorKind(raw));
        } else {
          const decoded = safeDecode(() => decodeSharingReceipt(raw, deliveryId, expectedEffect));
          if (!decoded || decoded.expected_effect_sha256 !== expectedEffect) {
            setReceipt(null);
            setReceiptError("unavailable");
          } else {
            setReceipt(decoded);
            setReceiptError(null);
          }
        }
        setReceiptRead(true);
      } catch (error) {
        if (!ctrl.signal.aborted && !isAbortError(error)) {
          setReceipt(null);
          setReceiptError("unavailable");
          setReceiptRead(true);
        }
      } finally {
        readsRef.current.delete(ctrl);
        if (!ctrl.signal.aborted) setReceiptPending(false);
      }
    },
    [deliveryId, clearPrivate],
  );

  const readReview = useCallback(async () => {
    if (!principalValid || lockedHash !== null || sentRef.current) return;
    if (!isUuid(teamId)) return;
    setReviewPending(true);
    setReviewError(null);
    const ctrl = new AbortController();
    readsRef.current.add(ctrl);
    try {
      const url = `${sharingRoute(deliveryId)}?team_id=${encodeURIComponent(teamId)}`;
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      if (response.status === 401) {
        clearPrivate();
        return;
      }
      const raw = await safeJson(response);
      if (ctrl.signal.aborted) return;
      if (!response.ok) {
        setReviewError(errorKind(raw));
        return;
      }
      const decoded = safeDecode(() => decodeSharingReview(raw, deliveryId, teamId));
      if (!decoded || decoded.delivery.delivery_id !== deliveryId || decoded.audience.team_id !== teamId) {
        setReviewError("unavailable");
        return;
      }
      setReview(decoded);
      setReviewError(null);
    } catch (error) {
      if (!ctrl.signal.aborted && !isAbortError(error)) setReviewError("unavailable");
    } finally {
      readsRef.current.delete(ctrl);
      if (!ctrl.signal.aborted) setReviewPending(false);
    }
  }, [principalValid, lockedHash, teamId, deliveryId, clearPrivate]);

  // The exact pre-send correlation address is carried by the page address itself —
  // same pathname, one added query key — so a reload reopens the original sharing,
  // not a new lifecycle. Never written to any store.
  const keepAddress = useCallback((expectedEffect: string) => {
    try {
      const url = new URL(window.location.href);
      if (url.pathname !== `/briefs/${deliveryId}/sharing`) return false;
      url.searchParams.set("expected_effect_sha256", expectedEffect);
      window.history.replaceState(window.history.state, "", url.toString());
      return new URL(window.location.href).searchParams.get("expected_effect_sha256") === expectedEffect;
    } catch { return false; }
  }, [deliveryId]);

  const checkOriginal = useCallback(async () => {
    const expected = lockedHash ?? effectUsed;
    if (expected === null || !SHA64_RE.test(expected)) return;
    await readReceipt(expected);
  }, [lockedHash, effectUsed, readReceipt]);

  const share = useCallback(() => {
    if (!principalValid || lockedHash !== null || sentRef.current) return;
    if (!review || review.grant) return;
    if (!review.eligibility || review.eligibility.can_share !== true) return;
    if (!isUuid(teamId) || review.audience.team_id !== teamId) return;
    const expectedEffect = review.expected_effect_sha256;
    const expectedContent = review.delivery.content_sha256;
    if (!SHA64_RE.test(expectedEffect) || !SHA64_RE.test(expectedContent)) return;
    if (!keepAddress(expectedEffect)) { setAddressError(true); return; }
    sentRef.current = true;
    setSendState("sending");
    setEffectUsed(expectedEffect);
    const run = async () => {
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 18000);
      try {
        const response = await fetch(sharingRoute(deliveryId), {
          method: "POST",
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            team_id: teamId,
            expected_content_sha256: expectedContent,
            expected_effect_sha256: expectedEffect,
          }),
        });
        if (!aliveRef.current) return;
        if (response.status === 401) {
          clearPrivate();
          return;
        }
        const raw = await safeJson(response);
        if (!aliveRef.current) return;
        if (!response.ok) {
          const kind = errorKind(raw);
          // A structured refusal is an answer: nothing was shared, and the send stays spent.
          if (kind === "denied" || kind === "invalid_input") {
            setSendRefusal(kind);
            setSendState("refused");
          } else {
            setSendState("unknown");
          }
          return;
        }
        const decoded = safeDecode(() => decodeSharingReview(raw, deliveryId, teamId));
        if (!aliveRef.current) return;
        if (!decoded || decoded.delivery.content_sha256 !== expectedContent || decoded.expected_effect_sha256 !== expectedEffect || decoded.grant?.effect_sha256 !== expectedEffect || decoded.grant.content_sha256 !== expectedContent || decoded.grant.shared_by !== principalId) {
          setSendState("unknown");
          return;
        }
        setReview(decoded);
        setSendState("recorded");
        // ONE read-only reconcile of the SAME expected hash — never a second send.
        await readReceipt(expectedEffect);
      } catch {
        if (aliveRef.current) setSendState("unknown");
      } finally { clearTimeout(deadline); }
    };
    void run();
  }, [principalValid, lockedHash, review, teamId, deliveryId, principalId, keepAddress, readReceipt, clearPrivate]);

  // ── Derived view state ────────────────────────────────────────────────────────

  const signedIn = principalValid && !sessionEnded;
  const grant = review?.grant ?? null;
  const teamLocked = lockedHash !== null || sendState !== "idle";
  const expectedOnPage = lockedHash ?? effectUsed;

  // A fresh send is offered only for the team the source review names, while the
  // source says the brief can be shared and this page has not spent its one send.
  // During the in-flight send the control stays visible but spent (no re-send).
  const sendCandidate =
    !!review &&
    review.grant === null &&
    !!review.eligibility &&
    review.eligibility.can_share === true &&
    isUuid(teamId) &&
    review.audience.team_id === teamId;
  const showSend = (sendCandidate && !teamLocked) || sendState === "sending";

  // "Keep private" is a real option only while nothing is shared and nothing is pending.
  const showKeepPrivate = !!review && review.grant === null && lockedHash === null && sendState === "idle";

  // A share is claimed ONLY from a receipt that MATCHES this page's own address,
  // carries that exact grant, and reports current access.
  const receiptQualified =
    !!receipt &&
    receipt.observation === "MATCHED" &&
    receipt.current_access === true &&
    receipt.grant !== null &&
    receipt.grant.effect_sha256 === expectedOnPage;

  const teamNameFor = (id: string | null): string => {
    if (!id) return "";
    if (review !== null && review.audience.team_id === id && review.audience.name !== "") return review.audience.name;
    return teams?.find((row) => row.id === id)?.name ?? "";
  };

  const receiptNote = (): string => {
    if (receiptError === "effect_unknown") return t("errEffectUnknown");
    if (receiptError === "denied") return t("errDenied");
    if (receiptError === "conflict") return t("errConflict");
    if (receiptError === "invalid_input") return t("errInvalid");
    if (receiptError === "unavailable") return t("errUnavailable");
    if (!receipt) return t("receiptUnreadable");
    if (receipt.observation === "NOT_OBSERVED") return t("notObservedNote");
    if (receipt.observation === "CONFLICT") return t("conflictNote");
    if (!receipt.grant || receipt.grant.effect_sha256 !== expectedOnPage) return t("grantMismatchNote");
    if (receipt.current_access !== true) return t("matchedNoAccess");
    return t("accessActive");
  };

  const refusalNote = (): string => {
    if (sendRefusal === "denied") return t("errDenied");
    if (sendRefusal === "invalid_input") return t("errInvalid");
    return t("errUnexpected");
  };

  const reviewErrorNote = (): string => {
    if (reviewError === "denied") return t("errDenied");
    if (reviewError === "conflict") return t("errConflict");
    if (reviewError === "invalid_input") return t("errInvalid");
    if (reviewError === "unavailable") return t("errUnavailable");
    return t("errUnexpected");
  };

  const stateSlug =
    !signedIn
      ? "signed-out"
      : sendState === "unknown"
        ? "unknown"
        : receiptQualified
          ? "shared"
          : sendState === "recorded"
            ? "recorded"
            : sendState === "refused"
              ? "refused"
              : receiptRead
                ? "receipt"
                : lockedHash !== null
                  ? "addressed"
                  : review
                    ? "review"
                    : "idle";

  let outcome: ReactNode = null;
  if (sendState === "unknown") {
    outcome = (
      <>
        <h2 className={s.outcomeTitle}>{t("unknownTitle")}</h2>
        <p className={s.outcomeBody}>{t("unknownNote")}</p>
      </>
    );
  } else if (receiptQualified && receipt) {
    const sharedTeam = teamNameFor(receipt.grant?.team_id ?? null);
    const artifactName = review?.delivery.body.artifact.name ?? "";
    outcome = (
      <>
        <h2 className={s.outcomeTitle}>{t("sharedTitle")}</h2>
        <p className={s.outcomeBody}>{[sharedTeam, artifactName].filter(Boolean).join(" · ")}</p>
        <p className={s.outcomeBody}>{t("accessActive")}</p>
      </>
    );
  } else if (sendState === "recorded" || receiptRead) {
    outcome = (
      <>
        {sendState === "recorded" && <h2 className={s.outcomeTitle}>{t("recordedTitle")}</h2>}
        <p className={s.outcomeBody}>{receiptNote()}</p>
      </>
    );
  } else if (sendState === "refused") {
    outcome = <p className={s.outcomeBody}>{refusalNote()}</p>;
  }

  if (!signedIn) {
    return (
      <div lang={lang} className={s.wrap} data-brief-sharing="" data-brief-sharing-state="signed-out">
        <header className={s.head}>
          <span className={s.eyebrow}>{t("eyebrow")}</span>
          <h1 className={s.heading}>{t("heading")}</h1>
        </header>
        <section className={s.panel} data-brief-sharing-session="">
          <p className={s.outcomeBody}>{sessionEnded ? t("sessionEnded") : t("signInPrompt")}</p>
          <div className={s.actions}>
            <a className={s.control} href="/login">
              {t("signIn")}
            </a>
            <a className={s.control} href="/alerts">
              {t("back")}
            </a>
          </div>
        </section>
      </div>
    );
  }

  const artifact = review !== null && (
    <section className={s.panel} data-brief-sharing-artifact="">
      <h2 className={s.artifactTitle}>{review.delivery.body.artifact.name}</h2>
      <p className={s.meta}>{review.delivery.body.target.name}</p>
      <p className={s.meta}>{review.audience.name}</p>
      <p className={s.note}>{t("audiencePolicy")}</p>
      <p className={s.meta}>
        <span>
          {t("slotLabel")} {review.delivery.slot_asof}
        </span>
        {review.delivery.artifact_asof !== null && (
          <span>
            {t("artifactAsOf")} {review.delivery.artifact_asof}
          </span>
        )}
      </p>

      {sendState !== "unknown" && (
        <>
          <button
            type="button"
            className={s.toggle}
            data-brief-sharing-toggle=""
            aria-expanded={bodyOpen}
            onClick={() => setBodyOpen((open) => !open)}
          >
            {bodyOpen ? t("closeBrief") : t("openBrief")}
          </button>
          {bodyOpen && (
            <div className={s.bodyBlock} data-brief-sharing-body="">
              <h3 className={s.bodyHead}>{t("marketRead")}</h3>
              {review.delivery.body.market_read.map((row, index) => (
                <p key={`${row.section}:${index}`} className={s.sentence} data-brief-sharing-sentence="">
                  {lang === "zh" ? row.sentence_zh : row.sentence_en}
                </p>
              ))}
              <h3 className={s.bodyHead}>{t("monitors")}</h3>
              {review.delivery.body.monitors.map((row, index) => (
                <p key={`${row.name}:${index}`} className={s.monitorRow}>
                  <span className={s.monitorName}>{row.name}</span>
                  <span>{lang === "zh" ? row.state_zh : row.state_en}</span>
                </p>
              ))}
            </div>
          )}
        </>
      )}

      <details className={s.details} data-brief-sharing-details="">
        <summary className={s.summary}>{t("technical")}</summary>
        <div className={s.detailGrid}>
          <div className={s.detailRow}>
            <span className={s.detailKey}>{t("contentDigest")}</span>
            <span className={s.detailVal}>{review.delivery.content_sha256}</span>
          </div>
          {expectedOnPage !== null && (
            <div className={s.detailRow}>
              <span className={s.detailKey}>{t("sharingAddress")}</span>
              <span className={s.detailVal}>{expectedOnPage}</span>
            </div>
          )}
          <div className={s.detailRow}>
            <span className={s.detailKey}>{t("slotLabel")}</span>
            <span className={s.detailVal}>{review.delivery.slot_asof}</span>
          </div>
          <div className={s.detailRow}>
            <span className={s.detailKey}>{t("artifactAsOf")}</span>
            <span className={s.detailVal}>{review.delivery.artifact_asof ?? "—"}</span>
          </div>
        </div>
      </details>

      {outcome !== null && (
        <div className={s.outcome} data-brief-sharing-outcome="">
          {outcome}
        </div>
      )}
    </section>
  );

  return (
    <div lang={lang} className={s.wrap} data-brief-sharing="" data-brief-sharing-state={stateSlug}>
      <header className={s.head}>
        <span className={s.eyebrow}>{t("eyebrow")}</span>
        <h1 className={s.heading}>{sendState === "unknown" ? t("unknownTitle") : receiptQualified ? t("sharedTitle") : t("heading")}</h1>
        <p className={s.lede}>{receiptQualified ? [teamNameFor(receipt?.grant?.team_id ?? null), t("accessActive")].filter(Boolean).join(" · ") : sendState === "unknown" ? t("unknownNote") : t("lede")}</p>
      </header>

      {artifact}

      {review === null && outcome !== null && (
        <section className={s.panel} data-brief-sharing-outcome-panel="">
          <div className={s.outcome} data-brief-sharing-outcome="">
            {outcome}
          </div>
        </section>
      )}

      <section className={s.composer} data-brief-sharing-composer="">
        {teamsUnavailable && (
          <p className={s.note} data-brief-sharing-teams-unavailable="">
            {t("teamsUnavailable")}{" "}
            <button type="button" className={s.ghost} onClick={reloadTeams}>
              {t("retryTeams")}
            </button>
          </p>
        )}

        {addressError && <p role="alert">{t("addressUnavailable")}</p>}
        {lockedHash !== null && <p className={s.note}>{t("lockedNote")}</p>}

        {lockedHash === null && (
          <div className={s.chooser}>
            <label className={s.label} htmlFor="brief-sharing-team">
              {t("chooseTeam")}
            </label>
            <select
              id="brief-sharing-team"
              className={s.select}
              data-brief-sharing-teams=""
              value={teamId}
              disabled={teamLocked || teams === null}
              onChange={(event) => {
                for (const ctrl of readsRef.current) ctrl.abort();
                readsRef.current.clear();
                setReview(null); setReviewPending(false); setReviewError(null); setBodyOpen(false);
                setTeamId(event.target.value);
              }}
            >
              <option value="">{t("chooseTeamBlank")}</option>
              {(teams ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={s.control}
              data-brief-sharing-review=""
              onClick={() => void readReview()}
              disabled={!isUuid(teamId) || reviewPending || teamLocked}
            >
              {reviewPending ? t("reviewing") : t("review")}
            </button>
          </div>
        )}

        {reviewError !== null && (
          <p className={s.note} data-brief-sharing-review-error="">
            {reviewErrorNote()}
          </p>
        )}

        {grant !== null && (
          <p className={s.note} data-brief-sharing-grant="">
            {[t("alreadyShared"), teamNameFor(grant.team_id)].filter(Boolean).join(" · ")}
          </p>
        )}

        {review !== null && review.grant === null && (!review.eligibility || review.eligibility.can_share !== true) && (
          <p className={s.note}>{t("notShareable")}</p>
        )}

        <div className={s.actions} data-brief-sharing-actions="">
          {showSend && (
            <button
              type="button"
              className={s.primary}
              data-brief-sharing-send=""
              onClick={share}
              disabled={sendState !== "idle"}
            >
              {sendState === "sending" ? t("sharing") : t("share")}
            </button>
          )}
          {showKeepPrivate && (
            <a className={s.secondary} href="/alerts" data-brief-sharing-keep-private="">
              {t("keepPrivate")}
            </a>
          )}
          {expectedOnPage !== null && (
            <button
              type="button"
              className={s.control}
              data-brief-sharing-check=""
              onClick={() => void checkOriginal()}
              disabled={receiptPending}
            >
              {receiptPending ? t("checking") : t("checkOriginal")}
            </button>
          )}
          <a className={s.control} href="/alerts">
            {t("back")}
          </a>
        </div>

        <p className={s.note}>{t("noteOtherWork")}</p>
      </section>
    </div>
  );
}

export default BriefSharingReview;
