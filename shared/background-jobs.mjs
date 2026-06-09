/** Shared background job types, statuses, and user-facing labels. */

export const BACKGROUND_JOB_TYPES = {
  COMPLETE_COMPANY_SETUP: "COMPLETE_COMPANY_SETUP",
  VERIFY_COMPANY_HEALTH: "VERIFY_COMPANY_HEALTH",
  REPAIR_COMPANY_STRUCTURE: "REPAIR_COMPANY_STRUCTURE",
  SEND_INVITE_EMAIL: "SEND_INVITE_EMAIL",
  SYNC_COMPANY_USERS: "SYNC_COMPANY_USERS",
  SYNC_SCHEDULES: "SYNC_SCHEDULES",
  GENERATE_REPORT: "GENERATE_REPORT",
  VERIFY_GOOGLE_CONNECTION: "VERIFY_GOOGLE_CONNECTION",
};

export const BACKGROUND_JOB_STATUSES = {
  QUEUED: "QUEUED",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
};

export const BACKGROUND_SETUP_USER_MESSAGE =
  "Saved. BERT is finishing the background setup.";

export const BACKGROUND_INVITE_CREATED_MESSAGE = "Invite created. Email is being sent.";

export const BACKGROUND_SCHEDULE_SAVED_MESSAGE =
  "Schedule saved. BERT is syncing to the company workbook.";

export const BACKGROUND_JOB_STATUS_BADGES = {
  COMPLETE_COMPANY_SETUP: "Finishing setup",
  VERIFY_COMPANY_HEALTH: "Finishing setup",
  REPAIR_COMPANY_STRUCTURE: "Finishing setup",
  SEND_INVITE_EMAIL: "Email sending",
  SYNC_COMPANY_USERS: "Syncing users",
  SYNC_SCHEDULES: "Syncing schedules",
  GENERATE_REPORT: "Generating report",
  VERIFY_GOOGLE_CONNECTION: "Checking Google",
  NEEDS_ATTENTION: "Needs attention",
};

export const BACKGROUND_JOB_MAX_ATTEMPTS = 5;

export const BACKGROUND_JOB_INITIAL_RETRY_MS = 5_000;

export const BACKGROUND_JOB_SLOW_ACTION_MS = 5_000;

export function backgroundJobStatusBadge(job = {}) {
  if (job.status === BACKGROUND_JOB_STATUSES.NEEDS_ATTENTION) {
    return BACKGROUND_JOB_STATUS_BADGES.NEEDS_ATTENTION;
  }
  if (job.status === BACKGROUND_JOB_STATUSES.FAILED) {
    return BACKGROUND_JOB_STATUS_BADGES.NEEDS_ATTENTION;
  }
  if (job.status === BACKGROUND_JOB_STATUSES.COMPLETED) {
    return "Complete";
  }
  return BACKGROUND_JOB_STATUS_BADGES[job.type] || "In progress";
}

export function isBackgroundJobTerminal(status = "") {
  return (
    status === BACKGROUND_JOB_STATUSES.COMPLETED ||
    status === BACKGROUND_JOB_STATUSES.FAILED ||
    status === BACKGROUND_JOB_STATUSES.NEEDS_ATTENTION
  );
}
