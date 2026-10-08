/** The Veritome ribbon mark as a PNG data URL, for reports. Null where the browser cannot draw it. */
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200">
  <defs>
    <linearGradient id="l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset=".55" stop-color="#6366f1"/><stop offset="1" stop-color="#4338ca"/></linearGradient>
    <linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0abfc"/><stop offset=".55" stop-color="#a855f7"/><stop offset="1" stop-color="#6d28d9"/></linearGradient>
  </defs>
  <path d="M14 14C26 12 36 26 43 46S48 78 50 86" fill="none" stroke="url(#l)" stroke-width="15" stroke-linecap="round"/>
  <path d="M86 14C74 12 64 26 57 46S52 78 50 86" fill="none" stroke="url(#r)" stroke-width="15" stroke-linecap="round"/>
  <path d="M11.5 14C23.5 12 33.5 26 40.5 46S45.5 78 47.5 86" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>
  <path d="M83.5 14C71.5 12 61.5 26 54.5 46S49.5 78 47.5 86" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>
  <circle cx="50" cy="86" r="5" fill="#fff"/>
</svg>`;

let cached: Promise<string | null> | null = null;

export function logoPng(): Promise<string | null> {
  cached ??= new Promise((resolve) => {
    try {
      if (typeof document === "undefined") return resolve(null);
      // Some environments never load the picture; the report is then made without it.
      setTimeout(() => resolve(null), 3000);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = 200;
          c.height = 200;
          const ctx = c.getContext("2d");
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, 200, 200);
          resolve(c.toDataURL("image/png"));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG)}`;
    } catch {
      resolve(null);
    }
  });
  return cached;
}
