/** Actual renderer geometry. Kept self-contained so Playwright can serialize it.
 * Native pane canvases contain their axis; LWC has a separate center-cell canvas.
 * mm's readback comes from the completed paint, never from configured axis options.
 */
export function readNativeChartGeometry(wrap: Element) {
  const rect = (r: { x: number; y: number; width: number; height: number }) => ({
    x: r.x, y: r.y, width: r.width, height: r.height,
    left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height,
  });
  const root = rect(wrap.getBoundingClientRect());
  const mm = wrap.querySelector<HTMLElement>("[data-mm-chart]");
  const table = wrap.querySelector<HTMLTableElement>(".tv-lightweight-charts table");
  const native = mm ?? table;
  const rows = [...(table?.querySelectorAll("tr") ?? [])];
  const paneNodes = mm ? [...mm.querySelectorAll<HTMLElement>("[data-mm-pane]")]
    : rows.filter(row => row.querySelector("canvas")).slice(0, -1);
  const panes = paneNodes.map(node => {
    const pane = rect(node.getBoundingClientRect());
    const canvas = mm ? node.querySelector<HTMLCanvasElement>("[data-mm-pane-canvas]")
      : node.children[1]?.querySelector<HTMLCanvasElement>("canvas");
    if (!canvas) return { pane, plot: null };
    const surface = canvas.getBoundingClientRect();
    if (!mm) return { pane, plot: rect(surface) };
    const painted = canvas.dataset.mmPaintGeometry;
    if (!painted) return { pane, plot: null };
    const geometry = JSON.parse(painted) as {
      plot: { x: number; y: number; width: number; height: number };
      axis: { width: number };
    } | null;
    if (!geometry) return { pane, plot: null };
    const p = geometry.plot;
    // A resized DOM surface with an older bitmap is not a settled chart.
    if (Math.abs(p.width + geometry.axis.width - surface.width) > 1 || Math.abs(p.height - surface.height) > 1)
      return { pane, plot: null };
    return { pane, plot: rect({ x: surface.x + p.x, y: surface.y + p.y, width: p.width, height: p.height }) };
  });
  const separators = (mm ? [...mm.querySelectorAll<HTMLElement>("[data-mm-separator]")]
    : rows.filter(row => !row.querySelector("canvas")))
    .map(node => rect(node.getBoundingClientRect())).filter(r => r.height > 0);
  const body = wrap.closest<HTMLElement>(".chart-body");
  const style = body ? getComputedStyle(body) : null;
  const subpanes = style?.getPropertyValue("--subpanes").trim() ?? "";
  return {
    engine: mm ? "mm" : table ? "lwc" : null, root, panes, separators, subpanes,
    hostHeight: style?.getPropertyValue("--drawing-host-height").trim() ?? "",
    declared: body ? Number.parseInt(subpanes || "0", 10) : -1,
    drawn: panes.every(p => p.plot !== null) ? panes.length - 1 : -1,
    fills: !!native && Math.abs(native.getBoundingClientRect().height - root.height) <= 1,
  };
}
