"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useShellIdentity } from "@/components/chrome/AppShell";
import { normalizeCompanyIntelligenceSymbol } from "@/lib/companyIntelligence";
import { useLang } from "@/lib/i18n";
import { beginWatchSave, applyWatchSaveResponse, reconcileWatchSave, type OwnerRead, type WatchSave } from "@/lib/sharedShellMonitor";
import { browserStorage } from "@/lib/ownerStorage";
import { watchlistOwnerKey, readWatchlistSaveFence, retainWatchlistSaveFence, clearWatchlistSaveFence } from "@/lib/watchlistOwner";
import type { ServerWatchlist } from "@/lib/watchlists";
import { SHARED_SHELL_NAV } from "@/lib/sharedShellNavigation";
import styles from "./CompanyWatchSave.module.css";

type Inventory = OwnerRead<readonly ServerWatchlist[]>;
type Scope = { subjectId: string | null; generation: number; closed: boolean };
type Operation = { save: WatchSave; settled: boolean; checking: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_TIMEOUT_MS = 15_000;

/** The writable inventory is lists; grant-fed sharedWithMe is never a mutation target. */
function ownedLists(raw: unknown): ServerWatchlist[] | null {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { lists?: unknown }).lists)) return null;
  const lists = (raw as { lists: unknown[] }).lists;
  const ids = new Set<string>();
  for (const value of lists) {
    if (!value || typeof value !== "object") return null;
    const list = value as ServerWatchlist;
    if (typeof list.id !== "string" || !UUID.test(list.id) || ids.has(list.id)
      || typeof list.name !== "string" || !list.name.trim() || list.name.length > 80
      || typeof list.position !== "number" || !Number.isFinite(list.position) || !Array.isArray(list.symbols)) return null;
    ids.add(list.id);
    if (list.symbols.some(row => !row || typeof row.symbol !== "string"
      || normalizeCompanyIntelligenceSymbol(row.symbol) !== row.symbol
      || typeof row.section !== "string" || typeof row.position !== "number" || !Number.isFinite(row.position))) return null;
  }
  return lists as ServerWatchlist[];
}

export default function CompanyWatchSave({ symbol }: { symbol: string }) {
  const identity = useShellIdentity();
  const subjectId = identity.kind === "account" && UUID.test(identity.userId) ? identity.userId : null;
  const { lang } = useLang();
  if (!subjectId) return <Link className="btn" href="/login">{lang === "zh" ? "登录后保存" : "Sign in to save"}</Link>;
  return <CompanyWatchSaveControl key={subjectId} subjectId={subjectId} symbol={symbol} />;
}

/** Keyed by UUID so an account transition replaces private state in the same commit. */
function CompanyWatchSaveControl({ symbol, subjectId }: { symbol: string; subjectId: string }) {
  const ticker = normalizeCompanyIntelligenceSymbol(symbol);
  const { lang } = useLang();
  const text = (en: string, zh: string) => lang === "zh" ? zh : en;
  const [inventory, setInventory] = useState<Inventory>({ subjectId: "", state: "loading" });
  const [selection, setSelection] = useState<{ subjectId: string; listId: string } | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const scope = useRef<Scope>({ subjectId, generation: 0, closed: false });
  const operationRef = useRef<Operation | null>(null);
  const readGeneration = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const postController = useRef<AbortController | null>(null);

  // Scope by immutable UUID. Render also filters snapshots before this effect runs, so an
  // account transition never paints the previous account's names, membership or save state.
  useLayoutEffect(() => {
    const active: Scope = { subjectId, generation: scope.current.generation + 1, closed: false };
    scope.current = active;
    operationRef.current = null;
    return () => {
      active.closed = true;
      readController.current?.abort();
      postController.current?.abort(); // Abort is not evidence that an issued mutation was undone.
    };
  }, [subjectId]);

  const current = useCallback((captured: Scope) => !captured.closed
    && scope.current === captured && scope.current.subjectId === captured.subjectId, []);

  const readInventory = useCallback(async (captured: Scope): Promise<Inventory> => {
    const owner = captured.subjectId ?? "";
    const generation = ++readGeneration.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    let result: Inventory = { subjectId: owner, state: "unavailable" };
    try {
      const response = await fetch("/api/watchlist", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (response.status === 401 || response.status === 403) result = { subjectId: owner, state: "restricted" };
      else if (response.ok) {
        const lists = ownedLists(await response.json());
        if (lists) result = { subjectId: owner, state: "ready", data: lists };
      }
    } catch { /* Read failure remains unavailable; it never becomes an empty inventory. */ }
    if (current(captured) && generation === readGeneration.current && !controller.signal.aborted) setInventory(result);
    return controller.signal.aborted ? { subjectId: owner, state: "unavailable" } : result;
  }, [current]);

  const updateOperation = useCallback((next: Operation) => {
    operationRef.current = next;
    setOperation(next);
  }, []);

  const reconcile = useCallback(async (captured: Scope, pending: Operation) => {
    if (!current(captured) || !pending.settled || operationRef.current?.save.operationId !== pending.save.operationId) return;
    updateOperation({ ...pending, checking: true });
    // This request starts here, after POST response/timeout. Earlier inventory is never reused.
    const snapshot = await readInventory(captured);
    if (!current(captured) || operationRef.current?.save.operationId !== pending.save.operationId) return;
    const save = reconcileWatchSave(pending.save, captured.subjectId, { operationId: pending.save.operationId, inventory: snapshot });
    if (save) {
      if (save.status === "confirmed") {
        const storage = browserStorage();
        setStorageBlocked(!storage || !clearWatchlistSaveFence(storage, watchlistOwnerKey(save.subjectId), save.operationId));
      }
      updateOperation({ save, settled: true, checking: false });
    }
  }, [current, readInventory, updateOperation]);

  const recoverFence = useCallback(async (captured: Scope) => {
    if (!current(captured) || !captured.subjectId) return;
    const storage = browserStorage();
    const held = storage ? readWatchlistSaveFence(storage, watchlistOwnerKey(captured.subjectId)) : { state: "blocked" as const };
    setStorageReady(true);
    setStorageBlocked(held.state === "blocked");
    if (held.state === "held") {
      // A prior document cannot receive its original POST response. Preserve that exact
      // operation as unknown; only a new tagged read may establish its postcondition.
      const restored = { save: held.save, settled: true, checking: false };
      updateOperation(restored);
      await reconcile(captured, restored);
    }
  }, [current, reconcile, updateOperation]);

  useEffect(() => {
    const captured = scope.current;
    void readInventory(captured).then(() => recoverFence(captured));
  }, [readInventory, recoverFence]);

  const visible = subjectId && inventory.subjectId === subjectId ? inventory : null;
  const lists = visible?.state === "ready" ? visible.data : [];
  const selected = selection?.subjectId === subjectId ? selection.listId : "";
  const listId = lists.some(list => list.id === selected) ? selected : lists[0]?.id ?? "";
  const visibleOperation = subjectId && operation?.save.subjectId === subjectId ? operation : null;
  const unresolved = visibleOperation?.save.status === "pending" || visibleOperation?.save.status === "unknown";
  const member = !!ticker && lists.find(list => list.id === listId)?.symbols.some(row => row.symbol === ticker) === true;

  const save = async () => {
    const captured = scope.current;
    const existing = operationRef.current;
    if (!captured.subjectId || !current(captured) || !ticker || !listId || !lists.some(list => list.id === listId)
      || member || existing?.save.status === "pending" || existing?.save.status === "unknown") return;
    const storage = browserStorage();
    const owner = watchlistOwnerKey(captured.subjectId);
    const held = storage ? readWatchlistSaveFence(storage, owner) : { state: "blocked" as const };
    if (held.state !== "empty") {
      if (held.state === "held") await recoverFence(captured);
      else setStorageBlocked(true);
      return;
    }
    const operationId = crypto.randomUUID();
    const pending: Operation = { save: beginWatchSave({ operationId, subjectId: captured.subjectId, listId, symbol: ticker }), settled: false, checking: false };
    if (!storage || !retainWatchlistSaveFence(storage, owner, { operationId, subjectId: captured.subjectId, listId, symbol: ticker })) {
      setStorageBlocked(true);
      return; // No POST unless the exact unresolved fence was retained and read back.
    }
    updateOperation(pending); // Ref locks the operation synchronously, including rapid double clicks.
    const controller = new AbortController();
    postController.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: "accepted" | "rejected" | "unknown" = "unknown";
    try {
      const response = await Promise.race([
        fetch("/api/watchlist", {
          method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "add", listId, symbols: [ticker], section: "Watchlist" }),
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("unconfirmed")); }, POST_TIMEOUT_MS); }),
      ]);
      if ([400, 401, 403, 404].includes(response.status)) outcome = "rejected";
      else if (response.ok && (await response.json())?.ok === true) outcome = "accepted";
    } catch { /* Timeout/network/malformed/5xx stays unknown; none authorizes a second POST. */ }
    finally { if (timer) clearTimeout(timer); }
    if (!current(captured) || operationRef.current?.save.operationId !== operationId) return;
    const applied = applyWatchSaveResponse(pending.save, captured.subjectId, { operationId, outcome });
    if (!applied) return;
    const settled = { save: applied, settled: true, checking: false };
    if (outcome === "rejected") setStorageBlocked(!clearWatchlistSaveFence(storage, owner, operationId));
    updateOperation(settled);
    if (outcome !== "rejected") await reconcile(captured, settled);
  };

  if (!ticker) return <span role="status">{text("Company unavailable for saving", "该公司暂无法保存")}</span>;

  let message = "";
  if (visibleOperation) {
    const savedSymbol = visibleOperation.save.symbol;
    if (!visibleOperation.settled) message = text(`Saving ${savedSymbol}…`, `正在保存 ${savedSymbol}…`);
    else if (visibleOperation.checking) message = text(`Checking ${savedSymbol} membership…`, `正在核对 ${savedSymbol} 的列表状态…`);
    else if (visibleOperation.save.status === "confirmed") message = text(`${savedSymbol} saved to watchlist`, `${savedSymbol} 已保存到观察列表`);
    else if (visibleOperation.save.status === "rejected") message = text("Save rejected. Select an available list and try again.", "保存请求被拒绝。请选择可用列表后重试。");
    else message = text(`Save unconfirmed for ${savedSymbol}. Check status before saving again.`, `${savedSymbol} 的保存状态未确认。请先核对状态，再进行保存。`);
  }
  return <div className={styles.control}>
    {!visible || visible.state === "loading" ? <span role="status">{text("Loading watchlists…", "正在载入观察列表…")}</span>
      : visible.state === "restricted" ? <span role="status">{text("Watchlist access restricted", "观察列表访问受限")}</span>
      : visible.state === "unavailable" ? <><span role="status">{text("Watchlists unavailable", "观察列表暂不可用")}</span><button className="btn" onClick={() => void readInventory(scope.current)}>{text("Retry list read", "重试读取列表")}</button></>
      : !lists.length ? <span role="status">{text("No owned watchlists are available.", "尚无可用的自有观察列表。")} <Link href={SHARED_SHELL_NAV.find(item => item.k === "shellMonitor")?.href ?? "/watchlist.html"}>{text("Open Monitor", "打开监控")}</Link></span>
      : <>
        <label className={styles.label}>{text("Watchlist", "观察列表")}
          <select aria-label={text("Save to watchlist", "保存到观察列表")} value={listId} disabled={unresolved}
            onChange={event => setSelection({ subjectId, listId: event.target.value })}>
            {lists.map(list => <option key={list.id} value={list.id}>{list.name}</option>)}
          </select>
        </label>
        <button className="btn" disabled={!storageReady || storageBlocked || unresolved || member} onClick={() => void save()}>{member ? text("In watchlist", "已在观察列表") : text("Save", "保存")}</button>
      </>}
    {storageBlocked && <span className={styles.status} role="status">{text("This browser cannot safely retain a save request. No new save was sent.", "浏览器无法安全保留保存请求。未发送新的保存请求。")}</span>}
    {storageBlocked && <button className="btn" onClick={() => void recoverFence(scope.current)}>{text("Check browser storage", "检查浏览器存储")}</button>}
    {message && <span className={styles.status} role="status" aria-live="polite">{message}</span>}
    {unresolved && visibleOperation?.settled && <button className="btn" disabled={visibleOperation.checking}
      onClick={() => void reconcile(scope.current, visibleOperation)}>{text("Check status", "核对状态")}</button>}
  </div>;
}
