"use client";
import { useCallback } from "react";
import { useLang, type Lang } from "./i18n";
/** Feature-local EN/ZH copy for the study-template library (E07). Language state remains the shared
 * LangProvider; keeping this copy out of the global LEX preserves unrelated screen evidence.
 * Placeholders are `{name}` and are filled by `studyTemplatesText`. No mutable registration/store.
 */
export const STUDY_TEMPLATES_LEX: Record<string, [string, string]> = {
  // ── titles, buttons ──
  stplLibraryTitle: ["Study templates", "指标模板"],
  stplSaveTitle: ["Save study template", "保存指标模板"],
  stplNavLabel: ["Study templates", "指标模板"],
  stplNameLabel: ["Template name", "模板名称"],
  stplNamePlaceholder: ["For example, Swing setup", "例如：波段设置"],
  stplSave: ["Save", "保存"],
  stplSaving: ["Saving…", "正在保存…"],
  stplCancel: ["Cancel", "取消"],
  stplClose: ["Close", "关闭"],
  stplBack: ["Back to templates", "返回模板列表"],
  stplApply: ["Apply", "应用"],
  stplApplying: ["Applying…", "正在应用…"],
  stplRetry: ["Try again", "重试"],
  stplReload: ["Reload", "重新加载"],
  stplRename: ["Rename", "重命名"],
  stplRenameSave: ["Save name", "保存名称"],
  stplDelete: ["Delete", "删除"],
  stplDeleteConfirm: ["Delete “{name}”? This can’t be undone.", "删除“{name}”？此操作无法撤销。"],
  stplCopyToAccount: ["Copy to account", "复制到账户"],
  stplReplaceExisting: ["Replace existing", "覆盖同名模板"],
  stplSaveCurrent: ["Save current studies", "保存当前指标"],

  // ── destinations ──
  stplSaveTo: ["Save to", "保存到"],
  stplDestAccount: ["Your account", "你的账户"],
  stplDestAccountHint: ["Opens on every device you sign in to", "在你登录的所有设备上可用"],
  stplDestDevice: ["This device", "本设备"],
  stplDestDeviceHint: ["Only in this browser", "仅保存在此浏览器"],
  stplGuestDeviceOnly: ["Guest templates stay on this device. Sign in to keep them on every device.", "访客模板仅保存在本设备。登录后可在所有设备上使用。"],
  stplDeviceSuffix: ["This device", "本设备"],

  // ── capture summary ──
  stplCaptureCount: ["{count} studies will be saved with their settings.", "将保存 {count} 个指标及其设置。"],
  stplCaptureCountOne: ["1 study will be saved with its settings.", "将保存 1 个指标及其设置。"],
  stplCaptureExcluded: ["Not saved: {list}", "未保存：{list}"],
  stplCaptureNothing: ["Add a study to the chart first. There is nothing to save yet.", "请先在图表上添加指标，目前没有可保存的内容。"],
  stplCaptureScope: ["Templates keep studies only. Symbol, drawings, compare overlays and scripts stay with the chart.", "模板只保存指标。代码、画线、对比叠加和脚本仍保留在图表中。"],

  // ── write errors (never “Saved”) ──
  stplErrInvalidName: ["Enter a name for the template.", "请输入模板名称。"],
  stplErrNameTooLong: ["Use {max} characters or fewer.", "名称不能超过 {max} 个字符。"],
  stplErrEmpty: ["Add a study to the chart first. Nothing was saved.", "请先在图表上添加指标。未保存任何内容。"],
  stplErrTooMany: ["A template holds up to {max} studies. Nothing was saved.", "每个模板最多 {max} 个指标。未保存任何内容。"],
  stplErrTooLarge: ["These settings are too large for one template. Nothing was saved.", "这些设置超出单个模板的大小。未保存任何内容。"],
  stplErrInvalidBody: ["These settings can’t be stored as a template. Nothing was saved.", "这些设置无法保存为模板。未保存任何内容。"],
  stplErrNameTaken: ["A template with this name already exists.", "已存在同名模板。"],
  stplErrLimit: ["You have {max} templates here, the most allowed. Delete one first. Nothing was saved.", "此处已有 {max} 个模板，已达上限。请先删除一个。未保存任何内容。"],
  stplErrUnavailable: ["Couldn’t reach your account. Nothing was saved. Try again.", "无法连接到你的账户。未保存任何内容。请重试。"],
  stplErrSignedOut: ["You’re signed out. Sign in again to use your account templates. Nothing was saved.", "你已退出登录。请重新登录以使用账户模板。未保存任何内容。"],
  stplErrStorageBlocked: ["This browser is blocking storage. Nothing was saved on this device.", "此浏览器禁止本地存储。本设备未保存任何内容。"],
  stplErrUnreadable: ["Templates on this device can’t be read, so nothing was changed.", "本设备上的模板无法读取，因此未做任何更改。"],
  stplErrWriteFailed: ["Couldn’t save on this device. Nothing was saved.", "无法保存到本设备。未保存任何内容。"],
  stplErrConflict: ["This template was changed on another device. Reload to see the latest version. Nothing was changed.", "此模板已在其他设备上更改。请重新加载查看最新版本。未做任何更改。"],
  stplErrNewer: ["A newer version of the app saved this template, so it can’t be changed here.", "此模板由较新版本的应用保存，无法在此修改。"],
  stplErrNotFound: ["This template no longer exists.", "此模板已不存在。"],
  stplErrDeleteFailed: ["Couldn’t delete. Nothing was removed.", "删除失败。未移除任何内容。"],
  stplErrRenameFailed: ["Couldn’t rename. The old name was kept.", "重命名失败。已保留原名称。"],

  // ── library ──
  stplSectionAccount: ["Your account", "你的账户"],
  stplSectionDevice: ["This device", "本设备"],
  stplLoading: ["Loading templates…", "正在加载模板…"],
  stplAccountUnavailable: ["Account templates can’t be loaded right now. Your templates were not changed.", "暂时无法加载账户模板。你的模板未受影响。"],
  stplAccountSignedOut: ["Sign in to see the templates saved to your account.", "登录后可查看账户中保存的模板。"],
  stplAccountEmpty: ["No templates in your account yet.", "账户中还没有模板。"],
  stplDeviceEmpty: ["No templates on this device.", "本设备上没有模板。"],
  stplDeviceBlocked: ["This browser is blocking storage, so templates on this device can’t be shown.", "此浏览器禁止本地存储，因此无法显示本设备上的模板。"],
  stplDeviceUnreadable: ["Templates on this device can’t be read. They were left as they are.", "本设备上的模板无法读取，已原样保留。"],
  stplUnreadableCount: ["{count} saved entries can’t be read by this version and were left as they are.", "有 {count} 条已保存记录无法被此版本读取，已原样保留。"],
  stplTruncated: ["Showing the newest templates only.", "仅显示最新的模板。"],
  stplRowStudies: ["{count} studies", "{count} 个指标"],
  stplRowStudiesOne: ["1 study", "1 个指标"],
  stplRowNewer: ["Newer version", "较新版本"],
  stplRowLegacy: ["Older format", "旧格式"],
  stplPickTemplate: ["Choose a template to preview what it changes.", "选择一个模板以预览其更改。"],

  // ── preview ──
  stplModeLabel: ["How to apply", "应用方式"],
  stplModeReplace: ["Replace chart studies", "替换图表指标"],
  stplModeReplaceHint: ["The chart’s studies become this template’s studies.", "图表的指标将替换为此模板的指标。"],
  stplModeMerge: ["Add to chart", "添加到图表"],
  stplModeMergeHint: ["Keep the chart’s studies and add this template’s.", "保留图表现有指标并加入此模板的指标。"],
  stplPreviewAdded: ["Added", "新增"],
  stplPreviewRemoved: ["Removed", "移除"],
  stplPreviewChanged: ["Changed", "更改"],
  stplPreviewUnchanged: ["{count} studies stay as they are", "{count} 个指标保持不变"],
  stplPreviewUnchangedOne: ["1 study stays as it is", "1 个指标保持不变"],
  stplPreviewNotApplied: ["Not applied", "未应用"],
  stplPreviewNoop: ["Applying this template would not change the chart.", "应用此模板不会改变图表。"],
  stplChangeVisibility: ["shown or hidden", "显示状态"],
  stplChangeOther: ["{count} more settings", "另外 {count} 项设置"],
  stplChangeOtherOne: ["1 more setting", "另外 1 项设置"],
  stplUnknownStudy: ["Study not recognized", "无法识别的指标"],
  stplCompareOverlay: ["Compare overlay", "对比叠加"],
  stplScript: ["Script", "脚本"],
  stplReasonUnsupportedMultiplicity: ["This study can be on a chart only once", "此指标在图表上只能添加一次"],
  stplReasonOverCap: ["The chart already has the most of this study ({max})", "图表上此指标已达上限（{max}）"],
  stplReasonCollision: ["Already on the chart, left as it is", "已在图表上，保持不变"],
  stplReasonUnknown: ["Not available in this version", "此版本不可用"],
  stplReasonNotPortable: ["Stays with the chart", "保留在图表中"],
  stplReasonGuestLimit: ["Guest charts show up to {max} studies. Sign in for more", "访客图表最多显示 {max} 个指标，登录可使用更多"],
  stplNoticeUntouched: ["Symbol, drawings, watchlists, alerts, data settings and Day Trade Mode are not changed.", "代码、画线、自选列表、提醒、数据设置和日内交易模式均不会改变。"],
  stplNoticeLocked: ["{count} modules in this template need a higher plan and stay locked.", "此模板中有 {count} 个模块需要更高级的方案，将保持锁定。"],
  stplNoticeLockedOne: ["1 module in this template needs a higher plan and stays locked.", "此模板中有 1 个模块需要更高级的方案，将保持锁定。"],
  stplNoticeNewer: ["A newer version of the app saved this template. Anything this version can’t use is listed under Not applied.", "此模板由较新版本的应用保存。此版本无法使用的部分列在“未应用”中。"],
  stplNoticeChartChanged: ["The chart changed after this preview. Check the updated changes, then apply again.", "预览后图表已更改。请查看更新后的更改，然后重新应用。"],

  // ── toasts ──
  stplToastSavedAccount: ["Template saved to your account", "模板已保存到账户"],
  stplToastSavedDevice: ["Template saved on this device", "模板已保存到本设备"],
  stplToastApplied: ["Template applied", "已应用模板"],
  stplToastDeleted: ["Template deleted", "模板已删除"],
  stplToastRenamed: ["Template renamed", "模板已重命名"],
  stplToastCopied: ["Copied to your account", "已复制到账户"],
  stplToastNotFound: ["That template is no longer available.", "该模板已不可用。"],
};

export type StudyTemplatesKey = keyof typeof STUDY_TEMPLATES_LEX;

/** Pure lookup + `{placeholder}` fill; an unknown key returns the key (never throws). */
export function studyTemplatesText(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const pair = STUDY_TEMPLATES_LEX[key];
  const template = pair ? pair[lang === "zh" ? 1 : 0] : key;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

export function useStudyTemplatesT() {
  const { lang } = useLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => studyTemplatesText(lang, key, vars), [lang]);
}
