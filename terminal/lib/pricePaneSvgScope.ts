const SVG_NS = "http://www.w3.org/2000/svg";

export interface PricePaneSvgScopeOptions {
  id: string;
  width: number;
  top: number;
  height: number;
  scope: string;
}

export interface PricePaneSvgScope {
  clipPath: SVGClipPathElement;
  scope: SVGGElement;
  group: SVGGElement;
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Append one pane-bounded drawing surface to a chart-wide overlay SVG.
 * The outer group clips in root coordinates; the inner group translates
 * pane-local drawings into that root coordinate space.
 */
export function appendPricePaneSvgScope(
  svg: SVGSVGElement,
  options: PricePaneSvgScopeOptions,
): PricePaneSvgScope {
  const width = finiteNonNegative(options.width);
  const top = finiteNonNegative(options.top);
  const height = finiteNonNegative(options.height);

  const defs = document.createElementNS(SVG_NS, "defs");
  const clipPath = document.createElementNS(SVG_NS, "clipPath");
  clipPath.setAttribute("id", options.id);
  clipPath.setAttribute("clipPathUnits", "userSpaceOnUse");

  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", "0");
  rect.setAttribute("y", String(top));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  clipPath.appendChild(rect);
  defs.appendChild(clipPath);

  const scope = document.createElementNS(SVG_NS, "g");
  scope.setAttribute("clip-path", `url(#${options.id})`);
  scope.setAttribute("data-price-pane-scope", options.scope);
  scope.setAttribute("data-pane-top", String(top));
  scope.setAttribute("data-pane-height", String(height));

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", `translate(0 ${top})`);
  group.setAttribute("data-price-pane-local", options.scope);
  scope.appendChild(group);

  svg.appendChild(defs);
  svg.appendChild(scope);
  return { clipPath, scope, group };
}
