import { createHttp, HttpError, type FetchLike } from "../infra/http.ts";

export interface LlmConfig {
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 or http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
  model: string;
  /**
   * Sent as `reasoning_effort`. Thinking models (such as Gemini) count thinking
   * against max_tokens, so a low value keeps short replies from coming back empty.
   */
  reasoningEffort?: string;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      "No language model is configured. Set LLM_BASE_URL and LLM_MODEL (and LLM_API_KEY if needed) on the server, or add one in Settings.",
    );
    this.name = "LlmNotConfiguredError";
  }
}

export class LlmError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    if (status !== undefined) this.status = status;
  }
}

export interface ChatRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask for a JSON object. Falls back to plain mode when the server rejects it. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface LlmClient {
  readonly model: string;
  chat(request: ChatRequest): Promise<string>;
}

export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  error?: { message?: string };
}

export function createLlmClient(config: LlmConfig, options: { fetch?: FetchLike; timeoutMs?: number } = {}): LlmClient {
  const http = createHttp({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    timeoutMs: options.timeoutMs ?? 120_000,
    retries: 1,
  });
  const url = chatCompletionsUrl(config.baseUrl);

  async function call(req: ChatRequest, json: boolean, reasoning: boolean, limit = true): Promise<string> {
    const body = JSON.stringify({
      model: config.model,
      temperature: req.temperature ?? 0.7,
      ...(req.maxTokens && limit ? { max_tokens: req.maxTokens } : {}),
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(reasoning && config.reasoningEffort ? { reasoning_effort: config.reasoningEffort } : {}),
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    });
    const data = await http.json<ChatCompletionResponse>(url, {
      method: "POST",
      body,
      ...(req.signal ? { signal: req.signal } : {}),
      headers: {
        "content-type": "application/json",
        ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
    });
    const content = data.choices?.[0]?.message?.content;
    if ((typeof content !== "string" || content.trim() === "") && limit && req.maxTokens && data.choices?.[0]?.finish_reason === "length") {
      // Thinking models (Gemini, o-series) can spend the whole limit on reasoning; ask again without it.
      return call(req, json, reasoning, false);
    }
    if (typeof content !== "string" || content.trim() === "") {
      throw new LlmError(data.error?.message ?? "The language model returned an empty response.");
    }
    return content;
  }

  return {
    model: config.model,
    async chat(req) {
      try {
        return await call(req, req.json === true, true);
      } catch (err) {
        if (err instanceof HttpError) {
          if ((req.json || config.reasoningEffort) && err.status === 400) {
            // Some servers do not support response_format or reasoning_effort.
            return call(req, false, false).catch((e) => {
              throw mapError(e);
            });
          }
          throw mapError(err);
        }
        throw mapError(err);
      }
    },
  };
}

function mapError(err: unknown): Error {
  if (err instanceof LlmError) return err;
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403) return new LlmError("The language model rejected the API key.", err.status);
    if (err.status === 404) return new LlmError("The language model endpoint or model name was not found.", err.status);
    if (err.status === 429) return new LlmError("The language model is rate limiting requests. Try again shortly.", err.status);
    return new LlmError(`The language model returned HTTP ${err.status}.`, err.status);
  }
  if (err instanceof Error && err.name === "TimeoutError") return new LlmError("The language model took too long to respond.");
  if (err instanceof Error) return new LlmError(`Could not reach the language model: ${err.message}`);
  return new LlmError("Unknown language model error.");
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function extractJson<T = unknown>(raw: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced?.[1] ?? raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
