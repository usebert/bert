import {
  countCompanyUsersOnSheet,
  ensureCompanyWorkspaceLiveIfReady,
  isCompanyWorkspaceLiveForUserInvites,
  readOnboardingRegistryMasterSheetForFolder,
  writeOnboardingRegistryMasterSheetForFolder,
} from "./company-onboarding.mjs";
import {
  getCanonicalCompanyRegistryRecord,
  persistCompanyWorkspaceSetup,
} from "./company-workspace-registry.mjs";
import {
  COMPANY_MASTER_SHEET_UNAVAILABLE_CODE,
  COMPANY_MASTER_SHEET_UNAVAILABLE_MESSAGE,
  customerMessageForInviteTargetCode,
  INVITE_COMPANY_LINK_MISSING_CODE,
  INVITE_COMPANY_LINK_MISSING_MESSAGE,
  logInviteCompleteFailure,
  mapInviteTargetCodeForCustomer,
  validateCompanyUserInviteTarget,
} from "./invite-target.mjs";

function trimId(value) {
  return String(value || "").trim();
}

export function isGoogleAccessDeniedError(err) {
  const status = err?.code ?? err?.response?.status ?? err?.status;
  if (status === 403 || status === 401) {
    return true;
  }
  const message = String(err?.message || err?.response?.data?.error?.message || "");
  return /permission|forbidden|insufficient|access denied/i.test(message);
}

export function buildInviteTargetDiagnostics(resolved, targetCheck) {
  const diagnostics = [];
  if (!trimId(resolved.companyId)) {
    diagnostics.push("missing_company_id");
  }
  if (!trimId(resolved.companyFolderId)) {
    diagnostics.push("missing_company_folder_id");
  }
  if (!trimId(resolved.masterSheetId)) {
    diagnostics.push("missing_master_sheet_id");
  }
  if (resolved.sources.includes("registry")) {
    diagnostics.push("source_registry");
  }
  if (resolved.sources.includes("invite")) {
    diagnostics.push("source_invite");
  }
  if (resolved.sources.includes("provision")) {
    diagnostics.push("source_provision");
  }
  if (resolved.sources.includes("folder")) {
    diagnostics.push("source_folder_search");
  }
  if (resolved.sources.includes("config")) {
    diagnostics.push("source_config");
  }
  if (resolved.sources.includes("onboarding_registry")) {
    diagnostics.push("source_onboarding_registry");
  }
  if (resolved.repaired) {
    diagnostics.push("repaired_target_ids");
  }
  if (targetCheck?.code === "google_access_denied") {
    diagnostics.push("google_access_denied");
  }
  if (
    targetCheck?.code === "stale_invite_target" ||
    targetCheck?.code === INVITE_COMPANY_LINK_MISSING_CODE
  ) {
    diagnostics.push("stale_invite_target");
  }
  if (targetCheck?.code === "google_api_error") {
    diagnostics.push("google_api_error");
  }
  if (resolved.promotedLive) {
    diagnostics.push("promoted_live");
  }
  if (resolved.registryUpdated) {
    diagnostics.push("registry_updated");
  }
  return diagnostics;
}

export async function findMasterSheetInCompanyFolder(auth, companyFolderId, deps) {
  const folderId = trimId(companyFolderId);
  if (!auth || !folderId) {
    return null;
  }
  const { listDriveChildren, normalizeDriveFolderName, resolveIsoFoldersFromChildren } = deps;
  const children = await listDriveChildren(auth, folderId);
  const isoFoldersByKey = resolveIsoFoldersFromChildren(children);
  const setupFolder = isoFoldersByKey.setupFolderId;
  const auditFormsFolder = isoFoldersByKey.auditFormsFolderId;

  let setupFolderContents = [];
  if (setupFolder?.id) {
    setupFolderContents = await listDriveChildren(auth, setupFolder.id);
  }

  const bertSystemFolder = children.find(
    (file) =>
      file.mimeType === "application/vnd.google-apps.folder" &&
      normalizeDriveFolderName(file.name) === "bert system files",
  );
  let companyWorkbookContents = [];
  if (bertSystemFolder?.id) {
    const bertChildren = await listDriveChildren(auth, bertSystemFolder.id);
    const companyWorkbookFolder = bertChildren.find(
      (file) =>
        file.mimeType === "application/vnd.google-apps.folder" &&
        normalizeDriveFolderName(file.name) === "company workbook",
    );
    if (companyWorkbookFolder?.id) {
      companyWorkbookContents = await listDriveChildren(auth, companyWorkbookFolder.id);
    }
  }

  const masterSheet =
    companyWorkbookContents.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
    setupFolderContents.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
    children.find((file) => file.mimeType === "application/vnd.google-apps.spreadsheet") ||
    null;

  return masterSheet?.id ? { id: masterSheet.id, name: masterSheet.name || "" } : null;
}

function inviteLinkMissingResult({ companyLabel = "", masterSheetIdPresent = false } = {}) {
  return {
    ok: false,
    code: INVITE_COMPANY_LINK_MISSING_CODE,
    message: INVITE_COMPANY_LINK_MISSING_MESSAGE,
    httpStatus: 409,
    masterSheetIdPresent,
    companyLabel,
    resolved: null,
    diagnostics: ["missing_company_link"],
  };
}

function customerFacingTargetFailure(targetCheck, resolved) {
  const customerCode = mapInviteTargetCodeForCustomer(targetCheck.code);
  const customerMessage = customerMessageForInviteTargetCode(targetCheck.code) || targetCheck.message;
  return {
    ...targetCheck,
    code: customerCode,
    message: customerMessage,
    resolved,
    diagnostics: buildInviteTargetDiagnostics(resolved, targetCheck),
  };
}

/**
 * Single source of truth for company-user invite workspace resolution.
 * Registry masterSheetId / rootFolderId win over stale invite-embedded IDs.
 */
export async function resolveCompanyWorkspaceForInvite(auth, invite, deps, options = {}) {
  const sources = [];
  const companyId = trimId(invite.companyId || invite.companyFolderId || invite.provisionDriveFolderId);
  const companyLabel = trimId(invite.companyName) || companyId;

  if (!companyId) {
    return inviteLinkMissingResult({ companyLabel });
  }

  let companyFolderId = "";
  let masterSheetId = "";
  let companyName = trimId(invite.companyName);

  const registryRecord = await getCanonicalCompanyRegistryRecord(auth, deps, companyId).catch(() => null);
  if (registryRecord) {
    sources.push("registry");
    companyFolderId = trimId(registryRecord.rootFolderId || registryRecord.companyId) || companyId;
    masterSheetId = trimId(registryRecord.masterSheetId);
    companyName = trimId(registryRecord.companyName) || companyName;
  } else {
    companyFolderId = companyId;
  }

  if (!masterSheetId && companyFolderId) {
    const registrySheetId = await readOnboardingRegistryMasterSheetForFolder(auth, deps, companyFolderId).catch(
      () => "",
    );
    if (registrySheetId) {
      masterSheetId = registrySheetId;
      sources.push("onboarding_registry");
    }
  }

  if (!masterSheetId && companyFolderId) {
    const found = await findMasterSheetInCompanyFolder(auth, companyFolderId, deps).catch(() => null);
    if (found?.id) {
      masterSheetId = found.id;
      sources.push("folder");
      if (!companyName) {
        companyName = found.name || companyName;
      }
    }
  }

  if (!companyFolderId && masterSheetId) {
    try {
      const cfg = await deps.getConfig(auth, masterSheetId);
      const configFolderId = trimId(cfg.companyId);
      if (configFolderId) {
        companyFolderId = configFolderId;
        sources.push("config");
      }
    } catch {
      /* best-effort */
    }
  }

  if (!masterSheetId) {
    const inviteSheetId = trimId(invite.masterSheetId || invite.provisionMasterSheetId);
    if (inviteSheetId) {
      masterSheetId = inviteSheetId;
      sources.push(trimId(invite.masterSheetId) ? "invite" : "provision");
    }
  }

  if (!companyFolderId) {
    const inviteFolderId = trimId(invite.companyFolderId || invite.provisionDriveFolderId);
    if (inviteFolderId) {
      companyFolderId = inviteFolderId;
      if (!sources.includes("invite")) {
        sources.push("invite");
      }
    }
  }

  if (!companyFolderId || !masterSheetId) {
    return inviteLinkMissingResult({
      companyLabel: companyName || companyLabel,
      masterSheetIdPresent: Boolean(masterSheetId),
    });
  }

  const repaired =
    trimId(invite.companyId) !== companyId ||
    trimId(invite.companyFolderId || invite.provisionDriveFolderId) !== companyFolderId ||
    trimId(invite.masterSheetId || invite.provisionMasterSheetId) !== masterSheetId;

  const resolved = {
    companyId,
    companyFolderId,
    masterSheetId,
    companyName,
    sources,
    repaired,
    registryUpdated: false,
    promotedLive: false,
  };

  if (options.patchInviteRecord && repaired) {
    options.patchInviteRecord({
      companyId,
      companyFolderId,
      masterSheetId,
      companyName: companyName || invite.companyName,
    });
  }

  if (resolved.masterSheetId && resolved.companyFolderId && resolved.sources.includes("folder")) {
    const registryResult = await writeOnboardingRegistryMasterSheetForFolder(auth, deps, {
      companyFolderId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
      companyName: resolved.companyName,
    }).catch(() => ({ synced: false }));
    resolved.registryUpdated = Boolean(registryResult?.synced);
  }

  if (resolved.masterSheetId && resolved.companyFolderId && (repaired || resolved.sources.includes("registry"))) {
    const persistResult = await persistCompanyWorkspaceSetup(auth, deps, {
      companyId: resolved.companyId,
      rootFolderId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
      companyName: resolved.companyName,
      touchSetup: false,
      markSetupComplete: false,
      markLive: false,
    }).catch(() => ({ synced: false }));
    if (persistResult?.synced) {
      resolved.registryUpdated = true;
    }
  }

  if (resolved.masterSheetId) {
    const liveResult = await ensureCompanyWorkspaceLiveIfReady(deps, auth, resolved).catch(() => ({
      promoted: false,
    }));
    resolved.promotedLive = Boolean(liveResult?.promoted);
  }

  const targetCheck = await validateCompanyUserInviteTarget(auth, resolved);
  if (!targetCheck.ok) {
    return customerFacingTargetFailure(targetCheck, resolved);
  }

  return {
    ...targetCheck,
    resolved,
    diagnostics: buildInviteTargetDiagnostics(resolved, targetCheck),
  };
}

export async function resolveCompanyUserInviteTarget(auth, record, deps) {
  const result = await resolveCompanyWorkspaceForInvite(auth, record, deps);
  if (!result.resolved) {
    return {
      companyId: trimId(record.companyId || record.companyFolderId || record.provisionDriveFolderId),
      companyFolderId: trimId(record.companyFolderId || record.provisionDriveFolderId),
      masterSheetId: trimId(record.masterSheetId || record.provisionMasterSheetId),
      companyName: trimId(record.companyName),
      sources: [],
      repaired: false,
      registryUpdated: false,
      promotedLive: false,
    };
  }
  return result.resolved;
}

export function repairPendingCompanyUserInvites(deps, { companyId, companyFolderId, masterSheetId, companyName }) {
  const folderId = trimId(companyFolderId);
  const sheetId = trimId(masterSheetId);
  const normalizedCompanyId = trimId(companyId || folderId);
  if (!normalizedCompanyId || !sheetId) {
    return 0;
  }
  const { readInviteStore, writeInviteStore } = deps;
  const store = readInviteStore();
  let repairedCount = 0;
  for (const [tokenId, record] of Object.entries(store)) {
    if (record.kind !== "company_user" || record.consumedAt) {
      continue;
    }
    const recordCompanyId = trimId(record.companyId || record.companyFolderId || record.provisionDriveFolderId);
    const recordFolderId = trimId(record.companyFolderId || record.provisionDriveFolderId);
    const recordSheetId = trimId(record.masterSheetId || record.provisionMasterSheetId);
    const matchesCompany =
      recordCompanyId === normalizedCompanyId || recordFolderId === folderId || recordSheetId === sheetId;
    if (!matchesCompany) {
      continue;
    }
    if (
      recordCompanyId === normalizedCompanyId &&
      recordFolderId === folderId &&
      recordSheetId === sheetId
    ) {
      continue;
    }
    store[tokenId] = {
      ...record,
      companyId: normalizedCompanyId,
      companyFolderId: folderId,
      masterSheetId: sheetId,
      companyName: trimId(companyName || record.companyName),
    };
    repairedCount += 1;
  }
  if (repairedCount > 0) {
    writeInviteStore(store);
  }
  return repairedCount;
}

export async function repairCompanyInviteTarget(auth, target, deps) {
  const invite = {
    companyId: trimId(target.companyId || target.companyFolderId),
    companyFolderId: trimId(target.companyFolderId),
    masterSheetId: trimId(target.masterSheetId),
    companyName: trimId(target.companyName),
  };
  const result = await resolveCompanyWorkspaceForInvite(auth, invite, deps);
  const resolved = result.resolved;
  if (!resolved) {
    return {
      ...result,
      repairedInvites: 0,
    };
  }

  const repairedInvites = repairPendingCompanyUserInvites(deps, resolved);
  return {
    ...result,
    repairedInvites,
    diagnostics: buildInviteTargetDiagnostics(resolved, result),
  };
}

export async function prepareCompanyUserInviteTarget(auth, record, options = {}) {
  const { deps, patchInviteRecord, tokenId } = options;
  const result = await resolveCompanyWorkspaceForInvite(auth, record, deps, {
    patchInviteRecord: typeof patchInviteRecord === "function" ? patchInviteRecord : null,
  });

  if (!result.ok) {
    logInviteCompleteFailure({
      code: result.code,
      email: record.email,
      tokenId,
      company: result.companyLabel || result.resolved?.companyName,
      masterSheetIdPresent: result.masterSheetIdPresent,
      diagnostics: result.diagnostics,
    });
  }

  return result;
}

export async function diagnoseCompanyInviteTarget(auth, target, deps) {
  const invite = {
    companyId: trimId(target.companyId || target.companyFolderId),
    companyFolderId: trimId(target.companyFolderId),
    masterSheetId: trimId(target.masterSheetId),
    companyName: trimId(target.companyName),
  };
  const result = await resolveCompanyWorkspaceForInvite(auth, invite, deps);
  const resolved = result.resolved;
  const masterSheetReady = Boolean(resolved?.masterSheetId);
  const verificationWouldFail = !result.ok;
  return {
    ok: result.ok,
    masterSheetReady,
    verificationWouldFail,
    code: result.code,
    message: result.message,
    diagnostics: result.diagnostics,
    resolved,
  };
}

export async function isCompanyWorkspaceReadyForInvites(auth, deps, { masterSheetId, companyFolderId, companyId }) {
  const invite = {
    companyId: trimId(companyId || companyFolderId),
    companyFolderId: trimId(companyFolderId),
    masterSheetId: trimId(masterSheetId),
  };
  const result = await resolveCompanyWorkspaceForInvite(auth, invite, deps);
  if (!result.ok || !result.resolved?.masterSheetId) {
    return false;
  }
  const sheetId = result.resolved.masterSheetId;
  try {
    const cfg = await deps.getConfig(auth, sheetId);
    if (isCompanyWorkspaceLiveForUserInvites(cfg)) {
      return true;
    }
    const userCount = await countCompanyUsersOnSheet(auth, deps.getTabValues, sheetId);
    return userCount > 0 && trimId(result.resolved.companyFolderId || cfg.companyId);
  } catch {
    return false;
  }
}
