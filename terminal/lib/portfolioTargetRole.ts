// Optional user-authored description on the existing portfolio target.
// Never inferred from holdings, used as an allocation rule, or fed to a signal.
export const MAX_PORTFOLIO_ROLE_CODE_POINTS = 48;

export type PortfolioRoleEdit =
  | { kind: "unchanged" }
  | { kind: "value"; value: string | null }
  | { kind: "invalid" };

/** Omitted preserves a saved role; explicit null/blank clears it. */
export function parsePortfolioRoleEdit(value: unknown): PortfolioRoleEdit {
  if (value === undefined) return { kind: "unchanged" };
  if (value === null) return { kind: "value", value: null };
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    return { kind: "invalid" };
  }
  const text = value.trim();
  if (Array.from(text).length > MAX_PORTFOLIO_ROLE_CODE_POINTS) return { kind: "invalid" };
  return { kind: "value", value: text || null };
}
