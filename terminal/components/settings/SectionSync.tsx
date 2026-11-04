"use client";
import Link from "next/link";
import { identityOwnerKey, isAccountOwner } from "@/lib/accountIdentity";
import { useAccountPrefs, type AccountPrefsSnapshot } from "@/lib/useMarketPrefs";
import { Group, IconExtLink, Row, SectionHead } from "./icons";
import type { SectionProps } from "./types";

// ── Sync ─────────────────────────────────────────────────────────────────────
// Ported from the macro dashboard's `_renderSDSync`, plus a third row for the
// Terminal-only settings that now ride with the account.
//
// The headline is a CLAIM about the account's authority, so it is derived from
// the preference store, never from the identity props (macro#6819 C2, F12). An
// identity proves someone is signed in; it proves nothing about whether their
// preferences have reached the account. The ladder, first match wins:
//
//   off      guest — there is nothing to sync with
//   quiet    signed in, but the snapshot is someone else's (the render before
//            this owner's load effect ran). Say "Signed in", claim nothing more.
//   pending  an edit is held for the merge base, a write is in flight, or the
//            last delivery failed (the pump retries on its own; the button
//            jumps the backoff). Judged BEFORE the base: a hold exists only
//            while the base is unknown, so it must outrank the next rung.
//   quiet    this owner's base is not known yet (first read in flight, or a
//            failed read with nothing outstanding) — again "Signed in".
//   on       base loaded, nothing held, newest revision acknowledged.
//
// The settings button only opens this panel for a signed-in user, so the
// off-state below is unreachable in practice — it is kept because the panel is
// reachable programmatically via useSettings().open() and a signed-out card is
// the honest thing to render if it ever is.

export type SyncClaim = "off" | "quiet" | "pending" | "on";

type ClaimInputs = Pick<AccountPrefsSnapshot, "owner" | "base" | "held" | "sync"> & {
  /** The owner key of the identity being RENDERED — `identityOwnerKey(identity)`. */
  who: string;
};

/** Pure: what the card may honestly say about `who`, given the store's published snapshot. */
export function syncClaim({ who, owner, base, held, sync }: ClaimInputs): SyncClaim {
  if (!isAccountOwner(who)) return "off";
  // The snapshot belongs to someone else (the render before `load(who)` ran): nothing about this
  // account is proven, so nothing is claimed.
  if (owner !== who) return "quiet";
  // Held outranks an unknown base — see the ladder above.
  if (held || sync.phase === "syncing" || sync.phase === "failed" || sync.revision !== sync.acked) {
    return "pending";
  }
  // This owner's merge base is not known yet (read in flight, or failed and retrying).
  if (base !== "loaded") return "quiet";
  return "on";
}

/** Copy for the two claims the shared dictionary has no key for — component-local and keyed by
 *  `lang`, the idiom SectionAlertDelivery / SectionSharing / SectionDeveloper use for their own
 *  messages. Deliberately NOT added to lib/i18n.tsx: seventeen evidence packets pin that file
 *  byte-for-byte and B-F12-9 binds its capturedAtHead, so a dictionary edit would demand
 *  recaptures of surfaces this change does not touch. */
const CLAIM_COPY = {
  quiet: { en: "Signed in", zh: "已登录" },
  pending: { en: "Preference changes are pending", zh: "偏好设置更改仍待同步" },
} as const;

function claimTitle(claim: SyncClaim, t: SectionProps["t"], lang: SectionProps["lang"]): string {
  if (claim === "off") return t("acsSyncOff");
  if (claim === "on") return t("acsSyncOn");
  return CLAIM_COPY[claim][lang];
}

export default function SectionSync({ lang, t, email, user, identity, onClose }: SectionProps) {
  const who = identityOwnerKey(identity);
  const { owner, base, held, sync, retrySync } = useAccountPrefs(identity);
  const claim = syncClaim({ who, owner, base, held, sync });

  const addr = user?.email || email;
  // The zh lead ends in a full-width colon, which already carries its own space.
  const lead = t("acsSignedInAs");
  const signedInLine = /：$/.test(lead) ? `${lead}${addr}` : `${lead} ${addr}`;

  return (
    <>
      <SectionHead title={t("acsSyncT")} sub={t("acsSyncSub")} closeLabel={t("acsClose")} onClose={onClose} />
      <div className="acs-body">
        {/* Two materials, not four: the on-tint IS the claim, so every non-on state wears the
            neutral `off` material; `data-claim` carries the distinction for tests and tooling. */}
        <div className={`acs-sync${claim === "on" ? "" : " off"}`} data-claim={claim}>
          <span className="dot" />
          <span className="acs-sync-main">
            {/* A polite live region: the claim moves as deliveries settle while the panel is
                open, which is worth announcing — but it is a status, not an alert. */}
            <span className="acs-sync-t" role="status">{claimTitle(claim, t, lang)}</span>
            <span className="acs-sync-s">{claim === "off" ? t("acsSignInToOn") : signedInLine}</span>
          </span>
          {claim === "pending" && sync.phase === "failed" && (
            <button type="button" className="acs-msg-retry" onClick={retrySync}>{t("acsPrefRetry")}</button>
          )}
        </div>

        <Group>
          <Row label={t("acsThemeLang")} desc={t("acsThemeLangN")} />
          <Row
            label={t("acsWatchlists")}
            desc={t("acsWatchNote")}
            control={
              <Link className="acs-link" href="/portfolio" onClick={onClose}>
                {t("acsOpenPortal")}
                <IconExtLink />
              </Link>
            }
          />
          <Row label={t("acsTermSettings")} desc={t("acsTermSettingsNote")} />
        </Group>
      </div>
    </>
  );
}
