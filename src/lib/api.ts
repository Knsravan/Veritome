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
