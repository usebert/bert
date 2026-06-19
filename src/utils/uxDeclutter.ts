import type { Role } from "../permissions";

/** Platform operator tools — never shown to company Admin/Manager/Auditor. */
export function canShowTechnicalUi(role: Role | undefined): boolean {
  return role === "Master";
}

export function resolveUserEmail(user: { username: string; email?: string }): string {
  const explicit = String(user.email || "").trim();
  if (explicit) return explicit;
  const username = String(user.username || "").trim();
  if (username.includes("@")) return username;
  return "";
}

export function getAccountRoleLabel(role: Role): string {
  if (role === "Master") return "Platform Admin";
  return role;
}

export function getAccountRoleDetail(role: Role): string {
  if (role === "Master") return "Godmode";
  return role;
}

/** Friendly status copy for company-facing surfaces. */
export const UX_STATUS = {
  ready: "Ready",
  needsAttention: "Needs attention",
  workingInBackground: "Finishing updates…",
  saved: "Saved",
  inviteLinkCreated: "Invite link created",
  scheduleSaved: "Schedule saved",
  couldNotLoadUsers: "Could not load users",
  couldNotSaveSchedule: "Could not save schedule",
} as const;

export function backgroundJobsBannerForRole(role: Role | undefined, activeCount: number): string {
  if (canShowTechnicalUi(role)) {
    return activeCount > 0 ? `${activeCount} job(s) in progress` : "No background jobs running";
  }
  if (activeCount > 0) {
    return UX_STATUS.workingInBackground;
  }
  return "";
}

/** Strip internal jargon from toast / inline messages for company users. */
export function softenUserFacingMessage(message: string, role: Role | undefined): string {
  if (canShowTechnicalUi(role) || !message.trim()) {
    return message;
  }
  return message
    .replace(/\bmaster sheet\b/gi, "company data")
    .replace(/\bregistry\b/gi, "company record")
    .replace(/\bworkbook\b/gi, "company data")
    .replace(/\bfallback registry\b/gi, "backup record")
    .replace(/\bdrive root\b/gi, "company folder")
    .replace(/\bgoogle oauth\b/gi, "Google connection")
    .replace(/\bre-?sync\b/gi, "refresh")
    .replace(/\brepair\b/gi, "fix")
    .replace(/\brelink\b/gi, "reconnect")
    .replace(/\bhealth check\b/gi, "readiness check")
    .replace(/\bsync log\b/gi, "activity");
}
