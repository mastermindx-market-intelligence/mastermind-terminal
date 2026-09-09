"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Group, IconGoogle, IconSignOut, IconTwitterX, Msg, Row, SectionHead } from "./icons";
import { acsDate, type SectionProps } from "./types";
import type { ExportFormat } from "@/lib/accountExport";

// ── Account ──────────────────────────────────────────────────────────────────
// Ported from the macro dashboard's `_renderSDAccount` + `_wireSDAccount`:
// the aurora ID card, then Profile (name / email / password inline editors) and
// Security (login method / last sign-in / user id) in the two-column grid.

type EditKind = "name" | "email" | "pw" | "del";

type DeletionReceipt = {
  receipt_code: string;
  status: string;
  steps: { phase: string; done: boolean; text: [string, string] }[];
};

// A "cancelled" or "failed" request is a dead request: the account is not going anywhere and
// the control below must still let the owner file a new one. Only "received"/"in_progress"
// (still open — the DB's own partial unique index enforces at most one of these) and
// "completed" (a real outcome worth keeping visible) permanently occupy this row. Exported so
// the review MAJOR ("permanently removes the ability to file another") has a unit test that
// does not need a DOM.
export function isActiveDeletionStatus(status: string): boolean {
  return status === "received" || status === "in_progress" || status === "completed";
}

function providerLabelKey(p: string): string {
  if (p === "google") return "acsProvGoogle";
  if (p === "twitter") return "acsProvX";
  return "acsProvEmail";
}
function ProviderIcon({ p }: { p: string }) {
  if (p === "google") return <IconGoogle />;
  if (p === "twitter") return <IconTwitterX />;
  return null;
}

/** Cancel / Save pair for an inline edit form. A COMPONENT rather than a helper
 *  call so the save handlers (which touch timer refs) are only ever passed as
 *  props — never invoked during render. */
function FormBtns({
  busy, t, onCancel, onSave, saveKey,
}: {
  busy: boolean;
  t: SectionProps["t"];
  onCancel: () => void;
  onSave: () => void;
  saveKey: string;
}) {
  return (
    <div className="acs-btns">
      <button type="button" className="acs-btn ghost" onClick={onCancel} disabled={busy}>{t("acsCancel")}</button>
      <button type="button" className="acs-btn primary" onClick={onSave} disabled={busy}>
        {busy ? t("acsSaving") : t(saveKey)}
      </button>
    </div>
  );
}

export default function SectionAccount({ t, lang, email, user, onClose, onPatchMeta, onRefreshUser }: SectionProps) {
  const [editing, setEditing] = useState<EditKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [nameIn, setNameIn] = useState("");
  const [emailIn, setEmailIn] = useState("");
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  // ── data lifecycle (export / deletion request, B-F12-4) ──
  const [delIn, setDelIn] = useState("");
  const [filed, setFiled] = useState<DeletionReceipt | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/account/deletion");
        if (!res.ok) return;
        const body = await res.json();
        const rows: DeletionReceipt[] = Array.isArray(body?.requests) ? body.requests : [];
        if (live && rows.length) setFiled(rows[0]);
      } catch { /* no receipt shown — not an error state, just unknown */ }
    })();
    return () => { live = false; };
  }, []);
  function stepText(r: DeletionReceipt): string {
    const step = r.steps.find((s) => !s.done) || r.steps[r.steps.length - 1];
    return step ? step.text[lang === "zh" ? 1 : 0] : r.receipt_code;
  }
  async function saveDeletion() {
    const email = delIn.trim();
    if (email.toLowerCase() !== (addr || "").trim().toLowerCase()) {
      setMsg({ kind: "err", text: t("acsDeleteMismatch") });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/account/deletion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm_email: email }),
      });
      const body = await res.json();
      if (!res.ok || !body?.ok) throw new Error(t("acsDeleteErr"));
      setFiled(body.receipt as DeletionReceipt);
      setMsg({ kind: "ok", text: t("acsDeleteOk") });
      setEditing(null);
      setDelIn("");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error)?.message || t("acsDeleteErr") });
    } finally {
      setBusy(false);
    }
  }

  // ── data export (B-F12-4 / review MAJOR acceptance-6) ──
  // A plain <a download> saved every non-200 body (429/503/500/401) to disk verbatim. This
  // fetches, checks the status, and only ever hands the browser a real file on 200.
  const [dlBusy, setDlBusy] = useState<ExportFormat | null>(null);
  const [dlMsg, setDlMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  async function downloadExport(format: ExportFormat) {
    setDlBusy(format);
    setDlMsg(null);
    try {
      const res = await fetch(`/api/account/export?format=${format}`);
      if (res.status === 429) {
        let retryAfterS: number | null = null;
        try {
          const body = await res.json();
          retryAfterS = typeof body?.retry_after_s === "number" ? body.retry_after_s : null;
        } catch { /* keep retryAfterS null */ }
        setDlMsg({
          kind: "err",
          text: retryAfterS ? `${t("acsDownloadWait")} (${retryAfterS}s)` : t("acsDownloadWait"),
        });
        return;
      }
      if (!res.ok) {
        setDlMsg({ kind: "err", text: t("acsDownloadErr") });
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `mastermind-terminal-data.${format}`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setDlMsg({ kind: "err", text: t("acsDownloadErr") });
    } finally {
      setDlBusy(null);
    }
  }

  const displayName = (typeof user?.meta?.display_name === "string" ? user.meta.display_name : "") || "";
  const addr = user?.email || email;
  const provider = user?.provider || "email";
  const since = acsDate(user?.createdAt, lang);
  const lastIn = acsDate(user?.lastSignInAt, lang);
  const uid = user?.id || "";
  const uidShort = uid.length > 10 ? `${uid.slice(0, 4)}…${uid.slice(-4)}` : uid;
  const idName = displayName || addr;
  const avatarChar = (idName || "U").trim().charAt(0).toUpperCase() || "U";

  function openEdit(kind: EditKind) {
    setEditing(kind);
    setMsg(null);
    if (kind === "name") setNameIn(displayName);
    if (kind === "email") setEmailIn("");
    if (kind === "pw") { setPw1(""); setPw2(""); }
    if (kind === "del") setDelIn("");
  }
  function cancelEdit() {
    setEditing(null);
    setMsg(null);
    setEmailIn(""); setPw1(""); setPw2(""); setDelIn("");
  }

  async function saveName() {
    const val = nameIn.trim();
    setBusy(true); setMsg(null);
    try {
      const { error } = await createClient().auth.updateUser({ data: { display_name: val } });
      if (error) throw error;
      onPatchMeta({ display_name: val });   // ID card + rail repaint without a refetch
      setEditing(null);
      void onRefreshUser();
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error)?.message || t("acsErrGen") });
    } finally {
      setBusy(false);
    }
  }

  async function saveEmail() {
    const val = emailIn.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setMsg({ kind: "err", text: t("acsValidEmail") });
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const { error } = await createClient().auth.updateUser({ email: val });
      if (error) throw error;
      setMsg({ kind: "ok", text: t("acsEmailSent") });
      setEmailIn("");
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error)?.message || t("acsErrGen") });
    } finally {
      setBusy(false);
    }
  }

  async function savePw() {
    if (pw1.length < 8) { setMsg({ kind: "err", text: t("acsPwShort") }); return; }
    if (pw1 !== pw2) { setMsg({ kind: "err", text: t("acsPwMismatch") }); return; }
    setBusy(true); setMsg(null);
    try {
      const { error } = await createClient().auth.updateUser({ password: pw1 });
      if (error) throw error;
      setMsg({ kind: "ok", text: t("acsPwOk") });
      setPw1(""); setPw2("");
      closeTimer.current = setTimeout(() => { setEditing(null); setMsg(null); }, 1200);
    } catch (e) {
      setMsg({ kind: "err", text: (e as Error)?.message || t("acsErrGen") });
    } finally {
      setBusy(false);
    }
  }

  function copyUid() {
    const flip = () => {
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1200);
    };
    // The async Clipboard API is not always available: it needs a secure context
    // AND a focused document, so it rejects with NotAllowedError over plain http
    // or when the window has lost focus. Falling through to the legacy
    // execCommand path (macro's `_sdCopyExec`) means the ID is actually copied
    // and the button still confirms it — swallowing the rejection would leave
    // the user with a button that silently does nothing.
    const legacy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = uid;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flip();
      } catch { /* clipboard genuinely unavailable — no false confirmation */ }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(uid).then(flip).catch(legacy);
    else legacy();
  }

  // `labelKey` lets one row use its own action word (review MAJOR round 2: reusing the generic
  // "Edit"/"编辑" on the "Delete my account" row does not name the action).
  const editBtn = (kind: EditKind, labelKey: string = "acsEdit") => (
    <button type="button" className="acs-edit" onClick={() => openEdit(kind)}>{t(labelKey)}</button>
  );

  return (
    <>
      <SectionHead title={t("acsAccount")} sub={t("acsAccountSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {/* ── the aurora ID card (signature) ── */}
        <div className="acs-id">
          <span className="acs-id-av">{avatarChar}</span>
          <span className="acs-id-main">
            <span className="acs-id-name">{idName || "—"}</span>
            {displayName ? <span className="acs-id-mail">{addr}</span> : null}
            <span className="acs-id-chips">
              <span className="acs-chip"><ProviderIcon p={provider} />{t(providerLabelKey(provider))}</span>
              {since ? <span className="acs-chip">{`${t("acsMemberSince")} ${since}`}</span> : null}
            </span>
          </span>
        </div>

        <div className="acs-grid">
          <Group title={t("acsProfile")}>
            {/* display name */}
            <Row
              label={t("acsDispName")}
              value={displayName || "—"}
              valueStrong={!!displayName}
              control={editing === "name" ? undefined : editBtn("name")}
              editing={editing === "name"}
            >
              <div className="acs-form">
                <input
                  className="acs-in"
                  type="text"
                  value={nameIn}
                  placeholder={t("acsDispNamePh")}
                  aria-label={t("acsDispName")}
                  onChange={(e) => setNameIn(e.target.value)}
                />
                <Msg text={msg && editing === "name" ? msg.text : ""} kind={msg?.kind || "err"} />
                <FormBtns busy={busy} t={t} onCancel={cancelEdit} onSave={saveName} saveKey="acsSave" />
              </div>
            </Row>

            {/* email — the address itself is the row's primary text */}
            <Row
              label={<span className="acs-mailv">{addr}</span>}
              control={editing === "email" ? undefined : editBtn("email")}
              editing={editing === "email"}
            >
              <div className="acs-form">
                <input
                  className="acs-in"
                  type="email"
                  value={emailIn}
                  placeholder={t("acsEmailPh")}
                  aria-label={t("acsProvEmail")}
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={(e) => setEmailIn(e.target.value)}
                />
                <p className="acs-note">{t("acsEmailNote")}</p>
                <Msg text={msg && editing === "email" ? msg.text : ""} kind={msg?.kind || "err"} />
                <FormBtns busy={busy} t={t} onCancel={cancelEdit} onSave={saveEmail} saveKey="acsSendConfirm" />
              </div>
            </Row>

            {/* password */}
            <Row
              label={t("acsPassword")}
              value="••••••••"
              control={editing === "pw" ? undefined : editBtn("pw")}
              editing={editing === "pw"}
            >
              <div className="acs-form">
                <input
                  className="acs-in"
                  type="password"
                  value={pw1}
                  placeholder={t("acsNewPwPh")}
                  aria-label={t("acsNewPwPh")}
                  autoComplete="new-password"
                  onChange={(e) => setPw1(e.target.value)}
                />
                <input
                  className="acs-in"
                  type="password"
                  value={pw2}
                  placeholder={t("acsConfirmPwPh")}
                  aria-label={t("acsConfirmPwPh")}
                  autoComplete="new-password"
                  onChange={(e) => setPw2(e.target.value)}
                />
                <Msg text={msg && editing === "pw" ? msg.text : ""} kind={msg?.kind || "err"} />
                <FormBtns busy={busy} t={t} onCancel={cancelEdit} onSave={savePw} saveKey="acsUpdatePw" />
              </div>
            </Row>
          </Group>

          <Group title={t("acsSecurity")}>
            <Row
              label={t("acsLoginMethod")}
              control={
                <span className="acs-provider"><ProviderIcon p={provider} />{t(providerLabelKey(provider))}</span>
              }
            />
            {lastIn ? <Row label={t("acsLastSignin")} value={lastIn} /> : null}
            <Row
              label={t("acsUserId")}
              desc={t("acsUserIdNote")}
              value={uidShort}
              control={
                <button type="button" className="acs-mini" onClick={copyUid}>
                  {copied ? t("acsCopied") : t("acsCopy")}
                </button>
              }
            />
          </Group>

          <Group title={t("acsData")}>
            <Row
              label={t("acsDownload")}
              desc={t("acsDownloadDesc")}
              control={(
                <>
                  <button
                    type="button"
                    className="acs-mini"
                    disabled={dlBusy !== null}
                    onClick={() => downloadExport("json")}
                  >
                    {dlBusy === "json" ? t("acsDownloadWait") : "JSON"}
                  </button>
                  <button
                    type="button"
                    className="acs-mini"
                    disabled={dlBusy !== null}
                    onClick={() => downloadExport("csv")}
                  >
                    {dlBusy === "csv" ? t("acsDownloadWait") : "CSV"}
                  </button>
                </>
              )}
            />
            {dlMsg ? <Msg text={dlMsg.text} kind={dlMsg.kind} /> : null}
            {filed && isActiveDeletionStatus(filed.status) ? (
              <Row label={t("acsDeleteFiled")} value={filed.receipt_code} desc={stepText(filed)} />
            ) : (
              <Row
                label={t("acsDelete")}
                // A prior cancelled/failed request is disclosed honestly rather than hidden —
                // it removed nothing, so it must never block filing a new one (review MAJOR
                // round 2).
                desc={filed ? `${t("acsDeleteDesc")} ${stepText(filed)}` : t("acsDeleteDesc")}
                control={editing === "del" ? undefined : editBtn("del", "acsDeleteBtn")}
                editing={editing === "del"}
              >
                <div className="acs-form">
                  <p className="acs-note">{t("acsDeleteConfirm")}</p>
                  <input
                    className="acs-in"
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label={t("acsDeleteTypeEmail")}
                    placeholder={t("acsDeleteTypeEmail")}
                    value={delIn}
                    onChange={(e) => setDelIn(e.target.value)}
                  />
                  <Msg text={msg && editing === "del" ? msg.text : ""} kind={msg?.kind || "err"} />
                  <FormBtns busy={busy} t={t} onCancel={cancelEdit} onSave={saveDeletion} saveKey="acsDelete" />
                </div>
              </Row>
            )}
          </Group>
        </div>

        {/* mobile sign-out row (the rail's is hidden ≤640px) */}
        <form action="/auth/signout" method="post">
          <button type="submit" className="acs-signout-m">
            <IconSignOut />
            {t("signOut")}
          </button>
        </form>
      </div>
    </>
  );
}
