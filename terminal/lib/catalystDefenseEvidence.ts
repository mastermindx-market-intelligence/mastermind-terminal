/** Display existing Defense facts without calculating, ranking, or merging financial bases. */
import type { DefenseFact, DefenseProfile } from "./catalystDefense";

type Lang = "en" | "zh";
type Copy = readonly [string, string];
export type DefenseFactReference = { fact_id: string; owner_ref: string };
export type DefenseEvidenceSelection = { facts: DefenseFact[]; unresolved: number };
export type DefenseFactPresentation = {
  title: string; basis: string; nature: string; value: string; unit: string;
  period: string; originalTerms: boolean;
};
const local = (copy: Copy, lang: Lang) => copy[lang === "zh" ? 1 : 0];
const pair = (ref: DefenseFactReference) => JSON.stringify([ref.owner_ref, ref.fact_id]);

/** Resolve the actual owner's two-field references within one selected issuer only. */
export function defenseEvidenceFor(profile: DefenseProfile, refs?: readonly DefenseFactReference[]): DefenseEvidenceSelection {
  const index = new Map<string, DefenseFact | null>();
  for (const fact of profile.axes.economics.facts) {
    const key = pair(fact);
    index.set(key, index.has(key) ? null : fact);
  }
  const selected: DefenseFact[] = [], seen = new Set<string>();
  let unresolved = 0;
  for (const ref of refs ?? profile.axes.economics.facts) {
    const key = pair(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    const fact = index.get(key);
    if (fact) selected.push(fact); else unresolved += 1;
  }
  return { facts: selected, unresolved };
}

export function defensePeriodText(period: string, lang: Lang): string {
  let match = /^(\d{4})Q([1-4])$/.exec(period);
  if (match) return lang === "zh" ? `${match[1]}年第${match[2]}季度` : `Q${match[2]} ${match[1]}`;
  match = /^(\d{4})H([12])$/.exec(period);
  if (match) return lang === "zh" ? `${match[1]}年${match[2] === "1" ? "上" : "下"}半年` : `${match[2] === "1" ? "First" : "Second"} half ${match[1]}`;
  match = /^(\d{4})FY$/.exec(period);
  if (match) return lang === "zh" ? `${match[1]}全年` : `Full year ${match[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const date = new Date(`${period}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === period) {
      return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
    }
  }
  return local(["Reporting period not recognized", "尚未识别报告期"], lang);
}

const TERMS: Record<string, { title: Copy; basis: string; kind: "conditional" | "completed"; forward?: boolean }> = {
  msl_preferred_payout_terms: { title: ["Missile Solutions preferred-share alternatives", "导弹解决方案优先股的不同偿付路径"], basis: "contractual_preferred_terms:conditional_alternatives", kind: "conditional" },
  msl_qipo_conversion_terms: { title: ["Preferred-share conversion on a qualifying listing", "符合条件的上市触发的优先股转换"], basis: "contractual_preferred_conversion:conditional_QIPO", kind: "conditional", forward: true },
  msl_nonipo_redemption_terms: { title: ["Preferred-share redemption without a qualifying listing", "未完成符合条件上市时的优先股赎回"], basis: "contractual_preferred_redemption:conditional_no_QIPO", kind: "conditional" },
  space_business_sale_pending_terms: { title: ["Earlier proposed space-business sale terms", "早先拟议的航天业务出售条款"], basis: "business_disposal:pending:net_enterprise_value", kind: "conditional" },
  space_business_sale_pending_accounting: { title: ["Earlier conditional disposal accounting", "早先有条件的业务处置会计处理"], basis: "business_disposal:conditional_equity_method_accounting", kind: "conditional" },
  space_business_sale_completed_terms: { title: ["Completed space-business sale disclosure", "已完成航天业务出售的披露"], basis: "business_disposal:completed:total_enterprise_value", kind: "completed" },
  space_business_sale_retained_scope: { title: ["Retained ownership and excluded businesses", "保留的所有权与不在出售范围内的业务"], basis: "business_disposal:completed:retained_interest_scope", kind: "completed" },
};
const COSTS: Record<string, { title: Copy; basis: string }> = {
  siaw_unfavorable_eac: { title: ["SiAW unfavorable cost-estimate revision", "SiAW不利成本估计修订"], basis: "issuer_reported_program_cost_estimate:SiAW:unfavorable_EAC" },
  sentinel_prior_favorable_eac: { title: ["Earlier Sentinel favorable cost-estimate revision", "先前Sentinel有利成本估计修订"], basis: "issuer_reported_program_cost_estimate:Sentinel:prior_favorable_EAC" },
  issuer_space_gem63xl_unfavorable_eac: { title: ["GEM63XL unfavorable cost-estimate revision", "GEM63XL不利成本估计修订"], basis: "issuer_reported_program_cost_estimate:GEM63XL:unfavorable_EAC" },
};
const WORKING_CAPITAL: Record<string, Copy> = {
  receivables: ["Cash-flow effect of receivables", "应收款项对现金流的影响"],
  contract_assets: ["Cash-flow effect of contract assets", "合同资产对现金流的影响"],
  inventories: ["Cash-flow effect of inventories", "存货对现金流的影响"],
  accounts_payable: ["Cash-flow effect of accounts payable", "应付账款对现金流的影响"],
  contract_liabilities: ["Cash-flow effect of contract liabilities", "合同负债对现金流的影响"],
};
const BACKLOG: Record<string, Copy> = {
  total: ["Total reported backlog", "已披露积压订单总额"], commercial: ["Commercial backlog", "商业业务积压订单"],
  defense: ["Defense backlog", "防务业务积压订单"], funded: ["Funded backlog", "已获拨款的积压订单"], unfunded: ["Unfunded backlog", "尚未获拨款的积压订单"],
};

/** Closed semantic labels: a recognized suffix alone cannot relabel a different accounting basis. */
export function presentDefenseFact(fact: DefenseFact, lang: Lang): DefenseFactPresentation | null {
  const key = fact.fact_id.split(":").at(-1) || "";
  const term = TERMS[key];
  if (term) {
    if (typeof fact.value !== "string" || fact.unit !== "source_reported_terms" || fact.accounting_basis !== term.basis
      || fact.fact_class !== (term.forward ? "company_forward" : "reported_shareholder_terms")) return null;
    return {
      title: local(term.title, lang), basis: local(["Original issuer contract / transaction disclosure", "发行人原始合同／交易披露"], lang),
      nature: local(term.kind === "completed" ? ["Completed transaction disclosure", "已完成交易披露"] : ["Conditional terms, not realized proceeds", "有条件条款，并非已实现所得款项"], lang),
      value: fact.value, unit: "", period: defensePeriodText(fact.period, lang), originalTerms: true,
    };
  }
  if (typeof fact.value !== "number" || !Number.isFinite(fact.value)) return null;
  let title: Copy | undefined, basis: Copy | undefined;
  let nature: Copy = ["Reported result", "已披露结果"];
  let expectedClass = "", expectedUnit: "money" | "percent" = "money";
  const segment = /^issuer_reported_segment:([^:]+):reported$/.exec(fact.accounting_basis);
  const metric = /^(?:defense_segment|issuer_space_segment)_(sales|operating_profit|margin)(?:_prior)?$/.exec(key);
  if (segment && (metric || key === "defense_segment_prior_margin")) {
    const kind = metric?.[1] || "margin";
    title = kind === "sales" ? ["Segment sales", "分部销售额"] : kind === "operating_profit" ? ["Segment operating profit", "分部营业利润"] : ["Segment operating margin", "分部营业利润率"];
    basis = [`Reported segment: ${segment[1]}`, `已披露分部：${segment[1]}`];
    expectedClass = kind === "sales" ? "reported_segment_sales" : kind === "operating_profit" ? "reported_segment_operating_profit" : "reported_segment_margin";
    expectedUnit = kind === "margin" ? "percent" : "money";
    if (key.endsWith("_prior") || key === "defense_segment_prior_margin") nature = ["Disclosed prior-period comparison", "披露中的上年同期比较"];
  } else if (COSTS[key] && fact.accounting_basis === COSTS[key].basis) {
    title = COSTS[key].title; basis = ["Program cost estimate, not a cash payment", "项目成本估计，并非现金付款"];
    expectedClass = "reported_eac";
  } else {
    const cash = /^issuer_(operating|free)_cash_(quarter|half_year)(?:_prior)?$/.exec(key);
    const guidance = /^issuer_(operating|free)_cash_guidance_(low|high|point)(?:_prior)?$/.exec(key);
    const working = /^issuer_(receivables|contract_assets|inventories|accounts_payable|contract_liabilities)_cash_change_half_year(?:_prior)?$/.exec(key);
    const backlog = /^issuer_backlog(?:_(commercial|defense|funded|unfunded|prior))?$/.exec(key);
    if (cash || guidance) {
      const kind = (cash || guidance)![1];
      const prefix = guidance ? "issuer_guidance_consolidated:" : "issuer_reported_consolidated:";
      const accounting = fact.accounting_basis.slice(prefix.length);
      if (!fact.accounting_basis.startsWith(prefix) || (kind === "operating" ? accounting !== "GAAP_operating_cash_flow" : !["nonGAAP_free_cash_flow", "nonGAAP_adjusted_free_cash_flow"].includes(accounting))) return null;
      title = kind === "operating" ? ["Operating cash flow", "经营活动现金流"] : accounting === "nonGAAP_adjusted_free_cash_flow" ? ["Adjusted free cash flow", "调整后自由现金流"] : ["Free cash flow", "自由现金流"];
      basis = kind === "operating" ? ["Company-wide, generally accepted accounting basis", "公司整体，公认会计准则口径"] : ["Company-wide, company-defined non-standard accounting measure", "公司整体，公司自定义的非公认会计准则指标"];
      expectedClass = guidance ? "reported_guidance" : "reported_cashflow";
      if (guidance) {
        const endpoint: Copy = guidance[2] === "low" ? ["lower bound", "下限"] : guidance[2] === "high" ? ["upper bound", "上限"] : ["point estimate", "单点估计"];
        title = [`${title[0]} guidance - ${endpoint[0]}`, `${title[1]}指引－${endpoint[1]}`];
        nature = key.endsWith("_prior") ? ["Earlier company guidance, not a reported result", "先前公司指引，并非已披露业绩"] : ["Company guidance, not a reported result", "公司指引，并非已披露业绩"];
      } else if (key.endsWith("_prior")) nature = ["Disclosed prior-period comparison", "披露中的上年同期比较"];
    } else if (working && fact.accounting_basis === `issuer_reported_consolidated:GAAP_cashflow_change_in_${working[1]}`) {
      title = WORKING_CAPITAL[working[1]]; basis = ["Company-wide cash-flow change, not a balance-sheet level", "公司整体现金流变动，并非资产负债表余额"];
      expectedClass = "reported_cashflow";
      if (key.endsWith("_prior")) nature = ["Disclosed prior-period comparison", "披露中的上年同期比较"];
    } else if (backlog) {
      const kind = backlog[1] && backlog[1] !== "prior" ? backlog[1] : "total";
      if (fact.accounting_basis !== `issuer_reported_consolidated:${kind}_backlog_stock`) return null;
      title = BACKLOG[kind]; basis = ["Company-wide backlog balance, not sales or new orders", "公司整体积压订单余额，并非销售额或新增订单"];
      expectedClass = "reported_backlog";
      nature = backlog[1] === "prior" ? ["Earlier disclosed balance", "先前披露的余额"] : ["Disclosed backlog balance", "已披露积压订单余额"];
    }
  }
  if (!title || !basis || fact.fact_class !== expectedClass || (expectedUnit === "percent" ? fact.unit !== "percent" : !["USD_million", "USD_billion"].includes(fact.unit))) return null;
  return {
    title: local(title, lang), basis: local(basis, lang), nature: local(nature, lang),
    value: new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", { maximumFractionDigits: 10 }).format(fact.value) + (fact.unit === "percent" ? "%" : ""),
    unit: fact.unit === "USD_million" ? local(["USD million", "百万美元"], lang) : fact.unit === "USD_billion" ? local(["USD billion", "十亿美元"], lang) : "",
    period: defensePeriodText(fact.period, lang), originalTerms: false,
  };
}
