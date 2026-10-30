"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { browserStorage } from "@/lib/ownerStorage";
import { FROZEN_ENTRY_CLIENT_ENABLED, type FrozenEntrySelection } from "@/lib/frozenNodeEntryProtocol";
import { createFrozenNodeEntryJourney, type FrozenEntryClientResult } from "@/lib/frozenNodeEntryClient";
import { withFrozenEntryJournal } from "@/lib/frozenNodeEntryJournal";
import { frozenEntrySelection } from "@/lib/frozenNodeEntrySelection";
import styles from "./FrozenNodeEntry.module.css";
import type { ExposureLens } from "@/lib/exposureMapProjection";

type Props = { owner: string; identity: string; root: string; source: unknown; lens: ExposureLens; price: number;
  metric: string; shock: { spotPercent: number; ivPoints: number; calendarDays: number }; now: number; zh: boolean };
/** Default-OFF mount has zero Auth/issuance/account/source/storage effects. */
export default function FrozenNodeEntry(props: Props) {
  return FROZEN_ENTRY_CLIENT_ENABLED && props.metric === "gamma" && Object.values(props.shock).every(v => v === 0)
    ? <EnabledFrozenNodeEntry {...props} /> : null;
}
function EnabledFrozenNodeEntry(props: Props) {
  const live = useRef({ alive: true, identity: props.identity, owner: props.owner });
  useLayoutEffect(() => {
    const state = live.current; state.alive = true; state.identity = props.identity; state.owner = props.owner;
    return () => { state.alive = false; };
  }, [props.identity, props.owner]);
  const [referenceState, setReferenceState] = useState<"checking" | "empty" | "held" | "blocked">("checking");
  useEffect(() => {
    let active = true;
    const storage = browserStorage(), locks = navigator.locks;
    if (!storage || !locks || !props.owner) return;
    void withFrozenEntryJournal({ storage, locks }, props.owner, async slot => slot.read().state).then(state => {
      if (active) setReferenceState(state ?? "blocked");
    });
    return () => { active = false; };
  }, [props.owner, props.identity]);
  const journey = useRef<ReturnType<typeof createFrozenNodeEntryJourney> | null>(null);
  const [result, setResult] = useState<FrozenEntryClientResult | null>(null), [busy, setBusy] = useState(false);
  function make(selection: FrozenEntrySelection | null) {
    const storage = browserStorage(), locks = navigator.locks;
    if (!storage || !locks || !props.owner) return null;
    let db: ReturnType<typeof createClient>;
    try { db = createClient(); } catch { return null; }
    const identity = props.identity, owner = props.owner;
    return createFrozenNodeEntryJourney({ owner, selectionKey: identity, selection }, { storage, locks, enabled: true, fetcher: fetch,
      currentSelection: () => live.current.alive ? live.current.identity : "",
      currentOwner: async () => {
        if (!live.current.alive || live.current.owner !== owner) return null;
        const session = await db.auth.getSession(), token = session.data.session?.access_token;
        if (session.error || !token) return null;
        const user = await db.auth.getUser(token);
        return !user.error && live.current.alive && live.current.owner === owner ? user.data.user?.id ?? null : null;
      } });
  }
  async function prepare() {
    if (busy || referenceState !== "empty" || result?.kind === "effect_unknown") return;
    setBusy(true);
    try {
      const identity = props.identity, owner = props.owner;
      const selection = await frozenEntrySelection(props);
      if (!live.current.alive || live.current.identity !== identity || live.current.owner !== owner || !selection) {
        setResult({ kind: "unavailable", reason: "selection_unavailable_or_changed" }); return;
      }
      journey.current = make(selection);
      const value = await journey.current?.prepare() ?? { kind: "unavailable" as const, reason: "journal_lock_unavailable" };
      setResult(value); if (value.kind === "retained" || value.kind === "effect_unknown") setReferenceState("held");
    } finally { setBusy(false); }
  }
  async function act(recover: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      if (recover && !journey.current) journey.current = make(null);
      const value = recover ? await journey.current?.recover() : await journey.current?.enroll();
      setResult(value ?? { kind: "unavailable", reason: "original_reference_unavailable" });
      setReferenceState("held");
    } finally { setBusy(false); }
  }
  const message = result?.kind === "retained" ? (props.zh ? "原始引用已在本设备保存。尚未创建或启用提醒；请明确确认。" : "Original reference saved on this device. No alert has been created or armed; explicit confirmation is required.")
    : result?.kind === "committed" ? (props.zh ? "已核对原始历史登记回执；当前启用状态未经确认。" : "Original historical enrollment acknowledged; current active state is unverified.")
    : result ? (props.zh ? "尚未确认。保留原始引用；仅可只读核对，不会自动重试或创建新尝试。" : "Unconfirmed. Keep the original reference; recovery is read-only and never retries or creates a new attempt.") : "";
  return <section className={styles.entry} aria-label={props.zh ? "冻结节点登记预览" : "Frozen node enrollment preview"}>
    <p>{props.zh ? "仅限精确日期的 Gamma 节点引用；实时提醒评估尚未启用。" : "Exact dated Gamma node reference only; live alert evaluation is not enabled."}</p>
    <p>{props.zh ? `拟设条件：距原始 ${props.root} ${props.price} 节点不超过 0.5%。` : `Prospective condition: within 0.5% of the original ${props.root} ${props.price} node.`}</p>
    <div className={styles.actions}><button type="button" disabled={busy || !props.owner || referenceState !== "empty" || result?.kind === "effect_unknown"} onClick={() => void prepare()}>{props.zh ? "准备并保存引用" : "Prepare and save reference"}</button>
      <button type="button" disabled={busy || result?.kind !== "retained"} onClick={() => void act(false)}>{props.zh ? "确认登记此引用" : "Confirm this enrollment"}</button>
      <button type="button" disabled={busy || !props.owner} onClick={() => void act(true)}>{props.zh ? "只读核对原始尝试" : "Read original attempt"}</button></div>
    <p role="status">{message}</p>
    {result?.original && <p>{props.zh ? "原始引用" : "Original reference"}: {result.original.root} · {result.original.price} · {result.original.session}</p>}
    {result?.original && <details><summary>{props.zh ? "原始尝试引用" : "Original attempt reference"}</summary><code>{result.original.alertId} / {result.original.attemptId}</code></details>}
  </section>;
}
