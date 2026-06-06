import {
  countCompanyUsersOnSheet,
  ensureCompanyWorkspaceLiveIfReady,
  isCompanyWorkspaceLiveForUserInvites,
  readOnboardingRegistryMasterSheetForFolder,
  writeOnboardingRegistryMasterSheetForFolder,
} from "./company-onboarding.mjs";
import {
  logInviteCompleteFailure,
  STALE_INVITE_CUSTOMER_MESSAGE,
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
  if (!trimId(resolved.companyFolderId)) {
    diagnostics.push("missing_company_folder_id");
  }
  if (!trimId(resolved.masterSheetId)) {
    diagnostics.push("missing_master_sheet_id");
  }
  if (resolved.sources.includes("invite")) {
    diagnostics.push("source_invite");
  }
  if (resolved.sources.includes("provision")) {
    diagnostics.push("source_provision");
  }
  if (resolved.sources.includes("registry")) {
    diagnostics.push("source_registry");
  }
  if (resolved.sources.includes("folder")) {
    diagnostics.push("source_folder_search");
  }
  if (resolved.sources.includes("config")) {
    diagnostics.push("source_config");
  }
  if (resolved.repaired) {
    diagnostics.push("repaired_target_ids");
  }
  if (targetCheck?.code === "google_access_denied") {
    diagnostics.push("google_access_denied");
  }
  if (targetCheck?.code === "stale_invite_target") {
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

export async function resolveCompanyUserInviteTarget(auth, record, deps) {
  const sources = [];
  let companyFolderId = trimId(record.companyFolderId || record.provisionDriveFolderId);
  let masterSheetId = trimId(record.masterSheetId);
  let companyName = trimId(record.companyName);

  if (companyFolderId) {
    sources.push("invite");
  }
  if (!masterSheetId) {
    const provisionSheetId = trimId(record.provisionMasterSheetId);
    if (provisionSheetId) {
      masterSheetId = provisionSheetId;
      sources.push("provision");
    }
  } else {
    sources.push("invite");
  }

  if (!masterSheetId && companyFolderId) {
    const registrySheetId = await readOnboardingRegistryMasterSheetForFolder(auth, deps, companyFolderId).catch(
      () => "",
    );
    if (registrySheetId) {
      masterSheetId = registrySheetId;
      sources.push("registry");
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

  if (masterSheetId && !companyFolderId) {
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

  const repaired =
    (trimId(record.masterSheetId) !== masterSheetId && Boolean(masterSheetId)) ||
    (trimId(record.companyFolderId) !== companyFolderId && Boolean(companyFolderId));

  return {
    companyFolderId,
    masterSheetId,
    companyName,
    sources,
    repaired,
    registryUpdated: false,
    promotedLive: false,
  };
}

export function repairPendingCompanyUserInvites(deps, { companyFolderId, masterSheetId, companyName }) {
  const folderId = trimId(companyFolderId);
  const sheetId = trimId(masterSheetId);
  if (!folderId || !sheetId) {
    return 0;
  }
  const { readInviteStore, writeInviteStore } = deps;
  const store = readInviteStore();
  let repairedCount = 0;
  for (const [tokenId, record] of Object.entries(store)) {
    if (record.kind !== "company_user" || record.consumedAt) {
      continue;
    }
    const recordFolderId = trimId(record.companyFolderId || record.provisionDriveFolderId);
    const recordSheetId = trimId(record.masterSheetId || record.provisionMasterSheetId);
    const matchesFolder = recordFolderId === folderId;
    const matchesSheet = recordSheetId === sheetId;
    if (!matchesFolder && !matchesSheet) {
      continue;
    }
    if (recordFolderId === folderId && recordSheetId === sheetId) {
      continue;
    }
    store[tokenId] = {
      ...record,
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
  const resolved = await resolveCompanyUserInviteTarget(auth, target, deps);
  let registryUpdated = false;
  if (resolved.masterSheetId && resolved.companyFolderId && resolved.sources.includes("folder")) {
    const registryResult = await writeOnboardingRegistryMasterSheetForFolder(auth, deps, {
      companyFolderId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
      companyName: resolved.companyName,
    }).catch(() => ({ synced: false }));
    registryUpdated = Boolean(registryResult?.synced);
    resolved.registryUpdated = registryUpdated;
  }
  const repairedInvites = repairPendingCompanyUserInvites(deps, resolved);
  const liveResult = resolved.masterSheetId
    ? await ensureCompanyWorkspaceLiveIfReady(deps, auth, resolved).catch(() => ({ promoted: false }))
    : { promoted: false };
  resolved.promotedLive = Boolean(liveResult?.promoted);
  const targetCheck = await validateCompanyUserInviteTarget(auth, resolved);
  return {
    ...targetCheck,
    resolved,
    repairedInvites,
    diagnostics: buildInviteTargetDiagnostics(resolved, targetCheck),
  };
}

export async function prepareCompanyUserInviteTarget(auth, record, options = {}) {
  const { deps, patchInviteRecord } = options;
  const resolved = await resolveCompanyUserInviteTarget(auth, record, deps);

  if (patchInviteRecord && resolved.repaired) {
    patchInviteRecord({
      companyFolderId: resolved.companyFolderId,
      masterSheetId: resolved.masterSheetId,
      companyName: resolved.companyName || record.companyName,
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

  if (resolved.masterSheetId) {
    const liveResult = await ensureCompanyWorkspaceLiveIfReady(deps, auth, resolved).catch(() => ({
      promoted: false,
    }));
    resolved.promotedLive = Boolean(liveResult?.promoted);
  }

  const targetCheck = await validateCompanyUserInviteTarget(auth, resolved);
  const diagnostics = buildInviteTargetDiagnostics(resolved, targetCheck);

  if (!targetCheck.ok) {
    logInviteCompleteFailure({
      code: targetCheck.code,
      email: record.email,
      tokenId: options.tokenId,
      company: targetCheck.companyLabel || resolved.companyName,
      masterSheetIdPresent: targetCheck.masterSheetIdPresent,
      diagnostics,
    });
  }

  return {
    ...targetCheck,
    resolved,
    diagnostics,
  };
}

export async function diagnoseCompanyInviteTarget(auth, target, deps) {
  const resolved = await resolveCompanyUserInviteTarget(auth, target, deps);
  const targetCheck = await validateCompanyUserInviteTarget(auth, resolved);
  const diagnostics = buildInviteTargetDiagnostics(resolved, targetCheck);
  const masterSheetReady = Boolean(resolved.masterSheetId);
  const verificationWouldFail = !targetCheck.ok;
  return {
    ok: targetCheck.ok,
    masterSheetReady,
    verificationWouldFail,
    code: targetCheck.code,
    message: targetCheck.message,
    diagnostics,
    resolved,
  };
}

export async function isCompanyWorkspaceReadyForInvites(auth, deps, { masterSheetId, companyFolderId }) {
  const sheetId = trimId(masterSheetId);
  if (!sheetId || !auth) {
    return false;
  }
  try {
    const cfg = await deps.getConfig(auth, sheetId);
    if (isCompanyWorkspaceLiveForUserInvites(cfg)) {
      return true;
    }
    const userCount = await countCompanyUsersOnSheet(auth, deps.getTabValues, sheetId);
    return userCount > 0 && trimId(companyFolderId || cfg.companyId);
  } catch {
    return false;
  }
}
