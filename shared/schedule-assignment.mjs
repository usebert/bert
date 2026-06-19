/**
 * Single source for schedule assignee emails — save, load, dashboard, My checks, reports.
 */

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseEmailList(raw) {
  if (Array.isArray(raw)) {
    return raw.map((entry) => normalizeEmail(entry)).filter(Boolean);
  }
  const text = String(raw ?? "").trim();
  if (!text) {
    return [];
  }
  return text
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}

function addUniqueEmails(target, seen, values) {
  for (const email of values) {
    const normalized = normalizeEmail(email);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    target.push(normalized);
  }
}

/**
 * Reads assignee emails from canonical and legacy schedule fields.
 */
export function getScheduleAssignedEmails(schedule = {}) {
  const emails = [];
  const seen = new Set();

  addUniqueEmails(emails, seen, parseEmailList(schedule.assignedUserEmails));

  const usersJson = schedule.assignedUsersJson;
  if (usersJson) {
    try {
      const parsed = typeof usersJson === "string" ? JSON.parse(usersJson) : usersJson;
      if (Array.isArray(parsed)) {
        addUniqueEmails(
          emails,
          seen,
          parsed.map((entry) => (typeof entry === "string" ? entry : entry?.email)),
        );
      }
    } catch {
      // ignore malformed JSON
    }
  }

  if (Array.isArray(schedule.assignedUsers)) {
    addUniqueEmails(
      emails,
      seen,
      schedule.assignedUsers.map((entry) => (typeof entry === "string" ? entry : entry?.email)),
    );
  }

  addUniqueEmails(emails, seen, parseEmailList(schedule.auditorEmails));
  addUniqueEmails(emails, seen, parseEmailList(schedule.auditors));
  addUniqueEmails(emails, seen, parseEmailList(schedule.assignedAuditors));

  return emails;
}

/** True when userEmail is listed on the schedule (trimmed, lowercase). */
export function isScheduleAssignedToUser(schedule, userEmail) {
  const normalized = normalizeEmail(userEmail);
  if (!normalized) {
    return false;
  }
  return getScheduleAssignedEmails(schedule).includes(normalized);
}

/** True when any email in the set matches a schedule assignee. */
export function isScheduleAssignedToAnyEmail(schedule, userEmails) {
  const assigned = getScheduleAssignedEmails(schedule);
  if (assigned.length === 0) {
    return true;
  }
  for (const email of userEmails) {
    if (assigned.includes(normalizeEmail(email))) {
      return true;
    }
  }
  return false;
}
