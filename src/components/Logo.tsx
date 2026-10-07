"use client";

import { useId } from "react";

/**
 * The Veritome mark: a V folded from two gradient ribbons that meet in a knot.
 * "intro" draws the ribbons in, then light keeps running down them; "idle" only runs the light; "static" never moves.
 */
export function LogoMark({ size = 26, mode = "idle", className }: { size?: number; mode?: "intro" | "idle" | "static"; className?: string }) {
  const g = useId().replace(/:/g, "");
  const left = "M14 14C26 12 36 26 43 46S48 78 50 86";
  const right = "M86 14C74 12 64 26 57 46S52 78 50 86";
  const small = size < 40;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`vt-logo vt-logo-${mode}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${g}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset=".55" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
        <linearGradient id={`${g}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0abfc" />
          <stop offset=".55" stopColor="#a855f7" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
        <filter id={`${g}shadow`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#1e1b4b" floodOpacity=".45" />
        </filter>
        <filter id={`${g}glow`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.5" />
        </filter>
      </defs>
      <path className="vt-strand" pathLength={1} d={left} fill="none" stroke={`url(#${g}l)`} strokeWidth={small ? 15 : 13} strokeLinecap="round" filter={small ? undefined : `url(#${g}shadow)`} />
      <path className="vt-strand vt-s2" pathLength={1} d={right} fill="none" stroke={`url(#${g}r)`} strokeWidth={small ? 15 : 13} strokeLinecap="round" filter={small ? undefined : `url(#${g}shadow)`} />
      <path d={left} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" transform="translate(-2.5 0)" />
      <path d={right} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" transform="translate(-2.5 0)" />
      <path className="vt-run" pathLength={1} d={left} fill="none" stroke="#fff" strokeWidth={small ? 4 : 3} strokeLinecap="round" filter={`url(#${g}glow)`} />
      <path className="vt-run vt-run2" pathLength={1} d={right} fill="none" stroke="#fff" strokeWidth={small ? 4 : 3} strokeLinecap="round" filter={`url(#${g}glow)`} />
      <circle className="vt-knot" cx="50" cy="86" r={small ? 5.5 : 4.5} fill="#fff" />
    </svg>
  );
}
