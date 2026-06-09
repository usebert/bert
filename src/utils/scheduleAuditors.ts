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

export type ScheduleAuditorOption = {
  id: string;
  name: string;
  role: Role;
  email: string;
  areaWarning?: string;
};

export type ScheduleAuditorDiagnostics = {
  companyId: string;
  masterSheetId: string;
  selectedArea: string;
  totalRows: number;
  activeCount: number;
  auditorRoleCount: number;
  auditorAccessLevelCount: number;
  excludedByStatus: number;
  excludedByCompany: number;
  excludedByArea: number;
  excludedNotAuditor: number;
  finalCount: number;
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

type InviteLike = {
  email: string;
  role: string;
  status: string;
  loginReady?: boolean;
  companyFolderId?: string;
};

export function normalizeScheduleValue(value: string | undefined | null): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isActiveCompanyUsersTabRow(user: CompanyUsersTabRow): boolean {
  return normalizeScheduleValue(user.status) === "active";
}

export function isAuditorCompanyUsersTabRow(user: CompanyUsersTabRow): boolean {
  const role = normalizeScheduleValue(user.role);
  const accessLevel = normalizeScheduleValue(user.accessLevel);
  return role === "auditor" || accessLevel === "auditor";
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
    if (role === "admin" || role === "manager") {
      return { include: true };
    }
    return { include: true, areaWarning: "Auditor has no area assigned" };
  }

  const normalizedArea = normalizeScheduleValue(area);
  const normalizedAreas = areas.map((entry) => normalizeScheduleValue(entry));
  if (normalizedAreas.includes("all") || normalizedAreas.includes(normalizedArea)) {
    return { include: true };
  }

  return { include: false };
}

function parseClientRole(roleRaw: string): Role {
  const role = normalizeScheduleValue(roleRaw);
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  if (role === "master") return "Master";
  return "Auditor";
}

export function buildScheduleAuditorDiagnostics(
  users: CompanyUsersTabRow[],
  context: { companyId?: string; masterSheetId?: string; selectedArea?: string },
): ScheduleAuditorDiagnostics {
  const companyId = context.companyId?.trim() || "";
  const masterSheetId = context.masterSheetId?.trim() || "";
  const selectedArea = context.selectedArea?.trim() || "";

  const diagnostics: ScheduleAuditorDiagnostics = {
    companyId,
    masterSheetId,
    selectedArea,
    totalRows: users.length,
    activeCount: 0,
    auditorRoleCount: 0,
    auditorAccessLevelCount: 0,
    excludedByStatus: 0,
    excludedByCompany: 0,
    excludedByArea: 0,
    excludedNotAuditor: 0,
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

    if (snapshot.normalizedRole === "auditor") {
      diagnostics.auditorRoleCount += 1;
    }
    if (snapshot.normalizedAccessLevel === "auditor") {
      diagnostics.auditorAccessLevelCount += 1;
    }

    if (!isAuditorCompanyUsersTabRow(user)) {
      diagnostics.excludedNotAuditor += 1;
      snapshot.excludedReason = "not_auditor";
      diagnostics.candidates.push(snapshot);
      continue;
    }

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

export function buildAvailableScheduleAuditors(
  users: CompanyUsersTabRow[],
  context: {
    companyId?: string;
    masterSheetId?: string;
    selectedArea?: string;
    includeDiagnostics?: boolean;
  } = {},
): { auditors: ScheduleAuditorOption[]; diagnostics?: ScheduleAuditorDiagnostics } {
  const companyId = context.companyId?.trim() || "";
  const selectedArea = context.selectedArea?.trim() || "";
  const diagnostics = context.includeDiagnostics
    ? buildScheduleAuditorDiagnostics(users, context)
    : undefined;

  const auditors: ScheduleAuditorOption[] = [];
  const seen = new Set<string>();

  for (const user of users) {
    const email = user.email.trim();
    if (!email) {
      continue;
    }
    if (!isActiveCompanyUsersTabRow(user) || !isAuditorCompanyUsersTabRow(user) || !belongsToCompanyUsersTabRow(user, companyId)) {
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

    auditors.push({
      id,
      name: user.name.trim() || email.split("@")[0] || email,
      role: parseClientRole(user.role),
      email: email.toLowerCase(),
      areaWarning: areaResult.areaWarning,
    });
  }

  if (diagnostics) {
    diagnostics.finalCount = auditors.length;
  }

  return { auditors, diagnostics };
}

export function findPendingAuditorInvites(invites: InviteLike[], companyId = ""): InviteLike[] {
  return invites.filter((invite) => {
    if (normalizeScheduleValue(invite.role) !== "auditor") {
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

export function normalizeScheduleAuditorIds(
  savedAuditors: string[],
  options: ScheduleAuditorOption[],
): string[] {
  const normalized = new Set<string>();

  for (const saved of savedAuditors) {
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

export function resolveScheduleAuditorLabels(
  auditorIds: string[],
  options: ScheduleAuditorOption[],
): string[] {
  return auditorIds.map((auditorId) => {
    const match = options.find((option) => option.id === normalizeScheduleValue(auditorId));
    return match?.email || auditorId;
  });
}
