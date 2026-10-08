// Copies ONNX Runtime Web's WebAssembly files into public/, so the AI detector's neural models run from this site
// rather than a CDN that some networks and browsers block. Runs before every build and dev start.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dist = join(process.cwd(), "node_modules", "onnxruntime-web", "dist");
const out = join(process.cwd(), "public", "ort");
mkdirSync(out, { recursive: true });
for (const f of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) copyFileSync(join(dist, f), join(out, f));
