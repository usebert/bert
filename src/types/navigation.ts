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
  | "audits"
  | "actions"
  | "nonConformance"
  | "incidents"
  | "reports"
  | "sync"
  | "schedules"
  | "documentTraining"
  | "admin"
  | "onboarding"
  | "account"
  | "emailReminders"
  | "qmsReadiness"
  | "complete";

/** Sidebar / nav-gated screens only — excludes the `"complete"` audit flow route. */
export type NavItemId = Exclude<RoutedScreen, "complete">;
