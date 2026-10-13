import { ImageResponse } from "next/og";
import { TOOLS } from "@/lib/tools";

export const alt = "Veritome: check your paper before reviewers do";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The card shown when a link to the site is shared (built once, at build time). */
export default function OpenGraphImage() {
  const tools = TOOLS.filter((t) => !t.soon).map((t) => t.name);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #eff1f6 0%, #e4e7f7 100%)",
          color: "#0e1320",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              background: "#4f46e5",
              color: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ fontSize: 44, fontWeight: 700 }}>Veritome</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
            Check your paper before reviewers do.
          </div>
          <div style={{ fontSize: 32, color: "#434b5a" }}>Free, open-source checks for research writing. Nothing stored.</div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {tools.map((name) => (
            <div key={name} style={{ padding: "10px 22px", borderRadius: 999, background: "#ffffff", fontSize: 28, color: "#4f46e5", fontWeight: 600 }}>
              {name}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
