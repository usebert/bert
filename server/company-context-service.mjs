/**
 * Company context resolution for signed-in users and session enrichment.
 */
import {
  cleanCompanyNameFromFolder,
  COMPANY_CONTEXT_INVALID,
  COMPANY_CONTEXT_STATUS_USABLE,
  COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
  isCompanyWorkspaceUsable,
  isLegacyConfigCompanyFolderId,
} from "../shared/company-folder-context.mjs";
import { FOLDER_NOT_IN_COMPANIES_ROOT } from "../shared/company-folder-placement.mjs";
import { getCanonicalCompanyStatus } from "../shared/company-invite-permissions.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { resolveCompanyContextForUser } from "./company-users.mjs";
import { validateCompanyFolderUnderCompaniesRoot } from "./company-folder-placement.mjs";
import { readCanonicalCompanyWorkspaceRegistryMap } from "./company-workspace-registry.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

export async function readCompanyNameFromDriveFolder(auth, deps, companyFolderId) {
  const folderId = trim(companyFolderId);
  if (!auth || !folderId || !deps?.google) {
    return "";
  }
  try {
    const drive = deps.google.drive({ version: "v3", auth });
    const meta = await drive.files.get({
      fileId: folderId,
      supportsAllDrives: true,
      fields: "name",
    });
    return cleanCompanyNameFromFolder(meta.data?.name);
  } catch {
    return "";
  }
}

async function readCompanyFieldsFromConfig(auth, masterSheetId, getConfig) {
  const sheetId = trim(masterSheetId);
  if (!auth || !sheetId || typeof getConfig !== "function") {
    return { companyFolderId: "", companyName: "" };
  }
  try {
    const cfg = await getConfig(auth, sheetId);
    return {
      companyFolderId: trim(cfg.companyId),
      companyName: trim(cfg.companyName),
    };
  } catch {
    return { companyFolderId: "", companyName: "" };
  }
}

/** Exact masterSheetId match only — never fuzzy name or unrelated folder id. */
export async function findRegistryRecordByMasterSheetId(auth, deps, masterSheetId) {
  const sheetId = trim(masterSheetId);
  if (!auth || !sheetId) {
    return null;
  }
  const { map } = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
    map: new Map(),
  }));
  for (const record of map.values()) {
    if (trim(record.masterSheetId) === sheetId) {
      return record;
    }
  }
  return null;
}

/**
 * Resolve company folder from the workbook the user authenticated against.
 * Config tab + exact registry masterSheetId match — never registry name guess.
 */
export async function resolveCompanyContextFromLoginWorkbook(auth, deps, masterSheetId) {
  const sheetId = trim(masterSheetId);
  if (!auth || !sheetId) {
    return null;
  }

  const fromConfig = await readCompanyFieldsFromConfig(auth, sheetId, deps.getConfig);
  let companyFolderId = trim(fromConfig.companyFolderId);
  let companyName = trim(fromConfig.companyName);

  const registryRecord = await findRegistryRecordByMasterSheetId(auth, deps, sheetId);
  const registryFolderId = registryRecord
    ? trim(registryRecord.companyFolderId || registryRecord.rootFolderId || registryRecord.companyId)
    : "";

  if (isLegacyConfigCompanyFolderId(companyFolderId, sheetId)) {
    companyFolderId = "";
  }

  if (!companyFolderId && registryFolderId) {
    companyFolderId = registryFolderId;
  }

  if (!companyName && registryRecord) {
    companyName = trim(registryRecord.companyName || registryRecord.name);
  }

  if (!companyName && companyFolderId) {
    companyName = await readCompanyNameFromDriveFolder(auth, deps, companyFolderId);
  }

  return {
    companyId: companyFolderId,
    companyFolderId,
    companyName,
    masterSheetId: sheetId,
    registryRecord,
    registryStatus: getCanonicalCompanyStatus(registryRecord || {}),
    registrySource: trim(registryRecord?.registrySource) || undefined,
  };
}

/** Resolve companyFolderId, companyName, and masterSheetId from folder, registry, and Config tab. */
export async function resolveCompanyContextFields(auth, deps, partial = {}) {
  const requestedFolderId = trim(partial.companyFolderId || partial.companyId);
  let companyFolderId = requestedFolderId;
  let masterSheetId = trim(partial.masterSheetId);
  let companyName = trim(partial.companyName);

  let registryRecord = null;
  if (masterSheetId) {
    registryRecord = await findRegistryRecordByMasterSheetId(auth, deps, masterSheetId);
    const fromConfig = await readCompanyFieldsFromConfig(auth, masterSheetId, deps.getConfig);
    const configFolderId = trim(fromConfig.companyFolderId);
    // Never replace an explicit session/API folder id with Config — legacy sheets store spreadsheet id as companyId.
    if (configFolderId && configFolderId !== masterSheetId) {
      if (!requestedFolderId || configFolderId === requestedFolderId) {
        companyFolderId = configFolderId;
      }
    }
    companyName = companyName || fromConfig.companyName;
  }
  if (!registryRecord && companyFolderId) {
    registryRecord = await resolveCompanyById(auth, deps, companyFolderId).catch(() => null);
    if (
      registryRecord &&
      masterSheetId &&
      trim(registryRecord.masterSheetId) &&
      trim(registryRecord.masterSheetId) !== masterSheetId
    ) {
      registryRecord = null;
    }
  }

  companyFolderId =
    companyFolderId ||
    trim(registryRecord?.companyFolderId || registryRecord?.rootFolderId || registryRecord?.companyId);

  if (!companyFolderId && masterSheetId) {
    const fromConfig = await readCompanyFieldsFromConfig(auth, masterSheetId, deps.getConfig);
    companyFolderId = fromConfig.companyFolderId;
    companyName = companyName || fromConfig.companyName;
  }

  masterSheetId = masterSheetId || trim(registryRecord?.masterSheetId);
  companyName =
    companyName ||
    trim(registryRecord?.companyName || registryRecord?.name) ||
    cleanCompanyNameFromFolder(partial.folderName);

  if (!companyName && companyFolderId) {
    companyName = await readCompanyNameFromDriveFolder(auth, deps, companyFolderId);
  }

  if (!companyName && masterSheetId) {
    const fromConfig = await readCompanyFieldsFromConfig(auth, masterSheetId, deps.getConfig);
    companyName = fromConfig.companyName;
    companyFolderId = companyFolderId || fromConfig.companyFolderId;
  }

  const folderIdForWorkbookResolve = requestedFolderId || companyFolderId;
  if (!masterSheetId && folderIdForWorkbookResolve) {
    try {
      const folderResolved = await resolveCompanyFromFolder(auth, deps, folderIdForWorkbookResolve, {
        companyName,
        masterSheetId,
        skipFolderPlacementCheck: true,
      });
      if (folderResolved?.ok && trim(folderResolved.masterSheetId)) {
        masterSheetId = trim(folderResolved.masterSheetId) || masterSheetId;
        companyName = companyName || trim(folderResolved.companyName);
      }
    } catch {
      /* non-blocking */
    }
  }

  const resolvedCompanyId = requestedFolderId || companyFolderId;
  return {
    companyId: resolvedCompanyId,
    companyFolderId: resolvedCompanyId,
    companyName,
    masterSheetId,
    registryRecord,
  };
}

export async function resolveCompanyForUser(auth, email, deps) {
  return resolveCompanyContextForUser(auth, email, deps);
}

export async function enrichCompanyContextFromRegistry(auth, deps, partial = {}) {
  const companyId = trim(partial.companyId || partial.companyFolderId);
  let masterSheetId = trim(partial.masterSheetId);
  if (!companyId && !masterSheetId) {
    return partial;
  }

  const resolved = await resolveCompanyContextFields(auth, deps, partial);
  const registryRecord = resolved.registryRecord || null;
  const resolvedCompanyId = trim(resolved.companyId);
  const companyFolderId = trim(resolved.companyFolderId || resolvedCompanyId);
  const companyName = trim(resolved.companyName);
  masterSheetId = trim(resolved.masterSheetId || masterSheetId);

  let folderPlacementOk = partial.folderPlacementOk;
  let folderPlacement = partial.folderPlacement || null;
  if (companyFolderId && auth && folderPlacementOk !== true) {
    folderPlacement = await validateCompanyFolderUnderCompaniesRoot(auth, deps, companyFolderId, {
      companyFolderName: companyName,
    }).catch(() => ({ ok: false }));
    folderPlacementOk = Boolean(folderPlacement?.ok);
  }

  const context = {
    companyId: resolvedCompanyId,
    companyFolderId,
    companyName,
    masterSheetId,
    status: partial.status,
    archived: partial.archived,
    usable: partial.usable,
    folderPlacementOk,
  };

  return {
    ...partial,
    companyId: resolvedCompanyId,
    companyFolderId,
    companyName,
    masterSheetId,
    status: isCompanyWorkspaceUsable(context) ? COMPANY_CONTEXT_STATUS_USABLE : partial.status,
    usable: isCompanyWorkspaceUsable(context),
    workspaceSetupComplete: isCompanyWorkspaceUsable(context),
    folderPlacementOk,
    folderPlacement,
    registryStatus: getCanonicalCompanyStatus(registryRecord || { status: partial.registryStatus }),
    registrySource: trim(registryRecord?.registrySource || partial.registrySource) || undefined,
  };
}

export async function resolveCompanyContextFromFolder(auth, deps, companyFolderId, options = {}) {
  return resolveCompanyFromFolder(auth, deps, companyFolderId, options);
}

/**
 * Canonical company identity resolver — companyFolderId is companyId everywhere.
 * @returns {{ ok: boolean, companyFolderId: string, companyId: string, companyName: string, masterSheetId: string, workbook: { masterSheetId: string } | null, registryRecord?: object }}
 */
/**
 * Live resolver — folder exists in Drive, under Live Companies when configured, workbook reachable.
 * Never trusts stale cookie/index/hint companyName without re-resolving.
 */
export async function validateLiveCompanyContext(auth, deps, partial = {}) {
  const masterSheetId = trim(partial.masterSheetId);
  if (!auth || !masterSheetId) {
    return {
      companyContextValid: false,
      reasonCode: COMPANY_CONTEXT_INVALID,
      message: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
    };
  }

  const workbookContext = await resolveCompanyContextFromLoginWorkbook(auth, deps, masterSheetId).catch(() => null);
  const hintFolderId = trim(partial.companyFolderId || partial.companyId);
  const resolvedMasterSheetId = trim(workbookContext?.masterSheetId || masterSheetId);
  let companyFolderId = trim(workbookContext?.companyFolderId);
  if (isLegacyConfigCompanyFolderId(companyFolderId, resolvedMasterSheetId)) {
    companyFolderId = "";
  }
  if (!companyFolderId) {
    companyFolderId = hintFolderId;
  }
  if (!companyFolderId && workbookContext?.registryRecord) {
    companyFolderId = trim(
      workbookContext.registryRecord.companyFolderId ||
        workbookContext.registryRecord.rootFolderId ||
        workbookContext.registryRecord.companyId,
    );
  }
  let companyName = trim(workbookContext?.companyName || partial.companyName);

  if (!companyFolderId) {
    return {
      companyContextValid: false,
      reasonCode: COMPANY_CONTEXT_INVALID,
      message: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
    };
  }

  const driveFolderName = await readCompanyNameFromDriveFolder(auth, deps, companyFolderId);
  if (!driveFolderName) {
    return {
      companyContextValid: false,
      reasonCode: COMPANY_CONTEXT_INVALID,
      message: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
    };
  }
  if (!companyName) {
    companyName = driveFolderName;
  }

  if (!resolvedMasterSheetId || !deps?.google) {
    return {
      companyContextValid: false,
      reasonCode: COMPANY_CONTEXT_INVALID,
      message: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
    };
  }

  try {
    const sheets = deps.google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.get({
      spreadsheetId: resolvedMasterSheetId,
      fields: "spreadsheetId",
    });
  } catch {
    return {
      companyContextValid: false,
      reasonCode: COMPANY_CONTEXT_INVALID,
      message: COMPANY_NO_LONGER_AVAILABLE_MESSAGE,
    };
  }

  const folderPlacement = await validateCompanyFolderUnderCompaniesRoot(auth, deps, companyFolderId, {
    companyFolderName: companyName,
  }).catch(() => ({ ok: false, reasonCode: FOLDER_NOT_IN_COMPANIES_ROOT }));
  const folderPlacementOk = Boolean(folderPlacement?.ok);

  return {
    companyContextValid: true,
    companyId: companyFolderId,
    companyFolderId,
    companyName,
    masterSheetId: resolvedMasterSheetId,
    folderPlacementOk,
    folderPlacement,
    reasonCode: folderPlacementOk ? undefined : trim(folderPlacement?.reasonCode) || FOLDER_NOT_IN_COMPANIES_ROOT,
    message: folderPlacementOk ? undefined : trim(folderPlacement?.userMessage) || undefined,
    registryStatus: trim(workbookContext?.registryStatus) || undefined,
  };
}

export async function resolveCompanyContext(auth, deps, companyFolderId, options = {}) {
  const resolved = await resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: options.masterSheetId,
    companyName: options.companyName,
  });
  const folderId = trim(resolved.companyFolderId || companyFolderId);
  const masterSheetId = trim(resolved.masterSheetId);
  const companyName = trim(resolved.companyName);
  return {
    ok: Boolean(folderId && masterSheetId),
    companyFolderId: folderId,
    companyId: folderId,
    companyName,
    masterSheetId,
    workbook: masterSheetId ? { masterSheetId } : null,
    registryRecord: resolved.registryRecord || null,
  };
}
