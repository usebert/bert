import type { NavItemId } from "../types/navigation";

/** Primary sidebar / tablet nav (always visible when role permits). */
export const PRIMARY_NAV_IDS = [
  "dashboard",
  "audits",
  "actions",
  "nonConformance",
  "incidents",
  "reports",
] as const satisfies readonly NavItemId[];

/** Behind “More”: sync, schedules, onboarding, admin, account — routes unchanged. */
export const MORE_MENU_NAV_IDS = ["sync", "schedules", "documentTraining", "onboarding", "admin", "account"] as const satisfies readonly NavItemId[];

/** Mobile bottom bar (subset). */
export const MOBILE_BOTTOM_NAV_IDS = ["dashboard", "audits", "actions", "reports", "more"] as const;

export type MobileBottomKey = (typeof MOBILE_BOTTOM_NAV_IDS)[number];

export function isPrimaryNavId(id: NavItemId): id is (typeof PRIMARY_NAV_IDS)[number] {
  return (PRIMARY_NAV_IDS as readonly string[]).includes(id);
}

export function isMoreMenuNavId(id: NavItemId): id is (typeof MORE_MENU_NAV_IDS)[number] {
  return (MORE_MENU_NAV_IDS as readonly string[]).includes(id);
}
