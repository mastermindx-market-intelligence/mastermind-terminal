/** On-demand reader of the incumbent finite projection, never another catalog. */
export type SharedSearchCatalog = Pick<typeof import("./sharedShellRoutes"), "sharedShellDirectory" | "sharedShellCatalog">;
export function loadSharedSearchCatalog(): Promise<SharedSearchCatalog> { return import("./sharedShellRoutes"); }
