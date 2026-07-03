import type { Role } from "../permissions";
import type {
  IncidentAssignmentHistoryEntry,
  IncidentReassignTarget,
  IncidentRecord,
} from "../types/incidentsScreenProps";
import type { User } from "../types/dashboardScreenProps";
import {
  belongsToCompanyUsersTabRow,
  isActiveCompanyUsersTabRow,
  type CompanyUsersTabRow,
} from "./scheduleAssignees";

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown): string {
  return trim(value).toLowerCase();
}

/**
 * Future-safe: if non-manager staff should handle incidents, add an explicit
 * IncidentHandler permission/role — do not widen Auditor eligibility by default.
 */
export type IncidentMemberLike = {
  email?: string;
  name?: string;
  role?: string;
  accessLevel?: string;
  status?: string;
  companyId?: string;
  companyFolderId?: string;
  hsReportReceiver?: boolean;
  isHsReportReceiver?: boolean;
};

export function parseIncidentMemberRole(value: string): Role | "User" | null {
  const lowered = trim(value).toLowerCase().replace(/\s+/g, " ");
  if (!lowered) {
    return null;
  }
  if (
    lowered === "master" ||
    lowered === "god mode" ||
    lowered === "godmode" ||
    lowered === "platform owner" ||
    lowered === "master operator"
  ) {
    return "Master";
  }
  if (
    lowered === "admin" ||
    lowered === "company admin" ||
    lowered === "administrator" ||
    lowered === "owner"
  ) {
    return "Admin";
  }
  if (lowered === "manager") {
    return "Manager";
  }
  if (lowered === "auditor") {
    return "Auditor";
  }
  if (lowered === "user") {
    return "User";
  }
  if (lowered.includes("company admin") || lowered.includes("administrator")) {
    return "Admin";
  }
  return null;
}

export function resolveIncidentMemberRole(member: IncidentMemberLike = {}): string {
  const roleCandidates = [member.role, member.accessLevel].map((value) => trim(value)).filter(Boolean);
  for (const candidate of roleCandidates) {
    const parsed = parseIncidentMemberRole(candidate);
    if (parsed && parsed !== "User") {
      return parsed;
    }
  }
  for (const candidate of roleCandidates) {
    const parsed = parseIncidentMemberRole(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return "User";
}

export function isHsReportReceiverMember(member: IncidentMemberLike = {}): boolean {
  if (member.hsReportReceiver === true || member.isHsReportReceiver === true) {
    return true;
  }
  const role = trim(member.role).toLowerCase();
  const access = trim(member.accessLevel).toLowerCase();
  const hsPattern = /h\s*&\s*s|health\s*(and|&)\s*safety|hs\s*receiver|h&s\s*receiver/;
  return hsPattern.test(role) || hsPattern.test(access);
}

export function isIncidentHandlerRole(role: Role | string): boolean {
  const normalized = trim(role).toLowerCase().replace(/\s+/g, " ");
  if (
    normalized.includes("company admin") ||
    normalized === "administrator" ||
    normalized === "owner"
  ) {
    return true;
  }
  return normalized === "master" || normalized === "admin" || normalized === "manager";
}

export function isEligibleIncidentReassignTarget(target: {
  role: string;
  hsReportReceiver?: boolean;
}): boolean {
  if (target.hsReportReceiver) {
    return true;
  }
  return isIncidentHandlerRole(target.role);
}

function toCompanyUsersTabRow(member: IncidentMemberLike): CompanyUsersTabRow {
  return {
    email: trim(member.email),
    name: trim(member.name),
    role: trim(member.role),
    accessLevel: trim(member.accessLevel),
    status: trim(member.status) || "ACTIVE",
    companyId: trim(member.companyId || member.companyFolderId),
    companyAreas: [],
  };
}

function isActiveIncidentReassignMember(member: IncidentMemberLike): boolean {
  const status = trim(member.status);
  if (!status) {
    return true;
  }
  return isActiveCompanyUsersTabRow(toCompanyUsersTabRow(member));
}

export function mergeIncidentReassignTargets(
  ...lists: IncidentReassignTarget[][]
): IncidentReassignTarget[] {
  const seen = new Set<string>();
  const merged: IncidentReassignTarget[] = [];
  for (const list of lists) {
    for (const target of list) {
      const email = normalizeEmail(target.email);
      if (!email || seen.has(email)) {
        continue;
      }
      seen.add(email);
      merged.push(target);
    }
  }
  return merged.sort((left, right) => left.name.localeCompare(right.name));
}

export function buildIncidentReassignTargets(
  members: IncidentMemberLike[],
  options: { companyFolderId?: string; log?: boolean } = {},
): IncidentReassignTarget[] {
  const companyFolderId = trim(options.companyFolderId);
  let totalUsers = 0;
  let activeUsers = 0;
  let excludedAuditors = 0;
  const sampleRoles: string[] = [];
  const sampleStatuses: string[] = [];
  const sampleCompanyFolderIds: string[] = [];
  const seen = new Set<string>();
  const targets: IncidentReassignTarget[] = [];

  for (const member of members) {
    totalUsers += 1;
    const email = normalizeEmail(member.email);
    const name = trim(member.name);
    if (!email || !name) {
      continue;
    }

    if (sampleRoles.length < 5) {
      sampleRoles.push(trim(member.role) || trim(member.accessLevel) || "(blank)");
    }
    if (sampleStatuses.length < 5) {
      sampleStatuses.push(trim(member.status) || "(blank)");
    }
    if (sampleCompanyFolderIds.length < 5) {
      sampleCompanyFolderIds.push(trim(member.companyFolderId || member.companyId) || "(blank)");
    }

    if (!isActiveIncidentReassignMember(member)) {
      continue;
    }
    activeUsers += 1;

    if (companyFolderId && !belongsToCompanyUsersTabRow(toCompanyUsersTabRow(member), companyFolderId)) {
      continue;
    }

    const hsReportReceiver = isHsReportReceiverMember(member);
    const role = resolveIncidentMemberRole(member);
    const candidate = { email, name, role, hsReportReceiver };
    if (!isEligibleIncidentReassignTarget(candidate)) {
      if (role === "Auditor") {
        excludedAuditors += 1;
      }
      continue;
    }

    if (seen.has(email)) {
      continue;
    }
    seen.add(email);
    targets.push({ email, name, role });
  }

  targets.sort((left, right) => left.name.localeCompare(right.name));

  if (options.log !== false) {
    console.info("[incidents]", {
      phase: "incident_reassign_targets",
      totalUsers,
      activeUsers,
      eligibleTargets: targets.length,
      excludedAuditors,
      sampleRoles,
      sampleStatuses,
      sampleCompanyFolderIds,
    });
  }

  return targets;
}

export function incidentActorEmail(user: Pick<User, "username" | "email">): string {
  const identity = trim(user.email || user.username).toLowerCase();
  if (identity.includes("@")) {
    return identity;
  }
  return identity ? `${identity}@usebert.co.uk` : "";
}

export function incidentAssignedToEmail(incident: IncidentRecord): string {
  return normalizeEmail(incident.assignedToEmail);
}

export function incidentReceivedByEmail(incident: IncidentRecord): string {
  return normalizeEmail(incident.receivedByEmail || incident.assignedToEmail);
}

export function isIncidentHsReportReceiver(user: Pick<User, "username" | "email" | "role">, incident: IncidentRecord): boolean {
  const actorEmail = incidentActorEmail(user);
  const receivedByEmail = incidentReceivedByEmail(incident);
  return Boolean(actorEmail && receivedByEmail && actorEmail === receivedByEmail);
}

export function isIncidentAssignedHandler(user: Pick<User, "username" | "email" | "role">, incident: IncidentRecord): boolean {
  const actorEmail = incidentActorEmail(user);
  const assignedToEmail = incidentAssignedToEmail(incident);
  return Boolean(actorEmail && assignedToEmail && actorEmail === assignedToEmail);
}

export function canReassignIncident(
  user: Pick<User, "username" | "email" | "role" | "name">,
  incident: IncidentRecord,
  target?: { email: string; role: string; hsReportReceiver?: boolean },
): boolean {
  if (user.role === "Auditor") {
    return false;
  }
  if (target?.email && !isEligibleIncidentReassignTarget(target)) {
    return false;
  }
  if (user.role === "Master" || user.role === "Admin" || user.role === "Manager") {
    return true;
  }
  if (isIncidentHsReportReceiver(user, incident)) {
    return true;
  }
  if (isIncidentAssignedHandler(user, incident)) {
    return true;
  }
  return false;
}

export function formatIncidentAssignee(incident: IncidentRecord): string {
  return trim(incident.assignedToName || incident.assignedTo) || "Unassigned";
}

export function incidentAssigneeSelectValue(
  incident: IncidentRecord,
  targets: IncidentReassignTarget[] = [],
): string {
  const email = incidentAssignedToEmail(incident);
  if (email) {
    return email;
  }
  const assigneeName = trim(incident.assignedToName || incident.assignedTo);
  if (!assigneeName) {
    return "";
  }
  const match = targets.find((target) => target.name.toLowerCase() === assigneeName.toLowerCase());
  return match?.email || "";
}

export function recentAssignmentHistory(history: IncidentAssignmentHistoryEntry[] = [], limit = 5): IncidentAssignmentHistoryEntry[] {
  return [...history].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, limit);
}

/** @internal test helper */
export function isActiveIncidentMember(member: IncidentMemberLike): boolean {
  if (!trim(member.email) || !trim(member.name)) {
    return false;
  }
  return isActiveIncidentReassignMember(member);
}
