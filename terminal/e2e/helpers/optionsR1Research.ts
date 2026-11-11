import type { BrowserContext } from "@playwright/test";

// Options R1 W2C — the saved-research API as an in-memory store shared by every context of one test, so a revision
// written by one browser context can be reopened by another. Revisions are immutable; a re-read never rewrites one.
// Shared by the continuity spec and the W2 crop packet so both exercise one fixture.
export const SAVED_HASH = `sha256:${"a1b2c3d4e5f60718".repeat(4)}`, CORRECTED_HASH = `sha256:${"f".repeat(64)}`;
export const digest = (hash: string) => hash.slice("sha256:".length);
export type Ref = Record<string, unknown>;
export type Manifest = { intent: { title: string; question: string }; evidence_refs: Ref[] };
export type Command = { id: string; expected_revision: number; action: string; manifest: Manifest };
export type Saved = { id: string; revision: number; lifecycle: "active"; manifest: Manifest; committed_at: string; layouts: never[] };
export class ResearchStore { commands: Command[] = []; records = new Map<string, Saved[]>(); }

export async function routeResearch(context: BrowserContext, store: ResearchStore, access: "granted" | "revoked" = "granted") {
  await context.route("**/api/layouts", route => route.fulfill({ json: { layouts: [], teams: [], teamRead: { ok: true } } }));
  await context.route("**/api/investigations{,?*}", route => {
    if (access === "revoked") return route.fulfill({ status: 401, json: { status: "unauthenticated" } });
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "POST") {
      const command = request.postDataJSON() as Command;
      store.commands.push(command);
      const revisions = store.records.get(command.id) ?? [];
      if ((revisions.at(-1)?.revision ?? 0) !== command.expected_revision) return route.fulfill({ status: 409, json: { status: "version_conflict" } });
      const saved: Saved = { id: command.id, revision: revisions.length + 1, lifecycle: "active", manifest: command.manifest,
        committed_at: new Date(Date.UTC(2026, 9, 19, 14, 0, revisions.length)).toISOString(), layouts: [] };
      store.records.set(command.id, [...revisions, saved]);
      return route.fulfill({ json: { status: "committed", id: saved.id, revision: saved.revision, lifecycle: "active", manifest: saved.manifest, committed_at: saved.committed_at } });
    }
    const id = url.searchParams.get("id");
    if (id) {
      const revisions = store.records.get(id) ?? [], wanted = url.searchParams.get("revision");
      const found = wanted ? revisions.find(item => item.revision === Number(wanted)) : revisions.at(-1);
      if (!found) return route.fulfill({ status: 404, json: { status: "not_found" } });
      return route.fulfill({ json: { ...found, status: "found", current_revision: revisions.length } });
    }
    const items = [...store.records.values()].map(revisions => revisions.at(-1)!).map(item => ({
      id: item.id, revision: item.revision, lifecycle: item.lifecycle, title: item.manifest.intent.title, question: item.manifest.intent.question, updated_at: item.committed_at }));
    return route.fulfill({ json: { status: "listed", items } });
  });
}
