/**
 * Company context resolution for signed-in users and session enrichment.
 */
import {
  cleanCompanyNameFromFolder,
  COMPANY_CONTEXT_STATUS_USABLE,
  isCompanyWorkspaceUsable,
} from "../shared/company-folder-context.mjs";
import { getCanonicalCompanyStatus } from "../shared/company-invite-permissions.mjs";
import { resolveCompanyById } from "./company-registry-service.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import { resolveCompanyContextForUser } from "./company-users.mjs";
import { readCanonicalCompanyWorkspaceRegistryMap } from "./company-workspace-registry.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

async function readCompanyNameFromDriveFolder(auth, deps, companyFolderId) {
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

/** Resolve companyFolderId, companyName, and masterSheetId from folder, registry, and Config tab. */
export async function resolveCompanyContextFields(auth, deps, partial = {}) {
  let companyFolderId = trim(partial.companyFolderId || partial.companyId);
  let masterSheetId = trim(partial.masterSheetId);
  let companyName = trim(partial.companyName);

  let registryRecord = null;
  if (companyFolderId) {
    registryRecord = await resolveCompanyById(auth, deps, companyFolderId).catch(() => null);
  }
  if (!registryRecord && masterSheetId) {
    const { map } = await readCanonicalCompanyWorkspaceRegistryMap(auth, deps).catch(() => ({
      map: new Map(),
    }));
    for (const record of map.values()) {
      if (trim(record.masterSheetId) === masterSheetId) {
        registryRecord = record;
        break;
      }
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

  if (!masterSheetId && companyFolderId) {
    try {
      const folderResolved = await resolveCompanyFromFolder(auth, deps, companyFolderId, {
        companyName,
        ensureStructure: false,
      });
      if (folderResolved?.ok) {
        masterSheetId = trim(folderResolved.masterSheetId) || masterSheetId;
        companyName = companyName || trim(folderResolved.companyName);
      }
    } catch {
      /* non-blocking */
    }
  }

  const resolvedCompanyId = companyFolderId;
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

  const context = {
    companyId: resolvedCompanyId,
    companyFolderId,
    companyName,
    masterSheetId,
    status: partial.status,
    archived: partial.archived,
    usable: partial.usable,
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
    registryStatus: getCanonicalCompanyStatus(registryRecord || { status: partial.registryStatus }),
    registrySource: trim(registryRecord?.registrySource || partial.registrySource) || undefined,
  };
}

export async function resolveCompanyContextFromFolder(auth, deps, companyFolderId, options = {}) {
  return resolveCompanyFromFolder(auth, deps, companyFolderId, options);
}
