type SnapshotShadow = {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
};

export type SnapshotLegendRow = {
  label: string;
  rowX: number;
  rowY: number;
  rowWidth: number;
  rowHeight: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  textX: number;
  textCenterY: number;
  color: string;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  shadow: SnapshotShadow | null;
  dot: {
    centerX: number;
    centerY: number;
    radius: number;
    color: string;
  } | null;
};

function transparent(value: string): boolean {
  const color = value.trim().toLowerCase();
  return color === "" || color === "transparent" || /rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color);
}

function parseShadow(value: string): SnapshotShadow | null {
  if (!value || value === "none") return null;
  const match = value.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+([\d.]+)px)?/i);
  if (!match) return null;
  return {
    color: match[1],
    offsetX: Number(match[2]),
    offsetY: Number(match[3]),
    blur: Number(match[4] ?? 0),
  };
}

/** Capture the actual rendered legend geometry and computed typography before raster export. */
export function captureSnapshotLegendRows(wrap: HTMLElement | null): SnapshotLegendRow[] {
  if (!wrap) return [];
  const wrapRect = wrap.getBoundingClientRect();
  const rows: SnapshotLegendRow[] = [];

  for (const row of wrap.querySelectorAll<HTMLElement>(".lg-row")) {
    const name = row.querySelector<HTMLElement>(".lg-name");
    if (!name) continue;
    const rowStyle = getComputedStyle(row);
    const nameStyle = getComputedStyle(name);
    const rowRect = row.getBoundingClientRect();
    const nameRect = name.getBoundingClientRect();
    if (
      rowStyle.display === "none"
      || rowStyle.visibility === "hidden"
      || Number(rowStyle.opacity || "1") <= 0
      || rowRect.width <= 0
      || rowRect.height <= 0
    ) continue;

    const dotEl = row.querySelector<HTMLElement>(".lg-dot");
    const dotRect = dotEl?.getBoundingClientRect();
    const dotStyle = dotEl ? getComputedStyle(dotEl) : null;
    const dot = dotRect && dotRect.width > 0 && dotRect.height > 0 && dotStyle
      ? {
          centerX: dotRect.left - wrapRect.left + dotRect.width / 2,
          centerY: dotRect.top - wrapRect.top + dotRect.height / 2,
          radius: Math.min(dotRect.width, dotRect.height) / 2,
          color: dotStyle.backgroundColor || dotStyle.color,
        }
      : null;

    rows.push({
      label: name.textContent?.trim() ?? "",
      rowX: rowRect.left - wrapRect.left,
      rowY: rowRect.top - wrapRect.top,
      rowWidth: rowRect.width,
      rowHeight: rowRect.height,
      backgroundColor: rowStyle.backgroundColor,
      borderColor: rowStyle.borderColor,
      borderWidth: Number.parseFloat(rowStyle.borderTopWidth) || 0,
      borderRadius: Number.parseFloat(rowStyle.borderTopLeftRadius) || 0,
      textX: nameRect.left - wrapRect.left,
      textCenterY: nameRect.top - wrapRect.top + nameRect.height / 2,
      color: nameStyle.color,
      fontSize: Number.parseFloat(nameStyle.fontSize) || 12,
      fontWeight: nameStyle.fontWeight || "500",
      fontFamily: nameStyle.fontFamily || "system-ui, sans-serif",
      shadow: parseShadow(nameStyle.textShadow),
      dot,
    });
  }
  return rows.filter((row) => row.label !== "");
}

export function paintSnapshotLegendRows(
  context: CanvasRenderingContext2D,
  rows: readonly SnapshotLegendRow[],
  options: { scale: number; chartBodyTop: number },
): void {
  const { scale, chartBodyTop } = options;
  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";

  for (const row of rows) {
    const x = row.rowX * scale;
    const y = chartBodyTop + row.rowY * scale;
    const width = row.rowWidth * scale;
    const height = row.rowHeight * scale;
    const radius = Math.max(0, row.borderRadius * scale);

    if (!transparent(row.backgroundColor)) {
      context.fillStyle = row.backgroundColor;
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
      context.fill();
    }
    if (row.borderWidth > 0 && !transparent(row.borderColor)) {
      context.strokeStyle = row.borderColor;
      context.lineWidth = row.borderWidth * scale;
      context.beginPath();
      context.roundRect(x, y, width, height, radius);
      context.stroke();
    }

    if (row.dot && !transparent(row.dot.color)) {
      context.fillStyle = row.dot.color;
      context.beginPath();
      context.arc(
        row.dot.centerX * scale,
        chartBodyTop + row.dot.centerY * scale,
        row.dot.radius * scale,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    context.font = `${row.fontWeight} ${row.fontSize * scale}px ${row.fontFamily}`;
    context.fillStyle = row.color;
    if (row.shadow) {
      context.shadowColor = row.shadow.color;
      context.shadowOffsetX = row.shadow.offsetX * scale;
      context.shadowOffsetY = row.shadow.offsetY * scale;
      context.shadowBlur = row.shadow.blur * scale;
    }
    context.fillText(row.label, row.textX * scale, chartBodyTop + row.textCenterY * scale);
    context.shadowColor = "transparent";
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
    context.shadowBlur = 0;
  }

  context.restore();
}
