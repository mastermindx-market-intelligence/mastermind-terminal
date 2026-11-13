"use client";
import { useCallback } from "react";
import { useLang } from "@/lib/i18n";
export const MEDTECH_LEX: Record<string, [string, string]> = {
  "refreshing": ["Refreshing the current view…", "正在刷新当前视图……"],
  "fieldFamily": ["Field group", "字段类别"],
  "title": [
    "Regulatory watchdesk",
    "监管观察台"
  ],
  "subtitle": [
    "Follow FDA decisions and changes to the records you watch.",
    "跟踪 FDA 决定及关注记录的变化。"
  ],
  "records": [
    "FDA records",
    "FDA 记录"
  ],
  "watches": [
    "My watches",
    "我的关注"
  ],
  "sources": [
    "Sources & coverage",
    "来源与覆盖范围"
  ],
  "monthly": [
    "Monthly FDA reference data",
    "FDA 月度参考数据"
  ],
  "search": [
    "Search device, applicant or submission",
    "搜索器械、申请人或申报编号"
  ],
  "searchAction": [
    "Search",
    "搜索"
  ],
  "clear": [
    "Clear filters",
    "清除筛选"
  ],
  "pathway": [
    "Pathway",
    "监管路径"
  ],
  "allPathways": [
    "All pathways",
    "全部路径"
  ],
  "decision": [
    "FDA decision",
    "FDA 决定"
  ],
  "allDecisions": [
    "All decisions",
    "全部决定"
  ],
  "decisionDate": [
    "Decision date",
    "决定日期"
  ],
  "applicant": [
    "Applicant",
    "申请人"
  ],
  "device": [
    "Device / submission",
    "器械 / 申报"
  ],
  "sourceRecord": [
    "Source record",
    "来源记录"
  ],
  "openRecord": [
    "Open record",
    "打开记录"
  ],
  "watch": [
    "Watch",
    "关注"
  ],
  "watching": [
    "Watching",
    "已关注"
  ],
  "watchRecord": [
    "Watch this record",
    "关注此记录"
  ],
  "watchFamily": [
    "Watch this PMA family",
    "关注此 PMA 系列"
  ],
  "watchSettings": [
    "Watch settings",
    "关注设置"
  ],
  "saveWatch": [
    "Save watch",
    "保存关注"
  ],
  "saveSettings": [
    "Save settings",
    "保存设置"
  ],
  "saving": [
    "Saving…",
    "保存中……"
  ],
  "saved": [
    "Watch saved",
    "已保存关注"
  ],
  "settingsSaved": [
    "Watch settings saved",
    "关注设置已保存"
  ],
  "removeWatch": [
    "Remove watch",
    "移除关注"
  ],
  "removed": [
    "Watch removed",
    "已移除关注"
  ],
  "removeConfirm": [
    "Remove this watch and its review marks?",
    "移除此关注及其已阅标记？"
  ],
  "removeCopy": [
    "The FDA record stays available. A new watch will start with a new baseline.",
    "FDA 记录仍可查看。重新关注将建立新的起始记录。"
  ],
  "cancel": [
    "Cancel",
    "取消"
  ],
  "close": [
    "Close",
    "关闭"
  ],
  "done": [
    "Done",
    "完成"
  ],
  "scope": [
    "What to watch",
    "关注范围"
  ],
  "exactRecord": [
    "This submission only",
    "仅此申报"
  ],
  "pmaFamily": [
    "PMA application and its supplements",
    "PMA 申请及其补充申请"
  ],
  "recordChanged": [
    "Changes to the record",
    "记录变化"
  ],
  "newSupplement": [
    "New supplements",
    "新的补充申请"
  ],
  "triggerLabel": [
    "Show me",
    "向我显示"
  ],
  "atLeastOne": [
    "Choose at least one change type.",
    "至少选择一种变化类型。"
  ],
  "baselineNote": [
    "Your watch starts from the saved record. Older records do not become new developments.",
    "从保存时的记录开始关注。旧记录不会被当作新进展。"
  ],
  "familyNote": [
    "New-supplement updates require a decision dated after the day you start watching.",
    "新的补充申请更新需有晚于开始关注当天的决定日期。"
  ],
  "inAppOnly": [
    "Changes appear here when you return. Email and push delivery are not connected.",
    "返回此处可查看变化。尚未连接邮件和推送通知。"
  ],
  "baseline": [
    "Watching since",
    "关注开始时间"
  ],
  "reviewChanges": [
    "Review changes",
    "查看变化"
  ],
  "manage": [
    "Manage",
    "管理"
  ],
  "backRecords": [
    "Back to records",
    "返回记录"
  ],
  "backWatches": [
    "Back to my watches",
    "返回我的关注"
  ],
  "backChanges": [
    "Back to changes",
    "返回变化"
  ],
  "history": [
    "Record history",
    "记录历史"
  ],
  "observed": [
    "Observed",
    "观察时间"
  ],
  "first_observed": [
    "First observed",
    "首次观察"
  ],
  "source_record_changed": [
    "FDA record changed",
    "FDA 记录变化"
  ],
  "normalization_changed": [
    "Interpretation corrected",
    "解析修正"
  ],
  "source_and_normalization_changed": [
    "Source and interpretation changed",
    "来源及解析均变化"
  ],
  "unknownChange": [
    "Record revision",
    "记录修订"
  ],
  "firstObservedCopy": [
    "This is our starting observation, not a new FDA announcement.",
    "这是初始观察记录，不代表 FDA 的新公告。"
  ],
  "normalizationCopy": [
    "This revision corrects how the source is read. It does not establish a new FDA action.",
    "此次修订更正了来源的解析方式，不构成新的 FDA 行动。"
  ],
  "combinedCopy": [
    "Both the source record and its interpretation changed in this revision.",
    "此次修订中，来源记录及其解析均有变化。"
  ],
  "noChanges": [
    "No changes since you started watching",
    "关注后暂无变化"
  ],
  "noChangesCopy": [
    "The original watch baseline is preserved. Check back after the source updates.",
    "原始关注起点已保留。来源更新后可再次查看。"
  ],
  "reviewed": [
    "Reviewed",
    "已阅"
  ],
  "markReviewed": [
    "Mark as reviewed",
    "标为已阅"
  ],
  "reviewing": [
    "Saving review…",
    "保存已阅状态……"
  ],
  "reviewSaved": [
    "This revision is marked as reviewed.",
    "此版本已标为已阅。"
  ],
  "reviewCopy": [
    "Review marks apply to this exact revision. A later revision will need a new review.",
    "已阅标记仅适用于此版本。后续修订需重新查看。"
  ],
  "previous": [
    "Previous",
    "此前"
  ],
  "now": [
    "Now",
    "现在"
  ],
  "field": [
    "Changed field",
    "变化字段"
  ],
  "absent": [
    "Not present",
    "未提供"
  ],
  "notReported": [
    "Not reported",
    "未报告"
  ],
  "viewFDA": [
    "View FDA record",
    "查看 FDA 记录"
  ],
  "evidence": [
    "Source evidence",
    "来源证据"
  ],
  "dataset": [
    "Dataset",
    "数据集"
  ],
  "datasetUpdated": [
    "Dataset updated",
    "数据集更新日期"
  ],
  "checked": [
    "Last checked",
    "最近检查"
  ],
  "publicationDate": [
    "Source publication time",
    "来源发布时间"
  ],
  "publicationUnknown": [
    "Not provided by this dataset",
    "此数据集未提供"
  ],
  "coverage": [
    "Decision-date coverage",
    "决定日期覆盖范围"
  ],
  "completeQuery": [
    "Complete for this date range",
    "此日期范围内采集完整"
  ],
  "incompleteQuery": [
    "Incomplete date range",
    "此日期范围采集未完成"
  ],
  "referenceCopy": [
    "These datasets update monthly. Observation dates show when we saw a record, not when FDA announced it.",
    "这些数据集按月更新。观察日期表示发现记录的时间，不代表 FDA 公告时间。"
  ],
  "limitations": [
    "What this evidence supports",
    "证据范围"
  ],
  "limitationsCopy": [
    "FDA submission outcomes and record revisions. It does not establish a future decision date, listed-company exposure, reimbursement or commercial adoption.",
    "FDA 申报结果及记录修订。不能据此确定未来决定日期、上市公司敞口、支付覆盖或商业采用。"
  ],
  "deNovoCoverage": [
    "De Novo records are included when returned by the 510(k) dataset; this is not a complete standalone De Novo feed.",
    "包含 510(k) 数据集返回的 De Novo 记录，并非完整的独立 De Novo 数据源。"
  ],
  "retained": [
    "The latest refresh failed. The last verified records remain available.",
    "最近刷新失败。仍可查看上次验证的记录。"
  ],
  "overdue": [
    "The source dataset is older than 45 days.",
    "来源数据集已超过 45 天未更新。"
  ],
  "snapshotChanged": [
    "New source data is available. Refresh this view before saving or reviewing.",
    "来源已更新。请刷新此视图后再保存或标记已阅。"
  ],
  "refresh": [
    "Refresh view",
    "刷新视图"
  ],
  "retry": [
    "Try again",
    "重试"
  ],
  "loading": [
    "Loading records…",
    "加载记录中……"
  ],
  "loadingWatches": [
    "Loading your watches…",
    "加载关注中……"
  ],
  "loadingDetail": [
    "Loading this record…",
    "加载此记录中……"
  ],
  "loadingChanges": [
    "Loading changes…",
    "加载变化中……"
  ],
  "loadMore": [
    "Load more",
    "加载更多"
  ],
  "loadingMore": [
    "Loading…",
    "加载中……"
  ],
  "showing": [
    "Showing",
    "显示"
  ],
  "of": [
    "of",
    "/"
  ],
  "recordCount": [
    "records",
    "条记录"
  ],
  "noResults": [
    "No matching FDA records",
    "没有匹配的 FDA 记录"
  ],
  "noResultsCopy": [
    "Try a device name, applicant or exact submission number.",
    "请尝试器械名称、申请人或完整申报编号。"
  ],
  "noWatches": [
    "Your watchdesk starts with a record",
    "从一条记录开始关注"
  ],
  "noWatchesCopy": [
    "Browse FDA records and save the submissions you want to follow.",
    "浏览 FDA 记录，保存你希望跟踪的申报。"
  ],
  "browse": [
    "Browse FDA records",
    "浏览 FDA 记录"
  ],
  "unavailable": [
    "This data could not be loaded",
    "暂时无法加载数据"
  ],
  "retainedUnavailable": [
    "The latest request failed. Previously loaded records are still shown.",
    "最近请求失败。仍显示此前已加载的记录。"
  ],
  "watchesUnavailable": [
    "Your watches could not be read",
    "暂时无法读取关注"
  ],
  "watchesUnavailableCopy": [
    "Your saved watches are not confirmed. Reload them before making a change.",
    "无法确认已保存的关注。请重新加载后再更改。"
  ],
  "sourceUnavailable": [
    "Source records are temporarily unavailable. Try again shortly.",
    "来源记录暂时不可用。请稍后重试。"
  ],
  "missingRecord": [
    "This record is unavailable in the current dataset",
    "当前数据集中没有此记录"
  ],
  "missingWatch": [
    "This watch no longer exists",
    "此关注已不存在"
  ],
  "accessTitle": [
    "Sign in to open your watchdesk",
    "登录以打开观察台"
  ],
  "accessCopy": [
    "Your watches and review marks belong to your account.",
    "关注和已阅标记保存在你的账户中。"
  ],
  "signIn": [
    "Sign in",
    "登录"
  ],
  "subscriptionTitle": [
    "A subscription is required",
    "需要订阅"
  ],
  "subscriptionCopy": [
    "Your account does not currently have access to this FDA dataset.",
    "你的账户目前没有此 FDA 数据集的访问权限。"
  ],
  "plans": [
    "View plans",
    "查看方案"
  ],
  "rateLimited": [
    "Too many requests. Wait a moment, then try again.",
    "请求过多。请稍后重试。"
  ],
  "mutationUnknown": [
    "This change could not be confirmed. Reload your watches before trying again.",
    "无法确认此次更改。请重新加载关注后再尝试。"
  ],
  "watchConflict": [
    "This watch changed in another session. Reload and review its current settings.",
    "此关注已在其他会话中更改。请重新加载并检查当前设置。"
  ],
  "quota": [
    "You have reached the 50-watch limit. Remove a watch before adding another.",
    "已达到 50 条关注上限。请先移除一条再添加。"
  ],
  "unavailableRevision": [
    "This change is no longer available in this view. Refresh before reviewing.",
    "此视图中已无法查看该变化。请刷新后再标记已阅。"
  ],
  "reloadWatches": [
    "Reload my watches",
    "重新加载关注"
  ],
  "originalScope": [
    "Watch scope",
    "关注范围"
  ],
  "received": [
    "Received by FDA",
    "FDA 收件日期"
  ],
  "productCode": [
    "Product code",
    "产品代码"
  ],
  "genericName": [
    "Generic device name",
    "器械通用名称"
  ],
  "supplement": [
    "Supplement",
    "补充申请"
  ],
  "supplementType": [
    "Supplement type",
    "补充申请类型"
  ],
  "supplementReason": [
    "Supplement reason",
    "补充申请原因"
  ],
  "decisionCode": [
    "FDA decision code",
    "FDA 决定代码"
  ],
  "unmappedCopy": [
    "The native decision code is retained; no approval or clearance is inferred.",
    "保留原始决定代码；不据此推断批准或准许上市。"
  ],
  "pathway_510k": [
    "510(k)",
    "510(k)"
  ],
  "pathway_de_novo": [
    "De Novo",
    "De Novo"
  ],
  "pathway_pma_original": [
    "Original PMA",
    "原始 PMA"
  ],
  "pathway_pma_supplement": [
    "PMA supplement",
    "PMA 补充申请"
  ],
  "pathway_pma_panel_track_supplement": [
    "PMA panel-track supplement",
    "PMA 专家组审查补充申请"
  ],
  "pathway_other_device_submission": [
    "Other device submission",
    "其他器械申报"
  ],
  "status_cleared": [
    "Cleared",
    "准许上市"
  ],
  "status_granted": [
    "Granted",
    "获准"
  ],
  "status_approved": [
    "Approved",
    "批准"
  ],
  "status_not_substantially_equivalent": [
    "Not substantially equivalent",
    "非实质等同"
  ],
  "status_denied": [
    "Denied",
    "拒绝"
  ],
  "status_withdrawn": [
    "Withdrawn",
    "撤回"
  ],
  "status_unmapped": [
    "Decision recorded",
    "已记录决定"
  ],
  "watchLimit": [
    "50 watches per account",
    "每个账户可关注 50 条"
  ]
};
export function useMedTechT() {
  const { lang } = useLang();
  return useCallback((key: string) => MEDTECH_LEX[key]?.[lang === "zh" ? 1 : 0] ?? MEDTECH_LEX.notReported[lang === "zh" ? 1 : 0], [lang]);
}
