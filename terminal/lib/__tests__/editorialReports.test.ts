import { afterEach, expect, it, vi } from "vitest";
import { archiveFilter, decodeEditorialReports, editorialTopics, filterEditorialReports } from "../shared-shell/editorialReports";
import { readEditorialReports } from "../shared-shell/editorialReportsServer";

vi.mock("server-only", () => ({}));
const source = {
  slug: "report_alpha", date: "2026-02-02", read_min: 12,
  title_en: "Alpha", title_zh: "甲", dek_en: "Copper and power", dek_zh: "铜与电力",
  tags: [{ key: "energy", en: "Energy", zh: "能源" }],
};
const other = { ...source, slug: "report_beta", date: "2026-01-12", title_en: "Beta", title_zh: "乙",
  dek_en: "Bank credit", dek_zh: "银行信贷", tags: [{ key: "credit", en: "Credit", zh: "信贷" }] };

afterEach(() => vi.unstubAllGlobals());

it("decodes every published row, preserves supplied text and orders by publication date", () => {
  const reports = decodeEditorialReports({ version: 1, reports: [other, source] })!;
  expect(reports).toEqual([source, other]);
  const topics = editorialTopics(reports);
  expect(topics.map(topic => topic.key)).toEqual(["credit", "energy"]);
  expect(archiveFilter(new URLSearchParams("tag=../../x&q=铜&sort=bogus"), topics)).toEqual({ q: "铜", tag: "all", sort: "new" });
  expect(filterEditorialReports(reports, { q: " 铜 ", tag: "energy", sort: "old" })).toEqual([source]);
  expect(filterEditorialReports(reports, { q: "", tag: "all", sort: "old" })).toEqual([other, source]);
});

it.each([
  { version: 2, reports: [] },
  { version: 1, reports: [source, source] },
  ...[{ slug: "report_../x" }, { date: "2026-02-30" }, { read_min: 0 }, { dek_zh: null },
    { tags: [...source.tags, ...source.tags] }].map(change => ({ version: 1, reports: [source, { ...other, ...change }] })),
])("fails the whole manifest on malformed rows or an unsupported schema", value => {
  expect(decodeEditorialReports(value)).toBeNull();
});

it("only reads the public fixed origin and distinguishes an empty edition from an unreadable feed", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ version: 1, reports: [] }))
    .mockResolvedValueOnce(new Response("offline", { status: 503 }))
    .mockResolvedValueOnce(new Response("<html>"))
    .mockResolvedValueOnce(new Response("x".repeat(1_048_577)));
  vi.stubGlobal("fetch", fetcher);
  expect(await readEditorialReports()).toEqual([]);
  expect(fetcher).toHaveBeenCalledWith("https://www.mastermind-x.com/research/editorial-reports.json",
    expect.objectContaining({ redirect: "error", cache: "no-store", credentials: "omit" }));
  for (let i = 0; i < 3; i++) expect(await readEditorialReports()).toBeNull();
});
