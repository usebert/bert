/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Short app name in UI chrome (default `bert.` in code). */
  readonly VITE_APP_NAME?: string;
  /** When `"true"`, shows role switcher, layout/landscape preview, demo badges, dashboard layout tools. */
  readonly VITE_SHOW_DEBUG_UI?: string;
  readonly VITE_SHOW_ADMIN_DEBUG_UI?: string;
  readonly VITE_ENABLE_DEMO_LOGIN?: string;
  /** When set (e.g. https://api.usebert.co.uk), browser and Capacitor builds call that host for `/api` and `/auth` routes. Omit for same-origin. */
  readonly VITE_API_BASE_URL?: string;
  /** Set by scripts/bump-android-build.sh when assembling pilot APKs. */
  readonly VITE_ANDROID_PILOT_BUILD_NUMBER?: string;
  readonly VITE_ANDROID_PILOT_BUILD_TIME?: string;
  readonly VITE_ANDROID_PILOT_BUILD_GIT_SHA?: string;
  readonly VITE_DEBUG_GODMODE_NAV?: string;
  readonly VITE_APP_COMMIT_SHA?: string;
}

declare module "*bert-record-navigation.mjs" {
  import type { BertRecordLink } from "./lib/bertRecordNavigation";
  import type { SafetyWorkspaceTab } from "./safety/types";
  export function buildBertRecordLink(input?: Record<string, unknown>): BertRecordLink;
  export function buildActTodayNavigation(item?: Record<string, unknown>, companyFolderId?: string): BertRecordLink;
  export function enrichOperationalItem<T extends Record<string, unknown>>(item: T, companyFolderId?: string): T & Partial<BertRecordLink>;
  export function enrichOperationalItems<T extends Record<string, unknown>>(items: T[], companyFolderId?: string): Array<T & Partial<BertRecordLink>>;
  export function buildKpiListNavigation(kpiId: string, companyFolderId?: string): BertRecordLink;
  export function buildActionSourceLink(action?: Record<string, unknown>, companyFolderId?: string): BertRecordLink | null;
  export function parseBertRouteSearch(search?: string): {
    screen: string;
    recordId: string;
    filter: string;
    scheduleId: string;
    templateId: string;
  };
  export function mapUrlFilterToActionFilter(filter: string): string;
  export function mapUrlFilterToSafetyTab(filter: string): SafetyWorkspaceTab;
  export function searchTargetToRoute(target?: Record<string, unknown>): string;
}
