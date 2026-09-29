export const LAB_SCHEMA: 'mastermind.thesis-lab/v1';
export function isUuid(value: unknown): value is string;
export interface LabSession {
  userId: string;
  list(): Promise<{ok: boolean; theses?: unknown[]; truncated?: boolean}>;
  read(id: string): Promise<{ok: boolean; thesis?: unknown; status?: string}>;
  receipt(id: string): Promise<{ok: boolean; receipt?: {thesisId: string; version: number; clientRequestId: string} | null}>;
  apply(input: unknown): Promise<{ok: boolean; status: string; thesisId?: string; version?: number; lifecycleState?: string; replayed?: boolean; currentVersion?: number}>;
}
export function handleThesisLab(request: Request, resolveSession: () => Promise<LabSession | null>): Promise<Response>;
