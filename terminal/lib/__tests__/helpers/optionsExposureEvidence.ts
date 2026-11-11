// One runtime owns native evidence selection for CI and the typed consumers.
import { createRequire } from "node:module";
export type { EvidenceKind, EvidenceProfile } from "../../../e2e/tools/optionsExposureEvidence.cjs";
const runtime: typeof import("../../../e2e/tools/optionsExposureEvidence.cjs") =
  createRequire(import.meta.url)("../../../e2e/tools/optionsExposureEvidence.cjs");

export const requireSourceKeys: typeof runtime.requireSourceKeys = runtime.requireSourceKeys;
export const selectWholeFingerprint: typeof runtime.selectWholeFingerprint = runtime.selectWholeFingerprint;
export const projectR4CaptureHarness: typeof runtime.projectR4CaptureHarness = runtime.projectR4CaptureHarness;
export const projectIndicatorGuardBrowserSources: typeof runtime.projectIndicatorGuardBrowserSources = runtime.projectIndicatorGuardBrowserSources;
export const layoutSources: typeof runtime.layoutSources = runtime.layoutSources;
export const requireR4ChartIdentity: typeof runtime.requireR4ChartIdentity = runtime.requireR4ChartIdentity;
export const qualifiedOptionsExposurePacket: typeof runtime.qualifiedOptionsExposurePacket = runtime.qualifiedOptionsExposurePacket;
export const masterIntegrationInputs: typeof runtime.masterIntegrationInputs = runtime.masterIntegrationInputs;
export const MASTER_BROWSER_SPECS: typeof runtime.MASTER_BROWSER_SPECS = runtime.MASTER_BROWSER_SPECS;
export const masterIntegrationBrowserInputs: typeof runtime.masterIntegrationBrowserInputs = runtime.masterIntegrationBrowserInputs;
export const uiCopyIntegrationInputs: typeof runtime.uiCopyIntegrationInputs = runtime.uiCopyIntegrationInputs;
export const uiCopyIntegrationBrowserInputs: typeof runtime.uiCopyIntegrationBrowserInputs = runtime.uiCopyIntegrationBrowserInputs;
export const requireIntegrationExecution: typeof runtime.requireIntegrationExecution = runtime.requireIntegrationExecution;
export const optionalQualifiedOptionsExposurePacket: typeof runtime.optionalQualifiedOptionsExposurePacket = runtime.optionalQualifiedOptionsExposurePacket;

export const optionsIntegrationInputs: typeof runtime.optionsIntegrationInputs = runtime.optionsIntegrationInputs;
export const OPTIONS_INTEGRATION_BROWSER_SPECS: typeof runtime.OPTIONS_INTEGRATION_BROWSER_SPECS = runtime.OPTIONS_INTEGRATION_BROWSER_SPECS;
export const optionsIntegrationBrowserInputs: typeof runtime.optionsIntegrationBrowserInputs = runtime.optionsIntegrationBrowserInputs;
export const requireOptionsIntegrationBrowserCases: typeof runtime.requireOptionsIntegrationBrowserCases = runtime.requireOptionsIntegrationBrowserCases;

export const expiryGreeksJourneyInputs: typeof runtime.expiryGreeksJourneyInputs = runtime.expiryGreeksJourneyInputs;
export const requireExpiryGreeksBrowserCases: typeof runtime.requireExpiryGreeksBrowserCases = runtime.requireExpiryGreeksBrowserCases;

export const requireExpiryGreeksScreenshotSet: typeof runtime.requireExpiryGreeksScreenshotSet = runtime.requireExpiryGreeksScreenshotSet;
