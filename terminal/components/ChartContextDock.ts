/** Presentation destination only. The active ChartPanel still owns analysis and selection. */
export interface ChartContextDock {
  open: boolean;
  target: HTMLElement | null;
  onOpen: (launcher?: HTMLElement | null) => void;
  onClose: (restoreFocus?: boolean) => void;
}
