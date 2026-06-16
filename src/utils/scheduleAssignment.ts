/**
 * Schedule assignee resolution — client bundle (mirrors shared/schedule-assignment.mjs).
 */

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseEmailList(raw: unknown): string[] {
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

function addUniqueEmails(target: string[], seen: Set<string>, values: string[]): void {
  for (const email of values) {
    const normalized = normalizeEmail(email);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    target.push(normalized);
  }
}

export function getScheduleAssignedEmails(schedule: Record<string, unknown> = {}): string[] {
  const emails: string[] = [];
  const seen = new Set<string>();

  addUniqueEmails(emails, seen, parseEmailList(schedule.assignedUserEmails));

  const usersJson = schedule.assignedUsersJson;
  if (usersJson) {
    try {
      const parsed = typeof usersJson === "string" ? JSON.parse(usersJson) : usersJson;
      if (Array.isArray(parsed)) {
        addUniqueEmails(
          emails,
          seen,
          parsed.map((entry: string | { email?: string }) =>
            typeof entry === "string" ? entry : entry?.email || "",
          ),
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
      schedule.assignedUsers.map((entry: string | { email?: string }) =>
        typeof entry === "string" ? entry : entry?.email || "",
      ),
    );
  }

  addUniqueEmails(emails, seen, parseEmailList(schedule.auditorEmails));
  addUniqueEmails(emails, seen, parseEmailList(schedule.auditors));
  addUniqueEmails(emails, seen, parseEmailList(schedule.assignedAuditors));

  return emails;
}

export function isScheduleAssignedToUser(schedule: Record<string, unknown>, userEmail: string): boolean {
  const normalized = normalizeEmail(userEmail);
  if (!normalized) {
    return false;
  }
  return getScheduleAssignedEmails(schedule).includes(normalized);
}

export function isScheduleAssignedToAnyEmail(
  schedule: Record<string, unknown>,
  userEmails: Set<string> | Iterable<string>,
): boolean {
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
