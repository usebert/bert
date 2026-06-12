/**
 * Validates company Drive folders are children of the canonical Live Companies parent.
 */
import {
  FOLDER_NOT_IN_COMPANIES_ROOT,
  FOLDER_PLACEMENT_USER_MESSAGE,
  isFolderUnderLiveCompanies,
  isLiveCompaniesFolderName,
  LIVE_COMPANIES_FOLDER_LABEL,
} from "../shared/company-folder-placement.mjs";
import {
  inspectConfiguredWorkspaceRoot,
  listFolderChildren,
  WORKSPACE_ROOT_INACCESSIBLE_ERROR,
} from "./google-workspace-root.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

async function readDriveFolderMeta(drive, folderId, fields = "id,name,mimeType,parents") {
  const response = await drive.files.get({
    fileId: folderId,
    supportsAllDrives: true,
    fields,
  });
  return response.data || {};
}

/**
 * Resolve the Live Companies folder under GOOGLE_SHARED_DRIVE_ID.
 */
export async function resolveLiveCompaniesFolder(auth, deps = {}) {
  const sharedDriveId = trim(deps.sharedDriveId);
  const google = deps.google;
  if (!auth || !google || !sharedDriveId) {
    return {
      liveCompaniesFolder: null,
      liveCompaniesFolderId: "",
      liveCompaniesMissing: true,
      workspaceRoot: null,
      warning: "GOOGLE_SHARED_DRIVE_ID is not configured on the server.",
    };
  }

  const workspaceRoot = await inspectConfiguredWorkspaceRoot(auth, google, sharedDriveId);
  if (!workspaceRoot.ok) {
    return {
      liveCompaniesFolder: null,
      liveCompaniesFolderId: "",
      liveCompaniesMissing: true,
      workspaceRoot,
      warning: workspaceRoot.error || WORKSPACE_ROOT_INACCESSIBLE_ERROR,
    };
  }

  const topLevelFolders = (await listFolderChildren(auth, google, workspaceRoot, workspaceRoot.id)).filter(
    (item) => item.mimeType === "application/vnd.google-apps.folder",
  );
  const liveCompaniesFolder =
    topLevelFolders.find((item) => isLiveCompaniesFolderName(item.name)) || null;

  return {
    liveCompaniesFolder,
    liveCompaniesFolderId: trim(liveCompaniesFolder?.id),
    liveCompaniesMissing: !liveCompaniesFolder?.id,
    workspaceRoot,
    topLevelFolders,
    warning: liveCompaniesFolder?.id
      ? ""
      : `${LIVE_COMPANIES_FOLDER_LABEL} folder not found under workspace root. Check platform setup.`,
  };
}

/**
 * Walk parent chain from company folder up to workspace root (max 12 hops).
 * @returns {{ segments: Array<{ id: string, name: string }>, parentIds: string[] }}
 */
export async function buildCompanyFolderAncestorPath(auth, deps, companyFolderId, options = {}) {
  const google = deps.google;
  const drive = google.drive({ version: "v3", auth });
  const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : 12;
  const stopAtIds = new Set(
    [options.liveCompaniesFolderId, options.workspaceRootId, deps.sharedDriveId]
      .map((entry) => trim(entry))
      .filter(Boolean),
  );

  const segments = [];
  const parentIds = [];
  let currentId = trim(companyFolderId);
  const visited = new Set();

  for (let depth = 0; depth < maxDepth && currentId; depth += 1) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    let meta;
    try {
      meta = await readDriveFolderMeta(drive, currentId);
    } catch {
      break;
    }
    if (meta.mimeType && meta.mimeType !== "application/vnd.google-apps.folder") {
      break;
    }

    segments.push({
      id: trim(meta.id || currentId),
      name: trim(meta.name),
    });

    const parents = Array.isArray(meta.parents) ? meta.parents.map((entry) => trim(entry)).filter(Boolean) : [];
    if (!parents.length) {
      break;
    }

    const parentId = parents[0];
    parentIds.push(parentId);
    if (stopAtIds.has(parentId)) {
      try {
        const parentMeta = await readDriveFolderMeta(drive, parentId, "id,name");
        segments.push({
          id: trim(parentMeta.id || parentId),
          name: trim(parentMeta.name),
        });
      } catch {
        segments.push({ id: parentId, name: "" });
      }
      break;
    }
    currentId = parentId;
  }

  return { segments, parentIds };
}

/**
 * Validate company folder placement under Live Companies.
 */
export async function validateCompanyFolderPlacement(auth, deps, companyFolderId, options = {}) {
  const folderId = trim(companyFolderId || options.companyFolderId);
  if (!auth || !folderId) {
    return {
      ok: false,
      reasonCode: FOLDER_NOT_IN_COMPANIES_ROOT,
      userMessage: FOLDER_PLACEMENT_USER_MESSAGE,
      companyFolderId: folderId,
      liveCompaniesFolderId: "",
      liveCompaniesFolderName: "",
      parentPath: [],
      parentPathLabel: "",
      liveCompaniesMissing: true,
    };
  }

  const liveResolution =
    options.liveCompaniesFolderId && options.workspaceRoot
      ? {
          liveCompaniesFolder: { id: options.liveCompaniesFolderId, name: options.liveCompaniesFolderName || LIVE_COMPANIES_FOLDER_LABEL },
          liveCompaniesFolderId: trim(options.liveCompaniesFolderId),
          liveCompaniesMissing: false,
          workspaceRoot: options.workspaceRoot,
          warning: "",
        }
      : await resolveLiveCompaniesFolder(auth, deps);

  const liveCompaniesFolderId = trim(liveResolution.liveCompaniesFolderId);
  const liveCompaniesFolderName = trim(liveResolution.liveCompaniesFolder?.name) || LIVE_COMPANIES_FOLDER_LABEL;
  const workspaceRootId = trim(liveResolution.workspaceRoot?.id || deps.sharedDriveId);

  if (liveResolution.liveCompaniesMissing || !liveCompaniesFolderId) {
    return {
      ok: false,
      reasonCode: FOLDER_NOT_IN_COMPANIES_ROOT,
      userMessage: liveResolution.warning || FOLDER_PLACEMENT_USER_MESSAGE,
      companyFolderId: folderId,
      liveCompaniesFolderId: "",
      liveCompaniesFolderName: LIVE_COMPANIES_FOLDER_LABEL,
      parentPath: [],
      parentPathLabel: "",
      liveCompaniesMissing: true,
      workspaceRootId,
    };
  }

  const drive = deps.google.drive({ version: "v3", auth });
  let folderName = trim(options.companyFolderName);
  try {
    const meta = await readDriveFolderMeta(drive, folderId);
    if (meta.mimeType !== "application/vnd.google-apps.folder") {
      return {
        ok: false,
        reasonCode: FOLDER_NOT_IN_COMPANIES_ROOT,
        userMessage: "The company folder ID is missing or invalid.",
        companyFolderId: folderId,
        companyFolderName: folderName,
        liveCompaniesFolderId,
        liveCompaniesFolderName,
        parentPath: [],
        parentPathLabel: "",
        liveCompaniesMissing: false,
        workspaceRootId,
      };
    }
    folderName = folderName || trim(meta.name);
  } catch (error) {
    return {
      ok: false,
      reasonCode: FOLDER_NOT_IN_COMPANIES_ROOT,
      userMessage: error instanceof Error ? error.message : FOLDER_PLACEMENT_USER_MESSAGE,
      companyFolderId: folderId,
      companyFolderName: folderName,
      liveCompaniesFolderId,
      liveCompaniesFolderName,
      parentPath: [],
      parentPathLabel: "",
      liveCompaniesMissing: false,
      workspaceRootId,
    };
  }

  const { segments, parentIds } = await buildCompanyFolderAncestorPath(auth, deps, folderId, {
    liveCompaniesFolderId,
    workspaceRootId,
  });
  const parentPath = segments.map((segment) => ({
    id: segment.id,
    name: segment.name,
  }));
  const parentPathLabel = parentPath
    .map((segment) => segment.name || segment.id)
    .filter(Boolean)
    .join(" / ");
  const underLiveCompanies = isFolderUnderLiveCompanies(folderId, liveCompaniesFolderId, parentIds);

  return {
    ok: underLiveCompanies,
    reasonCode: underLiveCompanies ? "" : FOLDER_NOT_IN_COMPANIES_ROOT,
    userMessage: underLiveCompanies ? "" : FOLDER_PLACEMENT_USER_MESSAGE,
    companyFolderId: folderId,
    companyFolderName: folderName,
    liveCompaniesFolderId,
    liveCompaniesFolderName,
    parentPath,
    parentPathLabel,
    immediateParentId: parentIds[0] || "",
    immediateParentName: parentPath.length > 1 ? parentPath[1]?.name || "" : "",
    liveCompaniesMissing: false,
    workspaceRootId,
    workspaceRootName: trim(liveResolution.workspaceRoot?.name),
  };
}

export function installCompanyFolderPlacementRoutes(app, deps) {
  const { getAuthedClient, envConfigured, requireGoogleWorkspaceSession, requireMasterOnlyActor } = deps;

  app.get(
    "/api/godmode/companies/:companyFolderId/folder-placement",
    requireGoogleWorkspaceSession,
    requireMasterOnlyActor,
    async (req, res) => {
      if (!envConfigured()) {
        return res.status(503).json({
          ok: false,
          error: "Google Workspace is not configured on the server.",
        });
      }
      const authed = getAuthedClient();
      if (!authed) {
        return res.status(401).json({
          ok: false,
          error: "Connect Google Workspace before checking folder placement.",
        });
      }
      const companyFolderId = trim(req.params.companyFolderId || req.query?.companyFolderId);
      try {
        const result = await validateCompanyFolderPlacement(authed, deps, companyFolderId, {
          companyFolderName: trim(req.query?.companyName),
        });
        return res.status(200).json({
          ok: result.ok,
          ...result,
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          companyFolderId,
          error: error instanceof Error ? error.message : "Unable to validate folder placement.",
        });
      }
    },
  );
}
