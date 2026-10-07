export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Posts JSON to a Veritome route and returns the parsed reply, or throws an ApiError with the server's message. */
export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the Veritome server. Check your connection and try again.", 0);
  }
  return readReply<T>(res);
}

export async function postForm<T>(path: string, form: FormData, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", body: form, ...(signal ? { signal } : {}) });
  } catch {
    throw new ApiError("Could not reach the Veritome server. Check your connection and try again.", 0);
  }
  return readReply<T>(res);
}

async function readReply<T>(res: Response): Promise<T> {
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback =
      res.status === 413
        ? "That is too large for this server. Try a smaller file, or paste the text instead."
        : res.status === 504
          ? "The check took too long and was stopped. Try a shorter text, or fewer checks at once."
          : `The server replied with HTTP ${res.status}.`;
    const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : fallback;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

/**
 * Posts JSON and reads a newline-delimited JSON reply, passing each event to `onEvent` as it arrives.
 * Errors before the stream starts come back as ordinary JSON and are thrown as ApiErrors.
 */
export async function postNdjson<E>(path: string, body: unknown, onEvent: (event: E) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the Veritome server. Check your connection and try again.", 0);
  }
  if (!res.ok) await readReply<never>(res);
  if (!res.body || !(res.headers.get("content-type") ?? "").includes("ndjson")) throw new ApiError("The server sent an unexpected reply.", res.status);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<string>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError("The connection dropped before the check finished. Try again, or with fewer checks at once.", 0);
    }
    if (chunk.done) break;
    buffer += chunk.value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}
