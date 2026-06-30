/**
 * Schedule assignee resolution — client bundle (mirrors shared/schedule-assignment.mjs).
 */

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidAssigneeEmail(value: unknown): boolean {
  const normalized = normalizeEmail(value);
  return Boolean(normalized) && normalized.includes("@");
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
    if (!isValidAssigneeEmail(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    target.push(normalized);
  }
}

export function buildAssigneeDirectoryIndex(
  companyUsers: Array<{ email?: string; name?: string; Email?: string; Name?: string }> = [],
) {
  const emailByName = new Map<string, string>();
  const nameByEmail = new Map<string, string>();
  for (const user of companyUsers) {
    const email = normalizeEmail(user.email || user.Email);
    const name = normalizeEmail(user.name || user.Name);
    if (!isValidAssigneeEmail(email)) {
      continue;
    }
    nameByEmail.set(email, name);
    if (name) {
      emailByName.set(name, email);
    }
  }
  return { emailByName, nameByEmail };
}

export function resolveAssigneeTokensToEmails(
  tokens: string[] = [],
  companyUsers: Array<{ email?: string; name?: string; Email?: string; Name?: string }> = [],
): string[] {
  const { emailByName } = buildAssigneeDirectoryIndex(companyUsers);
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const rawToken of tokens) {
    const token = normalizeEmail(rawToken);
    if (!token) {
      continue;
    }
    let email = "";
    if (isValidAssigneeEmail(token)) {
      email = token;
    } else {
      email = emailByName.get(token) || "";
    }
    if (!isValidAssigneeEmail(email) || seen.has(email)) {
      continue;
    }
    seen.add(email);
    resolved.push(email);
  }

  return resolved;
}

export function getScheduleAssigneeIdentityTokens(schedule: Record<string, unknown> = {}): string[] {
  if (Array.isArray(schedule.assigneeIdentityTokens) && schedule.assigneeIdentityTokens.length > 0) {
    return schedule.assigneeIdentityTokens
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean);
  }
  const tokens: string[] = [];
  const seen = new Set<string>();

  const addToken = (value: unknown) => {
    const token = normalizeEmail(value);
    if (!token || seen.has(token)) {
      return;
    }
    seen.add(token);
    tokens.push(token);
  };

  for (const entry of parseEmailList(schedule.assignedUserEmails)) {
    addToken(entry);
  }

  const usersJson = schedule.assignedUsersJson;
  if (usersJson) {
    try {
      const parsed = typeof usersJson === "string" ? JSON.parse(usersJson) : usersJson;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === "string") {
            addToken(entry);
          } else {
            addToken((entry as { email?: string; name?: string })?.email);
            addToken((entry as { email?: string; name?: string })?.name);
          }
        }
      }
    } catch {
      // ignore malformed JSON
    }
  }

  if (Array.isArray(schedule.assignedUsers)) {
    for (const entry of schedule.assignedUsers) {
      if (typeof entry === "string") {
        addToken(entry);
      } else {
        addToken((entry as { email?: string; name?: string })?.email);
        addToken((entry as { email?: string; name?: string })?.name);
      }
    }
  }

  for (const entry of parseEmailList(schedule.auditorEmails)) {
    addToken(entry);
  }
  for (const entry of parseEmailList(schedule.auditors)) {
    addToken(entry);
  }
  for (const entry of parseEmailList(schedule.assignedAuditors)) {
    addToken(entry);
  }
  for (const entry of parseEmailList(schedule.assignedUserNames)) {
    addToken(entry);
  }

  return tokens;
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

export function isScheduleAssignedToUser(
  schedule: Record<string, unknown>,
  userEmail: string,
  options: { assigneeDirectory?: Array<{ email?: string; name?: string }> } = {},
): boolean {
  const normalized = normalizeEmail(userEmail);
  if (!normalized) {
    return false;
  }

  if (getScheduleAssignedEmails(schedule).includes(normalized)) {
    return true;
  }

  const directory = Array.isArray(options.assigneeDirectory) ? options.assigneeDirectory : [];
  if (directory.length === 0) {
    return false;
  }

  const { emailByName, nameByEmail } = buildAssigneeDirectoryIndex(directory);
  const signedInNames = new Set([nameByEmail.get(normalized)].filter(Boolean));

  const tokens =
    Array.isArray(schedule.assigneeIdentityTokens) && schedule.assigneeIdentityTokens.length > 0
      ? schedule.assigneeIdentityTokens.map((entry) => normalizeEmail(String(entry))).filter(Boolean)
      : getScheduleAssigneeIdentityTokens(schedule);

  for (const token of tokens) {
    if (token === normalized) {
      return true;
    }
    if (signedInNames.has(token)) {
      return true;
    }
    if (emailByName.get(token) === normalized) {
      return true;
    }
  }

  return false;
}

export function isScheduleAssignedToAnyEmail(
  schedule: Record<string, unknown>,
  userEmails: Set<string> | Iterable<string>,
  options: { assigneeDirectory?: Array<{ email?: string; name?: string }> } = {},
): boolean {
  const assigned = getScheduleAssignedEmails(schedule);
  if (assigned.length === 0 && getScheduleAssigneeIdentityTokens(schedule).length === 0) {
    return true;
  }
  for (const email of userEmails) {
    if (isScheduleAssignedToUser(schedule, email, options)) {
      return true;
    }
  }
  return false;
}
