import "server-only";

export async function withinMatrixRead<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new DOMException("Read cancelled", "AbortError");
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException("Read cancelled", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw new DOMException("Read cancelled", "AbortError"); return action(); })
      .then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** A single bounded allocation; cancellation cleanup never extends the deadline. */
export async function readMatrixBytes(
  stream: ReadableStream<Uint8Array>, signal: AbortSignal, limit: number, exact = false,
): Promise<Uint8Array> {
  const body = new Uint8Array(limit); let size = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const part = await withinMatrixRead(signal, () => reader.read());
      if (part.done) break;
      if (part.value.byteLength > limit - size) throw Error("Read exceeds bound");
      body.set(part.value, size); size += part.value.byteLength;
    }
    if (!size || (exact && size !== limit)) throw Error("Read length differs");
    return size === limit ? body : body.slice(0, size);
  } finally {
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* Cancellation owns a pending read. */ }
  }
}
