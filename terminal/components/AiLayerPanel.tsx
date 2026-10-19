"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { groupAiDrawings, type AiLayerController, type AiDrawingGroup } from "@/lib/chartAiLayer";
import { getDrawingTool } from "@/lib/drawingTools";
import { useT } from "@/lib/i18n";
import styles from "./AiLayerPanel.module.css";

function Icon({ kind }: { kind: "eye" | "hidden" | "remove" | "chevron" | "spark" }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {kind === "eye" ? <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
      : kind === "hidden" ? <><path d="m3 3 18 18M9 5.5A12 12 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-3 3.8M6.3 6.3A21 21 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.2-1.4" /></>
      : kind === "remove" ? <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7" />
      : kind === "chevron" ? <path d="m9 5 7 7-7 7" />
      : <path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z" />}
  </svg>;
}

/** Chart-local view of useChartBus's existing store; the panel never owns drawings. */
export default function AiLayerPanel({ layer }: { layer: AiLayerController }) {
  const t = useT();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => groupAiDrawings(layer.objects), [layer.objects]);

  // Indicator rows and the responsive chart header already determine our position.
  // Bound the panel to its chart as well as the viewport; a phone's chart can be
  // much shorter than the page. The list scrolls without pushing controls below it.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const trigger = triggerRef.current;
      if (!trigger || !rootRef.current) return;
      const chartBottom = rootRef.current.closest(".chart-wrap")?.getBoundingClientRect().bottom ?? window.innerHeight;
      const available = Math.min(window.innerHeight - 12, chartBottom - 8) - trigger.getBoundingClientRect().bottom - 5;
      rootRef.current.style.setProperty("--ai-panel-height", `${Math.max(0, available)}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (rootRef.current?.parentElement) observer.observe(rootRef.current.parentElement);
    const chart = rootRef.current?.closest(".chart-wrap");
    if (chart) observer.observe(chart);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open]);

  const label = (group: AiDrawingGroup) => {
    if (group.op === "draw.risk_box") return t("aiScenario");
    const tool = getDrawingTool(group.op.slice(5)) ?? getDrawingTool(group.objects[0]?.kind);
    return tool ? t(tool.labelKey, tool.label) : t("aiDrawing");
  };
  const title = (group: AiDrawingGroup) => group.caption || label(group);
  const remove = (ids: readonly string[]) => {
    // Removing the currently focused row must not leave keyboard focus in the chart.
    triggerRef.current?.focus({ preventScroll: true });
    layer.editObjects(ids, "remove");
  };

  return <div ref={rootRef} className={styles.root} data-ai-layer="true"
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape" && open) { setOpen(false); triggerRef.current?.focus(); }
    }}>
    <div className={styles.bar}>
      <button ref={triggerRef} type="button" className={styles.trigger}
        aria-expanded={open} aria-controls={panelId} title={t("aiLayerTip")}
        onClick={() => setOpen(value => !value)}>
        <span className={styles.spark}><Icon kind="spark" /></span>
        <span>{t("aiLayer")}</span>
        <span className={styles.count}>{groups.length}</span>
        <span className={`${styles.chevron} ${open ? styles.expanded : ""}`}><Icon kind="chevron" /></span>
      </button>
      {groups.length > 0 && <button type="button" className={styles.iconButton}
        aria-label={layer.hidden ? t("aiShow") : t("aiHide")}
        title={layer.hidden ? t("aiShow") : t("aiHide")}
        onClick={layer.toggleHidden}><Icon kind={layer.hidden ? "hidden" : "eye"} /></button>}
    </div>
    {open && <section id={panelId} className={styles.panel} aria-label={t("aiLayerTip")}>
      <div className={styles.summary}>
        <span>{t("aiDrawingCount")
          .replace("{drawings}", t(groups.length === 1 ? "drawingCountOne" : "drawingCountMany").replace("{n}", String(groups.length)))
          .replace("{elements}", t(layer.objects.length === 1 ? "aiElementCountOne" : "aiElementCountMany").replace("{n}", String(layer.objects.length)))}</span>
        {groups.length > 0 && <button type="button" className={styles.clear} onClick={() => {
          triggerRef.current?.focus({ preventScroll: true }); layer.clear();
        }}>{t("aiClearAll")}</button>}
      </div>
      {layer.hidden && groups.length > 0 && <div className={styles.notice}>
        <span>{t("aiLayerHidden")}</span>
        <button type="button" onClick={layer.toggleHidden}>{t("aiShowAll")}</button>
      </div>}
      {groups.length === 0 ? <p className={styles.empty}>{t("aiLayerEmpty")}</p> :
        <ul className={styles.list} aria-label={t("aiDrawingList")}>
          {groups.map(group => {
            const ids = group.objects.map(object => object.id);
            const allHidden = group.objects.every(object => object.hidden);
            const someHidden = !allHidden && group.objects.some(object => object.hidden);
            const isExpanded = expanded.has(group.id);
            const groupTitle = title(group);
            const childrenId = `${panelId}-${group.id}`;
            return <li key={group.id} className={styles.group} data-ai-drawing-id={group.id}>
              <div className={`${styles.row} ${allHidden || layer.hidden ? styles.isHidden : ""}`}>
                {ids.length > 1 ? <button type="button" className={styles.iconButton}
                  aria-label={`${isExpanded ? t("aiCollapseElements") : t("aiExpandElements")}: ${groupTitle}`}
                  aria-expanded={isExpanded} aria-controls={childrenId}
                  onClick={() => setExpanded(current => {
                    const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next;
                  })}><span className={`${styles.chevron} ${isExpanded ? styles.expanded : ""}`}><Icon kind="chevron" /></span></button>
                  : <span className={styles.swatch} style={{ background: group.objects[0]?.color }} aria-hidden="true" />}
                <div className={styles.name}>
                  <span className={styles.caption} title={groupTitle}>{groupTitle}</span>
                  <span className={styles.detail}>{label(group)}{ids.length > 1 ? ` · ${ids.length} ${t("aiElements")}` : ""}{someHidden ? ` · ${t("aiPartlyHidden")}` : ""}</span>
                </div>
                <button type="button" className={styles.iconButton} disabled={layer.hidden}
                  aria-label={`${allHidden ? t("aiShowDrawing") : t("aiHideDrawing")}: ${groupTitle}`}
                  title={layer.hidden ? t("aiLayerHidden") : allHidden ? t("aiShowDrawing") : t("aiHideDrawing")}
                  onClick={() => layer.editObjects(ids, allHidden ? "show" : "hide")}><Icon kind={allHidden ? "hidden" : "eye"} /></button>
                <button type="button" className={`${styles.iconButton} ${styles.remove}`}
                  aria-label={`${t("aiRemoveDrawing")}: ${groupTitle}`} title={t("aiRemoveDrawing")}
                  onClick={() => remove(ids)}><Icon kind="remove" /></button>
              </div>
              {isExpanded && ids.length > 1 && <ul id={childrenId} className={styles.children}>
                {group.objects.map((object, index) => {
                  const tool = getDrawingTool(object.kind);
                  const elementTitle = `${index + 1}. ${tool ? t(tool.labelKey, tool.label) : t("aiDrawing")}`;
                  return <li key={object.id} className={`${styles.row} ${object.hidden || layer.hidden ? styles.isHidden : ""}`} data-ai-element-id={object.id}>
                    <span className={styles.elementName}>{elementTitle}</span>
                    <button type="button" className={styles.iconButton} disabled={layer.hidden}
                      aria-label={`${object.hidden ? t("aiShowElement") : t("aiHideElement")}: ${groupTitle}, ${elementTitle}`}
                      title={layer.hidden ? t("aiLayerHidden") : object.hidden ? t("aiShowElement") : t("aiHideElement")}
                      onClick={() => layer.editObjects([object.id], object.hidden ? "show" : "hide")}><Icon kind={object.hidden ? "hidden" : "eye"} /></button>
                    <button type="button" className={`${styles.iconButton} ${styles.remove}`}
                      aria-label={`${t("aiRemoveElement")}: ${groupTitle}, ${elementTitle}`} title={t("aiRemoveElement")}
                      onClick={() => remove([object.id])}><Icon kind="remove" /></button>
                  </li>;
                })}
              </ul>}
            </li>;
          })}
        </ul>}
    </section>}
  </div>;
}
