"use client";
import { useCallback } from "react";
import { useLang, useT } from "./i18n";

/** Feature-local EN/ZH copy for the chart capture review (E19). Language state stays the shared
 * LangProvider; keeping this copy out of the global dictionary keeps it out of every route. */
export const CHART_CAPTURE_LEX: Record<string, [string, string]> = {
  ccMenuReview: ["Review & save…", "检查并保存…"],
  ccTitle: ["Review capture", "检查截图"],
  ccPreparing: ["Capturing the chart…", "正在截取图表…"],
  ccLocalOnly: ["Files stay on this device. Nothing is uploaded.", "文件仅保存在本设备，不会上传。"],
  ccPreviewAlt: ["Preview of the image that will be saved", "将要保存的图片预览"],
  ccDetailsHeading: ["What this image shows", "图片包含的信息"],

  ccFieldInstrument: ["Chart", "图表"],
  ccFieldCaptured: ["Captured (this device's clock)", "截取时间（本设备时钟）"],
  ccFieldMarket: ["Latest market data shown", "图中最新行情"],
  ccFieldPublished: ["Published by the data source", "数据源发布时间"],
  ccFieldData: ["Chart data", "图表数据"],
  ccFieldView: ["Visible range", "可见区间"],
  ccFieldLayers: ["Included", "已包含"],
  ccFieldNotCaptured: ["On screen but not in the image", "屏幕上有但图片中没有"],
  ccFieldHidden: ["Hidden studies (not in the image)", "已隐藏的指标（不在图片中）"],
  ccFieldReplay: ["Bar Replay", "K线回放"],
  ccReplayOn: ["On — the chart shows a replayed past position", "开启 — 图表显示的是回放中的历史位置"],

  ccPublishedNotProvided: ["Not provided by the data source", "数据源未提供"],
  ccNotAvailable: ["Not available", "不可用"],
  ccQuoteLive: ["live quote", "实时报价"],
  ccQuoteDelayed: ["15-minute delayed quote", "延迟15分钟报价"],
  ccQuoteOther: ["quote", "报价"],
  ccQuoteNoTime: ["time not reported", "未报告时间"],
  ccBarSession: ["trading day", "交易日"],
  ccBarOpen: ["bar opening time", "K线开盘时间"],
  ccCopyCurrent: ["Current read", "最新读取"],
  ccCopySaved: ["Saved copy", "已保存副本"],
  ccCopyUnreported: ["Freshness not reported for this chart", "此图表未报告数据新鲜度"],
  ccRefreshPending: ["refresh still running", "刷新进行中"],
  ccRefreshOk: ["newer data loaded since, not shown", "此后已载入较新数据，图中未显示"],
  ccRefreshFailed: ["refresh failed", "刷新失败"],
  ccRefreshSuperseded: ["refresh replaced by a later one", "刷新已被后续刷新取代"],
  ccUnitSec: ["s", "秒"],
  ccUnitMin: ["min", "分钟"],
  ccUnitHour: ["h", "小时"],
  ccUnitDay: ["d", "天"],

  ccLayerPrice: ["Price chart", "价格图"],
  ccLayerIndicators: ["Indicators", "指标"],
  ccLayerSignals: ["Signals", "信号"],
  ccLayerLabels: ["Study names", "指标名称"],
  ccLayerTables: ["Indicator tables", "指标表格"],
  ccLayerAnnotations: ["My drawings", "我的画线"],
  ccLayerOther: ["Other", "其他"],
  ccMissingPriceTag: ["Price tag", "价格标签"],
  ccMissingExtendedTag: ["Extended-hours tag", "盘前盘后标签"],
  ccMissingCountdown: ["Bar countdown", "K线倒计时"],

  ccFooterCaptured: ["Captured", "截取"],
  ccFooterMarket: ["Market data:", "行情："],
  ccFooterPublishedNone: ["Source publish time: not provided", "数据源发布时间：未提供"],
  ccFooterData: ["Data:", "数据："],
  ccFooterAnnotationsExcluded: ["Drawings not included", "未包含画线"],
  ccFooterAnnotationsIncluded: ["Includes drawings", "包含画线"],
  ccFooterHidden: ["Hidden studies:", "隐藏指标："],
  ccFooterReplay: ["Bar Replay position", "K线回放位置"],

  ccIncludeDrawings: ["Include my drawings", "包含我的画线"],
  ccDrawingsPrivate: ["Your drawings are private and left out unless you include them.", "画线属于个人内容，除非你选择包含，否则不会出现在图片中。"],
  ccDrawingsNone: ["No drawings on this chart.", "此图表没有画线。"],

  ccSaveImage: ["Save image", "保存图片"],
  ccSaveDetails: ["Save details (JSON)", "保存详情（JSON）"],
  ccCopyImage: ["Copy image", "复制图片"],
  ccCaptureAgain: ["Capture again", "重新截取"],
  ccClose: ["Close", "关闭"],

  ccDownloadStarted: ["Image download started.", "图片已开始下载。"],
  ccDetailsStarted: ["Details download started.", "详情已开始下载。"],
  ccCopied: ["Image copied.", "图片已复制。"],
  ccCopyFailed: ["Copy failed. Nothing was shared.", "复制失败，未分享任何内容。"],
  ccCopyUnsupported: ["This browser cannot copy images. Save the image instead.", "此浏览器无法复制图片，请改为保存图片。"],
  ccHashUnavailable: ["The image fingerprint could not be computed in this browser.", "此浏览器无法计算图片指纹。"],
  ccWithheld: ["The chart changed while it was being captured, so nothing was saved. Capture again.", "截取期间图表发生了变化，因此未保存任何内容。请重新截取。"],
  ccNoData: ["There is no chart data to capture yet.", "暂无可截取的图表数据。"],
  ccUnavailable: ["The chart could not be captured. Nothing was saved.", "无法截取图表，未保存任何内容。"],
};

export function useCaptureT() {
  const { lang } = useLang();
  const sharedT = useT();
  return useCallback((key: string, fallback?: string): string => {
    const pair = CHART_CAPTURE_LEX[key];
    return pair ? pair[lang === "zh" ? 1 : 0] : sharedT(key, fallback);
  }, [lang, sharedT]);
}
