/**
 * Per-user dashboard layout preferences — presentation only.
 * Stored in localStorage; never includes passwords, tokens, or domain data.
 */

export const DASHBOARD_LAYOUT_PREFS_VERSION = 1 as const;

export type DashboardLayoutPreferences = {
  version: typeof DASHBOARD_LAYOUT_PREFS_VERSION;
  order: string[];
  hidden: string[];
};

export type DashboardCardDefinition = {
  id: string;
  /** Stable label for restore UI — not used as a storage key. */
  label: string;
  defaultOrder: number;
  hideable: boolean;
};

export type DashboardLayoutCatalogId =
  | "manager-role"
  | "auditor-task"
  | "company-admin"
  | "live-operations";
