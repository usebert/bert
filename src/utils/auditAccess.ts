import type { AuditAccessLevel } from "../types/auditsScreenProps";
import type { Audit, AuditTemplate } from "../types/reportsScreenProps";
import type { User } from "../types/dashboardScreenProps";

export type CompanyReportUserLike = {
  name: string;
  email: string;
  username?: string;
};

export function normalizeAuditAccessLevel(access: AuditAccessLevel): AuditAccessLevel {
  if (access === "Complete") {
    return "Can complete";
  }
  return access;
}

export function isAuditorCompletableAccess(access: AuditAccessLevel): boolean {
  const normalized = normalizeAuditAccessLevel(access);
  return normalized === "Can complete" || normalized === "Full access";
}

export function resolveCurrentUserReportEmails(
  currentUser: User,
  companyReportUsers: CompanyReportUserLike[],
): Set<string> {
  const normalizedName = normalizeIdentity(currentUser.name);
  const normalizedUsername = normalizeIdentity(currentUser.username);
  const usernameIsEmail = currentUser.username.includes("@");
  const primaryEmail = usernameIsEmail
    ? normalizedUsername
    : normalizeIdentity(`${currentUser.username}@usebert.co.uk`);
  const legacyEmail = usernameIsEmail ? "" : normalizeIdentity(`${currentUser.username}@qmsprecast.co.uk`);

  const emails = new Set<string>();
  if (primaryEmail) {
    emails.add(primaryEmail);
  }
  if (legacyEmail) {
    emails.add(legacyEmail);
  }
  if (usernameIsEmail) {
    emails.add(normalizedUsername);
  }

  companyReportUsers.forEach((user) => {
    const userName = normalizeIdentity(user.name);
    const userEmail = normalizeIdentity(user.email);
    const userEmailLocalPart = normalizeIdentity(user.email.split("@")[0]);
    const userUsername = normalizeIdentity(user.username || "");
    const matchesUser =
      userName === normalizedName ||
      userEmail === primaryEmail ||
      userEmail === legacyEmail ||
      userEmailLocalPart === normalizedUsername ||
      userUsername === normalizedUsername ||
      (usernameIsEmail && userEmail === normalizedUsername);
    if (matchesUser && userEmail) {
      emails.add(userEmail);
    }
  });

  return emails;
}

export function buildAvailableAuditFromTemplate(
  template: AuditTemplate,
  siteArea: string,
  owner: string,
  dueLabel = "Available",
): Audit {
  return {
    id: template.id,
    name: template.name,
    category: template.source,
    siteArea,
    dueLabel,
    dueHours: 24,
    priority: "Medium",
    owner,
    templateVersion: template.source,
    status: "green",
    lastCompletedAt: "Not yet completed",
    questions: template.questions,
  };
}

function normalizeIdentity(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ").trim();
}
