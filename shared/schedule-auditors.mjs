/**
 * Schedule builder auditor filtering — shared by server API and verify script.
 */

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

export function isAuditorUser(user) {
  const role = normalize(user.role ?? user.Role);
  const accessLevel = normalize(user.accessLevel ?? user.AccessLevel);
  return role === "auditor" || accessLevel === "auditor";
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
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  if (role === "auditor") return "Auditor";
  if (role === "master") return "Master";
  return "Auditor";
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
    if (role === "admin" || role === "manager") {
      return { include: true, reason: "blank_areas_admin_manager" };
    }
    return {
      include: true,
      reason: "blank_areas_auditor",
      areaWarning: "Auditor has no area assigned",
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

export function buildScheduleAuditorDiagnostics(users, options = {}) {
  const companyId = String(options.companyId ?? "").trim();
  const masterSheetId = String(options.masterSheetId ?? "").trim();
  const selectedArea = String(options.selectedArea ?? "").trim();

  const diagnostics = {
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

    if (entry.normalizedRole === "auditor") {
      diagnostics.auditorRoleCount += 1;
    }
    if (entry.normalizedAccessLevel === "auditor") {
      diagnostics.auditorAccessLevelCount += 1;
    }

    if (!isAuditorUser(user)) {
      diagnostics.excludedNotAuditor += 1;
      entry.excludedReason = "not_auditor";
      diagnostics.candidates.push(entry);
      continue;
    }

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

export function buildAvailableScheduleAuditorsFromUsers(users, options = {}) {
  const companyId = String(options.companyId ?? "").trim();
  const selectedArea = String(options.selectedArea ?? "").trim();
  const includeDiagnostics = options.includeDiagnostics === true;

  const diagnostics = includeDiagnostics
    ? buildScheduleAuditorDiagnostics(users, options)
    : undefined;

  const optionsOut = [];
  const seen = new Set();

  for (const user of users) {
    const email = String(user.email ?? user.Email ?? "").trim();
    if (!email) {
      continue;
    }

    if (!isActiveUser(user) || !isAuditorUser(user) || !belongsToCurrentCompany(user, companyId)) {
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

    optionsOut.push({
      id,
      name: String(user.name ?? user.Name ?? email.split("@")[0] ?? email).trim() || email,
      role: parseRoleForClient(user.role ?? user.Role),
      email: email.toLowerCase(),
      areaWarning: areaResult.areaWarning,
    });
  }

  if (diagnostics) {
    diagnostics.finalCount = optionsOut.length;
  }

  return { auditors: optionsOut, diagnostics };
}

export function findPendingAuditorInvites(invites = [], companyId = "") {
  return invites.filter((invite) => {
    const role = normalize(invite.role);
    if (role !== "auditor") {
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

export function inviteAccessLevelForRole(role) {
  const normalized = normalize(role);
  if (normalized === "admin") {
    return "full";
  }
  if (normalized === "auditor") {
    return "AUDITOR";
  }
  return "operational";
}
