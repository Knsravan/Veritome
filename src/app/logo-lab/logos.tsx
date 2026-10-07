"use client";

import { useId } from "react";

export interface MarkProps {
  size?: number;
  /** "intro" plays the entrance then loops; "idle" only loops; "static" never moves (favicons). */
  mode?: "intro" | "idle" | "static";
}

const cls = (mode: MarkProps["mode"], name: string) => `ll-mark ll-${mode ?? "intro"} ${name}`;
const polar = (r: number, deg: number, cx = 50, cy = 50) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
};
const pt = (p: readonly [number, number]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`;

/** 1. Prism: a faceted crystal V. Facets assemble, light runs across them, a spark glints at the tip. */
export function Prism({ size = 96, mode }: MarkProps) {
  const g = useId().replace(/:/g, "");
  const V = "M12 14H33L50 58L67 14H88L59 88H41Z";
  const facets: Array<[string, string, string]> = [
    ["12 14 33 14 41 88", "#a5b4fc", "#6366f1"],
    ["33 14 50 58 41 88", "#4f46e5", "#312e81"],
    ["67 14 50 58 59 88", "#7c3aed", "#4c1d95"],
    ["67 14 88 14 59 88", "#e9d5ff", "#a855f7"],
    ["41 88 50 58 59 88", "#c084fc", "#6d28d9"],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cls(mode, "ll-prism")} aria-hidden>
      <defs>
        {facets.map(([, a, b], i) => (
          <linearGradient key={i} id={`${g}f${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        ))}
        <linearGradient id={`${g}glow`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <filter id={`${g}blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <clipPath id={`${g}clip`}>
          <path d={V} />
        </clipPath>
        <linearGradient id={`${g}sheen`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="ll-glow" d={V} fill={`url(#${g}glow)`} filter={`url(#${g}blur)`} opacity=".55" />
      {facets.map(([p], i) => (
        <polygon key={i} className={`ll-facet ll-f${i}`} points={p} fill={`url(#${g}f${i})`} />
      ))}
      <path d={V} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth=".8" strokeLinejoin="round" />
      <path d="M33 14L50 58L67 14M50 58L41 88M50 58L59 88" fill="none" stroke="#fff" strokeOpacity=".25" strokeWidth=".6" />
      <g clipPath={`url(#${g}clip)`}>
        <rect className="ll-sheen" x="-40" y="0" width="26" height="100" fill={`url(#${g}sheen)`} transform="skewX(-22)" />
      </g>
      <path className="ll-spark" d="M84 6l1.6 4.4L90 12l-4.4 1.6L84 18l-1.6-4.4L78 12l4.4-1.6z" fill="#fff" />
    </svg>
  );
}

/** 2. Aperture: six iris blades close around a glowing V, inside a ring of ticks that turns slowly. */
export function Aperture({ size = 96, mode }: MarkProps) {
  const g = useId().replace(/:/g, "");
  const shades = ["#4f46e5", "#6366f1", "#7c3aed", "#8b5cf6", "#a855f7", "#6d28d9"];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cls(mode, "ll-aperture")} aria-hidden>
      <defs>
        {shades.map((c, i) => (
          <linearGradient key={i} id={`${g}b${i}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c} />
            <stop offset="1" stopColor="#1e1b4b" />
          </linearGradient>
        ))}
        <radialGradient id={`${g}core`}>
          <stop offset="0" stopColor="#f5f3ff" />
          <stop offset=".6" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
        <filter id={`${g}soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>
      <g className="ll-ticks">
        {Array.from({ length: 48 }, (_, i) => {
          const [x1, y1] = polar(47, i * 7.5);
          const [x2, y2] = polar(i % 4 === 0 ? 43 : 45, i * 7.5);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#a5b4fc" strokeOpacity={i % 4 === 0 ? 0.9 : 0.4} strokeWidth={i % 4 === 0 ? 1.4 : 0.8} strokeLinecap="round" />;
        })}
      </g>
      <circle cx="50" cy="50" r="40" fill="#1e1b4b" />
      {shades.map((_, i) => {
        const a = i * 60;
        const p1 = polar(40, a);
        const p2 = polar(40, a + 72);
        const q = polar(13, a + 112);
        return (
          <path
            key={i}
            className="ll-blade"
            style={{ ["--b" as string]: i }}
            d={`M${pt(p1)} A40 40 0 0 1 ${pt(p2)} L${pt(q)} Z`}
            fill={`url(#${g}b${i})`}
            stroke="#c7d2fe"
            strokeOpacity=".35"
            strokeWidth=".5"
          />
        );
      })}
      <circle cx="50" cy="50" r="40" fill="none" stroke="#c7d2fe" strokeOpacity=".5" strokeWidth=".8" />
      <circle className="ll-core" cx="50" cy="50" r="16" fill={`url(#${g}core)`} filter={`url(#${g}soft)`} />
      <path className="ll-draw" pathLength={1} d="M43 46l7 10 8-14" fill="none" stroke="#1e1b4b" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 3. Orbit: a glass sphere holding a V, circled by three orbits in the report's colours, each with a comet. */
export function Orbit({ size = 96, mode }: MarkProps) {
  const g = useId().replace(/:/g, "");
  const orbits: Array<[number, string, number]> = [
    [-30, "#f59e0b", 7],
    [30, "#22d3ee", 9],
    [90, "#e879f9", 11],
  ];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cls(mode, "ll-orbit")} aria-hidden>
      <defs>
        <radialGradient id={`${g}sphere`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#e0e7ff" />
          <stop offset=".35" stopColor="#818cf8" />
          <stop offset=".8" stopColor="#4c1d95" />
          <stop offset="1" stopColor="#1e1b4b" />
        </radialGradient>
        <radialGradient id={`${g}halo`}>
          <stop offset="0" stopColor="#8b5cf6" stopOpacity=".55" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
        <filter id={`${g}glow`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle className="ll-halo" cx="50" cy="50" r="34" fill={`url(#${g}halo)`} />
      {orbits.map(([rot, colour, dur], i) => (
        <g key={i} transform={`rotate(${rot} 50 50)`}>
          <g transform="translate(50 50) scale(1 .34)">
            <circle r="42" fill="none" stroke={colour} strokeOpacity=".55" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
            <g className="ll-comet" style={{ ["--dur" as string]: `${dur}s`, ["--delay" as string]: `${-i * 2}s` }}>
              <circle cx="42" cy="0" r="3.2" fill={colour} filter={`url(#${g}glow)`} />
            </g>
          </g>
        </g>
      ))}
      <g className="ll-sphere">
        <circle cx="50" cy="50" r="19" fill={`url(#${g}sphere)`} />
        <ellipse cx="44" cy="41" rx="8" ry="4.5" fill="#fff" fillOpacity=".55" transform="rotate(-30 44 41)" />
        <path className="ll-draw" pathLength={1} d="M42 45l8 14 8-14" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/** 4. Ribbon: a V folded from a gradient ribbon, with a point of light running along it. */
export function Ribbon({ size = 96, mode }: MarkProps) {
  const g = useId().replace(/:/g, "");
  const left = "M14 14C26 12 36 26 43 46S48 78 50 86";
  const right = "M86 14C74 12 64 26 57 46S52 78 50 86";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cls(mode, "ll-ribbon")} aria-hidden>
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
      <path className="ll-draw ll-strand" pathLength={1} d={left} fill="none" stroke={`url(#${g}l)`} strokeWidth="13" strokeLinecap="round" filter={`url(#${g}shadow)`} />
      <path className="ll-draw ll-strand ll-s2" pathLength={1} d={right} fill="none" stroke={`url(#${g}r)`} strokeWidth="13" strokeLinecap="round" filter={`url(#${g}shadow)`} />
      <path d={left} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" transform="translate(-2.5 0)" />
      <path d={right} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" transform="translate(-2.5 0)" />
      <path className="ll-run" pathLength={1} d={left} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" filter={`url(#${g}glow)`} />
      <path className="ll-run ll-run2" pathLength={1} d={right} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" filter={`url(#${g}glow)`} />
      <circle className="ll-knot" cx="50" cy="86" r="4.5" fill="#fff" />
    </svg>
  );
}

/** 5. Liquid Glass: a glass tile over slowly drifting colour, with a rim of light and an engraved V-tick. */
export function LiquidGlass({ size = 96, mode }: MarkProps) {
  const g = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cls(mode, "ll-glass")} aria-hidden>
      <defs>
        <clipPath id={`${g}clip`}>
          <rect x="8" y="8" width="84" height="84" rx="26" />
        </clipPath>
        <filter id={`${g}blur`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <linearGradient id={`${g}rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".15" />
          <stop offset=".7" stopColor="#fff" stopOpacity=".05" />
          <stop offset="1" stopColor="#fff" stopOpacity=".6" />
        </linearGradient>
        <linearGradient id={`${g}gloss`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".5" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${g}engrave`} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="#1e1b4b" floodOpacity=".55" />
        </filter>
      </defs>
      <g clipPath={`url(#${g}clip)`}>
        <rect x="8" y="8" width="84" height="84" fill="#312e81" />
        <g filter={`url(#${g}blur)`}>
          <circle className="ll-blob ll-b1" cx="30" cy="30" r="26" fill="#22d3ee" />
          <circle className="ll-blob ll-b2" cx="72" cy="38" r="24" fill="#d946ef" />
          <circle className="ll-blob ll-b3" cx="48" cy="78" r="28" fill="#6366f1" />
          <circle className="ll-blob ll-b4" cx="80" cy="82" r="16" fill="#f59e0b" />
        </g>
        <rect x="8" y="8" width="84" height="84" fill="#fff" fillOpacity=".08" />
        <path d="M8 8h84v34C70 50 30 50 8 38z" fill={`url(#${g}gloss)`} />
      </g>
      <rect x="8.75" y="8.75" width="82.5" height="82.5" rx="25.3" fill="none" stroke={`url(#${g}rim)`} strokeWidth="1.5" />
      <path className="ll-draw" pathLength={1} d="M30 49l13 17 27-34" fill="none" stroke="#fff" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${g}engrave)`} />
    </svg>
  );
}

/** 6. Fingerprint: nested ridges that form a V, like a fingerprint of originality, read by a moving beam of light. */
export function Fingerprint({ size = 96, mode }: MarkProps) {
  const g = useId().replace(/:/g, "");
  // Rounded chevrons, outer to inner; small breaks in some ridges make them read as a fingerprint.
  const ridges = Array.from({ length: 8 }, (_, k) => {
    const x1 = 10 + k * 4.6;
    const x2 = 90 - k * 4.6;
    const y = 12 + k * 2.2;
    const by = 88 - k * 3.4;
    const gaps = ["1", "0.62 0.05 0.33", "0.4 0.04 0.56", "0.75 0.05 0.2", "0.3 0.05 0.65", "1", "0.55 0.06 0.39", "1"][k]!;
    return { d: `M${x1} ${y}C${x1 + 10} ${y + 30} ${50 - 8} ${by} 50 ${by}S${x2 - 10} ${y + 30} ${x2} ${y}`, gaps, k };
  });
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={cls(mode, "ll-print")} aria-hidden>
      <defs>
        <linearGradient id={`${g}ink`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset=".5" stopColor="#6366f1" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
        <linearGradient id={`${g}beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${g}m`}>
          {ridges.map((r) => (
            <path key={r.k} d={r.d} fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          ))}
        </mask>
      </defs>
      {ridges.map((r) => (
        <path
          key={r.k}
          className="ll-ridge"
          style={{ ["--k" as string]: r.k }}
          pathLength={1}
          d={r.d}
          fill="none"
          stroke={`url(#${g}ink)`}
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeDasharray={r.gaps}
        />
      ))}
      <g mask={`url(#${g}m)`}>
        <rect className="ll-scanbar" x="0" y="-16" width="100" height="16" fill={`url(#${g}beam)`} />
      </g>
      <circle className="ll-dot" cx="50" cy="66" r="3" fill="#fff" />
    </svg>
  );
}

export const LOGOS = [
  { id: 1, name: "Prism", Mark: Prism, idea: "A V cut like a crystal: five facets catch the light, a sheen runs across them and a spark glints at the tip. Clarity and value." },
  { id: 2, name: "Aperture", Mark: Aperture, idea: "Camera-iris blades close around a glowing tick inside a turning dial: looking at your paper in sharp focus." },
  { id: 3, name: "Orbit", Mark: Orbit, idea: "A glass sphere holding a V, circled by three orbits in the report’s colours with comets: every source searched around your work." },
  { id: 4, name: "Ribbon", Mark: Ribbon, idea: "A V folded from two gradient ribbons that meet in a knot, with light running along them: elegant, fluid, unmistakable." },
  { id: 5, name: "Liquid Glass", Mark: LiquidGlass, idea: "A glass tile over slowly drifting colour with a rim of light and an engraved tick, in the style of premium app icons." },
  { id: 6, name: "Fingerprint", Mark: Fingerprint, idea: "Nested ridges form a V like a fingerprint, the symbol of originality, read by a moving beam of light." },
] as const;
