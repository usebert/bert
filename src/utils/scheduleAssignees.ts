import type { Role } from "../permissions";

export type CompanyUsersTabRow = {
  email: string;
  name: string;
  role: string;
  accessLevel: string;
  status: string;
  companyId: string;
  companyAreas: string[];
  companyAreasRaw?: string;
};

export type ScheduleAssigneeOption = {
  id: string;
  name: string;
  role: Role | "User";
  email: string;
  companyAreas: string[];
  areaWarning?: string;
};

/** @deprecated Use ScheduleAssigneeOption */
export type ScheduleAuditorOption = ScheduleAssigneeOption;

export type ScheduleAssigneeDiagnostics = {
  companyId: string;
  masterSheetId: string;
  selectedArea: string;
  totalRows: number;
  activeCount: number;
  assignableRoleCount: number;
  excludedByStatus: number;
  excludedByCompany: number;
  excludedByArea: number;
  excludedNotAssignable: number;
  finalCount: number;
  currentCompanyId?: string;
  currentCompanyName?: string;
  signedInEmail?: string;
  totalUsersRead?: number;
  activeUsersFound?: number;
  assignableUsersReturned?: number;
  dataSource?: string;
  candidates: Array<{
    email: string;
    role: string;
    accessLevel: string;
    status: string;
    companyId: string;
    companyAreas: string[];
    normalizedRole: string;
    normalizedAccessLevel: string;
    normalizedStatus: string;
    excludedReason: string | null;
    areaWarning?: string | null;
  }>;
};

/** @deprecated Use ScheduleAssigneeDiagnostics */
export type ScheduleAuditorDiagnostics = ScheduleAssigneeDiagnostics & {
  auditorRoleCount: number;
  auditorAccessLevelCount: number;
  excludedNotAuditor: number;
};

const COMPLETABLE_ROLE_VALUES = new Set([
  "admin",
  "company admin",
  "manager",
  "auditor",
  "user",
]);

type InviteLike = {
  email: string;
  role: string;
  status: string;
  loginReady?: boolean;
  companyFolderId?: string;
  accessLevel?: string;
};

export function normalizeScheduleValue(value: string | undefined | null): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isActiveCompanyUsersTabRow(user: CompanyUsersTabRow): boolean {
  return normalizeScheduleValue(user.status) === "active";
}

export function isActiveCompanyUser(user: CompanyUsersTabRow): boolean {
  return Boolean(user.email.trim()) && isActiveCompanyUsersTabRow(user);
}

export function canCompleteAuditUser(user: CompanyUsersTabRow): boolean {
  const role = normalizeScheduleValue(user.role);
  const accessLevel = normalizeScheduleValue(user.accessLevel);
  return COMPLETABLE_ROLE_VALUES.has(role) || COMPLETABLE_ROLE_VALUES.has(accessLevel);
}

/** @deprecated Use canCompleteAuditUser */
export function isAuditorCompanyUsersTabRow(user: CompanyUsersTabRow): boolean {
  return canCompleteAuditUser(user);
}

export function belongsToCompanyUsersTabRow(user: CompanyUsersTabRow, companyId: string): boolean {
  const targetCompanyId = companyId.trim();
  if (!targetCompanyId) {
    return true;
  }
  const userCompanyId = user.companyId.trim();
  if (!userCompanyId) {
    return true;
  }
  return userCompanyId === targetCompanyId;
}

export function matchesScheduleAreaForUser(user: CompanyUsersTabRow, selectedArea: string): {
  include: boolean;
  areaWarning?: string;
} {
  const area = selectedArea.trim();
  if (!area) {
    return { include: true };
  }

  const areas = user.companyAreas;
  const role = normalizeScheduleValue(user.role);

  if (areas.length === 0) {
    if (role === "admin" || role === "company admin" || role === "manager") {
      return { include: true };
    }
    return { include: true, areaWarning: "User has no area assigned" };
  }

  const normalizedArea = normalizeScheduleValue(area);
  const normalizedAreas = areas.map((entry) => normalizeScheduleValue(entry));
  if (normalizedAreas.includes("all") || normalizedAreas.includes(normalizedArea)) {
    return { include: true };
  }

  return { include: false };
}

function parseClientRole(roleRaw: string): Role | "User" {
  const role = normalizeScheduleValue(roleRaw);
  if (role === "admin" || role === "company admin") return "Admin";
  if (role === "manager") return "Manager";
  if (role === "auditor") return "Auditor";
  if (role === "user") return "User";
  if (role === "master") return "Master";
  return "User";
}

export function buildScheduleAssigneeDiagnostics(
  users: CompanyUsersTabRow[],
  context: { companyId?: string; masterSheetId?: string; selectedArea?: string },
): ScheduleAssigneeDiagnostics {
  const companyId = context.companyId?.trim() || "";
  const masterSheetId = context.masterSheetId?.trim() || "";
  const selectedArea = context.selectedArea?.trim() || "";

  const diagnostics: ScheduleAssigneeDiagnostics = {
    companyId,
    masterSheetId,
    selectedArea,
    totalRows: users.length,
    activeCount: 0,
    assignableRoleCount: 0,
    excludedByStatus: 0,
    excludedByCompany: 0,
    excludedByArea: 0,
    excludedNotAssignable: 0,
    finalCount: 0,
    candidates: [],
  };

  for (const user of users) {
    const snapshot = {
      email: user.email.trim().toLowerCase(),
      role: user.role,
      accessLevel: user.accessLevel,
      status: user.status,
      companyId: user.companyId,
      companyAreas: user.companyAreas,
      normalizedRole: normalizeScheduleValue(user.role),
      normalizedAccessLevel: normalizeScheduleValue(user.accessLevel),
      normalizedStatus: normalizeScheduleValue(user.status),
      excludedReason: null as string | null,
      areaWarning: null as string | null,
    };

    if (!snapshot.email) {
      continue;
    }

    if (!isActiveCompanyUsersTabRow(user)) {
      diagnostics.excludedByStatus += 1;
      snapshot.excludedReason = "inactive_status";
      diagnostics.candidates.push(snapshot);
      continue;
    }
    diagnostics.activeCount += 1;

    if (!canCompleteAuditUser(user)) {
      diagnostics.excludedNotAssignable += 1;
      snapshot.excludedReason = "not_assignable";
      diagnostics.candidates.push(snapshot);
      continue;
    }
    diagnostics.assignableRoleCount += 1;

    if (!belongsToCompanyUsersTabRow(user, companyId)) {
      diagnostics.excludedByCompany += 1;
      snapshot.excludedReason = "wrong_company";
      diagnostics.candidates.push(snapshot);
      continue;
    }

    const areaResult = matchesScheduleAreaForUser(user, selectedArea);
    if (!areaResult.include) {
      diagnostics.excludedByArea += 1;
      snapshot.excludedReason = "area_mismatch";
      diagnostics.candidates.push(snapshot);
      continue;
    }

    snapshot.areaWarning = areaResult.areaWarning ?? null;
    diagnostics.candidates.push(snapshot);
  }

  return diagnostics;
}

/** @deprecated Use buildScheduleAssigneeDiagnostics */
export function buildScheduleAuditorDiagnostics(
  users: CompanyUsersTabRow[],
  context: { companyId?: string; masterSheetId?: string; selectedArea?: string },
): ScheduleAuditorDiagnostics {
  const diagnostics = buildScheduleAssigneeDiagnostics(users, context);
  return {
    ...diagnostics,
    auditorRoleCount: diagnostics.assignableRoleCount,
    auditorAccessLevelCount: 0,
    excludedNotAuditor: diagnostics.excludedNotAssignable,
  };
}

export function buildAvailableScheduleAssignees(
  users: CompanyUsersTabRow[],
  context: {
    companyId?: string;
    masterSheetId?: string;
    selectedArea?: string;
    includeDiagnostics?: boolean;
  } = {},
): { assignees: ScheduleAssigneeOption[]; auditors: ScheduleAssigneeOption[]; diagnostics?: ScheduleAssigneeDiagnostics } {
  const companyId = context.companyId?.trim() || "";
  const selectedArea = context.selectedArea?.trim() || "";
  const diagnostics = context.includeDiagnostics
    ? buildScheduleAssigneeDiagnostics(users, context)
    : undefined;

  const assignees: ScheduleAssigneeOption[] = [];
  const seen = new Set<string>();

  for (const user of users) {
    const email = user.email.trim();
    if (!email) {
      continue;
    }
    if (!isActiveCompanyUser(user) || !canCompleteAuditUser(user) || !belongsToCompanyUsersTabRow(user, companyId)) {
      continue;
    }

    const areaResult = matchesScheduleAreaForUser(user, selectedArea);
    if (!areaResult.include) {
      continue;
    }

    const id = normalizeScheduleValue(email);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    assignees.push({
      id,
      name: user.name.trim() || email.split("@")[0] || email,
      role: parseClientRole(user.role),
      email: email.toLowerCase(),
      companyAreas: [...user.companyAreas],
      areaWarning: areaResult.areaWarning,
    });
  }

  if (diagnostics) {
    diagnostics.finalCount = assignees.length;
  }

  return { assignees, auditors: assignees, diagnostics };
}

/** @deprecated Use buildAvailableScheduleAssignees */
export function buildAvailableScheduleAuditors(
  users: CompanyUsersTabRow[],
  context: {
    companyId?: string;
    masterSheetId?: string;
    selectedArea?: string;
    includeDiagnostics?: boolean;
  } = {},
): { auditors: ScheduleAssigneeOption[]; diagnostics?: ScheduleAssigneeDiagnostics } {
  const result = buildAvailableScheduleAssignees(users, context);
  return { auditors: result.assignees, diagnostics: result.diagnostics };
}

export function findPendingAssigneeInvites(invites: InviteLike[], companyId = ""): InviteLike[] {
  return invites.filter((invite) => {
    const role = normalizeScheduleValue(invite.role);
    const accessLevel = normalizeScheduleValue(invite.accessLevel ?? "");
    if (!COMPLETABLE_ROLE_VALUES.has(role) && !COMPLETABLE_ROLE_VALUES.has(accessLevel)) {
      return false;
    }
    const inviteCompanyId = invite.companyFolderId?.trim() || "";
    if (companyId && inviteCompanyId && inviteCompanyId !== companyId) {
      return false;
    }
    if (invite.status === "Active" || invite.loginReady === true) {
      return false;
    }
    return true;
  });
}

/** @deprecated Use findPendingAssigneeInvites */
export function findPendingAuditorInvites(invites: InviteLike[], companyId = ""): InviteLike[] {
  return findPendingAssigneeInvites(invites, companyId);
}

export function normalizeScheduleAssigneeIds(
  savedAssignees: string[],
  options: ScheduleAssigneeOption[],
): string[] {
  const normalized = new Set<string>();

  for (const saved of savedAssignees) {
    const savedKey = normalizeScheduleValue(saved);
    if (!savedKey) {
      continue;
    }

    const match = options.find(
      (option) =>
        option.id === savedKey ||
        normalizeScheduleValue(option.name) === savedKey ||
        normalizeScheduleValue(option.email) === savedKey,
    );

    normalized.add(match?.id || savedKey);
  }

  return [...normalized];
}

/** @deprecated Use normalizeScheduleAssigneeIds */
export function normalizeScheduleAuditorIds(
  savedAuditors: string[],
  options: ScheduleAssigneeOption[],
): string[] {
  return normalizeScheduleAssigneeIds(savedAuditors, options);
}

export function resolveScheduleAssigneeLabels(
  assigneeIds: string[],
  options: ScheduleAssigneeOption[],
): string[] {
  return assigneeIds.map((assigneeId) => {
    const match = options.find((option) => option.id === normalizeScheduleValue(assigneeId));
    return match?.email || assigneeId;
  });
}

/** @deprecated Use resolveScheduleAssigneeLabels */
export function resolveScheduleAuditorLabels(
  auditorIds: string[],
  options: ScheduleAssigneeOption[],
): string[] {
  return resolveScheduleAssigneeLabels(auditorIds, options);
}

export function resolveScheduleAssigneeEmptyMessage(
  assignees: ScheduleAssigneeOption[],
  context: {
    selectedArea?: string;
    diagnostics?: ScheduleAssigneeDiagnostics;
    loadError?: string;
    loading?: boolean;
    warning?: string;
  },
): string {
  if (context.loadError?.trim()) {
    return context.loadError.trim();
  }
  if (context.loading) {
    return "Loading assignable users…";
  }
  if (assignees.length > 0) {
    return context.warning?.trim() || "";
  }
  if (context.warning?.trim()) {
    return context.warning.trim();
  }
  const selectedArea = context.selectedArea?.trim() || "";
  const diagnostics = context.diagnostics;
  const totalUsersRead = diagnostics?.totalUsersRead ?? diagnostics?.totalRows ?? 0;
  const activeUsersFound = diagnostics?.activeUsersFound ?? diagnostics?.activeCount ?? 0;
  if (totalUsersRead > 0 && assignees.length === 0) {
    const parts = [
      "No assignable users matched the current filters.",
      `Read ${totalUsersRead} user row${totalUsersRead === 1 ? "" : "s"}.`,
    ];
    if (diagnostics?.excludedByStatus) {
      parts.push(`${diagnostics.excludedByStatus} excluded by status.`);
    }
    if (diagnostics?.excludedByCompany) {
      parts.push(`${diagnostics.excludedByCompany} excluded by company.`);
    }
    if (diagnostics?.excludedByArea) {
      parts.push(`${diagnostics.excludedByArea} excluded by area.`);
    }
    return parts.join(" ");
  }
  if (selectedArea && diagnostics && diagnostics.excludedByArea > 0 && diagnostics.finalCount === 0) {
    return "No users are assigned to this area. Check user area access in Users & Invites.";
  }
  if (totalUsersRead > 0 && activeUsersFound === 0) {
    return "No active users found for this company. Add users in Users & Invites.";
  }
  return "";
}
