"use client";

import { pick } from "@/lib/finFormat";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useLang } from "@/lib/i18n";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { identityOwnerKey } from "@/lib/accountIdentity";
import { companyRetainedContextParams, loadCompanyRetainedContext, parseCompanyRetainedContext } from "@/lib/companyRetainedContext";
import type { TranscriptOpenTarget } from "@/lib/transcriptSearch";
import CompanyIntelligenceV2Current from "./CompanyIntelligenceV2Current";
import CompanyWatchSave from "./CompanyWatchSave";
import { useOnboarding } from "@/components/onboarding/OnboardingProvider";

type Result = Awaited<ReturnType<typeof loadCompanyRetainedContext>>;
export const COMPANY_CONTEXT_READ_TIMEOUT_MS = 15_000;

type Loaded = { owner: string; ticker: string; key: string; retry: number; result: Result };

type CompanyProps = {
  sym: string; name?: string | null;
  onOpenTx: (target: string | TranscriptOpenTarget) => void;
  onEvidenceOpenChange?: (open: boolean) => void;
};

/** Follow the shell's live URL owner; router snapshots may lag shallow history writes. */
function subscribeToLocation(onChange: () => void): () => void {
  window.addEventListener("mmx:shell-location", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("mmx:shell-location", onChange);
    window.removeEventListener("popstate", onChange);
  };
}
function readLocationSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}

/** Scope transitions end the whole retained-read lifetime, including receipt deduplication. */
export default function SharedShellCompanyIntelligence(props: CompanyProps) {
  const owner = identityOwnerKey(useShellIdentity());
  const ticker = props.sym.trim().toUpperCase();
  return <RetainedCompanyOwner key={JSON.stringify([owner, ticker])} {...props} owner={owner} ticker={ticker} />;
}

/** Composition of the incumbent authenticated retained-event reader; no new intelligence or store. */
function RetainedCompanyOwner({ owner, ticker, name, onOpenTx, onEvidenceOpenChange }: CompanyProps & { owner: string; ticker: string }) {
  const { lang } = useLang();
  const zh = lang === "zh";
  const onboarding = useOnboarding();
  const routerSearch = useSearchParams().toString();
  const search = useSyncExternalStore(subscribeToLocation, readLocationSearch, () => routerSearch);
  const params = new URLSearchParams(search);
  const pinQuery = new URLSearchParams();
  for (const key of ["ci_event", "ci_generation", "ci_company", "ci_fingerprint"]) {
    for (const value of params.getAll(key)) pinQuery.append(key, value);
  }
  const key = pinQuery.toString();
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const latest = useRef<Loaded | null>(null);
  const liveScope = useRef({ owner, ticker, key, retry });
  useLayoutEffect(() => {
    liveScope.current = { owner, ticker, key, retry };
    // End the previous selection before paint; returning to its URL still needs fresh rights.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile the external URL lifetime before showing a retained receipt.
    setLoaded(value => value?.owner === owner && value.ticker === ticker && value.key === key && value.retry === retry ? value : null);
  }, [owner, ticker, key, retry]);

  useEffect(() => {
    // The just-returned receipt was freshly authorized. Exporting it to this URL
    // must not initiate a duplicate read in the same mounted owner lifetime.
    if (latest.current?.owner === owner && latest.current.ticker === ticker
      && latest.current.key === key && latest.current.retry === retry) return;
    // A different selected pin ends receipt reuse even if the reader returns before it settles.
    latest.current = null;
    const controller = new AbortController();
    const requestController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const parsed = parseCompanyRetainedContext(new URLSearchParams(key), ticker);
    const read = parsed.ok
      ? Promise.race<Result>([
        loadCompanyRetainedContext({ symbol: ticker, pin: parsed.pin, signal: requestController.signal }),
        new Promise<Result>(resolve => { timer = setTimeout(() => {
          requestController.abort();
          resolve({ ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "read_timeout" });
        }, COMPANY_CONTEXT_READ_TIMEOUT_MS); }),
      ])
      : Promise.resolve(parsed);
    void read.then(result => {
      const scope = liveScope.current;
      if (controller.signal.aborted || scope.owner !== owner || scope.ticker !== ticker
        || scope.key !== key || scope.retry !== retry) return;
      let retainedKey = key;
      if (result.ok && parsed.ok && !parsed.pin) {
        const url = new URL(window.location.href);
        const pinned = companyRetainedContextParams(result.receipt);
        pinned.forEach((value, field) => url.searchParams.set(field, value));
        retainedKey = pinned.toString();
        const next = { owner, ticker, key: retainedKey, retry, result };
        latest.current = next;
        setLoaded(next);
        window.history.replaceState(window.history.state, "", url.toString());
        window.dispatchEvent(new Event("mmx:shell-location"));
      } else {
        const next = { owner, ticker, key: retainedKey, retry, result };
        latest.current = next;
        setLoaded(next);
      }
    }).catch(() => {
      const scope = liveScope.current;
      if (controller.signal.aborted || scope.owner !== owner || scope.ticker !== ticker
        || scope.key !== key || scope.retry !== retry) return;
      setLoaded({ owner, ticker, key, retry, result: { ok: false, code: "HISTORICAL_UNAVAILABLE", reason: "owner_unavailable" } });
    }).finally(() => { if (timer) clearTimeout(timer); });
    return () => { controller.abort(); requestController.abort(); if (timer) clearTimeout(timer); };
  }, [key, owner, retry, ticker]);

  const openCurrentEvent = () => {
    const url = new URL(window.location.href);
    for (const field of ["ci_event", "ci_generation", "ci_company", "ci_fingerprint", "ci_lens", "ci_evidence"]) url.searchParams.delete(field);
    latest.current = null;
    window.history.pushState(window.history.state, "", url.toString());
    window.dispatchEvent(new Event("mmx:shell-location"));
    setRetry(value => value + 1);
  };

  const current = loaded?.owner === owner && loaded.ticker === ticker && loaded.key === key && loaded.retry === retry
    ? loaded.result : null;
  if (!current) return <div className="ci-page" role="status" aria-busy="true">
    {zh ? `正在验证 ${ticker} 的事件和来源权限…` : `Verifying ${ticker} event and source access…`}
  </div>;
  const authRequired = !current.ok && current.reason === "unauthenticated";
  const accessRestricted = !current.ok && (current.reason === "rights_denied" || current.reason === "http_403");
  const hasRetainedSelection = key.length > 0;
  if (!current.ok) return <section className="ci-page ci-state" role="status" data-ci-context-state="historical_unavailable" data-ci-unavailable-reason={current.reason}>
    <h2>{authRequired
      ? hasRetainedSelection ? (pick(zh, "Sign in to recheck the selected event", "登录以重新验证所选事件")) : (pick(zh, "Sign in to recheck the current event", "登录以重新验证当前事件"))
      : accessRestricted
        ? hasRetainedSelection ? (pick(zh, "Selected event access restricted", "所选事件的访问受限")) : (pick(zh, "Current event access restricted", "当前事件的访问受限"))
        : hasRetainedSelection ? (pick(zh, "Selected event unavailable", "所选事件不可用")) : (pick(zh, "Current event unavailable", "当前事件不可用"))}</h2>
    <p>{authRequired
      ? hasRetainedSelection
        ? (pick(zh, "Your session has expired or you are signed out. Your selected event and source position are preserved; sign in to verify access again.", "会话已过期或尚未登录。所选事件及其来源位置已保留；请登录后重新验证访问权限。"))
        : (pick(zh, "Your session has expired or you are signed out. Your company selection is preserved; sign in to verify current event and source access.", "会话已过期或尚未登录。公司选择已保留；请登录后验证当前事件和来源权限。"))
      : accessRestricted
        ? hasRetainedSelection
          ? (pick(zh, "Current source rights do not permit viewing this event version. Your selected event and source position are preserved.", "当前来源权限不允许查看此事件版本。所选事件及其来源位置已保留。"))
          : (pick(zh, "Current source rights do not permit viewing this company's event context. Your company selection is preserved.", "当前来源权限不允许查看此公司的事件上下文。公司选择已保留。"))
        : hasRetainedSelection
          ? (pick(zh, "The original event version or current source access could not be verified. This event has not been replaced.", "无法验证此事件的原始版本或当前来源权限。未替换为其他事件。"))
          : (pick(zh, "The current event or source access could not be verified.", "无法验证当前事件或来源权限。"))}</p>
    {authRequired && <button type="button" className="btn btn-primary" onClick={() => onboarding.open("signin")}>{pick(zh, "Sign in", "登录")}</button>}
    <button type="button" className="btn btn-primary" onClick={() => setRetry(value => value + 1)}>{hasRetainedSelection ? pick(zh, "Recheck selected event", "重新验证所选事件") : pick(zh, "Recheck current event", "重新验证当前事件")}</button>
    {hasRetainedSelection && <button type="button" className="btn btn-ghost" onClick={openCurrentEvent}>{pick(zh, "Open current event", "打开当前事件")}</button>}
  </section>;
  return <CompanyIntelligenceV2Current ticker={ticker} name={name}
    result={{ workspace: current.workspace, state: current.workspace.lifecycle.state === "partial" ? "partial" : "ready" }}
    retained v1={null} onOpenTx={onOpenTx} onEvidenceOpenChange={onEvidenceOpenChange}
    headerActions={<><CompanyWatchSave symbol={ticker} /><button type="button" className="btn btn-ghost" onClick={openCurrentEvent}>{pick(zh, "Open current event", "打开当前事件")}</button></>} />;
}
