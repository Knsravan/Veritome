/**
 * Runs the neural AI-writing model in the browser (ONNX Runtime Web, WebAssembly), so the paper never leaves the
 * device for this check. The two models (about 14 MB each) are downloaded once and then served from the browser cache.
 */
import { isProse, mergeNeural, neuralWindows, type NeuralMeta } from "@/core/detector/neural";
import type { DetectorResult } from "@/core/detector/types";
import { wordPiece, type WordPiece } from "./wordpiece";

const BASE = "/models/ai-writing/";
const ORT_VERSION = "1.30.0";

type Ort = typeof import("onnxruntime-web/wasm");
interface Loaded {
  ort: Ort;
  sessions: Array<import("onnxruntime-web/wasm").InferenceSession>;
  tok: WordPiece;
  meta: NeuralMeta;
}

let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
    ort.env.wasm.numThreads = 1;
    const [meta, vocab] = await Promise.all([fetch(`${BASE}meta.json`).then((r) => r.json() as Promise<NeuralMeta>), fetch(`${BASE}vocab.txt`).then((r) => r.text())]);
    const sessions = await Promise.all(
      meta.models.map(async (m) => {
        const bytes = await fetch(BASE + m.file).then((r) => {
          if (!r.ok) throw new Error(`${m.file}: ${r.status}`);
          return r.arrayBuffer();
        });
        return ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"] });
      }),
    );
    return { ort, sessions, tok: wordPiece(vocab), meta };
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

async function score(m: Loaded, session: Loaded["sessions"][number], text: string): Promise<number> {
  const ids = m.tok.encode(text, m.meta.maxTokens);
  const tensor = (v: number[]) => new m.ort.Tensor("int64", BigInt64Array.from(v.map((x) => BigInt(x))), [1, v.length]);
  const feeds: Record<string, import("onnxruntime-web/wasm").Tensor> = { input_ids: tensor(ids), attention_mask: tensor(ids.map(() => 1)) };
  if (session.inputNames.includes("token_type_ids")) feeds.token_type_ids = tensor(ids.map(() => 0));
  const out = await session.run(feeds);
  const [human, ai] = Array.from(out[session.outputNames[0]!]!.data as Float32Array);
  return 1 / (1 + Math.exp(human! - ai!));
}

/**
 * Adds the neural model's opinion to a detector result. Only prose paragraphs are read (tables and equation blocks
 * keep the classifier's estimate). Returns the result unchanged if the model cannot be loaded.
 */
export async function withNeuralOpinion(result: DetectorResult, text: string, signal?: AbortSignal): Promise<DetectorResult> {
  const segments = result.model.segments;
  if (!segments?.length || result.verdict === "insufficient_text") return result;
  try {
    const m = await load();
    const scores: Array<number[][] | null> = [];
    for (const s of segments) {
      if (signal?.aborted) return result;
      const part = text.slice(s.start, s.end);
      if (!isProse(part)) {
        scores.push(null);
        continue;
      }
      const windows = neuralWindows(part, m.meta.windowWords);
      const perModel: number[][] = [];
      for (const session of m.sessions) {
        const ws: number[] = [];
        for (const w of windows) ws.push(await score(m, session, w));
        perModel.push(ws);
      }
      scores.push(perModel);
    }
    return mergeNeural(result, scores, m.meta);
  } catch {
    return result;
  }
}
