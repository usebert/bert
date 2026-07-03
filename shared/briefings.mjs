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

export const BRIEFING_TYPES = ["Policy", "Toolbox Talk", "Notice", "Training", "Other"];
export const BRIEFING_PRIORITIES = ["Normal", "Important", "Urgent"];
export const BRIEFING_TARGET_MODES = ["everyone", "role", "area", "department", "users"];
export const BRIEFING_RENEWAL_FREQUENCIES = ["None", "Annual", "6 monthly", "Custom"];

export const BRIEFINGS_DRIVE_PATH_PREFIX = "04 - Documents/Briefings";
