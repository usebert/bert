import type { NavItemId } from "../types/navigation";
import { PILOT_OPERATOR_NAV_IDS } from "./pilotNav";

/** Paid-pilot operator primary nav (Master / Admin setup). */
export const PILOT_PRIMARY_NAV_IDS = PILOT_OPERATOR_NAV_IDS;

/** Field roles — operational day-to-day work. */
export const PRIMARY_NAV_IDS = [
  "dashboard",
  "audits",
  "actions",
  "nonConformance",
  "incidents",
  "reports",
] as const satisfies readonly NavItemId[];

/** Behind “More” for field roles. */
export const MORE_MENU_NAV_IDS = [
  "sync",
  "schedules",
  "documentTraining",
  "emailReminders",
  "onboarding",
  "admin",
  "account",
] as const satisfies readonly NavItemId[];

/** Mobile bottom bar (field roles). */
export const MOBILE_BOTTOM_NAV_IDS = ["dashboard", "audits", "incidents", "actions", "more"] as const;

export type MobileBottomKey = (typeof MOBILE_BOTTOM_NAV_IDS)[number];

export function isPilotPrimaryNavId(id: NavItemId): id is (typeof PILOT_PRIMARY_NAV_IDS)[number] {
  return (PILOT_PRIMARY_NAV_IDS as readonly string[]).includes(id);
}

export function isPrimaryNavId(id: NavItemId): id is (typeof PRIMARY_NAV_IDS)[number] {
  return (PRIMARY_NAV_IDS as readonly string[]).includes(id);
}

export function isMoreMenuNavId(id: NavItemId): id is (typeof MORE_MENU_NAV_IDS)[number] {
  return (MORE_MENU_NAV_IDS as readonly string[]).includes(id);
}
