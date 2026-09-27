"use client";

import { useEffect, useRef } from "react";

const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 54;
const BASELINE = 27;
const POINTS = 84;
const TAU = Math.PI * 2;

type Point = { x: number; y: number };

function waveY(x: number, seconds: number): number {
  const normalizedX = x / VIEWBOX_WIDTH;

  // Three independently moving harmonics make the geometry itself evolve.
  // This is deliberately NOT a translated static path: phase, amplitude and
  // wavelength interactions all change over time, so crests form/dissolve and
  // the ribbon visibly "waves" in place like the approved mockup.
  const primaryAmp = 6.45 + Math.sin(seconds * 0.72) * 1.45;
  const secondaryAmp = 2.65 + Math.sin(seconds * 0.49 + 1.1) * 0.65;
  const detailAmp = 1.05 + Math.sin(seconds * 0.91 + 2.2) * 0.34;

  return BASELINE
    + Math.sin(normalizedX * TAU * 4.35 + seconds * 1.12) * primaryAmp
    + Math.sin(normalizedX * TAU * 2.05 - seconds * 0.73 + 1.35) * secondaryAmp
    + Math.sin(normalizedX * TAU * 7.4 + seconds * 1.58 + 0.45) * detailAmp;
}

function buildWavePath(seconds: number): string {
  const points: Point[] = [];
  for (let i = 0; i <= POINTS; i += 1) {
    const x = (i / POINTS) * VIEWBOX_WIDTH;
    points.push({ x, y: waveY(x, seconds) });
  }

  // Catmull-Rom -> cubic Bézier conversion gives a continuous smooth ribbon
  // while still letting the sampled sine field morph every animation frame.
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

export default function SettingsAuroraWave({
  active,
  openSeq,
}: {
  active: boolean;
  openSeq: number;
}) {
  const haloRef = useRef<SVGPathElement>(null);
  const bloomRef = useRef<SVGPathElement>(null);
  const coreRef = useRef<SVGPathElement>(null);
  const shimmerRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const paths = [haloRef.current, bloomRef.current, coreRef.current, shimmerRef.current]
      .filter((path): path is SVGPathElement => path !== null);
    if (!paths.length) return;

    const render = (seconds: number) => {
      const d = buildWavePath(seconds);
      for (const path of paths) path.setAttribute("d", d);
    };

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    render(0.85);

    if (!active || reducedMotion.matches) return;

    let frame = 0;
    let previous = 0;
    const started = performance.now();

    const tick = (now: number) => {
      // ~45 fps is visually fluid for a 1px ribbon while avoiding needless
      // full-refresh work when Settings is open on a high-refresh display.
      if (now - previous >= 22) {
        previous = now;
        render((now - started) / 1000 + 0.85);
      }
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, openSeq]);

  return (
    <div
      className="acs-aurora"
      aria-hidden="true"
      data-aurora-active={active ? "true" : "false"}
      data-testid="settings-aurora"
    >
      <svg
        className="acs-aurora-svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="none"
        focusable="false"
      >
        <defs>
          <linearGradient
            id="acs-aurora-gradient"
            x1="0"
            y1="0"
            x2={VIEWBOX_WIDTH}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#2f69ff" />
            <stop offset="12%" stopColor="#438dff" />
            <stop offset="28%" stopColor="#7868ff" />
            <stop offset="40%" stopColor="#b16cff" />
            <stop offset="56%" stopColor="#4c72ff" />
            <stop offset="72%" stopColor="#40d7ff" />
            <stop offset="84%" stopColor="#6998ff" />
            <stop offset="100%" stopColor="#a463ff" />
          </linearGradient>

          <linearGradient
            id="acs-aurora-shimmer-gradient"
            x1="0"
            y1="0"
            x2={VIEWBOX_WIDTH}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="36%" stopColor="#dff7ff" stopOpacity=".12" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity=".95" />
            <stop offset="64%" stopColor="#d7e9ff" stopOpacity=".16" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>

          <filter
            id="acs-aurora-halo-filter"
            x="-8%"
            y="-260%"
            width="116%"
            height="620%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="5.6" />
          </filter>
          <filter
            id="acs-aurora-bloom-filter"
            x="-6%"
            y="-180%"
            width="112%"
            height="460%"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur stdDeviation="2.5" />
          </filter>
        </defs>

        <path ref={haloRef} className="acs-aurora-path acs-aurora-halo" />
        <path ref={bloomRef} className="acs-aurora-path acs-aurora-bloom" />
        <path ref={coreRef} className="acs-aurora-path acs-aurora-core" />
        <path ref={shimmerRef} className="acs-aurora-path acs-aurora-shimmer" />
      </svg>
    </div>
  );
}
