/** Briefings workbook tab names and column headers (shared server + client). */

export const BRIEFINGS_TAB = "Briefings";
export const BRIEFING_RECIPIENTS_TAB = "BriefingRecipients";

export const BRIEFINGS_TAB_COLUMNS = [
  "BriefingId",
  "Title",
  "Type",
  "Status",
  "Priority",
  "CreatedByEmail",
  "CreatedByName",
  "CreatedAt",
  "SentAt",
  "DueDate",
  "RequiresRead",
  "RequiresAcknowledgement",
  "RequiresSignature",
  "RequiresReply",
  "RenewalFrequency",
  "RenewalDueDate",
  "TargetMode",
  "TargetRoles",
  "TargetAreas",
  "TargetDepartments",
  "TargetUserEmails",
  "DocumentName",
  "DocumentDriveFileId",
  "DocumentDriveLink",
  "Message",
  "RecipientCount",
  "OpenedCount",
  "ReadCount",
  "AcknowledgedCount",
  "SignedCount",
  "ReplyCount",
  "OverdueCount",
  "VerificationSource",
];

export const BRIEFING_RECIPIENTS_TAB_COLUMNS = [
  "BriefingId",
  "RecipientEmail",
  "RecipientName",
  "Role",
  "Area",
  "Department",
  "SentAt",
  "OpenedAt",
  "ReadAt",
  "AcknowledgedAt",
  "SignedAt",
  "ReplyText",
  "ReplyAt",
  "Status",
  "Overdue",
  "SignatureName",
  "LastReminderAt",
];

export const BRIEFING_TYPES = ["Policy", "Toolbox Talk", "Notice", "Training", "Verification", "Other"];
export const BRIEFING_PRIORITIES = ["Normal", "Important", "Urgent"];
export const BRIEFING_TARGET_MODES = ["everyone", "role", "area", "department", "users"];
export const BRIEFING_RENEWAL_FREQUENCIES = ["None", "Annual", "6 monthly", "Custom"];

export const BRIEFINGS_DRIVE_PATH_PREFIX = "04 - Documents/Briefings";

/** Company workbook tabs checked for briefing recipient expansion (People first, Users fallback). */
export const BRIEFING_RECIPIENT_SOURCE_TABS = ["People", "Users"];

export const BRIEFING_RECIPIENT_EMAIL_HEADERS = ["Email", "email", "UserEmail", "PersonEmail"];
export const BRIEFING_RECIPIENT_NAME_HEADERS = ["Name", "name", "FullName", "Full Name", "DisplayName"];
export const BRIEFING_RECIPIENT_ROLE_HEADERS = ["Role", "role", "Roles"];
export const BRIEFING_RECIPIENT_STATUS_HEADERS = ["Status", "status", "UserStatus"];
export const BRIEFING_RECIPIENT_AREA_HEADERS = ["CompanyAreas", "Company Areas", "Area", "area", "SiteArea"];
export const BRIEFING_RECIPIENT_DEPARTMENT_HEADERS = ["Department", "department"];

const BRIEFING_EXCLUDED_RECIPIENT_STATUSES = new Set([
  "disabled",
  "revoked",
  "inactive",
  "removed",
  "deleted",
]);

/** ACTIVE/Active/enabled/blank legacy are usable; disabled/revoked/inactive are not. */
export function isUsableBriefingRecipientStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return !BRIEFING_EXCLUDED_RECIPIENT_STATUSES.has(normalized);
}

export function pickBriefingRecipientField(record = {}, ...keys) {
  const keyList = keys.flat();
  for (const key of keyList) {
    const direct = String(record?.[key] ?? "").trim();
    if (direct) {
      return direct;
    }
  }
  const lowerKeys = keyList.map((key) => String(key).trim().toLowerCase());
  for (const [header, value] of Object.entries(record || {})) {
    if (lowerKeys.includes(String(header).trim().toLowerCase()) && String(value ?? "").trim()) {
      return String(value).trim();
    }
  }
  return "";
}
