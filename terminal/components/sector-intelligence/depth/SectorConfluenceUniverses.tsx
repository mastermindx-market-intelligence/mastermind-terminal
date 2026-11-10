"use client";

import { Fragment, useId, useRef, useState } from "react";
import type { Dispatch, KeyboardEvent, ReactNode, Ref, SetStateAction } from "react";
import { useLang } from "@/lib/i18n";
import { useSectorDepthT } from "@/lib/sectorDepthLex";
import {
  CLASS_LABEL_KEYS,
  MEMBERS_PREVIEW,
  RELIABILITY_LABEL_KEYS,
  RIBBON_ORDER,
  UNIVERSES,
  UNIVERSE_ORDER,
  buyableNow,
  classCounts,
  coverageModel,
  filterGroups,
  freshnessOf,
  groupReliability,
  groupsOf,
  initialUiStates,
  membersPreview,
  patchUiState,
  rotationRead,
  rs60Of,
  sectorRollupOf,
  sortGroups,
  toggleExpanded,
  universePresence,
  universeWordMatches,
} from "@/lib/sectorDepthUniverses";
import type {
  UniverseBlockRead,
  UniverseClass,
  UniverseData,
  UniverseGroup,
  UniverseId,
  UniverseUiState,
  UniverseUiStates,
  UniverseView,
} from "@/lib/sectorDepthUniverses";
import { conformingChartKey } from "@/lib/sectorDepthRows";
import { sameSiteHref } from "@/lib/sectorDepthHref";
import { DepthUnavailable } from "./DepthUnavailable";
import { RowBlockUnavailable } from "./RowBlockUnavailable";
import { EmergenceMark } from "./EmergenceMark";
import styles from "./SectorConfluenceUniverses.module.css";

/** Four-universe Entry evidence (props-only mount; lane 3 integrates).
 *
 * Four INDEPENDENT universes — S&P 500 subsectors (vs SPY), Nasdaq-100 groups
 * (vs QQQ), Russell-2000 groups (vs IWM) and thematic baskets (no equity
 * benchmark) — each rendered only from its own payload: scored/gateable rows
 * ONLY (thin and below-minimum groups are counted in coverage, never tabled),
 * per-row reliability from the payload (never recomputed), regime words from
 * the payload localized by label/label_zh, freshness by the engine's tier /
 * ticks logic. Rows never cross between universes and there is no client
 * fallback across them: absent capability, no-access (ok:false), zero scored
 * groups and live data are four distinct states. A timing map, not a buy list.
 *
 * Rows increment (wire v1.1): `universeBlocks` mounts the same board from the
 * four carried typed-block ENTRIES — a tab's available block read overrides
 * the legacy payload for that tab, an unavailable block read shows its honest
 * per-block reason state, and the index tabs add a separately labelled sector
 * roll-up (`sectors` is never mixed into the subsector table).
 */

export interface SectorConfluenceUniversesProps {
  /** Per-universe payloads from the Macro sector generation; null means the
   * whole capability is not carried by this reading. */
  universes?: Partial<Record<UniverseId, UniverseData>> | null;
  /** Rows increment: per-universe reads of the carried
   * `confluence_universe_<u>` typed-block ENTRIES (status/reason/value). When
   * present, a tab's available block read overrides the legacy payload. */
  universeBlocks?: Partial<Record<UniverseId, UniverseBlockRead>> | null;
  /** Navigation out through the host (exact href from the payload). */
  onNavigate?: (href: string) => void;
  /** Optional capture target for the root section. */
  captureRef?: Ref<HTMLElement>;
}

type UiSetter = Dispatch<SetStateAction<UniverseUiStates>>;

/** Detail href from the payload's chart_key: the universe directory + the
 * CARRIED key verbatim + ".html", as a same-site absolute path per the N4
 * href law. The real payloads already prefix basket keys ("b-crypto-rails"),
 * so no consumer-side prefix is added — double-prefixing is the bug this
 * verbatim law removes. A chart_key without a conforming id (navigable-id law
 * plus the no-`..` refusal) has no detail destination — no invented link. */
function detailHref(id: UniverseId, group: UniverseGroup): string | undefined {
  const key = group.chart_key;
  if (!key || !conformingChartKey(key)) return undefined;
  const dir =
    id === "nasdaq" ? "subsector_nasdaq/" : id === "russell" ? "subsector_russell/" : "subsector/";
  return sameSiteHref(`/${dir}${key}.html`) ?? undefined;
}

/** S1 (review r1): the roll-up detail link renders only where a published
 * sector-level detail page exists for that universe. The S&P tab's sector rows
 * carry `sec-*` chart keys and NO `/subsector/sec-*.html` route exists (the
 * route registry has none), so those labels render without a link; the Nasdaq
 * tab's `amalg-*` sector rows have published `/subsector_nasdaq/` routes and
 * keep theirs. Russell publishes no sector rows tonight and its keys would
 * follow the S&P pattern, so its roll-up is linkless too. The render test
 * keeps this honest: every href composed from the committed real fixtures
 * must exist in sharedShellRoutes.generated.json. */
const ROLLUP_HAS_DETAIL_ROUTES: ReadonlySet<UniverseId> = new Set(["nasdaq"]);

/** Count cell (S3): null (not stated) renders the localized not-stated word —
 * never a coerced 0 and never a bare dash. */
function fmtCount(v: number | null | undefined, notStated: string): string {
  return v == null ? notStated : String(v);
}

/** Count + noun (S3): a measured count reads "6 names"; a null count reads
 * the not-stated word ALONE ("not stated"), never "not stated names" and
 * never a coerced "0 names". */
function fmtCountNoun(v: number | null | undefined, noun: string, notStated: string): string {
  return v == null ? notStated : `${v} ${noun}`;
}

export function SectorConfluenceUniverses({
  universes,
  universeBlocks,
  onNavigate,
  captureRef,
}: SectorConfluenceUniversesProps) {
  const t = useSectorDepthT();
  const rid = useId();
  const [active, setActive] = useState<UniverseId>("subsectors");
  const [ui, setUi] = useState<UniverseUiStates>(initialUiStates);
  const tablistRef = useRef<HTMLDivElement | null>(null);

  if (universes == null && universeBlocks == null) {
    return (
      <DepthUnavailable
        field="confluence"
        owner="macro_sector_generation"
        title={t("siUniverseTitle")}
      />
    );
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const idx = UNIVERSE_ORDER.indexOf(active);
    let next = -1;
    if (event.key === "ArrowRight") next = (idx + 1) % UNIVERSE_ORDER.length;
    else if (event.key === "ArrowLeft")
      next = (idx - 1 + UNIVERSE_ORDER.length) % UNIVERSE_ORDER.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = UNIVERSE_ORDER.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const id = UNIVERSE_ORDER[next];
    setActive(id);
    tablistRef.current
      ?.querySelector<HTMLButtonElement>(`[data-universe="${id}"]`)
      ?.focus();
  };

  return (
    <section ref={captureRef} className={styles.root} aria-label={t("siUniverseTitle")}>
      <header className={styles.header}>
        <h3 className={styles.title}>{t("siUniverseTitle")}</h3>
        <p className={styles.sub}>{t("siUniverseSub")}</p>
        <p className={styles.never}>{t("siUniverseNeverMixed")}</p>
      </header>

      <div
        ref={tablistRef}
        role="tablist"
        aria-label={t("siUniverseTitle")}
        className={styles.tabs}
        onKeyDown={onTabKeyDown}
      >
        {UNIVERSE_ORDER.map((id) => {
          const selected = id === active;
          // E03/E04: each chip carries its universe's own gateable count. A
          // carried zero stays visible (0); only an absent payload hides it.
          // R2-S1: a payload whose owner word names another universe is not
          // this tab's data — no count chip either, matching the refused panel.
          // Rows increment: a tab's available block read overrides the legacy
          // payload; an unavailable block read keeps the chip hidden.
          const block = universeBlocks?.[id];
          const payload = block?.state === "available" ? block.data : universes?.[id];
          const count =
            payload !== undefined && universeWordMatches(id, payload)
              ? coverageModel(payload.coverage).gateable
              : null;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`${rid}-tab-${id}`}
              data-universe={id}
              className={styles.tab}
              aria-selected={selected}
              aria-controls={`${rid}-panel-${id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(id)}
            >
              {t(UNIVERSES[id].tabKey)}
              {count !== null && (
                <span className={styles.tabCount} data-count> · {count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${rid}-panel-${active}`}
        aria-labelledby={`${rid}-tab-${active}`}
        className={styles.panel}
      >
        <UniversePanel
          key={active}
          id={active}
          data={universes?.[active]}
          block={universeBlocks?.[active]}
          ui={ui[active]}
          setUi={setUi}
          onNavigate={onNavigate}
        />
      </div>
    </section>
  );
}

function UniversePanel({
  id,
  data,
  block,
  ui,
  setUi,
  onNavigate,
}: {
  id: UniverseId;
  data: UniverseData | undefined;
  block: UniverseBlockRead | undefined;
  ui: UniverseUiState;
  setUi: UiSetter;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const meta = UNIVERSES[id];

  // Rows increment: a classified unavailable block read is its own honest
  // state — never the legacy panel, never a partial table.
  if (block && block.state === "unavailable") {
    return <RowBlockUnavailable reason={block.reason} title={t("siUniverseTitle")} />;
  }
  const resolved = block?.state === "available" ? block.data : data;
  const envelope =
    block?.state === "available"
      ? { asOf: block.asOf, asOfField: block.asOfField }
      : undefined;
  const presence = universePresence(id, resolved);

  if (presence === "absent") {
    return (
      <DepthUnavailable
        field="confluence"
        owner="macro_sector_generation"
        title={t("siUniverseTitle")}
      />
    );
  }
  if (presence === "no_access") {
    return <p className={styles.stateLine}>{t("siUniverseNoAccess")}</p>;
  }
  // presence === "zero_groups" | "live" — resolved is defined either way.
  const d = resolved as UniverseData;
  const groups = presence === "live" ? groupsOf(id, d) : [];
  const ribbon = classCounts(groups);
  const rollup = sectorRollupOf(id, d);

  if (presence === "zero_groups") {
    // N2 (R3A-67): the zero-groups state KEEPS the population wording — the
    // coverage line, the thin / below-minimum / unscored chips and the
    // identity line all render above the zero-groups sentence, so a universe
    // whose groups are all thin still shows its counted population.
    // Rows increment: when the sector roll-up carries rows, the empty
    // subsector tab names the gate (no subsector crossed it) instead.
    return (
      <div className={styles.universe}>
        <CoverageBlock id={id} data={d} envelope={envelope}>
          <p className={styles.stateLine} data-empty="subsectors">
            {rollup.length > 0 ? t("siUniverseNoSubsectors") : t("siUniverseZeroGroups")}
          </p>
          <SectorRollup id={id} groups={rollup} onNavigate={onNavigate} />
        </CoverageBlock>
      </div>
    );
  }

  const filterActive = ui.filter.trim().length > 0;

  const base = ui.view === "buyable" ? buyableNow(groups) : rotationRead(groups);
  const filtered = filterGroups(base, ui.filter);
  const rows = sortGroups(filtered.matches, ui.sort);

  return (
    <div className={styles.universe}>
      <CoverageBlock id={id} data={d} envelope={envelope}>
        {/* B01 RIBBON_ORDER: reading-class counts over this universe's scored
            groups — zeros included, so a carried zero is visible, never hidden. */}
        <ul className={styles.ribbon} data-ribbon="true">
          {RIBBON_ORDER.map((cls) => (
            <li key={cls} className={styles.ribbonItem} data-cls={cls}>
              <span className={styles.ribbonLabel}>{t(CLASS_LABEL_KEYS[cls])}</span>
              <span className={styles.ribbonCount}>{ribbon[cls]}</span>
            </li>
          ))}
        </ul>
      </CoverageBlock>

      <div className={styles.viewBar} role="group" aria-label={t(meta.tabKey)}>
        {(["buyable", "rotation"] as const).map((view: UniverseView) => (
          <button
            key={view}
            type="button"
            className={styles.viewBtn}
            aria-pressed={ui.view === view}
            onClick={() => setUi((s) => patchUiState(s, id, { view }))}
          >
            {t(view === "buyable" ? "siUniverseBuyableNow" : "siUniverseRotationRead")}
          </button>
        ))}
      </div>

      <div className={styles.filterBar}>
        <input
          type="text"
          className={styles.filterInput}
          value={ui.filter}
          placeholder={t(meta.filterPlaceholderKey)}
          aria-label={t(meta.filterPlaceholderKey)}
          onChange={(e) => setUi((s) => patchUiState(s, id, { filter: e.target.value }))}
        />
        <span className={styles.filterCount}>
          {t("siUniverseFilterCount", { shown: filtered.count, total: filtered.total })}
        </span>
        {filterActive && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => setUi((s) => patchUiState(s, id, { filter: "" }))}
          >
            {t("siUniverseClearFilter")}
          </button>
        )}
      </div>
      {filterActive && filtered.count === 0 && (
        <p className={styles.noMatches}>
          {t("siUniverseNoMatches", { q: ui.filter })}
        </p>
      )}

      {ui.view === "buyable" ? (
        rows.length > 0 ? (
          <div className={styles.cards}>
            {rows.map((g) => (
              <GroupCard
                key={g.key}
                id={id}
                group={g}
                allShown={!!ui.expanded[`${g.key}#all`]}
                onToggleAll={() => setUi((s) => toggleExpanded(s, id, `${g.key}#all`))}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ) : (
          !filterActive && <p className={styles.stateLine}>{t("siUniverseBuyableEmpty")}</p>
        )
      ) : (
        <div className={styles.tableWrap}>
          {ui.sort !== "tier" && (
            <p className={styles.sortNote}>{t("siUniverseLocalSortNote")}</p>
          )}
          {rows.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <SortHead
                    active={ui.sort === "label"}
                    dir="ascending"
                    text={t(meta.labelColKey)}
                    onClick={() => setUi((s) => patchUiState(s, id, { sort: "label" }))}
                  />
                  <th scope="col">{t(meta.laneColKey)}</th>
                  <SortHead
                    active={ui.sort === "tier"}
                    dir="ascending"
                    text={t("siUniverseColTier")}
                    onClick={() => setUi((s) => patchUiState(s, id, { sort: "tier" }))}
                  />
                  <th scope="col">{t("siUniverseColRegime")}</th>
                  <th scope="col">{t("siUniverseColFresh")}</th>
                  <SortHead
                    active={ui.sort === "rs60"}
                    dir="descending"
                    text={t("siUniverseColRs60")}
                    onClick={() => setUi((s) => patchUiState(s, id, { sort: "rs60" }))}
                  />
                  <SortHead
                    active={ui.sort === "n_members"}
                    dir="descending"
                    text={t("siUniverseColN")}
                    onClick={() => setUi((s) => patchUiState(s, id, { sort: "n_members" }))}
                  />
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <RotationRow
                    key={g.key}
                    id={id}
                    group={g}
                    laneColText={t(meta.laneColKey)}
                    open={!!ui.expanded[g.key]}
                    allShown={!!ui.expanded[`${g.key}#all`]}
                    onToggleRow={() => setUi((s) => toggleExpanded(s, id, g.key))}
                    onToggleAll={() => setUi((s) => toggleExpanded(s, id, `${g.key}#all`))}
                    onNavigate={onNavigate}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Rows increment: the separately labelled sector roll-up (wire v1.1
          §1) — sector rows are never mixed into the subsector table above. */}
      <SectorRollup id={id} groups={rollup} onNavigate={onNavigate} />
    </div>
  );
}

/** The separately labelled sector roll-up for an index tab: sector-level
 * rows rendered as cards under their own heading, from the same GroupCard
 * surface. `sectors` never substitutes for the subsector table. */
function SectorRollup({
  id,
  groups,
  onNavigate,
}: {
  id: UniverseId;
  groups: UniverseGroup[];
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  if (groups.length === 0) return null;
  return (
    <div className={styles.rollup} data-rollup="sectors">
      <h4 className={styles.rollupTitle}>{t("siUniverseSectorRollup")}</h4>
      <div className={styles.cards}>
        {groups.map((g) => (
          <GroupCard
            key={g.key}
            id={id}
            group={g}
            allShown={!!expanded[g.key]}
            onToggleAll={() => setExpanded((s) => ({ ...s, [g.key]: !s[g.key] }))}
            onNavigate={onNavigate}
            // S1: roll-up cards link only where a published sector-level route
            // exists for this universe (see ROLLUP_HAS_DETAIL_ROUTES).
            detailLink={ROLLUP_HAS_DETAIL_ROUTES.has(id)}
          />
        ))}
      </div>
    </div>
  );
}

/** The population wording shared by the live and zero-groups states (review
 * N2): the coverage line (with the N1 absent-count law), the thin /
 * below-minimum / unscored chips, and the source-identity line (S5: the tab's
 * localized display name + localized benchmark, never raw ids). `children`
 * carries the live-only reading-class ribbon. Rows increment: `envelope`
 * renders the carried block date labelled by its source field — a session
 * `as_of`, or `generated_utc` (a build time, explicitly not a session date;
 * `data.as_of` itself stays verbatim and may be null). */
function CoverageBlock({
  id,
  data,
  envelope,
  children,
}: {
  id: UniverseId;
  data: UniverseData;
  envelope?: { asOf: string; asOfField: string };
  children?: ReactNode;
}) {
  const t = useSectorDepthT();
  const meta = UNIVERSES[id];
  const cov = coverageModel(data.coverage);
  // N1: an absent count renders as not stated — never as 0. The reliability
  // line needs all three counts; anything less is simply not shown.
  const relCounts =
    cov.high !== null && cov.med !== null && cov.lowConf !== null
      ? `${cov.high}/${cov.med}/${cov.lowConf}`
      : null;
  const benchmark = meta.benchmarkKey
    ? t(meta.benchmarkKey)
    : t("siUniverseBasketBenchmark");
  return (
    <div className={styles.coverage}>
      {(cov.total != null || data.as_of != null) && (
        <p className={styles.covMain}>
          {cov.total != null &&
            (cov.gateable !== null
              ? t("siUniverseCoverage", {
                  gateable: cov.gateable,
                  total: cov.total,
                  noun: t(meta.nounKey),
                })
              : t("siUniverseCoverageNotStated", {
                  total: cov.total,
                  noun: t(meta.nounKey),
                }))}
          {cov.total != null && data.as_of != null ? " · " : ""}
          {data.as_of != null ? t("siDepthAsOf", { date: data.as_of }) : ""}
        </p>
      )}
      <ul className={styles.chips}>
        {cov.thin != null && cov.thin > 0 && (
          <li className={styles.chip}>{t("siUniverseCoverageThin", { n: cov.thin })}</li>
        )}
        {cov.belowMin != null && cov.belowMin > 0 && (
          <li className={styles.chip}>
            {t("siUniverseCoverageBelowMin", { n: cov.belowMin, min: cov.minMembers })}
          </li>
        )}
        {cov.unscored != null && cov.unscored > 0 && (
          <li className={styles.chip}>
            {t("siUniverseCoverageUnscored", { n: cov.unscored })}
          </li>
        )}
        {relCounts && (
          <li className={styles.chip}>
            {t("siUniverseReliabilityHigh")} {cov.high} · {t("siUniverseReliabilityMed")}{" "}
            {cov.med} · {t("siUniverseReliabilityLow")} {cov.lowConf}
          </li>
        )}
      </ul>
      <p className={styles.identity}>
        {t("siUniverseSourceIdentity", { name: t(meta.tabKey), benchmark })}
        {data.as_of == null ? ` · ${t("siUniverseNoDate")}` : ""}
      </p>
      {envelope && (
        <p className={styles.envelope} data-envelope={envelope.asOfField}>
          {envelope.asOfField === "generated_utc"
            ? t("siUniverseBuiltAt", { date: envelope.asOf })
            : t("siUniverseCarriedAsOf", { date: envelope.asOf })}
        </p>
      )}
      {children}
    </div>
  );
}

function SortHead({
  active,
  dir,
  text,
  onClick,
}: {
  active: boolean;
  dir: "ascending" | "descending";
  text: string;
  onClick: () => void;
}) {
  return (
    <th scope="col" aria-sort={active ? dir : "none"}>
      <button
        type="button"
        className={styles.sortBtn}
        aria-pressed={active}
        onClick={onClick}
      >
        {text}{" "}
        <span className={styles.arr} aria-hidden="true">
          {active ? (dir === "ascending" ? "▲" : "▼") : "⇅"}
        </span>
      </button>
    </th>
  );
}

/** Six class badges; an unknown or absent class (engine reclassified between
 * sessions) renders the localized "unclassified" word (R3-N4) — never an
 * invented tier label and never the raw English word on the ZH page. The raw
 * engine value rides data-cls so the reclassification is triageable. */
function TierBadge({ cls }: { cls: UniverseClass | string | null | undefined }) {
  const t = useSectorDepthT();
  const known = cls != null && Object.hasOwn(CLASS_LABEL_KEYS, cls);
  if (!known) {
    return (
      <span className={styles.tier} data-cls={cls ?? undefined}>
        {t("siUniverseClassUnknown")}
      </span>
    );
  }
  return (
    <span className={styles.tier} data-cls={cls}>
      {t(CLASS_LABEL_KEYS[cls as UniverseClass])}
    </span>
  );
}

/** Regime word from the payload, localized by the shared lang; secondary
 * action line below. Colour keys off regime.side only — never language. */
function RegimeCell({ group }: { group: UniverseGroup }) {
  const { lang } = useLang();
  const r = group.regime;
  if (!r) return <span className={styles.regime}>–</span>;
  // Payload words, localized by the shared lang with EN fallback (ZH reader
  // falls back to the EN word, exactly like label_zh).
  const word = (lang === "zh" ? r.label_zh : undefined) || r.label || "–";
  const action = lang === "zh" ? (r.action_zh ?? r.action ?? null) : (r.action ?? null);
  return (
    <span className={styles.regimeWrap}>
      <span className={styles.regime} data-side={r.side || undefined}>
        {word}
      </span>
      {action ? <span className={styles.regimeAction}>{action}</span> : null}
    </span>
  );
}

function GroupCard({
  id,
  group,
  allShown,
  onToggleAll,
  onNavigate,
  detailLink = true,
}: {
  id: UniverseId;
  group: UniverseGroup;
  allShown: boolean;
  onToggleAll: () => void;
  onNavigate?: (href: string) => void;
  /** S1: the roll-up suppresses the detail control where no published
   * sector-level route exists (the subsector card view keeps its links). */
  detailLink?: boolean;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  // ZH fallback law (review r1 S2): label_zh is null on every real row
  // tonight (all four universes) and sector_zh likewise — the English label
  // stays under this documented fallback; translations are never authored
  // consumer-side. Regime label_zh/action_zh ARE carried and localize.
  const label = (lang === "zh" ? group.label_zh : undefined) || group.label || "–";
  const sector = (lang === "zh" ? group.sector_zh : undefined) || group.sector;
  const fresh = freshnessOf(group);
  const rel = groupReliability(group);
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle}>{label}</h4>
        <TierBadge cls={group.class} />
      </div>
      <p className={styles.cardLane}>
        {sector || "–"} · {fmtCountNoun(group.n_priced, t("siUniverseNames"), t("siUniverseNotStated"))}
      </p>
      <p className={styles.cardMeta}>
        <span className={styles.fresh}>{t(fresh.key, fresh.params)}</span>
        {" · "}
        <span className={styles.num} data-sign={signOf(rs60Of(group))}>
          {fmtSigned(rs60Of(group))}
        </span>
        {" · "}
        <span className={styles.relMini} data-rel={rel.tier}>
          {t(RELIABILITY_LABEL_KEYS[rel.tier])}
        </span>
      </p>
      <p className={styles.cardRegime}>
        <RegimeCell group={group} />
      </p>
      <MembersList
        group={group}
        expanded={allShown}
        onToggleMore={onToggleAll}
        onNavigate={onNavigate}
      />
      {detailLink && <DetailLink href={detailHref(id, group)} name={label} onNavigate={onNavigate} />}
    </article>
  );
}

function RotationRow({
  id,
  group,
  laneColText,
  open,
  allShown,
  onToggleRow,
  onToggleAll,
  onNavigate,
}: {
  id: UniverseId;
  group: UniverseGroup;
  laneColText: string;
  open: boolean;
  allShown: boolean;
  onToggleRow: () => void;
  onToggleAll: () => void;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const { lang } = useLang();
  // Same ZH fallback law as GroupCard (review r1 S2): label_zh/sector_zh are
  // null on every real row tonight — English stays, nothing is authored here.
  const label = (lang === "zh" ? group.label_zh : undefined) || group.label || "–";
  const sector = (lang === "zh" ? group.sector_zh : undefined) || group.sector;
  const fresh = freshnessOf(group);
  const rel = groupReliability(group);
  const detailId = `members-${id}-${group.key}`;
  return (
    <Fragment>
      <tr>
        <th scope="row" className={styles.cellLabel}>
          <button
            type="button"
            className={styles.expand}
            aria-expanded={open}
            aria-controls={detailId}
            onClick={onToggleRow}
          >
            {label}
          </button>
          <span className={styles.nMembers}>
            {fmtCountNoun(group.n_priced, t("siUniverseNames"), t("siUniverseNotStated"))}
            {" · "}
            <span className={styles.relMini} data-rel={rel.tier}>
              {t(RELIABILITY_LABEL_KEYS[rel.tier])}
            </span>
          </span>
        </th>
        <td data-label={laneColText}>{sector || "–"}</td>
        <td data-label={t("siUniverseColTier")}>
          <TierBadge cls={group.class} />
        </td>
        <td data-label={t("siUniverseColRegime")}>
          <RegimeCell group={group} />
        </td>
        <td data-label={t("siUniverseColFresh")}>
          <span className={styles.fresh}>{t(fresh.key, fresh.params)}</span>
        </td>
        <td data-label={t("siUniverseColRs60")}>
          <span className={styles.num} data-sign={signOf(rs60Of(group))}>
            {fmtSigned(rs60Of(group))}
          </span>
        </td>
        <td data-label={t("siUniverseColN")}>
          <span className={styles.num}>{fmtCount(group.n_priced, t("siUniverseNotStated"))}</span>
        </td>
      </tr>
      {open && (
        <tr className={styles.detailRow}>
          <td colSpan={7}>
            <div id={detailId} className={styles.detailBody}>
              <MembersList
                group={group}
                expanded={allShown}
                onToggleMore={onToggleAll}
                onNavigate={onNavigate}
              />
              <DetailLink href={detailHref(id, group)} name={label} onNavigate={onNavigate} />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function MembersList({
  group,
  expanded,
  onToggleMore,
  onNavigate,
}: {
  group: UniverseGroup;
  expanded: boolean;
  onToggleMore?: () => void;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  const { shown, hidden } = membersPreview(group.members, expanded);
  if (shown.length === 0) return null;
  const collapsible = group.members.length > MEMBERS_PREVIEW && onToggleMore;
  return (
    <div className={styles.members}>
      <p className={styles.memberUnits}>{t("siUniverseMemberUnits")}</p>
      <ul className={styles.memberList}>
        {shown.map((m, i) => (
          <li key={`${m.ticker}-${i}`} className={styles.member}>
            <span className={styles.mName}>{m.ticker}</span>
            {/* Owner-carried emergence marker (v1.1 R6-09): chip only, shown
                when the owner flagged the member; the chip becomes the
                company-evidence link when a destination is carried. */}
            <EmergenceMark
              variant="chip"
              emerging={m.emerging}
              href={m.emergence_href}
              onNavigate={onNavigate}
            />
            <span className={styles.mWeight}>{fmtWeight(m.stock_weight)}</span>
            <span className={styles.mVs} data-sign={signOf(m.vs_basket)}>
              {fmtSigned(m.vs_basket)}
            </span>
          </li>
        ))}
      </ul>
      {collapsible && hidden > 0 && (
        <button type="button" className={styles.more} onClick={onToggleMore}>
          {t("siCallsShowMore", { n: hidden })}
        </button>
      )}
      {collapsible && expanded && (
        <button type="button" className={styles.more} onClick={onToggleMore}>
          {t("siCallsShowLess")}
        </button>
      )}
    </div>
  );
}

function DetailLink({
  href,
  name,
  onNavigate,
}: {
  href: string | undefined;
  name: string;
  onNavigate?: (href: string) => void;
}) {
  const t = useSectorDepthT();
  if (!href) return null;
  const text = t("siUniverseDetail", { name });
  if (onNavigate) {
    return (
      <button type="button" className={styles.detail} onClick={() => onNavigate(href)}>
        {text}
      </button>
    );
  }
  return (
    <a className={styles.detail} href={href}>
      {text}
    </a>
  );
}

function signOf(v: number | null | undefined): "up" | "down" | undefined {
  if (v == null || !Number.isFinite(v)) return undefined;
  return v > 0 ? "up" : v < 0 ? "down" : undefined;
}

function fmtSigned(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function fmtWeight(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "–";
  return Number(v.toFixed(2)).toString();
}
