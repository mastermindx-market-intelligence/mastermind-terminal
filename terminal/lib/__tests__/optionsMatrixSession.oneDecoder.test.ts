import { describe, expect, it } from "vitest";
import { matrixSourceSession } from "@/lib/gexLadder";
import { readOptionsMatrixSourceSession } from "@/lib/investigationOptionsReference";

const payloads: Array<{ name: string; matrix: unknown; session: string | null; ok: boolean }> = [
  {
    name: "session=asof (2026-10-02/2026-10-02)",
    matrix: { session: "2026-10-02", _build_meta: { asof_date: "2026-10-02" } },
    session: "2026-10-02",
    ok: true,
  },
  {
    name: "session only",
    matrix: { session: "2026-10-02" },
    session: "2026-10-02",
    ok: true,
  },
  {
    name: "asof only",
    matrix: { _build_meta: { asof_date: "2026-10-02" } },
    session: "2026-10-02",
    ok: true,
  },
  {
    name: 'session "2026-10-02" vs asof "2026-10-01"',
    matrix: { session: "2026-10-02", _build_meta: { asof_date: "2026-10-01" } },
    session: null,
    ok: false,
  },
  {
    name: 'non-canonical "2026-02-30"',
    matrix: { session: "2026-02-30", _build_meta: { asof_date: "2026-02-30" } },
    session: null,
    ok: false,
  },
];

describe("one matrix-session decoder", () => {
  it.each(payloads)("$name: matrixSourceSession and readOptionsMatrixSourceSession agree", ({ matrix, session, ok }) => {
    const decoded = readOptionsMatrixSourceSession(matrix);
    expect(decoded.ok).toBe(ok);
    expect(matrixSourceSession(matrix as never)).toBe(session);
    expect(decoded.ok ? decoded.sourceSession : null).toBe(session);
    if (!ok) expect(decoded.ok).toBe(false);
  });
});
