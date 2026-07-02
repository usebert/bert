/** Shared incident handler reassignment permission rules (server + verify scripts). */

function trim(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

export function isIncidentHandlerRole(role) {
  const normalized = trim(role).toLowerCase();
  return normalized === "master" || normalized === "admin" || normalized === "manager";
}

export function isIncidentManagementRole(role) {
  return isIncidentHandlerRole(role);
}

export function normalizeIncidentActorEmail(actor = {}) {
  return normalizeEmail(actor.email || actor.userEmail || actor.username);
}

export function normalizeIncidentRecordEmail(incident = {}, ...keys) {
  for (const key of keys) {
    const value = normalizeEmail(incident[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

export function incidentAssignedToEmail(incident = {}) {
  return normalizeIncidentRecordEmail(incident, "assignedToEmail", "AssignedToEmail");
}

export function incidentReceivedByEmail(incident = {}) {
  return normalizeIncidentRecordEmail(
    incident,
    "receivedByEmail",
    "ReceivedByEmail",
    "assignedToEmail",
    "AssignedToEmail",
  );
}

export function isIncidentHsReportReceiver(actor, incident = {}) {
  const actorEmail = normalizeIncidentActorEmail(actor);
  const receivedByEmail = incidentReceivedByEmail(incident);
  return Boolean(actorEmail && receivedByEmail && actorEmail === receivedByEmail);
}

export function isIncidentAssignedHandler(actor, incident = {}) {
  const actorEmail = normalizeIncidentActorEmail(actor);
  const assignedToEmail = incidentAssignedToEmail(incident);
  return Boolean(actorEmail && assignedToEmail && actorEmail === assignedToEmail);
}

export function isEligibleIncidentReassignTarget(user = {}) {
  return isIncidentHandlerRole(user.role || user.accessLevel);
}

export function canReassignCompanyIncident(actor, incident = {}, options = {}) {
  if (!actor) {
    return false;
  }
  const role = trim(actor.role);
  if (role.toLowerCase() === "auditor") {
    return false;
  }
  const target = options.targetUser || {};
  if (trim(target.email) && !isEligibleIncidentReassignTarget(target)) {
    return false;
  }
  if (options.godmode === true || trim(actor.kind).toLowerCase() === "godmode") {
    return true;
  }
  if (isIncidentManagementRole(role)) {
    return true;
  }
  if (isIncidentHsReportReceiver(actor, incident)) {
    return true;
  }
  if (isIncidentAssignedHandler(actor, incident)) {
    return true;
  }
  return false;
}

export function canAssignCompanyIncident(actor) {
  if (!actor) {
    return false;
  }
  const role = trim(actor.role);
  if (role.toLowerCase() === "auditor") {
    return false;
  }
  return isIncidentManagementRole(role) || trim(actor.kind).toLowerCase() === "godmode";
}
