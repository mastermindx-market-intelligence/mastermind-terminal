"use client";

/**
 * InvestigationIntlEvidence — IM08/IM09 native trusted receiver (PATCH_ONLY,
 * run iw2-intl-native-receiver). Pure synchronous receiver the existing native
 * workspace renders for one saved selection.
 *
 * The parent workspace owns authentication, admission, storage and the
 * selection→packet binding and supplies them through `read`, a
 * native-auth-fenced synchronous pure getter (or null). This component never
 * authenticates anything, never fetches, never subscribes, never touches
 * storage, never saves, never generates a clock, and never mounts a route,
 * store or server.
 *
 * Per render it invokes `read` exactly once — no cache across renders
 * (A → B → A re-reads A), no retry, no second call to manufacture proof —
 * then, in order:
 * - missing reader, a thrown read or a null projection → localized
 *   unavailable;
 * - a projection bound to a different id/revision → localized scope_changed
 *   with NO composition (the caller kernel is never invoked for it);
 * - an explicit caller disposition → its own bilingual plain words, never a
 *   raw enum token and never a collapse into generic "unavailable";
 * - a resolved packet → resolveIntlInvestigation ONCE. Only when the kernel
 *   resolves AND the composition accepts does IntlInvestigationPanel render
 *   with the packet's real composition props: the panel lang stays the packet
 *   owner's genuine lang — never relabelled, never overridden with local
 *   owner values or timestamps, and no callbacks are attached (the caller
 *   supplies none);
 * - a refused composition → localized invalid wording with zero numeric
 *   leaks; nothing from the packet is rendered.
 *
 * A missing prior stays missing (never converted into a current baseline) and
 * no owner context is synthesized here; the trusted caller, evidence adapter,
 * composition mapper and panel are reused unchanged.
 */

import * as intlCaller from "../../lib/intlInvestigationCaller";
import type { IntlCallerDisposition, IntlCallerInput } from "../../lib/intlInvestigationCaller";
import { IntlInvestigationPanel } from "./IntlInvestigationPanel";
import type { IntlInvestigationPanelProps } from "./IntlInvestigationPanel";

export interface InvestigationIntlSelection {
  id: string;
  revision: number;
}

/** Parent-supplied, native-auth-fenced synchronous pure getter (or null). */
export type InvestigationIntlRead = () => {
  selection: InvestigationIntlSelection;
  input: IntlCallerInput;
} | null;

export interface InvestigationIntlEvidenceProps {
  /** Controls only this receiver's refusal copy; a resolved panel keeps the
   * packet owner's genuine lang. */
  lang: "en" | "zh";
  selection: InvestigationIntlSelection;
  read: InvestigationIntlRead | null;
}

/** Bilingual receiver copy. Plain words only: no enum tokens, no digits and
 * no packet values, so a refusal screen can never leak a number. */
export interface InvestigationIntlReceiverCopy {
  unavailable: string;
  selectionScopeChanged: string;
  refusedComposition: string;
  disposition: Record<IntlCallerDisposition, string>;
}

/** Private bilingual factory: each message pairs en and zh through pick. */
function receiverCopy(lang: "en" | "zh"): InvestigationIntlReceiverCopy {
  const pick = (en: string, zh: string) => (lang === "zh" ? zh : en);
  return {
    unavailable: pick(
      "No evidence projection is available for this selection right now.",
      "此选择当前没有可用的证据投影。"
    ),
    selectionScopeChanged: pick(
      "The supplied selection no longer matches the saved investigation this workspace is holding. Nothing was compared.",
      "所提供的选择与工作区持有的已保存研究不再匹配。未进行任何对比。"
    ),
    refusedComposition: pick(
      "The evidence result was invalid under the composition contract, so nothing is shown.",
      "证据结果在组合契约下无效，因此不显示任何内容。"
    ),
    disposition: {
      unauthenticated: pick(
        "Sign-in is required before this saved investigation can be read.",
        "需要先登录才能读取该已保存研究。"
      ),
      not_found: pick(
        "No saved investigation exists for this selection.",
        "此选择不存在已保存的研究。"
      ),
      not_admitted: pick(
        "This saved investigation is not admitted for viewing.",
        "该已保存研究未获准查看。"
      ),
      denied: pick(
        "Access to this saved investigation was denied.",
        "对该已保存研究的访问被拒绝。"
      ),
      unavailable: pick(
        "This saved investigation is unavailable right now.",
        "该已保存研究当前不可用。"
      ),
      invalid: pick(
        "This saved investigation could not be read as valid evidence.",
        "无法将该已保存研究读取为有效证据。"
      ),
      scope_changed: pick(
        "The saved investigation was read under a different scope than this selection.",
        "该已保存研究的读取范围与此选择不同。"
      ),
    },
  };
}

export const INVESTIGATION_INTL_RECEIVER_COPY: Record<
  "en" | "zh",
  InvestigationIntlReceiverCopy
> = {
  en: receiverCopy("en"),
  zh: receiverCopy("zh"),
};

type ReceiverScreen =
  | { kind: "unavailable" }
  | { kind: "selectionScopeChanged" }
  | { kind: "disposition"; disposition: IntlCallerDisposition }
  | { kind: "refusedComposition" }
  | { kind: "panel"; props: IntlInvestigationPanelProps };

export function InvestigationIntlEvidence(props: InvestigationIntlEvidenceProps) {
  const { lang, selection, read } = props;
  const copy = INVESTIGATION_INTL_RECEIVER_COPY[lang];

  // Exactly one synchronous read per render. A throw from the fenced getter is
  // an unavailable projection — never retried, never turned into a decision.
  let entry: ReturnType<InvestigationIntlRead> = null;
  let readFailed = false;
  if (read !== null) {
    try {
      entry = read();
    } catch {
      readFailed = true;
    }
  }

  let screen: ReceiverScreen;
  if (read === null || readFailed || entry === null) {
    screen = { kind: "unavailable" };
  } else if (entry.selection.id !== selection.id || entry.selection.revision !== selection.revision) {
    // Wrong id or revision: refuse before any composition work happens.
    screen = { kind: "selectionScopeChanged" };
  } else {
    // Single call into the trusted caller seam (namespace property access so
    // a read-only passthrough spy can observe it in tests).
    const outcome = intlCaller.resolveIntlInvestigation(entry.input);
    if (outcome.kind === "resolved") {
      screen = outcome.composition.ok
        ? { kind: "panel", props: outcome.composition.props }
        : { kind: "refusedComposition" };
    } else {
      screen = { kind: "disposition", disposition: outcome.disposition };
    }
  }

  if (screen.kind === "panel") {
    // Real packet composition props only — no overrides, no local owner
    // values or timestamps, no callbacks. Panel lang is the packet's own.
    return <IntlInvestigationPanel {...screen.props} />;
  }

  const text =
    screen.kind === "unavailable"
      ? copy.unavailable
      : screen.kind === "selectionScopeChanged"
        ? copy.selectionScopeChanged
        : screen.kind === "refusedComposition"
          ? copy.refusedComposition
          : copy.disposition[screen.disposition];

  return (
    <section lang={lang} data-lang={lang}>
      <p role="status">{text}</p>
    </section>
  );
}

export default InvestigationIntlEvidence;
