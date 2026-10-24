"use client";
import { useEffect, useId, useRef, useState } from "react";
import { parsePortfolioRoleEdit } from "@/lib/portfolioTargetRole";
import tg from "@/components/PortfolioTargets.module.css";

/** User-authored metadata only. The parent supplies its existing owner-fenced
 * mutation queue and verifies canonical readback before resolving onSave. */
export default function PortfolioRoleEditor({ ticker, roleLabel, available, lang, onSave }: {
  ticker: string; roleLabel?: string | null; available: boolean; lang: "en" | "zh";
  onSave: (value: string | null) => Promise<void>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(roleLabel ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<"saved" | "failed" | null>(null);
  const life = useRef({ active: true });
  useEffect(() => { const token = { active: true }; life.current = token; return () => { token.active = false; }; }, []);
  useEffect(() => { if (!dirty) setDraft(roleLabel ?? ""); }, [roleLabel, dirty]);
  const role = parsePortfolioRoleEdit(draft);
  const invalid = role.kind !== "value";
  const pick = (copy: { en: string; zh: string }) => lang === "zh" ? copy.zh : copy.en;
  if (!available) return <p className={tg.notice}>{pick({ en: "Role labels are unavailable. Weight targets remain usable.", zh: "角色标签暂不可用；权重目标仍可使用。" })}</p>;
  return <div className={tg.group}>
    <label className={tg.field} htmlFor={id}>
      <span className={tg.lbl}>{pick({ en: "Your role label (optional)", zh: "你的角色标签（可选）" })}</span>
      <input id={id} className={tg.input} value={draft} disabled={pending}
        aria-label={`${pick({ en: "Role label", zh: "角色标签" })}: ${ticker}`}
        aria-describedby={`${id}-hint`} aria-invalid={invalid || undefined}
        onChange={e => { setDraft(e.target.value); setDirty(true); setStatus(null); }} />
    </label>
    <p id={`${id}-hint`} className={tg.explain}>{invalid
      ? pick({ en: "Use at most 48 characters, without line breaks or control characters.", zh: "最多48个字符，不含换行或控制字符。" })
      : pick({ en: "Your description of this holding. It does not change target weights or drift. Leave blank to clear.", zh: "只记录你对这项持仓的描述，不改变目标权重或偏离状态。留空可清除标签。" })}</p>
    <div className={tg.actions}>
      <button type="button" className={tg.clear} disabled={pending || !dirty || invalid} onClick={async () => {
        if (role.kind !== "value") return;
        const token = life.current;
        const value = role.value;
        setPending(true); setStatus(null);
        try {
          await onSave(value);
          if (!token.active) return;
          setDraft(value ?? ""); setDirty(false); setStatus("saved");
        } catch { if (token.active) setStatus("failed"); }
        finally { if (token.active) setPending(false); }
      }}>{pick({ en: "Save role label", zh: "保存角色标签" })}</button>
      {pending && <span role="status" className={tg.saved}>{pick({ en: "Saving…", zh: "正在保存…" })}</span>}
      {status === "saved" && !dirty && <span role="status" className={tg.saved}>{pick({ en: "Role label saved and confirmed.", zh: "角色标签已确认保存。" })}</span>}
      {status === "failed" && <span role="alert" className={tg.error}>{pick({ en: "Change not confirmed. Your input is kept; refresh your holdings before deciding what to do next.", zh: "未能确认更改。输入内容已保留；请刷新持仓后再决定下一步。" })}</span>}
    </div>
  </div>;
}
