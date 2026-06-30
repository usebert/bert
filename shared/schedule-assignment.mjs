/**
 * Single source for schedule assignee emails — save, load, dashboard, My checks, reports.
 */

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidAssigneeEmail(value) {
  const normalized = normalizeEmail(value);
  return Boolean(normalized) && normalized.includes("@");
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
    if (!isValidAssigneeEmail(normalized) || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    target.push(normalized);
  }
}

/** Build lookup maps from Users tab rows for name → email resolution. */
export function buildAssigneeDirectoryIndex(companyUsers = []) {
  const emailByName = new Map();
  const nameByEmail = new Map();
  for (const user of companyUsers) {
    const email = normalizeEmail(user?.email || user?.Email);
    const name = normalizeEmail(user?.name || user?.Name);
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

/** Resolve picker tokens, legacy names, or emails to canonical assignee emails. */
export function resolveAssigneeTokensToEmails(tokens = [], companyUsers = []) {
  const { emailByName } = buildAssigneeDirectoryIndex(companyUsers);
  const resolved = [];
  const seen = new Set();

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

/** Raw assignee identity tokens from sheet fields (emails, names, legacy columns). */
export function getScheduleAssigneeIdentityTokens(schedule = {}) {
  if (Array.isArray(schedule.assigneeIdentityTokens) && schedule.assigneeIdentityTokens.length > 0) {
    return schedule.assigneeIdentityTokens.map((entry) => normalizeEmail(entry)).filter(Boolean);
  }
  const tokens = [];
  const seen = new Set();

  const addToken = (value) => {
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
            addToken(entry?.email);
            addToken(entry?.name);
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
        addToken(entry?.email);
        addToken(entry?.name);
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

/**
 * Reads canonical assignee emails from schedule fields (valid emails only).
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
  // assignedAuditors often stores display names — only keep valid emails from that column.
  addUniqueEmails(emails, seen, parseEmailList(schedule.assignedAuditors));

  return emails;
}

/** True when userEmail is listed on the schedule (trimmed, lowercase; optional Users tab directory). */
export function isScheduleAssignedToUser(schedule, userEmail, options = {}) {
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
      ? schedule.assigneeIdentityTokens.map((entry) => normalizeEmail(entry)).filter(Boolean)
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

/** True when any email in the set matches a schedule assignee. */
export function isScheduleAssignedToAnyEmail(schedule, userEmails, options = {}) {
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
