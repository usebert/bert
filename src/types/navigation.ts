/**
 * Shell routing types for bert.
 *
 * - `RoutedScreen` is every value `App.tsx` may assign to `screen` (including the audit completion route).
 * - `NavItemId` is the subset used by the sidebar (`src/config/navItems.ts`) and permission helpers (`canRoleAccessNavItem`, etc.).
 *
 * Do not add or rename literals here without updating `App.tsx` routing, `navItems`, and permission rules together.
 */

export type RoutedScreen =
  | "dashboard"
  | "godmodeHome"
  | "setup"
  | "companies"
  | "users"
  | "invites"
  | "settings"
  | "setupInitial"
  | "auditCentre"
  | "audits"
  | "results"
  | "googleForms"
  | "actions"
  | "nonConformance"
  | "incidents"
  | "loler"
  | "healthSafety"
  | "healthSafetyCoshh"
  | "healthSafetyRiddor"
  | "calendar"
  | "documentControl"
  | "documents"
  | "documentDetail"
  | "reports"
  | "sync"
  | "schedules"
  | "documentTraining"
  | "admin"
  | "onboarding"
  | "account"
  | "emailReminders"
  | "qmsReadiness"
  | "briefings"
  | "auditBuilder"
  | "auditTemplateEdit"
  | "archive"
  | "complete"
  | "uiFoundation";

/**
 * Sidebar / nav-gated screens only.
 * Excludes `"complete"` (audit flow) and `"documentDetail"` (opened from Documents, not a sidebar item).
 * Keep `documents` (Phase 1 Controlled Documents) distinct from legacy `documentControl`.
 */
export type NavItemId = Exclude<RoutedScreen, "complete" | "documentDetail" | "uiFoundation">;
