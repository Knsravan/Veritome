"use client";

import { useId } from "react";

/** Brand gradient: indigo to violet, with the report's underline colours as accents. */
function Grad({ id, from = "#6366f1", to = "#8b5cf6" }: { id: string; from?: string; to?: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

export interface MarkProps {
  size?: number;
  /** "intro" plays the entrance; "idle" only the gentle loop; "static" for favicons. */
  mode?: "intro" | "idle" | "static";
}

const cls = (mode: MarkProps["mode"]) => `ll-mark ll-${mode ?? "intro"}`;

/** 1. Proof Page: a page with a folded corner and a tick that writes itself. */
export function ProofPage({ size = 64, mode }: MarkProps) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`${cls(mode)} ll-proof`} aria-hidden>
      <defs>
        <Grad id={`${g}a`} />
      </defs>
      <g className="ll-proof-page">
        <path d="M17 5h21l15 15v32a7 7 0 0 1-7 7H17a7 7 0 0 1-7-7V12a7 7 0 0 1 7-7z" fill={`url(#${g}a)`} />
        <path className="ll-proof-fold" d="M38 5v10a5 5 0 0 0 5 5h10z" fill="#fff" fillOpacity=".38" />
        <rect className="ll-line" x="18" y="17" width="14" height="3.2" rx="1.6" fill="#fff" fillOpacity=".55" />
        <rect className="ll-line ll-d1" x="18" y="24" width="22" height="3.2" rx="1.6" fill="#fff" fillOpacity=".4" />
      </g>
      <path className="ll-draw" pathLength={1} d="M20 40l7.5 7.5L44 31" fill="none" stroke="#fff" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 2. Truth Lens: a magnifying lens with a V inside; a glint sweeps the glass. */
export function TruthLens({ size = 64, mode }: MarkProps) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`${cls(mode)} ll-lens`} aria-hidden>
      <defs>
        <Grad id={`${g}a`} />
        <clipPath id={`${g}c`}>
          <circle cx="27" cy="27" r="17" />
        </clipPath>
      </defs>
      <g className="ll-lens-body">
        <circle cx="27" cy="27" r="19" fill="none" stroke={`url(#${g}a)`} strokeWidth="6.5" />
        <path d="M41 41l14 14" stroke={`url(#${g}a)`} strokeWidth="8" strokeLinecap="round" />
        <g clipPath={`url(#${g}c)`}>
          <circle cx="27" cy="27" r="17" fill="#6366f1" fillOpacity=".1" />
          <rect className="ll-glint" x="-6" y="0" width="7" height="60" fill="#fff" fillOpacity=".55" transform="rotate(25 27 27)" />
        </g>
      </g>
      <path className="ll-draw" pathLength={1} d="M19 20l8 15 8-15" fill="none" stroke={`url(#${g}a)`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 3. Underline V: the letter V over three underlines in the report's own styles (solid, wavy, dashed). */
export function UnderlineV({ size = 64, mode }: MarkProps) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`${cls(mode)} ll-uv`} aria-hidden>
      <defs>
        <Grad id={`${g}a`} />
      </defs>
      <path className="ll-draw" pathLength={1} d="M14 9l18 32L50 9" fill="none" stroke={`url(#${g}a)`} strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path className="ll-ul ll-u1" pathLength={1} d="M12 47h40" stroke="#e0a100" strokeWidth="3.4" strokeLinecap="round" />
      <path className="ll-ul ll-u2" pathLength={1} d="M12 53.5q2.5-3 5 0t5 0 5 0 5 0 5 0 5 0 5 0 5 0" fill="none" stroke="#8b5cf6" strokeWidth="2.6" strokeLinecap="round" />
      <path className="ll-ul ll-u3" pathLength={1} d="M12 60h40" stroke="#0f9f8f" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.12 0.06" />
    </svg>
  );
}

/** 4. Open Tome: a book opening into a V, with a bookmark ribbon that drops in. */
export function OpenTome({ size = 64, mode }: MarkProps) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`${cls(mode)} ll-tome`} aria-hidden>
      <defs>
        <Grad id={`${g}a`} />
        <Grad id={`${g}b`} from="#818cf8" to="#a78bfa" />
      </defs>
      <path className="ll-tome-left" d="M32 18C24 11 14 10 5 12v38c9-2 19-1 27 6z" fill={`url(#${g}a)`} />
      <path className="ll-tome-right" d="M32 18c8-7 18-8 27-6v38c-9-2-19-1-27 6z" fill={`url(#${g}b)`} />
      <path d="M32 18v38" stroke="#fff" strokeOpacity=".6" strokeWidth="1.6" />
      <path className="ll-line" d="M11 24c5-1 10 0 15 3M11 31c5-1 10 0 15 3" stroke="#fff" strokeOpacity=".5" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path className="ll-ribbon" d="M43 6h9v20l-4.5-3.5L43 26z" fill="#e0a100" />
      <path className="ll-draw" pathLength={1} d="M38 36l5 5 9-10" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 5. Scan Tile: an app-style tile with a V-tick and a scanning beam passing over it. */
export function ScanTile({ size = 64, mode }: MarkProps) {
  const g = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`${cls(mode)} ll-scan`} aria-hidden>
      <defs>
        <Grad id={`${g}a`} from="#4f46e5" to="#9333ea" />
        <linearGradient id={`${g}beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#fff" stopOpacity=".55" />
        </linearGradient>
        <clipPath id={`${g}c`}>
          <rect x="4" y="4" width="56" height="56" rx="16" />
        </clipPath>
      </defs>
      <rect className="ll-scan-tile" x="4" y="4" width="56" height="56" rx="16" fill={`url(#${g}a)`} />
      <g clipPath={`url(#${g}c)`}>
        <rect className="ll-beam" x="4" y="-20" width="56" height="18" fill={`url(#${g}beam)`} />
        <path d="M4 4h56v16H4z" fill="#fff" fillOpacity=".07" />
      </g>
      <path className="ll-draw" pathLength={1} d="M17 23l11 20 19-27" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 6. Verity Seal: a scalloped seal stamped onto the page, its ring turning slowly. */
export function VeritySeal({ size = 64, mode }: MarkProps) {
  const g = useId();
  const points = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    const r = i % 2 ? 26 : 29.5;
    return `${(32 + r * Math.cos(a)).toFixed(2)},${(32 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={`${cls(mode)} ll-seal`} aria-hidden>
      <defs>
        <Grad id={`${g}a`} />
      </defs>
      <g className="ll-seal-body">
        <polygon points={points} fill={`url(#${g}a)`} />
        <circle className="ll-seal-ring" cx="32" cy="32" r="20.5" fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth="1.6" strokeDasharray="3 2.4" />
        <path className="ll-draw" pathLength={1} d="M22.5 31.5l6.5 7 13-14" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export const LOGOS = [
  { id: 1, name: "Proof Page", Mark: ProofPage, idea: "A paper with a folded corner and a tick that writes itself: “your paper, checked”. Closest to today’s logo, refined." },
  { id: 2, name: "Truth Lens", Mark: TruthLens, idea: "A magnifying lens with a V inside, and a glint across the glass: looking closely for the truth (veritas)." },
  { id: 3, name: "Underline V", Mark: UnderlineV, idea: "The letter V over three underlines in the report’s own styles: solid, wavy and dashed. Unique to Veritome." },
  { id: 4, name: "Open Tome", Mark: OpenTome, idea: "An open book (the “tome” in Veritome) with a bookmark ribbon and a tick: knowledge you can trust." },
  { id: 5, name: "Scan Tile", Mark: ScanTile, idea: "An app-style tile with a V that is also a tick, and a scanning beam passing over it. Strongest as an app icon." },
  { id: 6, name: "Verity Seal", Mark: VeritySeal, idea: "A scalloped seal stamped on with a tick, its ring turning slowly: a certificate of originality." },
] as const;
