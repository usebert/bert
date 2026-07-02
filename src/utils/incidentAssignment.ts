import type { Role } from "../permissions";
import type { IncidentAssignmentHistoryEntry, IncidentRecord } from "../types/incidentsScreenProps";
import type { User } from "../types/dashboardScreenProps";

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeEmail(value: unknown): string {
  return trim(value).toLowerCase();
}

export function isIncidentHandlerRole(role: Role | string): boolean {
  const normalized = trim(role).toLowerCase();
  return normalized === "master" || normalized === "admin" || normalized === "manager";
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

export function isEligibleIncidentReassignTarget(target: { role: string }): boolean {
  return isIncidentHandlerRole(target.role);
}

export function canReassignIncident(
  user: Pick<User, "username" | "email" | "role" | "name">,
  incident: IncidentRecord,
  target?: { email: string; role: string },
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

export function recentAssignmentHistory(history: IncidentAssignmentHistoryEntry[] = [], limit = 5): IncidentAssignmentHistoryEntry[] {
  return [...history].sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, limit);
}
