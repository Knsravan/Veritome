import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["mammoth", "unpdf"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The AI models (about 14 MB each) are fetched as model.onnx?v=<fingerprint>, so a browser can keep them for
      // a year without asking again; a changed model gets a new fingerprint and is fetched afresh.
      { source: "/models/ai-writing/:file*.onnx", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default config;
