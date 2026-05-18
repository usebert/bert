import type { NavItemId } from "../types/navigation";

/** Paid-pilot operator menu (platform owner / company setup). */
export const PILOT_OPERATOR_NAV_IDS = [
  "dashboard",
  "setup",
  "companies",
  "users",
  "invites",
  "settings",
] as const satisfies readonly NavItemId[];

export type PilotOperatorNavId = (typeof PILOT_OPERATOR_NAV_IDS)[number];

export const PILOT_NAV_LABELS: Record<PilotOperatorNavId, { label: string; icon: string }> = {
  dashboard: { label: "Dashboard", icon: "dashboard" },
  setup: { label: "Setup", icon: "spark" },
  companies: { label: "Companies", icon: "clipboard" },
  users: { label: "Users", icon: "user" },
  invites: { label: "Invites", icon: "note" },
  settings: { label: "Settings", icon: "shield" },
};
