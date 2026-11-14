"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { readingJson, useReadingScope } from "@/lib/shared-shell/useReadingScope";
import { todayPayload, type TodayPayload } from "@/lib/shared-shell/readingPayloads";
import { macroEconomyPayload, type EconomicSelection, type EconomicWorkspaceId, type EconomicWorkspaceRead } from "@/lib/shared-shell/macroEconomyPayload";
import MacroEconomyOverview from "./MacroEconomyOverview";
import MacroEconomyWorkspace from "./MacroEconomyWorkspace";
import s from "./MacroEconomy.module.css";

type RequestOwner = { workspaceId: EconomicWorkspaceId | null };
type Read = { phase: "loading" | "ready" | "unavailable" | "access" | "missing"; data: TodayPayload | EconomicWorkspaceRead | null; generation: AbortController | null; owner: RequestOwner | null };
const empty = (): Read => ({ phase: "loading", data: null, generation: null, owner: null });
export type MacroEconomyReaderProps = {
  ownerKey: string; workspaceId: EconomicWorkspaceId | null; lang: "en" | "zh";
  selection: EconomicSelection | null; onSelect: (change: Partial<EconomicSelection>) => void;
  onNavigate: (href: string) => void; overviewHref: string; dashboardHref: string; signInHref: string;
  workspaceHref: (id: EconomicWorkspaceId) => string;
};

/** Route/catalog admission belongs to the shared shell. The caller supplies its
 * verified subject and canonical navigation. This reader reuses the existing
 * account lifetime and BFF; it adds no token, cache, polling or fallback path. */
export default function MacroEconomyReader(props: MacroEconomyReaderProps) {
  return <EconomicSession key={props.ownerKey} {...props}/>;
}

function EconomicSession(props: MacroEconomyReaderProps) {
  const { ownerKey, workspaceId, lang } = props, zh = lang === "zh";
  const { scope, ready, ended, unavailable, retryIdentity, invalidateIdentity } = useReadingScope(ownerKey);
  // Chart/table/evidence changes do not refetch the same publication. Workspace
  // changes get a new owner even for A -> B -> A, fencing late A responses.
  const requestOwner = useMemo<RequestOwner>(() => ({ workspaceId }), [workspaceId]);
  const currentOwner = useRef<RequestOwner | null>(requestOwner);
  useLayoutEffect(() => { currentOwner.current = requestOwner; return () => { if (currentOwner.current === requestOwner) currentOwner.current = null; }; }, [requestOwner]);
  const sequence = useRef(0), [read, setRead] = useState<Read>(empty);
  const load = useCallback(async () => {
    const generation = scope.current;
    if (!generation || generation.signal.aborted || currentOwner.current !== requestOwner) return;
    const ticket = ++sequence.current;
    setRead({ phase: "loading", data: null, generation, owner: requestOwner });
    try {
      const { response, value } = await readingJson(scope, `/api/shared-shell/today${workspaceId ? `?workspace=${workspaceId}` : ""}`);
      if (generation !== scope.current || generation.signal.aborted || ticket !== sequence.current || currentOwner.current !== requestOwner) return;
      if (response.status === 401) { invalidateIdentity(); return; }
      const data = response.ok ? workspaceId ? macroEconomyPayload(value, workspaceId) : todayPayload(value) : null;
      const phase = response.status === 403 ? "access" : response.status === 404 ? "missing" : data ? "ready" : "unavailable";
      setRead({ phase, data, generation, owner: requestOwner });
    } catch {
      if (generation === scope.current && !generation.signal.aborted && ticket === sequence.current && currentOwner.current === requestOwner)
        setRead({ phase: "unavailable", data: null, generation, owner: requestOwner });
    }
  }, [scope, workspaceId, requestOwner, invalidateIdentity]);
  useEffect(() => {
    if (!ready) return;
    const generation = scope.current;
    queueMicrotask(() => { if (generation === scope.current && !generation?.signal.aborted && currentOwner.current === requestOwner) void load(); });
  }, [ready, load, scope, requestOwner]);
  const owned = ready && read.owner === requestOwner && read.generation === scope.current ? read : empty();
  const accountNotice = !ready ? <section className={s.limit} role="status">
    <p>{ended ? (zh ? "账户已更改或会话已结束，私人读数已清除。" : "Your account changed or your session ended. Private readings have been cleared.") : unavailable ? (zh ? "账户核验暂不可用，私人读数已隐藏。" : "Account verification is unavailable. Private readings are hidden.") : (zh ? "正在核验账户…" : "Verifying your account…")}</p>
    {(ended || unavailable) && <div className={s.actions}>{ended && <Link href={props.signInHref} className={s.textButton}>{zh ? "登录" : "Sign in"}</Link>}<button type="button" className={s.textButton} onClick={retryIdentity}>{zh ? "重新核验账户" : "Recheck account"}</button></div>}
  </section> : undefined;
  return workspaceId ? <MacroEconomyWorkspace {...props} workspaceId={workspaceId} read={{ phase: owned.phase, data: owned.data as EconomicWorkspaceRead | null }} onRefresh={() => void load()} accountNotice={accountNotice}/> : <MacroEconomyOverview lang={lang} data={owned.data as TodayPayload | null} phase={owned.phase === "missing" ? "unavailable" : owned.phase} dashboardHref={props.dashboardHref} overviewHref={props.overviewHref} workspaceHref={props.workspaceHref} onRefresh={() => void load()} accountNotice={accountNotice}/>;
}
