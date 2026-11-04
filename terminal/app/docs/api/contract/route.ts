import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const text = readFileSync(join(process.cwd(), "docs/api/API_V1_CONTRACT.md"), "utf8");
  return new NextResponse(text, {
    status: 200,
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
}
