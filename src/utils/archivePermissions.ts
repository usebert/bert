import type { Role } from "../permissions";
import type { CompanyMember } from "../services/companyUserService";

export type ClientArchiveRecordType =
  | "user"
  | "action"
  | "ncr"
  | "incident"
  | "briefing"
  | "audit"
  | "googleForm"
  | "schedule";

const SETUP_ADMIN_ROLES = new Set(["admin", "master"]);

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

export function canArchiveRecordFromClient(role: Role, type: ClientArchiveRecordType): boolean {
  if (role === "Auditor") {
    return false;
  }
  if (type === "user") {
    return role === "Master" || role === "Admin";
  }
  return role === "Master" || role === "Admin" || role === "Manager";
}

export function canArchiveCompanyMember(
  member: CompanyMember,
  currentUserEmail: string,
  members: CompanyMember[],
  currentUserRole: Role,
): boolean {
  if (!canArchiveRecordFromClient(currentUserRole, "user")) {
    return false;
  }
  if (normalizeEmail(member.email) === normalizeEmail(currentUserEmail)) {
    return false;
  }
  const memberRole = String(member.role || "").trim().toLowerCase();
  if (!SETUP_ADMIN_ROLES.has(memberRole)) {
    return true;
  }
  const activeSetupAdmins = members.filter((entry) => {
    const role = String(entry.role || "").trim().toLowerCase();
    const status = String(entry.status || "").trim().toUpperCase();
    return SETUP_ADMIN_ROLES.has(role) && status === "ACTIVE";
  });
  if (activeSetupAdmins.length <= 1 && activeSetupAdmins.some((entry) => normalizeEmail(entry.email) === normalizeEmail(member.email))) {
    return false;
  }
  return true;
}
