"use client";
import { useMemo, useState } from "react";
import MobileSheet from "@/components/ui/MobileSheet";
import { useT } from "@/lib/i18n";
import type { DrawKind } from "@/lib/drawings";
import { getDrawingTool, type RegisteredDrawingTool } from "@/lib/drawingTools";
import {
  DRAWING_SHEET_CATEGORIES,
  drawingSheetTools,
  pushDrawRecent,
  readDrawRecents,
  type DrawingSheetCategoryId,
} from "@/lib/drawingTaxonomy";

export type DrawingsSheetProps = {
  open: boolean;
  onClose: () => void;
  /** The armed tool, so its tile reads as selected. */
  activeTool: DrawKind | null;
  /**
   * Activates the tool through the dock's own code path; the sheet then closes itself. Return
   * `false` when the parent refuses it (drawings not ready, creation disabled) so the tool is
   * not recorded as recently used.
   */
  onPick: (id: DrawKind) => boolean | void;
};

// TV presents Drawings at ~62% of the screen with the chart still live above it (IMG_2366) and
// drags the grabber to full; apps/ios ships the same pair as [.fraction(0.62), .large].
const DETENTS = [62, 96] as const;

/**
 * The phone "Drawings" sheet — TV's anatomy measured from IMG_2366-68: grabber · title + circled
 * close · search pill · horizontally scrollable category pills · 3-column tile grid, presented at
 * the 62% detent over a live chart. Content is OUR registry only (lib/drawingTaxonomy.ts maps the
 * nine engine families onto TV's five tabs), so there is no tile that does nothing.
 *
 * MobileSheet supplies the grabber, focus containment, scrim and the two-detent drag; everything
 * below the title is this surface's own anatomy (.mdraw-*).
 */
export default function DrawingsSheet({ open, onClose, activeTool, onPick }: DrawingsSheetProps) {
  const t = useT();
  const [category, setCategory] = useState<DrawingSheetCategoryId>("trendlines");
  const [query, setQuery] = useState("");
  const [recents, setRecents] = useState<DrawKind[]>([]);
  const [wasOpen, setWasOpen] = useState(open);

  // Recents are re-read on each PRESENTATION rather than once at mount: the dock, a shortcut or
  // the native bridge can arm a tool while the sheet is closed. React's documented
  // adjust-state-on-prop-change pattern — an effect here would cost an extra committed frame.
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setRecents(readDrawRecents());
      setQuery("");
    }
  }

  const favorites = useMemo(
    () => recents.map((id) => getDrawingTool(id)).filter((tool): tool is RegisteredDrawingTool => !!tool),
    [recents],
  );

  const needle = query.trim().toLowerCase();
  const tools = useMemo(() => {
    // A live query searches the whole engine inventory — TV filters tiles, not the current tab.
    const pool = needle
      ? DRAWING_SHEET_CATEGORIES.flatMap((entry) => drawingSheetTools(entry.id))
      : category === "favorites" ? favorites : drawingSheetTools(category);
    if (!needle) return pool;
    return pool.filter((tool) =>
      tool.label.toLowerCase().includes(needle) || t(tool.labelKey).toLowerCase().includes(needle));
  }, [category, favorites, needle, t]);

  const pick = (tool: RegisteredDrawingTool) => {
    // Favorites list what the user actually drew with: a refused pick leaves recents untouched.
    if (onPick(tool.id) !== false) setRecents(pushDrawRecent(tool.id));
    onClose();
  };

  // `title` carries the text alone — the close button is a sibling below it, so the dialog's
  // accessible name stays "Drawings" rather than picking up the button's label through
  // aria-labelledby.
  return (
    <MobileSheet
      open={open}
      onClose={onClose}
      className="mdraw-sheet"
      detents={DETENTS}
      title={t("drawSheetTitle")}
    >
      <button className="mdraw-close" onClick={onClose} aria-label={t("sheetClose")} data-testid="drawings-sheet-close">
        <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>
      </button>
      {/* Search + category pills stay put while only the tile grid scrolls (TV). */}
      <div className="mdraw-top">
        <div className="mdraw-search">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("drawSearch")}
            aria-label={t("drawSearch")}
            data-testid="drawings-sheet-search"
            data-no-sheet-drag
          />
        </div>
        <div className="mdraw-cats" role="tablist" aria-label={t("drawSheetTitle")}>
          {DRAWING_SHEET_CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              role="tab"
              aria-selected={!needle && category === entry.id}
              className={`mdraw-cat${!needle && category === entry.id ? " on" : ""}`}
              data-testid={`drawings-cat-${entry.id}`}
              onClick={() => { setQuery(""); setCategory(entry.id); }}
            >
              {t(entry.labelKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="mdraw-grid" data-testid="drawings-sheet-grid">
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`mdraw-tile${activeTool === tool.id ? " on" : ""}`}
            data-tool-id={tool.id}
            data-testid={`drawings-tile-${tool.id}`}
            onClick={() => pick(tool)}
          >
            <svg className="mdraw-tile-ic" viewBox="0 0 24 24" aria-hidden="true"><path d={tool.iconPath} /></svg>
            <span>{t(tool.labelKey)}</span>
          </button>
        ))}
      </div>
      {tools.length === 0 && (
        <div className="mdraw-empty">
          {category === "favorites" && !needle ? t("drawNoRecents") : t("drawNoMatches")}
        </div>
      )}
    </MobileSheet>
  );
}
