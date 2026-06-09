/**
 * Schedule builder assignee filtering — shared by server API and verify script.
 */

const COMPLETABLE_ROLE_VALUES = new Set([
  "admin",
  "company admin",
  "manager",
  "auditor",
  "user",
]);

export function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function parseCompanyAreasList(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isActiveUser(user) {
  return normalize(user.status ?? user.Status) === "active";
}

export function isActiveCompanyUser(user) {
  const email = String(user.email ?? user.Email ?? "").trim();
  return Boolean(email) && isActiveUser(user);
}

export function canCompleteAudit(user) {
  const role = normalize(user.role ?? user.Role);
  const accessLevel = normalize(user.accessLevel ?? user.AccessLevel);
  return COMPLETABLE_ROLE_VALUES.has(role) || COMPLETABLE_ROLE_VALUES.has(accessLevel);
}

/** @deprecated Use canCompleteAudit — kept for verify backward compat. */
export function isAuditorUser(user) {
  return canCompleteAudit(user);
}

export function belongsToCurrentCompany(user, companyId) {
  const targetCompanyId = String(companyId ?? "").trim();
  if (!targetCompanyId) {
    return true;
  }
  const userCompanyId = String(
    user.companyId ?? user.companyFolderId ?? user["Company ID"] ?? user.company_id ?? "",
  ).trim();
  if (!userCompanyId) {
    return true;
  }
  return userCompanyId === targetCompanyId;
}

export function parseRoleForClient(roleRaw) {
  const role = normalize(roleRaw);
  if (role === "admin" || role === "company admin") return "Admin";
  if (role === "manager") return "Manager";
  if (role === "auditor") return "Auditor";
  if (role === "user") return "User";
  if (role === "master") return "Master";
  return "User";
}

/**
 * @returns {{ include: boolean, reason: string, areaWarning?: string }}
 */
export function matchesScheduleAreaFilter(user, selectedArea) {
  const area = String(selectedArea ?? "").trim();
  if (!area) {
    return { include: true, reason: "no_area_filter" };
  }

  const areas = Array.isArray(user.companyAreas)
    ? user.companyAreas
    : parseCompanyAreasList(user.companyAreasRaw ?? user.CompanyAreas ?? user.companyAreas ?? "");
  const role = normalize(user.role ?? user.Role);

  if (areas.length === 0) {
    if (role === "admin" || role === "company admin" || role === "manager") {
      return { include: true, reason: "blank_areas_admin_manager" };
    }
    return {
      include: true,
      reason: "blank_areas_assignee",
      areaWarning: "User has no area assigned",
    };
  }

  const normalizedArea = normalize(area);
  const normalizedAreas = areas.map((entry) => normalize(entry));
  if (normalizedAreas.includes("all") || normalizedAreas.includes(normalizedArea)) {
    return { include: true, reason: "area_match" };
  }

  return { include: false, reason: "area_mismatch" };
}

function candidateSnapshot(user) {
  return {
    email: String(user.email ?? user.Email ?? "").trim().toLowerCase(),
    role: String(user.role ?? user.Role ?? "").trim(),
    accessLevel: String(user.accessLevel ?? user.AccessLevel ?? "").trim(),
    status: String(user.status ?? user.Status ?? "").trim(),
    companyId: String(user.companyId ?? user.companyFolderId ?? user["Company ID"] ?? "").trim(),
    companyAreas: Array.isArray(user.companyAreas)
      ? user.companyAreas
      : parseCompanyAreasList(user.companyAreasRaw ?? user.CompanyAreas ?? ""),
  };
}

export function buildScheduleAssigneeDiagnostics(users, options = {}) {
  const companyId = String(options.companyId ?? "").trim();
  const masterSheetId = String(options.masterSheetId ?? "").trim();
  const selectedArea = String(options.selectedArea ?? "").trim();

  const diagnostics = {
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
    const snapshot = candidateSnapshot(user);
    if (!snapshot.email) {
      continue;
    }

    const entry = {
      ...snapshot,
      normalizedRole: normalize(snapshot.role),
      normalizedAccessLevel: normalize(snapshot.accessLevel),
      normalizedStatus: normalize(snapshot.status),
      excludedReason: null,
    };

    if (!isActiveUser(user)) {
      diagnostics.excludedByStatus += 1;
      entry.excludedReason = "inactive_status";
      diagnostics.candidates.push(entry);
      continue;
    }
    diagnostics.activeCount += 1;

    if (!canCompleteAudit(user)) {
      diagnostics.excludedNotAssignable += 1;
      entry.excludedReason = "not_assignable";
      diagnostics.candidates.push(entry);
      continue;
    }
    diagnostics.assignableRoleCount += 1;

    if (!belongsToCurrentCompany(user, companyId)) {
      diagnostics.excludedByCompany += 1;
      entry.excludedReason = "wrong_company";
      diagnostics.candidates.push(entry);
      continue;
    }

    const areaResult = matchesScheduleAreaFilter(user, selectedArea);
    if (!areaResult.include) {
      diagnostics.excludedByArea += 1;
      entry.excludedReason = "area_mismatch";
      diagnostics.candidates.push(entry);
      continue;
    }

    entry.excludedReason = null;
    entry.areaWarning = areaResult.areaWarning ?? null;
    diagnostics.candidates.push(entry);
  }

  return diagnostics;
}

/** @deprecated Use buildScheduleAssigneeDiagnostics */
export function buildScheduleAuditorDiagnostics(users, options = {}) {
  const diagnostics = buildScheduleAssigneeDiagnostics(users, options);
  return {
    ...diagnostics,
    auditorRoleCount: diagnostics.assignableRoleCount,
    auditorAccessLevelCount: 0,
    excludedNotAuditor: diagnostics.excludedNotAssignable,
  };
}

export function buildAvailableScheduleAssigneesFromUsers(users, options = {}) {
  const companyId = String(options.companyId ?? "").trim();
  const selectedArea = String(options.selectedArea ?? "").trim();
  const includeDiagnostics = options.includeDiagnostics === true;

  const diagnostics = includeDiagnostics
    ? buildScheduleAssigneeDiagnostics(users, options)
    : undefined;

  const assignees = [];
  const seen = new Set();

  for (const user of users) {
    const email = String(user.email ?? user.Email ?? "").trim();
    if (!email) {
      continue;
    }

    if (!isActiveCompanyUser(user) || !canCompleteAudit(user) || !belongsToCurrentCompany(user, companyId)) {
      continue;
    }

    const areaResult = matchesScheduleAreaFilter(user, selectedArea);
    if (!areaResult.include) {
      continue;
    }

    const id = normalize(email);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);

    const companyAreas = Array.isArray(user.companyAreas)
      ? user.companyAreas
      : parseCompanyAreasList(user.companyAreasRaw ?? user.CompanyAreas ?? user.companyAreas ?? "");

    assignees.push({
      id,
      name: String(user.name ?? user.Name ?? email.split("@")[0] ?? email).trim() || email,
      role: parseRoleForClient(user.role ?? user.Role),
      email: email.toLowerCase(),
      companyAreas,
      areaWarning: areaResult.areaWarning,
    });
  }

  if (diagnostics) {
    diagnostics.finalCount = assignees.length;
  }

  return { assignees, auditors: assignees, diagnostics };
}

/** @deprecated Use buildAvailableScheduleAssigneesFromUsers */
export function buildAvailableScheduleAuditorsFromUsers(users, options = {}) {
  return buildAvailableScheduleAssigneesFromUsers(users, options);
}

export function findPendingAssigneeInvites(invites = [], companyId = "") {
  return invites.filter((invite) => {
    if (!canCompleteAudit(invite)) {
      return false;
    }
    if (!belongsToCurrentCompany(invite, companyId)) {
      return false;
    }
    const status = normalize(invite.status);
    if (status === "active" || invite.loginReady === true) {
      return false;
    }
    return true;
  });
}

/** @deprecated Use findPendingAssigneeInvites */
export function findPendingAuditorInvites(invites = [], companyId = "") {
  return findPendingAssigneeInvites(invites, companyId);
}

export function inviteAccessLevelForRole(role) {
  const normalized = normalize(role);
  if (normalized === "admin" || normalized === "company admin") {
    return "full";
  }
  if (normalized === "auditor") {
    return "AUDITOR";
  }
  return "operational";
}
