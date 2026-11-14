/** Limit and validate the response while streaming, including bodies without Content-Length. */
export async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !response.body) throw Error("response_size");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body.cancel(); throw Error("response_size");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("response_size");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join(""));
  } catch (error) {
    await reader.cancel().catch(() => {}); throw error;
  } finally { reader.releaseLock(); }
}
