"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/**
 * Feature-local EN/ZH copy for the two-call transcript comparison (E12).
 * Language state stays in the shared LangProvider; keeping this copy out of the
 * global lexicon keeps it off every other route and leaves unrelated screen
 * evidence untouched. `{name}` placeholders are filled by the hook below.
 */
export const TRANSCRIPT_COMPARE_LEX: Record<string, [string, string]> = {
  // entry + chrome
  tcOpen: ["Compare two calls", "对比两次电话会"],
  tcOpenWhy: ["Read two calls side by side, filtered by topic, speaker or section, with every passage linked to its source.", "并排阅读两次电话会，可按话题、发言人或环节筛选，每段内容均链接至原始出处。"],
  tcClose: ["Close comparison", "关闭对比"],
  tcEyebrow: ["CALL COMPARISON", "电话会对比"],
  tcTitle: ["Two calls, side by side", "两次电话会并排对比"],
  tcIntro: ["Each passage is quoted from the exact call and archive revision shown above it. Nothing is summarised, paraphrased or scored for meaning.", "每段内容均引自其上方标注的确切电话会与档案版本，不做任何摘要、改写或含义评分。"],
  tcCallA: ["Call A", "电话会 A"],
  tcCallB: ["Call B", "电话会 B"],
  tcSwap: ["Swap calls", "交换两次电话会"],
  tcNotListed: ["{id} · not in archive list", "{id} · 不在档案列表中"],
  tcSameCall: ["Choose two different calls", "请选择两次不同的电话会"],
  tcSameCallWhy: ["A call compared with itself shows nothing new.", "同一次电话会与自身对比不会显示新内容。"],
  // filters
  tcFilters: ["Comparison filters", "对比筛选"],
  tcTopic: ["Topic", "话题"],
  tcTopicPlaceholder: ["Exact word or phrase in both calls", "两次电话会中的准确词语或短语"],
  tcClearTopic: ["Clear topic", "清除话题"],
  tcSpeaker: ["Speaker", "发言人"],
  tcAllSpeakers: ["All speakers", "全部发言人"],
  tcSpeakerInBoth: ["{name} · in both calls", "{name} · 两次均有"],
  tcSpeakerOnlyA: ["{name} · only in A", "{name} · 仅 A"],
  tcSpeakerOnlyB: ["{name} · only in B", "{name} · 仅 B"],
  tcSection: ["Section", "环节"],
  tcSectionAll: ["All", "全部"],
  tcSectionPrepared: ["Prepared remarks", "管理层陈述"],
  tcSectionQa: ["Q&A", "问答"],
  tcMode: ["View", "视图"],
  tcModeSide: ["Side by side", "并排"],
  tcModeAlign: ["Shared wording", "相同措辞"],
  tcColumns: ["Choose which call to read", "选择要阅读的电话会"],
  // alignment
  tcAlignCaveat: ["Pairs below only share words. A pair does not show that a statement changed, that the same person said it, or why. Numbers are left out of the matching.", "以下配对仅表示用词相同，不代表表述发生变化、出自同一人或任何原因。匹配时不计数字。"],
  tcPairScore: ["{n} shared words · {pct}% word overlap", "{n} 个相同词 · 用词重合 {pct}%"],
  tcSharedTerms: ["Shared words", "相同词"],
  tcMoreTerms: ["{n} more shared words", "另有 {n} 个相同词"],
  tcPairs: ["{n} passage pairs with shared wording", "{n} 组用词相同的段落"],
  tcNoPairs: ["No passages share enough wording", "没有用词足够相同的段落"],
  tcNoPairsWhy: ["Every visible passage is listed below under its own call. Nothing is paired on a guess.", "所有可见段落均列在各自电话会下方，不做猜测配对。"],
  tcUnmatched: ["Without a shared-wording match in {call} ({n})", "{call} 中无相同措辞配对的段落（{n}）"],
  // column header
  tcRawLabel: ["Raw source text · not translated", "原文 · 未翻译"],
  tcRevision: ["Revision {sha}", "版本 {sha}"],
  tcPassageCount: ["{n} of {total} passages", "{total} 段中显示 {n} 段"],
  // passage card
  tcSegment: ["Segment {n}", "第 {n} 段"],
  tcInferredRole: ["inferred", "推断"],
  tcInferredTitle: ["Role inferred by Mastermind from source text; not independently verified.", "角色由 Mastermind 根据来源文本推断，未经独立核验。"],
  tcUnknownSpeaker: ["Unknown speaker", "未知发言人"],
  tcSecPrepared: ["Prepared", "陈述"],
  tcSecQa: ["Q&A", "问答"],
  tcSecHandoff: ["Q&A handoff", "转入问答"],
  tcSecUnknown: ["Section not verified", "环节未核实"],
  tcOpenSource: ["Open in source", "在原文中打开"],
  tcOpenSourceAria: ["Open segment {n} of {call} in the source transcript", "在原始记录中打开 {call} 第 {n} 段"],
  tcReference: ["Source reference", "出处引用"],
  tcCopyReference: ["Copy reference", "复制引用"],
  tcCopied: ["Copied", "已复制"],
  tcCopyFailed: ["Copy failed", "复制失败"],
  tcLocator: ["{key} · revision {sha} · bytes {start}–{end}", "{key} · 版本 {sha} · 字节 {start}–{end}"],
  tcReferenceNote: ["Identifies this exact passage without carrying its text.", "可唯一定位该段内容，但不含其文本。"],
  // load states
  tcLoading: ["Loading both calls…", "正在加载两次电话会…"],
  tcNotCovered: ["{call} is not in the verified archive", "{call} 不在已验证档案中"],
  tcNotCoveredWhy: ["No other call is shown in its place.", "不会以其他电话会代替显示。"],
  tcStaleTitle: ["{call} did not pass revision checks", "{call} 未通过版本核验"],
  tcStale_root_revision_missing: ["The archive lists this call without a revision fingerprint.", "档案列出了该电话会，但缺少版本指纹。"],
  tcStale_body_missing: ["The archive lists this call, but its document is missing.", "档案列出了该电话会，但其文档缺失。"],
  tcStale_body_invalid: ["The document could not be read as a transcript.", "该文档无法作为电话会记录读取。"],
  tcStale_body_hash_mismatch: ["The document differs from the revision the archive advertises.", "该文档与档案公布的版本不一致。"],
  tcStaleWhy: ["Its passages are withheld rather than shown from an unconfirmed copy.", "其段落暂不显示，以免展示未经确认的副本。"],
  tcUnavailable: ["Transcript archive unavailable", "电话会档案不可用"],
  tcUnavailableWhy: ["The archive revision list could not be read, so neither call can be confirmed.", "无法读取档案版本列表，因此两次电话会均无法确认。"],
  tcSideUnavailable: ["{call} could not be reached", "无法获取 {call}"],
  tcRetry: ["Retry", "重试"],
  // filter result states
  tcSpeakerAbsent: ["{speaker} has no turn in {call}", "{speaker} 在 {call} 中没有发言"],
  tcSpeakerAbsentWhy: ["No other speaker is shown in their place.", "不会以其他发言人代替显示。"],
  tcSectionUnidentified: ["The Q&A boundary of {call} is not verified", "{call} 的问答分界未经核实"],
  tcSectionUnidentifiedWhy: ["Choose All to read it; passages are not sorted into sections on a guess.", "请选择“全部”阅读；不会凭猜测划分环节。"],
  tcNoMatch: ["No passage in {call} matches", "{call} 中没有匹配的段落"],
  tcNoMatchWhy: ["The filters are applied literally to this call only.", "筛选条件仅按字面应用于该电话会。"],
  tcEmptyDoc: ["{call} has no spoken passages", "{call} 没有发言段落"],
  // shared-link states
  tcLinkCorrected: ["{call} changed since this link was made (revision {old} → {new}). Its passages are re-resolved against the current revision; earlier references to it no longer apply.", "自此链接生成以来，{call} 已更新（版本 {old} → {new}）。其段落已按当前版本重新定位；此前对它的引用不再适用。"],
  tcLinkInvalid: ["This comparison link names {ticker}, not {current}. It was not applied.", "此对比链接指向 {ticker}，而非 {current}，因此未予应用。"],
  // rights + sharing
  tcRightsTitle: ["Source and sharing", "来源与分享"],
  tcRights: ["Text is the DefeatBeta transcript corpus as normalized and indexed by Mastermind, not an issuer-hosted original, and is shown untranslated. Comparison links and receipts carry call IDs, revision fingerprints and offsets only, never transcript text. Opening a link re-checks the archive and shows only what the opener can already read in the transcript archive.", "正文来自 DefeatBeta 电话会语料库，经 Mastermind 标准化并建立索引，并非发行人托管的原始文件，且未经翻译。对比链接与凭证仅包含电话会 ID、版本指纹和偏移量，从不包含记录正文。打开链接时会重新核验档案，且只显示打开者本已可在电话会档案中阅读的内容。"],
  tcCopyLink: ["Copy comparison link", "复制对比链接"],
  tcCopyReceipt: ["Copy comparison receipt", "复制对比凭证"],
  tcVerify: ["Re-verify references", "重新核验引用"],
  tcVerifying: ["Re-checking against the archive…", "正在对照档案重新核验…"],
  tcVerified: ["All {n} passage references re-resolved to the identical source text.", "全部 {n} 条段落引用均重新定位到相同的原文。"],
  tcVerifiedPairs: ["{n} shared-wording pairs recomputed with the same scores.", "{n} 组相同措辞配对已按相同分数重新计算。"],
  tcVerifyFailed: ["The comparison could not be reconstructed", "无法重建此对比"],
  tcReceiptUnavailable: ["A receipt needs both calls loaded and verified.", "生成凭证需两次电话会均已加载并通过核验。"],
  tcTooManyPassages: ["Narrow the filters to at most 512 passages per call to make a receipt.", "请收窄筛选，使每次电话会不超过 512 段后再生成凭证。"],
  // reconstruction problems
  tcProblem_invalid_receipt: ["The receipt is malformed or its identifier does not match its contents.", "凭证格式错误，或其标识与内容不符。"],
  tcProblem_archive_unavailable: ["The archive could not be read.", "无法读取档案。"],
  tcProblem_not_covered: ["{call} is no longer in the archive.", "{call} 已不在档案中。"],
  tcProblem_stale_revision: ["{call} did not pass revision checks.", "{call} 未通过版本核验。"],
  tcProblem_revision_changed: ["{call} was corrected (revision {old} → {new}); its offsets no longer apply.", "{call} 已更正（版本 {old} → {new}）；其偏移量不再适用。"],
  tcProblem_segment_missing: ["A referenced segment of {call} no longer exists.", "{call} 中被引用的段落已不存在。"],
  tcProblem_span_mismatch: ["A referenced passage of {call} no longer matches its fingerprint.", "{call} 中被引用的段落与其指纹不再一致。"],
  tcProblem_pair_unsupported: ["A claimed shared-wording pair no longer has the same score.", "所声称的相同措辞配对分数已不一致。"],
};

export type TranscriptCompareVars = Record<string, string | number>;

/** `t(key, vars?)` over the feature lexicon, falling back to the shared lexicon. */
export function useTranscriptCompareT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, vars?: TranscriptCompareVars): string => {
    const pair = TRANSCRIPT_COMPARE_LEX[key];
    const template = pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
  }, [lang, sharedT]);
}
