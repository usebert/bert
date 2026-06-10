/**
 * Local persistence keys. Legacy `qms-precast-*` keys are migrated once at app boot
 * (see `migrateLegacyStorageKeysOnce` in `main.tsx`).
 */
export const storageKeys = {
  currentUser: "bert-current-user",
  masterCompanySetupSession: "bert-master-company-setup-session",
  offlineSubmissions: "bert-offline-submissions",
  theme: "bert-theme",
  previewOrientation: "bert-preview-orientation",
  desktopSidebarCollapsed: "bert-desktop-sidebar-collapsed",
  dashboardPreferences: "bert-dashboard-preferences",
  dashboardSectionOrder: "bert-dashboard-section-order",
  folderLinks: "bert-folder-links",
  workspaceState: "bert-workspace-state",
  /** Master Godmode: active live company folder id (validated on load). */
  godmodeSelectedCompanyFolderId: "godmodeSelectedCompanyFolderId",
  userProfilePhotos: "bert-user-profile-photos",
  userNicknames: "bert-user-nicknames",
  layoutManager: "bert-layout-manager",
  layoutAdmin: "bert-layout-admin",
  localDatabaseRoot: "bert-local-db-v1",
  /** Android pilot: device-local tablet kiosk preference (not synced to server). */
  tabletKioskEnabled: "bert-tablet-kiosk-enabled",
  /** Scoped open-actions count cache (`${prefix}:${companyFolderId}:${userId}`). */
  openActionsCountCache: "bert-open-actions-count",
  /** Schedule builder assignees — keyed by company id + area in JSON payload. */
  scheduleAssigneesCache: "bert-schedule-assignees-cache",
  /** Reports dashboard — keyed by company id + filter key in JSON payload. */
  reportsDashboardCache: "bert-reports-dashboard-cache",
} as const;

/** Old keys from the QMS Precast product id — migrated to `storageKeys` on first load. */
const LEGACY_QMS_STORAGE_MIGRATION: ReadonlyArray<readonly [string, string]> = [
  ["qms-precast-current-user", storageKeys.currentUser],
  ["qms-precast-offline-submissions", storageKeys.offlineSubmissions],
  ["qms-precast-theme", storageKeys.theme],
  ["qms-precast-preview-orientation", storageKeys.previewOrientation],
  ["qms-precast-desktop-sidebar-collapsed", storageKeys.desktopSidebarCollapsed],
  ["qms-precast-dashboard-preferences", storageKeys.dashboardPreferences],
  ["qms-precast-dashboard-section-order", storageKeys.dashboardSectionOrder],
  ["qms-precast-folder-links", storageKeys.folderLinks],
  ["qms-precast-workspace-state", storageKeys.workspaceState],
  ["qms-precast-user-profile-photos", storageKeys.userProfilePhotos],
  ["qms-precast-user-nicknames", storageKeys.userNicknames],
  ["qms-precast-layout-manager", storageKeys.layoutManager],
  ["qms-precast-layout-admin", storageKeys.layoutAdmin],
  ["qms-precast-local-db-v1", storageKeys.localDatabaseRoot],
];

let legacyStorageMigrationDone = false;

/** Copy values from legacy `qms-precast-*` keys to `bert-*` keys once, then remove legacy keys. */
export function migrateLegacyStorageKeysOnce() {
  if (legacyStorageMigrationDone) {
    return;
  }
  legacyStorageMigrationDone = true;
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  for (const [legacyKey, nextKey] of LEGACY_QMS_STORAGE_MIGRATION) {
    try {
      const legacyVal = window.localStorage.getItem(legacyKey);
      if (legacyVal === null) {
        continue;
      }
      if (window.localStorage.getItem(nextKey) === null) {
        window.localStorage.setItem(nextKey, legacyVal);
      }
      window.localStorage.removeItem(legacyKey);
    } catch {
      /* ignore quota / private mode */
    }
  }
}
