"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, SectionHead } from "./icons";
import type { SectionProps } from "./types";

type SharedRow = {
  id: string;
  resourceId: string;
  resourceName: string;
  granteeUserId: string;
  createdAt: string | null;
  revokedAt: null;
};

type ReceivedRow = {
  id: string;
  name: string;
  sharedBy: string;
  symbols: { symbol: string; section: string; position: number }[];
};

type OwnList = { id: string; name: string };

function pickMessage(lang: "en" | "zh", body: { message?: string; messageZh?: string }, fallback: string): string {
  const text = lang === "zh" ? body.messageZh : body.message;
  return typeof text === "string" && text.trim() ? text : fallback;
}

function lastFour(id: string): string {
  return id.slice(-4);
}

function symbolsLabel(count: number, t: SectionProps["t"], lang: "en" | "zh"): string {
  if (lang === "zh") return t("shrSymbolsMany").replace("{n}", String(count));
  if (count === 1) return t("shrSymbolOne");
  return t("shrSymbolsMany").replace("{n}", String(count));
}

export default function SectionSharing({ t, lang, onClose }: SectionProps) {
  const [ownLists, setOwnLists] = useState<OwnList[]>([]);
  const [shared, setShared] = useState<SharedRow[]>([]);
  const [received, setReceived] = useState<ReceivedRow[]>([]);
  const [listId, setListId] = useState("");
  const [grantee, setGrantee] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [revokedIds, setRevokedIds] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [goneIds, setGoneIds] = useState<string[]>([]);
  const [grantsReady, setGrantsReady] = useState(false);
  const [receivedReady, setReceivedReady] = useState(false);
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const [grantsRes, listsRes] = await Promise.all([
        fetch("/api/grants", { headers: { Accept: "application/json" } }),
        fetch("/api/watchlist", { headers: { Accept: "application/json" } }),
      ]);
      const grantsBody = await grantsRes.json().catch(() => ({})) as {
        shared?: SharedRow[];
        sharedWithMe?: { id: string; resourceName?: string; resourceId?: string; grantedBy?: string; symbolCount?: number }[];
        message?: string;
        messageZh?: string;
      };
      const listsBody = await listsRes.json().catch(() => ({})) as {
        lists?: OwnList[];
        sharedWithMe?: ReceivedRow[] | null;
        sharedWithMeState?: "unavailable" | "failed";
      };
      if (grantsRes.status === 503 || listsRes.status === 503 || listsBody.sharedWithMeState === "unavailable") {
        setUnavailable(true);
        setGrantsReady(false);
        setReceivedReady(false);
        setMsg({ kind: "err", text: t("shrUnavailable") });
        return false;
      }
      if (!grantsRes.ok) {
        setGrantsReady(false);
        setReceivedReady(false);
        setMsg({ kind: "err", text: pickMessage(lang, grantsBody, t("shrReadFailed")) });
        return false;
      }
      if (!Array.isArray(grantsBody.shared)) {
        setGrantsReady(false);
        setReceivedReady(false);
        setMsg({ kind: "err", text: t("shrReadFailed") });
        return false;
      }
      if (listsRes.ok && !Array.isArray(listsBody.lists)) {
        setGrantsReady(false);
        setReceivedReady(false);
        setMsg({ kind: "err", text: t("shrReadFailed") });
        return false;
      }
      setUnavailable(false);
      setShared(grantsBody.shared);
      setGrantsReady(true);
      setOwnLists(Array.isArray(listsBody.lists) ? listsBody.lists.map((l) => ({ id: l.id, name: l.name })) : []);
      if (listsBody.sharedWithMeState === "failed" || listsBody.sharedWithMe === null || !Array.isArray(listsBody.sharedWithMe)) {
        setReceivedReady(false);
        setMsg({ kind: "err", text: t("shrReadFailed") });
        return false;
      }
      setReceived(listsBody.sharedWithMe);
      setReceivedReady(true);
      return true;
    } catch {
      setGrantsReady(false);
      setReceivedReady(false);
      setMsg({ kind: "err", text: t("shrReadFailed") });
      return false;
    }
  }, [lang, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (revokeTimerRef.current !== null) {
        clearTimeout(revokeTimerRef.current);
        revokeTimerRef.current = null;
      }
    };
  }, []);

  async function onShare() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "share",
          resourceKind: "watchlist",
          resourceId: listId,
          granteeUserId: grantee.trim(),
        }),
      });
      const body = await res.json().catch(() => ({})) as { message?: string; messageZh?: string };
      if (res.status === 503) {
        setUnavailable(true);
        setMsg({ kind: "err", text: t("shrUnavailable") });
        return;
      }
      if (!res.ok && res.status !== 200) {
        setMsg({ kind: "err", text: pickMessage(lang, body, t("shrWriteFailed")) });
        return;
      }
      setGrantee("");
      const sentence = pickMessage(lang, body, t("shrYouShared"));
      const readOk = await load();
      if (readOk) {
        setMsg({ kind: "ok", text: sentence });
      }
    } catch {
      setMsg({ kind: "err", text: t("shrWriteFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(row: SharedRow) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/grants", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ grantId: row.id }),
      });
      const body = await res.json().catch(() => ({})) as { message?: string; messageZh?: string };
      if (res.status === 503) {
        setUnavailable(true);
        setMsg({ kind: "err", text: t("shrUnavailable") });
        return;
      }
      if (!res.ok) {
        setMsg({ kind: "err", text: pickMessage(lang, body, t("shrWriteFailed")) });
        return;
      }
      setRevokedIds((ids) => [...ids, row.id]);
      if (revokeTimerRef.current !== null) {
        clearTimeout(revokeTimerRef.current);
      }
      revokeTimerRef.current = setTimeout(() => {
        setShared((rows) => rows.filter((r) => r.id !== row.id));
        setRevokedIds((ids) => ids.filter((id) => id !== row.id));
        revokeTimerRef.current = null;
      }, 1600);
    } catch {
      setMsg({ kind: "err", text: t("shrWriteFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function onToggleReceived(row: ReceivedRow) {
    if (openId === row.id) {
      setOpenId(null);
      return;
    }
    try {
      const res = await fetch("/api/watchlist", { headers: { Accept: "application/json" } });
      if (res.status === 503) {
        setUnavailable(true);
        setMsg({ kind: "err", text: t("shrUnavailable") });
        return;
      }
      if (!res.ok) {
        setMsg({ kind: "err", text: t("shrReadFailed") });
        return;
      }
      const body = await res.json().catch(() => ({})) as {
        sharedWithMe?: ReceivedRow[] | null;
        sharedWithMeState?: "unavailable" | "failed";
      };
      if (body.sharedWithMeState === "unavailable") {
        setUnavailable(true);
        setMsg({ kind: "err", text: t("shrUnavailable") });
        return;
      }
      if (body.sharedWithMeState === "failed" || body.sharedWithMe === null || !Array.isArray(body.sharedWithMe)) {
        setMsg({ kind: "err", text: t("shrReadFailed") });
        return;
      }
      const fresh = body.sharedWithMe.find((item) => item.id === row.id);
      if (!fresh) {
        setGoneIds((ids) => (ids.includes(row.id) ? ids : [...ids, row.id]));
        setOpenId(null);
        return;
      }
      const symbols = Array.isArray(fresh.symbols) ? fresh.symbols : [];
      setReceived((rows) => rows.map((item) => (item.id === row.id ? { ...item, ...fresh, symbols } : item)));
      setOpenId(row.id);
      setGoneIds((ids) => ids.filter((id) => id !== row.id));
    } catch {
      setMsg({ kind: "err", text: t("shrReadFailed") });
    }
  }

  return (
    <>
      <SectionHead title={t("acsSharing")} sub={t("shrSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {msg ? <p className={msg.kind === "ok" ? "acs-msg show ok" : "acs-msg show err"} role="status">{msg.text}</p> : null}

        <Group title={t("shrMineHead")}>
          <div className="acs-row">
            <div className="acs-row-line">
              <div className="acs-row-main">
                <span className="acs-row-lbl">{t("shrShareCta")}</span>
                <span className="acs-row-desc">{t("shrReadOnlyNote")}</span>
              </div>
            </div>
            {grantsReady && ownLists.length === 0 ? (
              <p className="acs-note" style={{ margin: 0 }}>{t("shrNoOwnLists")}</p>
            ) : (
              <div className="acs-form" style={{ display: "block" }}>
                <label className="acs-row-desc" htmlFor="shr-pick-list">{t("shrPickList")}</label>
                <select
                  id="shr-pick-list"
                  className="acs-in"
                  value={listId}
                  onChange={(e) => setListId(e.target.value)}
                  aria-label={t("shrPickList")}
                  disabled={unavailable || busy}
                >
                  <option value="">{t("shrPickList")}</option>
                  {ownLists.map((list) => (
                    <option key={list.id} value={list.id}>{list.name}</option>
                  ))}
                </select>
                <label className="acs-row-desc" htmlFor="shr-account">{t("shrAccountLabel")}</label>
                <input
                  id="shr-account"
                  className="acs-in"
                  value={grantee}
                  onChange={(e) => setGrantee(e.target.value)}
                  aria-label={t("shrAccountLabel")}
                  autoComplete="off"
                  disabled={unavailable || busy}
                />
                <p className="acs-note">{t("shrAccountHint")}</p>
                <div className="acs-btns">
                  <button
                    type="button"
                    className="acs-btn primary"
                    onClick={() => void onShare()}
                    disabled={unavailable || busy || !listId || !grantee.trim()}
                    aria-label={t("shrShareButton")}
                  >
                    {t("shrShareButton")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!grantsReady ? null : shared.length === 0 ? (
            <div className="acs-row">
              <p className="acs-note" style={{ margin: 0 }}>{t("shrMineEmpty")}</p>
            </div>
          ) : shared.map((row) => (
            <div className="acs-row" key={row.id}>
              {revokedIds.includes(row.id) ? (
                <p className="acs-note" style={{ margin: 0 }} role="status">{t("shrRevoked")}</p>
              ) : (
                <div className="acs-row-line">
                  <div className="acs-row-main">
                    <span className="acs-row-lbl">{row.resourceName}</span>
                    <span
                      className="acs-row-desc"
                      title={`${t("shrFullAccount")}: ${row.granteeUserId}`}
                    >
                      {t("shrYouShared") + (lang === "zh" ? "" : " ") + t("shrSharedWithAccount").replace("{n}", lastFour(row.granteeUserId))}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="acs-btn ghost"
                    onClick={() => void onRevoke(row)}
                    disabled={unavailable || busy}
                    aria-label={t("shrRevoke")}
                  >
                    {t("shrRevoke")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </Group>

        <Group title={t("shrTheirsHead")}>
          {!receivedReady ? null : received.length === 0 ? (
            <div className="acs-row">
              <p className="acs-note" style={{ margin: 0 }}>{t("shrTheirsEmpty")}</p>
            </div>
          ) : received.map((row) => (
            <div className="acs-row" key={row.id}>
              <div className="acs-row-line">
                <div className="acs-row-main">
                  <span className="acs-row-lbl">{row.name}</span>
                  <span className="acs-row-desc">{t("shrSharedWithYouBy")}</span>
                </div>
                <span className="acs-chip" aria-label={t("shrReadOnlyBadge")}>{t("shrReadOnlyBadge")}</span>
              </div>
              <p className="acs-note">{row.symbols.length === 0 ? t("shrListEmpty") : symbolsLabel(row.symbols.length, t, lang)}</p>
              {goneIds.includes(row.id) ? (
                <p className="acs-note" role="status">{t("shrNoLongerShared")}</p>
              ) : (
                <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    className="acs-btn ghost"
                    onClick={() => void onToggleReceived(row)}
                    aria-label={openId === row.id ? t("shrCloseList") : t("shrOpenList")}
                    aria-expanded={openId === row.id}
                  >
                    {openId === row.id ? t("shrCloseList") : t("shrOpenList")}
                  </button>
                </div>
              )}
              {openId === row.id && row.symbols.length > 0 ? (
                <ul className="acs-note" style={{ marginTop: 8, paddingLeft: 18 }}>
                  {row.symbols.map((sym) => (
                    <li key={sym.symbol}>{sym.symbol}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </Group>
      </div>
    </>
  );
}
