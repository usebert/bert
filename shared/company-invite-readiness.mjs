/**
 * Canonical company invite readiness — setup page, invite UI, and API gates share this logic.
 * Health checks, Google diagnostics, email, and background sync never block invites.
 */
import {
  COMPANY_NOT_LIVE_INVITE_MESSAGE,
  COMPANY_REGISTRY_STATUS_LIVE,
  getCanonicalCompanyStatus,
  isCompanyRegistryLive,
} from "./company-invite-permissions.mjs";

export const INVITE_READINESS_SOURCE = {
  MAIN_REGISTRY: "main_registry",
  FALLBACK_REGISTRY: "fallback_registry",
  SETUP_COMPLETED: "setup_completed",
  WORKSPACE_DERIVED: "workspace_derived",
  COMPANY_CONTEXT: "company_context",
  GODMODE_USERS_TAB: "godmode_users_tab",
};

export const INVITE_READINESS_NEXT_ACTION = {
  MAKE_USABLE: "make_usable",
  INVITE_USERS: "invite_users",
};

function trim(value) {
  return String(value ?? "").trim();
}

function hasLinkedWorkspace(record = {}) {
  const rootFolderId = trim(record.rootFolderId || record.companyId);
  const masterSheetId = trim(record.masterSheetId);
  return Boolean(rootFolderId && masterSheetId);
}

function isArchivedOrDisconnected(record = {}, context = {}) {
  const status = getCanonicalCompanyStatus(record) || trim(record.status);
  const lower = status.toLowerCase();
  if (lower === "archived" || lower === "disconnected") {
    return true;
  }
  return context.archived === true;
}

function isSetupCompletedRecord(record = {}) {
  return Boolean(trim(record.setupCompletedAt || record.liveAt));
}

function isWorkspaceDerivedUsable(record = {}) {
  if (!hasLinkedWorkspace(record)) {
    return false;
  }
  const explicit = getCanonicalCompanyStatus(record);
  if (explicit === "Archived" || explicit === "Disconnected") {
    return false;
  }
  return true;
}

function isCompanyContextUsable(context = {}) {
  const companyId = trim(context.companyId || context.companyFolderId);
  const masterSheetId = trim(context.masterSheetId);
  if (!companyId || !masterSheetId) {
    return false;
  }
  if (context.archived === true) {
    return false;
  }
  if (context.usable === false || context.workspaceSetupComplete === false) {
    return false;
  }
  if (context.usable === true || context.workspaceSetupComplete === true) {
    return true;
  }
  if (isCompanyRegistryLive({ status: context.registryStatus, registryStatus: context.registryStatus })) {
    return true;
  }
  return true;
}

/**
 * @param {{ record?: object; context?: object; godmodeUsersTabWritable?: boolean }} input
 */
export function evaluateCompanyInviteReadiness(input = {}) {
  const record = input.record || {};
  const context = input.context || {};

  if (input.godmodeUsersTabWritable === true) {
    return {
      canInvite: true,
      companyStatus: COMPANY_REGISTRY_STATUS_LIVE,
      source: INVITE_READINESS_SOURCE.GODMODE_USERS_TAB,
      userMessage: "",
    };
  }

  if (isArchivedOrDisconnected(record, context)) {
    return {
      canInvite: false,
      companyStatus: getCanonicalCompanyStatus(record) || "Archived",
      source: "",
      userMessage: COMPANY_NOT_LIVE_INVITE_MESSAGE,
      reasonCode: "ARCHIVED",
      nextAction: INVITE_READINESS_NEXT_ACTION.MAKE_USABLE,
    };
  }

  if (isCompanyRegistryLive(record)) {
    const fallback = record.registrySource === "fallback" || record.fallbackRegistry === true;
    return {
      canInvite: true,
      companyStatus: COMPANY_REGISTRY_STATUS_LIVE,
      source: fallback ? INVITE_READINESS_SOURCE.FALLBACK_REGISTRY : INVITE_READINESS_SOURCE.MAIN_REGISTRY,
      userMessage: "",
    };
  }

  if (isSetupCompletedRecord(record)) {
    return {
      canInvite: true,
      companyStatus: COMPANY_REGISTRY_STATUS_LIVE,
      source: INVITE_READINESS_SOURCE.SETUP_COMPLETED,
      userMessage: "",
    };
  }

  if (isWorkspaceDerivedUsable(record)) {
    return {
      canInvite: true,
      companyStatus: COMPANY_REGISTRY_STATUS_LIVE,
      source: INVITE_READINESS_SOURCE.WORKSPACE_DERIVED,
      userMessage: "",
    };
  }

  if (isCompanyContextUsable(context)) {
    return {
      canInvite: true,
      companyStatus: isCompanyRegistryLive(context)
        ? COMPANY_REGISTRY_STATUS_LIVE
        : COMPANY_REGISTRY_STATUS_LIVE,
      source: INVITE_READINESS_SOURCE.COMPANY_CONTEXT,
      userMessage: "",
    };
  }

  return {
    canInvite: false,
    companyStatus: getCanonicalCompanyStatus(record) || "Not set up",
    source: "",
    userMessage: COMPANY_NOT_LIVE_INVITE_MESSAGE,
    reasonCode: "COMPANY_NOT_USABLE",
    nextAction: INVITE_READINESS_NEXT_ACTION.MAKE_USABLE,
  };
}

/** Pure helper for verify scripts and synchronous callers with resolved data. */
export function canInviteUsersForCompanyFromData(input = {}) {
  return evaluateCompanyInviteReadiness(input).canInvite;
}
