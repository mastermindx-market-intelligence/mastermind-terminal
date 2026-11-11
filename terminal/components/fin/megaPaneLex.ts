/** Feature-local EN/ZH tuples for MegaPane chrome. Language state remains the shared
 * LangProvider; keeping the pane's copy here keeps it out of the global LEX.
 */
export const MEGA_PANE_LEX = {
  mpBackToChart: ["Back to chart", "返回图表"],
} as const satisfies Record<string, readonly [string, string]>;

export type MegaPaneLexKey = keyof typeof MEGA_PANE_LEX;

export function megaPaneText(key: MegaPaneLexKey, zh: boolean): string {
  return MEGA_PANE_LEX[key][zh ? 1 : 0];
}
