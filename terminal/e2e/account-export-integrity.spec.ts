import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { canonicalExportJson, verifyAccountExportIntegrity, verifyAccountExportCsvChecksum } from "../lib/accountExportIntegrity";
import type { AccountExportDoc } from "../lib/accountExport";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** RFC-style quoted cell parsing, including embedded newlines and doubled quotes. */
function csvRows(csv: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false;
  for (let i = csv.charCodeAt(0) === 0xfeff ? 1 : 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && c === ",") { row.push(field); field = ""; }
    else if (!quoted && c === "\r" && csv[i + 1] === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; }
    else field += c;
  }
  expect(quoted).toBe(false); expect(field).toBe(""); expect(row).toEqual([]);
  return rows;
}

for (const lang of ["en", "zh"] as const) {
  test(`real account JSON/CSV download keeps integrity and relationships in ${lang}`, async ({ page, context }, info) => {
    const key = `export-integrity-${info.project.name}-${lang}-${info.retry}`;
    await context.addCookies([{ name: "mm_e2e_wl", value: key, url: info.project.use.baseURL as string }]);
    await page.addInitScript((language) => { localStorage.setItem("mm.lang", language); localStorage.setItem("theme", "dark"); localStorage.setItem("theme_auto", "0"); }, lang);
    await page.goto(`/dev/settings?s=account&lang=${lang}`);
    const card = page.locator(".acs-overlay.open .acs-card");
    await expect(card).toBeVisible({ timeout: 45_000 });
    const jsonButton = card.getByRole("button", { name: "JSON", exact: true });
    const csvButton = card.getByRole("button", { name: "CSV", exact: true });
    await expect(jsonButton).toBeVisible(); await expect(csvButton).toBeVisible();
    await jsonButton.scrollIntoViewIfNeeded();
    const [jsonDownload] = await Promise.all([page.waitForEvent("download"), jsonButton.click()]);
    expect(jsonDownload.suggestedFilename()).toMatch(/^mastermind-terminal-data-.*\.json$/);
    const jsonPath = await jsonDownload.path(); expect(jsonPath).not.toBeNull();
    const doc: AccountExportDoc = JSON.parse(await readFile(jsonPath!, "utf8"));
    expect(verifyAccountExportIntegrity(doc, sha256)).toBe(true);
    expect(doc.integrity!.schema).toBe("mm.terminal_account_export.integrity.v2");
    // Unknown tables on the existing fixture client yield empty, unpageable responses.
    // They must remain partial, never a complete empty inventory or populated proof.
    expect(doc.integrity!.collections.chart_drawings).toMatchObject({ state: "partial", item_count: 0, sha256: sha256("[]") });
    expect(doc.integrity!.collections.alerts).toMatchObject({ state: "partial", item_count: 0, sha256: sha256("[]") });
    expect(doc.watchlists).toHaveLength(1); expect(doc.watchlists[0].symbols).toHaveLength(6);
    expect(doc.integrity!.collections.watchlists).toMatchObject({ state: "included_unverified", item_count: 1, coverage_row_count: 6 });
    await expect(csvButton).toBeEnabled();
    const [csvDownload] = await Promise.all([page.waitForEvent("download"), csvButton.click()]);
    expect(csvDownload.suggestedFilename()).toMatch(/^mastermind-terminal-data-.*\.csv$/);
    const csvPath = await csvDownload.path(); expect(csvPath).not.toBeNull();
    const csv = await readFile(csvPath!, "utf8");
    expect(verifyAccountExportCsvChecksum(csv, sha256)).toBe(true);
    const rows = csvRows(csv);
    const payload = JSON.parse(rows.find((row) => row[0] === "artifact" && row[1] === "logical_json")![4]);
    const integrity = JSON.parse(rows.find((row) => row[0] === "integrity" && row[1] === "manifest")![4]);
    expect(verifyAccountExportIntegrity({ ...payload, integrity }, sha256)).toBe(true);
    // Requests have independent read intervals. Their data/relationships must still match.
    expect(payload.watchlists).toEqual(doc.watchlists);
    expect(payload.portfolio_positions).toEqual(doc.portfolio_positions);
    expect(integrity.payload_sha256).toBe(sha256(canonicalExportJson(payload)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    expect(overflow).toBe(false);
  });
}
