"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Group, IconCheck, Msg, Row, SectionHead } from "./icons";
import type { SectionProps } from "./types";
import {
  webhookCopy,
  webhookDeliveryStatusLabel,
  webhookEnabledLabel,
  webhookRelativeTime,
} from "@/lib/webhookLabels";
import { validateWebhookUrl } from "@/lib/webhookUrl";

type Team = { id: string; name: string; role: "owner" | "admin" | "member" };
type Endpoint = {
  id: string;
  teamId: string;
  url: string;
  enabled: boolean;
  eventFilter: string[];
};
type Delivery = {
  id: string;
  eventType: string;
  status: string;
  createdAt: string | null;
};

function truncateUrl(url: string): string {
  const bare = url.replace(/^https:\/\//, "");
  return bare.length > 48 ? `${bare.slice(0, 45)}…` : bare;
}

export default function SectionWebhooks({ t, lang, onClose }: SectionProps) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamId, setTeamId] = useState<string>("");
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveriesByEp, setDeliveriesByEp] = useState<Record<string, Delivery[]>>({});
  const [callerRole, setCallerRole] = useState<"owner" | "admin" | "member" | null>(null);
  const [loadErr, setLoadErr] = useState<string>("");
  const [urlIn, setUrlIn] = useState("");
  const [wantTest, setWantTest] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formMsg, setFormMsg] = useState<{ text: string; kind: "ok" | "err" | "wait" } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const eligible = useMemo(
    () => (teams ?? []).filter((tm) => tm.role === "owner" || tm.role === "admin"),
    [teams],
  );
  const canWrite = callerRole === "owner" || callerRole === "admin";

  const loadTeams = useCallback(async () => {
    setLoadErr("");
    try {
      const r = await fetch("/api/teams");
      const body = await r.json().catch(() => ({}));
      if (r.status === 401) {
        setTeams([]);
        return;
      }
      if (!r.ok) {
        setLoadErr(lang === "zh" ? body.messageZh || webhookCopy("emptyTeamHelp", lang) : body.message || webhookCopy("emptyTeamHelp", lang));
        setTeams([]);
        return;
      }
      const list = Array.isArray(body.teams) ? (body.teams as Team[]) : [];
      setTeams(list);
      const admins = list.filter((tm) => tm.role === "owner" || tm.role === "admin");
      const pick = admins[0]?.id || list[0]?.id || "";
      setTeamId((cur) => cur || pick);
    } catch {
      setLoadErr(webhookCopy("emptyTeamHelp", lang));
      setTeams([]);
    }
  }, [lang]);

  const loadEndpoints = useCallback(async (id: string) => {
    if (!id) {
      setEndpoints([]);
      setCallerRole(null);
      return;
    }
    try {
      const r = await fetch(`/api/webhooks?teamId=${encodeURIComponent(id)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setEndpoints([]);
        setCallerRole(null);
        setLoadErr(lang === "zh" ? body.messageZh || "" : body.message || "");
        return;
      }
      setLoadErr("");
      setEndpoints(Array.isArray(body.endpoints) ? body.endpoints : []);
      setCallerRole(body.callerRole === "owner" || body.callerRole === "admin" || body.callerRole === "member" ? body.callerRole : null);
    } catch {
      setEndpoints([]);
    }
  }, [lang]);

  const loadDeliveries = useCallback(async (epId: string) => {
    try {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(epId)}/deliveries`);
      const body = await r.json().catch(() => ({}));
      const rows = Array.isArray(body.deliveries) ? (body.deliveries as Delivery[]) : [];
      setDeliveriesByEp((cur) => ({ ...cur, [epId]: rows }));
    } catch {
      setDeliveriesByEp((cur) => ({ ...cur, [epId]: [] }));
    }
  }, []);

  useEffect(() => { void loadTeams(); }, [loadTeams]);
  useEffect(() => {
    if (!teamId) return;
    void loadEndpoints(teamId);
  }, [teamId, loadEndpoints]);
  useEffect(() => {
    for (const ep of endpoints) void loadDeliveries(ep.id);
  }, [endpoints, loadDeliveries]);

  async function addEndpoint() {
    const check = validateWebhookUrl(urlIn);
    if (!check.ok) {
      const key = check.code === "not_https" ? "notHttps" : check.code === "private_address" ? "ssrf" : "invalidUrl";
      setFormMsg({ text: webhookCopy(key, lang), kind: "err" });
      return;
    }
    if (!teamId) return;
    setBusy(true);
    setFormMsg({ text: "", kind: "wait" });
    try {
      const r = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamId,
          url: urlIn.trim(),
          event_filter: wantTest ? ["webhook.test"] : [],
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormMsg({ text: lang === "zh" ? body.messageZh || webhookCopy("ssrf", lang) : body.message || webhookCopy("ssrf", lang), kind: "err" });
        return;
      }
      if (typeof body.secret === "string") setSecret(body.secret);
      setUrlIn("");
      setFormMsg(null);
      await loadEndpoints(teamId);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(ep: Endpoint) {
    setBusy(true);
    try {
      await fetch(`/api/webhooks/${encodeURIComponent(ep.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !ep.enabled }),
      });
      await loadEndpoints(teamId);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(ep: Endpoint) {
    setBusy(true);
    try {
      const r = await fetch(`/api/webhooks/${encodeURIComponent(ep.id)}/test`, { method: "POST" });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setFormMsg({
          text: lang === "zh" ? body.messageZh || webhookCopy("testDisabled", lang) : body.message || webhookCopy("testDisabled", lang),
          kind: "err",
        });
        return;
      }
      setFormMsg({ text: webhookCopy("testQueued", lang), kind: "ok" });
      await loadDeliveries(ep.id);
    } finally {
      setBusy(false);
    }
  }

  async function createTeam() {
    setBusy(true);
    try {
      const r = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: lang === "zh" ? "我的团队" : "My team" }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoadErr(lang === "zh" ? body.messageZh || "" : body.message || "");
        return;
      }
      await loadTeams();
    } finally {
      setBusy(false);
    }
  }

  function copySecret() {
    if (!secret) return;
    const flip = () => setCopied(true);
    const legacy = () => {
      try {
        const ta = document.createElement("textarea");
        ta.value = secret;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        flip();
      } catch { /* clipboard unavailable */ }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(secret).then(flip).catch(legacy);
    else legacy();
  }

  const emptyTeam = teams !== null && teams.length === 0;
  const memberOnly = teams !== null && teams.length > 0 && eligible.length === 0;

  return (
    <>
      <SectionHead title={t("acsWebhooks")} sub={t("acsWebhooksSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {loadErr ? <Msg text={loadErr} kind="err" /> : null}

        {emptyTeam ? (
          <Group>
            <Row label={webhookCopy("emptyTeam", lang)} desc={webhookCopy("emptyTeamHelp", lang)} />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="acs-btn primary" onClick={() => void createTeam()} disabled={busy}>
                {webhookCopy("createTeam", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        {memberOnly ? (
          <Group>
            <Row desc={webhookCopy("memberReadOnly", lang)} />
          </Group>
        ) : null}

        {eligible.length > 1 ? (
          <Group title={webhookCopy("teamLabel", lang)}>
            <select
              className="acs-in"
              aria-label={webhookCopy("teamLabel", lang)}
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
            >
              {eligible.map((tm) => (
                <option key={tm.id} value={tm.id}>{tm.name}</option>
              ))}
            </select>
          </Group>
        ) : null}

        {secret ? (
          <Group title={webhookCopy("secretTitle", lang)}>
            <Row desc={webhookCopy("secretOnce", lang)} />
            <input className="acs-in" type="text" readOnly value={secret} aria-label={webhookCopy("secretTitle", lang)} />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="acs-btn primary" onClick={copySecret}>
                {copied ? webhookCopy("copied", lang) : webhookCopy("copySecret", lang)}
              </button>
              <button type="button" className="acs-btn ghost" onClick={() => { setSecret(null); setCopied(false); }}>
                {webhookCopy("dismissSecret", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        {canWrite ? (
          <Group title={webhookCopy("addEndpoint", lang)}>
            <label className="acs-row-lbl" htmlFor="wh-url">{webhookCopy("urlLabel", lang)}</label>
            <input
              id="wh-url"
              className="acs-in"
              type="url"
              value={urlIn}
              placeholder={webhookCopy("urlPlaceholder", lang)}
              aria-label={webhookCopy("urlLabel", lang)}
              onChange={(e) => setUrlIn(e.target.value)}
            />
            <button
              type="button"
              className="acs-check"
              aria-pressed={wantTest}
              onClick={() => setWantTest((v) => !v)}
              style={{ marginTop: 10 }}
            >
              <span className="box"><IconCheck /></span>
              {webhookCopy("testEvent", lang)}
            </button>
            <Msg text={formMsg?.text || ""} kind={formMsg?.kind || "err"} />
            <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
              <button type="button" className="acs-btn primary" onClick={() => void addEndpoint()} disabled={busy}>
                {webhookCopy("add", lang)}
              </button>
            </div>
          </Group>
        ) : null}

        {!emptyTeam ? (
          <Group title={webhookCopy("endpoints", lang)}>
            {endpoints.length === 0 ? (
              <Row desc={webhookCopy("noEndpoints", lang)} />
            ) : (
              endpoints.map((ep) => (
                <div key={ep.id}>
                  <Row
                    label={truncateUrl(ep.url)}
                    value={canWrite ? undefined : webhookEnabledLabel(ep.enabled, lang)}
                    control={
                      canWrite ? (
                        <button
                          type="button"
                          className="acs-btn ghost"
                          aria-pressed={ep.enabled}
                          aria-label={webhookEnabledLabel(ep.enabled, lang)}
                          onClick={() => void toggleEnabled(ep)}
                          disabled={busy}
                        >
                          {webhookEnabledLabel(ep.enabled, lang)}
                        </button>
                      ) : undefined
                    }
                  />
                  {canWrite ? (
                    <div className="acs-btns" style={{ justifyContent: "flex-start" }}>
                      <button type="button" className="acs-btn ghost" onClick={() => void sendTest(ep)} disabled={busy || !ep.enabled}>
                        {webhookCopy("sendTest", lang)}
                      </button>
                    </div>
                  ) : null}
                  <Group title={webhookCopy("deliveries", lang)}>
                    {(deliveriesByEp[ep.id] ?? []).length === 0 ? (
                      <Row desc={webhookCopy("noDeliveries", lang)} />
                    ) : (
                      (deliveriesByEp[ep.id] ?? []).map((d) => (
                        <Row
                          key={d.id}
                          label={webhookCopy("testEvent", lang)}
                          desc={webhookRelativeTime(d.createdAt, lang)}
                          value={webhookDeliveryStatusLabel(d.status, lang)}
                        />
                      ))
                    )}
                  </Group>
                </div>
              ))
            )}
          </Group>
        ) : null}
      </div>
    </>
  );
}
