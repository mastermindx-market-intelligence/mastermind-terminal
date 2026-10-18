/** Presentation destination only. The active ChartPanel still owns analysis and selection. */
export interface ChartContextDock {
  open: boolean;
  target: HTMLElement | null;
  onClose: (restoreFocus?: boolean) => void;
}
