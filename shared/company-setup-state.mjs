/**
 * Company setup phase → user-facing status and next action (Godmode + verify scripts).
 * Health-check phases never block users; HEALTH_CHECK_READY auto-queues in the background.
 */

export const COMPANY_SETUP_PHASE = {
  SETUP_REQUIRED: "SETUP_REQUIRED",
  SETUP_RUNNING: "SETUP_RUNNING",
  LIVE: "LIVE",
  HEALTH_CHECK_READY: "HEALTH_CHECK_READY",
  HEALTH_CHECK_RUNNING: "HEALTH_CHECK_RUNNING",
  HEALTH_CHECK_FAILED_LIVE: "HEALTH_CHECK_FAILED_LIVE",
  SETUP_FAILED: "SETUP_FAILED",
  ARCHIVED: "ARCHIVED",
};

export const COMPANY_SETUP_DISPLAY_STATUS = {
  NOT_SET_UP: "Not set up",
  WORKING_IN_BACKGROUND: "Working in the background",
  READY: "Ready",
  NEEDS_ATTENTION: "Needs attention",
};

export const COMPANY_SETUP_PRIMARY_ACTION = {
  MAKE_USABLE: "make_usable",
  INVITE_USERS: "invite_users",
  OPEN_DASHBOARD: "open_dashboard",
  NONE: "none",
};

export const COMPANY_SETUP_FAILED_MESSAGE = "Could not finish setup";

function isSynced(syncState = "") {
  const value = String(syncState || "").trim();
  return value === "Synced" || value === "Linked";
}

/**
 * @param {{
 *   archived?: boolean;
 *   setupFailed?: boolean;
 *   companyLive?: boolean;
 *   companyUsable?: boolean;
 *   hasCompanyFolder?: boolean;
 *   masterSheetId?: string;
 *   syncState?: string;
 *   isProvisioning?: boolean;
 *   backgroundWorkRunning?: boolean;
 *   healthCheckRunning?: boolean;
 *   healthCheckRun?: boolean;
 *   workspaceHealthOk?: boolean;
 * }} input
 */
export function resolveCompanySetupPhase(input = {}) {
  if (input.archived) {
    return COMPANY_SETUP_PHASE.ARCHIVED;
  }
  if (input.setupFailed) {
    return COMPANY_SETUP_PHASE.SETUP_FAILED;
  }

  const companyUsable = Boolean(input.companyUsable || input.companyLive);
  const healthCheckRun = Boolean(input.healthCheckRun);
  const workspaceHealthOk = input.workspaceHealthOk !== false;

  if (companyUsable) {
    if (healthCheckRun && !workspaceHealthOk) {
      return COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE;
    }
    return COMPANY_SETUP_PHASE.LIVE;
  }

  if (input.healthCheckRunning) {
    return COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING;
  }
  if (input.isProvisioning || input.backgroundWorkRunning) {
    return COMPANY_SETUP_PHASE.SETUP_RUNNING;
  }

  const hasCompanyFolder = Boolean(input.hasCompanyFolder);
  const masterSheetId = String(input.masterSheetId || "").trim();
  const synced = isSynced(input.syncState);

  if (hasCompanyFolder && masterSheetId && synced && !healthCheckRun) {
    return COMPANY_SETUP_PHASE.HEALTH_CHECK_READY;
  }

  if (!hasCompanyFolder || !masterSheetId) {
    return COMPANY_SETUP_PHASE.SETUP_REQUIRED;
  }

  return COMPANY_SETUP_PHASE.SETUP_REQUIRED;
}

export function resolveCompanySetupDisplayStatus(phase) {
  switch (phase) {
    case COMPANY_SETUP_PHASE.LIVE:
      return COMPANY_SETUP_DISPLAY_STATUS.READY;
    case COMPANY_SETUP_PHASE.SETUP_RUNNING:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_READY:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING:
      return COMPANY_SETUP_DISPLAY_STATUS.WORKING_IN_BACKGROUND;
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE:
    case COMPANY_SETUP_PHASE.SETUP_FAILED:
    case COMPANY_SETUP_PHASE.ARCHIVED:
      return COMPANY_SETUP_DISPLAY_STATUS.NEEDS_ATTENTION;
    case COMPANY_SETUP_PHASE.SETUP_REQUIRED:
    default:
      return COMPANY_SETUP_DISPLAY_STATUS.NOT_SET_UP;
  }
}

export function resolveCompanySetupPrimaryAction(phase) {
  switch (phase) {
    case COMPANY_SETUP_PHASE.SETUP_REQUIRED:
      return {
        label: "Make company usable",
        action: COMPANY_SETUP_PRIMARY_ACTION.MAKE_USABLE,
      };
    case COMPANY_SETUP_PHASE.LIVE:
      return {
        label: "Invite users",
        action: COMPANY_SETUP_PRIMARY_ACTION.INVITE_USERS,
      };
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_FAILED_LIVE:
      return {
        label: "",
        detail: "Review advanced diagnostics when convenient.",
        action: COMPANY_SETUP_PRIMARY_ACTION.NONE,
      };
    case COMPANY_SETUP_PHASE.SETUP_FAILED:
      return {
        label: COMPANY_SETUP_FAILED_MESSAGE,
        detail: "Use advanced diagnostics to retry or repair.",
        action: COMPANY_SETUP_PRIMARY_ACTION.NONE,
      };
    case COMPANY_SETUP_PHASE.SETUP_RUNNING:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_READY:
    case COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING:
      return {
        label: "",
        detail: "Working in the background",
        action: COMPANY_SETUP_PRIMARY_ACTION.NONE,
      };
    default:
      return {
        label: "Make company usable",
        action: COMPANY_SETUP_PRIMARY_ACTION.MAKE_USABLE,
      };
  }
}

export function shouldAutoQueueHealthCheck(phase) {
  return phase === COMPANY_SETUP_PHASE.HEALTH_CHECK_READY;
}

export function isBackgroundSetupPhase(phase) {
  return (
    phase === COMPANY_SETUP_PHASE.SETUP_RUNNING ||
    phase === COMPANY_SETUP_PHASE.HEALTH_CHECK_READY ||
    phase === COMPANY_SETUP_PHASE.HEALTH_CHECK_RUNNING
  );
}
