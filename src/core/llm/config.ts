import { assertSafeUrl, type Resolver } from "../infra/netguard.ts";
import type { LlmConfig } from "./client.ts";

export interface ClientLlmOverride {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface ResolveOptions {
  env: Record<string, string | undefined>;
  override?: ClientLlmOverride | undefined;
  /** When false, anything sent by the browser is ignored. Disable on public deployments. */
  allowClientConfig: boolean;
  /** Allow localhost and private addresses for browser-supplied URLs (needed for Ollama). */
  allowPrivate: boolean;
  resolve?: Resolver;
}

/**
 * Chooses the language-model settings for a request. Server environment values
 * are trusted. Browser-supplied values are only honoured when enabled and are
 * checked against the SSRF guard first.
 */
export async function resolveLlmConfig(options: ResolveOptions): Promise<LlmConfig | null> {
  const { env, override } = options;
  const hasOverride = Boolean(options.allowClientConfig && override?.baseUrl && override.model);

  if (hasOverride && override?.baseUrl && override.model) {
    await assertSafeUrl(override.baseUrl, {
      allowPrivate: options.allowPrivate,
      ...(options.resolve ? { resolve: options.resolve } : {}),
    });
    return {
      baseUrl: override.baseUrl,
      model: override.model,
      ...(override.apiKey ? { apiKey: override.apiKey } : {}),
    };
  }

  const baseUrl = env.LLM_BASE_URL?.trim();
  const model = env.LLM_MODEL?.trim();
  if (!baseUrl || !model) return null;
  const reasoningEffort = env.LLM_REASONING_EFFORT?.trim();
  return {
    baseUrl,
    model,
    ...(env.LLM_API_KEY ? { apiKey: env.LLM_API_KEY } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}
