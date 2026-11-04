#!/usr/bin/env node
// Read the existing-holdings event projection with an already authorized personal key.
import { pathToFileURL } from "node:url";

export async function readEventImpact({ apiKey, origin = "https://app.mastermind-x.com", fetchImpl = fetch }) {
  const target = new URL(origin);
  const production = target.origin === "https://app.mastermind-x.com";
  const local = target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname);
  if ((!production && !local) || target.username || target.password || target.pathname !== "/" || target.search || target.hash) {
    throw new Error("Use the Terminal HTTPS origin or an explicit local test server.");
  }
  if (!apiKey || !/^mmx_[A-Za-z0-9_-]{40}$/.test(apiKey)) throw new Error("Set MMX_API_KEY to an already authorized personal API key.");
  const response = await fetchImpl(new URL("/api/v1/event-impact", target), {
    headers: { authorization: `Bearer ${apiKey}` }, redirect: "error", cache: "no-store",
  });
  const body = await response.json();
  if (response.ok || response.status === 503) {
    if (body?.schema !== "mm.api.v1.event_impact" || typeof body?.data?.state !== "string" ||
      body?.snapshot?.countdown_basis !== "source_snapshot" || body?.snapshot?.freshness !== "not_evaluated") {
      throw new Error("The server did not return the expected event-impact read contract.");
    }
  }
  return { status: response.status, body };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await readEventImpact({ apiKey: process.env.MMX_API_KEY, origin: process.env.MMX_API_ORIGIN });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 200) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Event-impact read failed.");
    process.exitCode = 1;
  }
}
