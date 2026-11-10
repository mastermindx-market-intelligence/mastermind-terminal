export type EvidenceKind = "gex" | "eod";
export type EvidenceProfile = "exposure" | "combined";
export type SourceMap = Record<string, string>;
export type NativeReceipt = {
    operation: string; protectedBase: string; kind: EvidenceKind; packet: string;
    expected: number; successful_files: number; exit: number; source_stable: boolean;
    failed_frames: string[]; source_sha256: SourceMap; image_sha256: SourceMap;
    native_manifest_sha256: string; log_sha256: string;
};
export type NativeCandidate = {
    profile: EvidenceProfile; sources: SourceMap; native: NativeReceipt;
    cropDir: string; evidence: string; layout: string[]; protectedManifest: string;
};
export type ExposureHistorical = NativeCandidate & { root: string; boundarySources: SourceMap };
export type SelectedPacket = NativeCandidate & {
    optionsHistorySources: SourceMap; hasExposureHistory: boolean; hasOptionsHistory: boolean;
    exposureHistorical: ExposureHistorical | null;
    captureRevision?: string; descriptorSha256?: string; execution?: IntegrationExecution;
};

export declare function requireSourceKeys(map: SourceMap, expected: string[]): void;
export declare function selectWholeFingerprint<T extends {
    sources: SourceMap;
}>(candidates: T[], current: SourceMap): T;
/** The pinned r4 executions are equivalent under this exact protected fixture-server default.
 * VI already supplied the value; the native runners do not use Playwright's webServer config.
 * Recorded maps remain immutable and every non-config input still matches the whole capture.
 */
export declare function projectR4CaptureHarness(recorded: SourceMap, current: SourceMap): SourceMap;
/** The browser suite never imports either native producer. Its immutable 123-case proof
 * remains applicable only for these two reviewed producer-only changes; every other
 * browser dependency and both complete key sets must still match exactly.
 */
export declare function projectIndicatorGuardBrowserSources(recorded: SourceMap, current: SourceMap): SourceMap;
export declare function layoutSources(kind: EvidenceKind, profile: EvidenceProfile): string[];
/** This separately qualifies the Chart branch deliberately excluded from native Strike captures. */
export declare function requireR4ChartIdentity(repo: string, original: string, peer: string, current: string, requireCurrentObserver?: boolean): void;
/** Select one complete recorded source composition. Corrupt declarations never fall back. */
export declare function qualifiedOptionsExposurePacket(repo: string, kind: EvidenceKind, crops: string[]): SelectedPacket;
export declare const masterIntegrationInputs: (kind: EvidenceKind) => string[];
export declare const MASTER_BROWSER_SPECS: string[];
export declare const masterIntegrationBrowserInputs: () => string[];
export declare const uiCopyIntegrationInputs: (kind: EvidenceKind) => string[];
export declare const uiCopyIntegrationBrowserInputs: () => string[];
export declare const optionsIntegrationInputs: (kind: EvidenceKind) => string[];
export declare const OPTIONS_INTEGRATION_BROWSER_SPECS: string[];
export declare const optionsIntegrationBrowserInputs: () => string[];
export type IntegrationExecution = {
    schema: string;
    operation: string;
    revision: string;
    kind: EvidenceKind;
    packet: string;
    branchHead: string;
    protectedMaster: string;
    integratedDependency?: string;
    command: string[];
    exit: number;
    expected: number;
    successfulFiles: number;
    sourceStable: boolean;
    captureId?: string;
    ownedServerStopped?: boolean;
    nativeSupervisor?: { closed: boolean; status: number | null; signal: string | null; timedOut: boolean;
        serverPid: number | null; serverReportedStopped: boolean; serverSettled: boolean;
        serverRefused: string | null; error: string | null };
    nativeReceipt?: { family: EvidenceKind; captureId: string; capturedAtHead: string;
        manifestSha256: string; files: { file: string; sha256: string }[]; history: unknown };
    portClosed?: boolean;
    nextLockAbsent?: boolean;
    producerPins?: SourceMap;
    sourceBeforeSha256: string;
    sourceAfterSha256: string;
    manifestSha256: string;
    logSha256: string;
    frames: {
        file: string;
        status: string;
    }[];
    images: Record<string, {
        sha256: string;
        bytes: number;
        width: number;
        height: number;
    }>;
};
/** A failed full GEX run may still emit a manifest; its actual result is decisive. */
export declare function requireIntegrationExecution(value: IntegrationExecution, kind: EvidenceKind, crops: string[], identity?: "indicator-guard" | "master-integration" | "ui-copy-integration" | "options-integration"): void;
/** Legacy is eligible only when neither a declaration nor any qualified operation history exists. */
export declare function optionalQualifiedOptionsExposurePacket(repo: string, kind: EvidenceKind, crops: string[]): SelectedPacket | null;
export declare function requireOptionsIntegrationBrowserCases(current: { expectedPassed: string[]; expectedSkipped: string[] }, historical: { expectedPassed: string[]; expectedSkipped: string[] }): void;
export {};
