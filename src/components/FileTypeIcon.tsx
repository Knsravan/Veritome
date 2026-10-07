/** A page with a folded corner, coloured by file type, with the type on a label. */
const TYPES: Record<string, { label: string; from: string; to: string }> = {
  docx: { label: "DOCX", from: "#3b82f6", to: "#1d4ed8" },
  pdf: { label: "PDF", from: "#f05252", to: "#b91c1c" },
  tex: { label: "TEX", from: "#14b8a6", to: "#0f766e" },
  md: { label: "MD", from: "#8b5cf6", to: "#6d28d9" },
  txt: { label: "TXT", from: "#64748b", to: "#334155" },
  odt: { label: "ODT", from: "#0ea5e9", to: "#0369a1" },
  rtf: { label: "RTF", from: "#f59e0b", to: "#b45309" },
};

export function fileKind(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return ext in TYPES ? ext : "txt";
}

export function FileTypeIcon({ kind, size = 64, className }: { kind: string; size?: number; className?: string }) {
  const t = TYPES[kind] ?? TYPES.txt!;
  const id = `ft-${kind}`;
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 50 60" aria-hidden className={className}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.from} />
          <stop offset="1" stopColor={t.to} />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d="M6 2h26l14 14v38a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" />
        </clipPath>
      </defs>
      <path d="M6 2h26l14 14v38a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z" fill={`url(#${id}-g)`} />
      <path d="M32 2v10a4 4 0 0 0 4 4h10z" fill="#fff" fillOpacity="0.35" />
      <g clipPath={`url(#${id}-clip)`}>
        <rect className="file-shine" x="-30" y="0" width="22" height="60" fill={`url(#${id}-shine)`} transform="skewX(-20)" />
      </g>
      <rect x="8" y="22" width="22" height="2.5" rx="1.25" fill="#fff" fillOpacity="0.55" />
      <rect x="8" y="28" width="30" height="2.5" rx="1.25" fill="#fff" fillOpacity="0.4" />
      <rect x="6" y="38" width="38" height="13" rx="3" fill="#fff" fillOpacity="0.95" />
      <text x="25" y="47.5" textAnchor="middle" fontSize="8.5" fontWeight="800" fontFamily="Inter, system-ui, sans-serif" fill={t.to} letterSpacing="0.5">
        {t.label}
      </text>
    </svg>
  );
}
