import { useId } from "react";

export function BrandMark({ size = 28 }: { size?: number }) {
  const gradientId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4d82ff" />
          <stop offset="1" stopColor="#2962ff" />
        </linearGradient>
      </defs>
      <rect x="3" y="3" width="34" height="34" rx="8" fill={`url(#${gradientId})`} />
      <rect x="3.6" y="3.6" width="32.8" height="32.8" rx="7.4" fill="none" stroke="#fff" strokeOpacity=".22" />
      <path d="M13 28 L13 14.5 L20 22 L27 12.5 L27 28" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <span className="brand">
      <BrandMark />
      <span className="wm">
        <b>MASTERMIND</b>
        <small>TERMINAL</small>
      </span>
    </span>
  );
}
