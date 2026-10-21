const COPY = {
  fromSectorCentral: ["From Sector Central", "来自板块中心"],
  backToSectorCentral: ["Back to Sector Central", "返回板块中心"],
  previousCompany: ["Previous company", "上一家公司"],
  nextCompany: ["Next company", "下一家公司"],
  positionOf: ["{index} of {count}", "第 {index}/{count} 家"],
  asOf: ["as of {date}", "截至 {date}"],
  rosterLoading: ["Checking the sector roster…", "正在核对板块名单…"],
  rosterExact: ["Same roster as when you left.", "名单与离开时一致。"],
  rosterChanged: ["The sector roster changed since you left. Stepping is paused; go back to choose again.", "板块名单已更新。已暂停切换，请返回重新选择。"],
  rosterUnavailable: ["The sector roster could not be checked. Back still works.", "暂时无法核对板块名单，仍可返回。"],
  methodIncumbent: ["Relative strength, 63-day and 21-day", "相对强度（63 日与 21 日）"],
  benchmarkRelative: ["relative to {benchmark}", "相对 {benchmark}"],
  originNavLabel: ["Sector origin", "板块来源"],
} as const;
export type ExposureOriginKey = keyof typeof COPY;
export const exposureOriginT = (lang: "en" | "zh") => (key: ExposureOriginKey): string => COPY[key][lang === "zh" ? 1 : 0];
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (token, name: string) => (Object.hasOwn(vars, name) ? String(vars[name]) : token));
}
