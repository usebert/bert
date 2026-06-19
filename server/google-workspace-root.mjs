export const WORKSPACE_ROOT_SHARED_DRIVE = "shared_drive";
export const WORKSPACE_ROOT_FOLDER = "folder";

export const WORKSPACE_ROOT_FOLDER_WARNING =
  "Configured Drive ID is not a Shared Drive. It may be a folder ID.";
export const WORKSPACE_ROOT_INACCESSIBLE_ERROR =
  "BERT Google account cannot access this Drive/folder.";

function trimId(value) {
  return String(value || "").trim();
}

function errorMessage(error) {
  return String(error?.message || error?.response?.data?.error?.message || "").trim();
}

function isAccessError(error) {
  const code = Number(error?.code || error?.response?.status || 0);
  const message = errorMessage(error).toLowerCase();
  return code === 403 || code === 404 || /not found|forbidden|permission|insufficient|shared drive not found/i.test(message);
}

/**
 * Resolve GOOGLE_SHARED_DRIVE_ID as either a Shared Drive (drives.get) or parent folder (files.get).
 */
export async function inspectConfiguredWorkspaceRoot(auth, google, rootId) {
  const id = trimId(rootId);
  if (!id) {
    return {
      ok: false,
      accessible: false,
      kind: "",
      id: "",
      name: "",
      isSharedDrive: false,
      warning: "",
      error: "GOOGLE_SHARED_DRIVE_ID is not configured on the server.",
    };
  }

  const drive = google.drive({ version: "v3", auth });

  try {
    const response = await drive.drives.get({ driveId: id, fields: "id,name" });
    return {
      ok: true,
      accessible: true,
      kind: WORKSPACE_ROOT_SHARED_DRIVE,
      id: trimId(response.data.id || id),
      name: String(response.data.name || "").trim(),
      isSharedDrive: true,
      warning: "",
      error: "",
    };
  } catch (driveError) {
    try {
      const response = await drive.files.get({
        fileId: id,
        supportsAllDrives: true,
        fields: "id,name,mimeType",
      });
      const file = response.data;
      if (file.mimeType !== "application/vnd.google-apps.folder") {
        return {
          ok: false,
          accessible: true,
          kind: "",
          id,
          name: String(file.name || "").trim(),
          isSharedDrive: false,
          warning: "",
          error: WORKSPACE_ROOT_FOLDER_WARNING,
        };
      }
      return {
        ok: true,
        accessible: true,
        kind: WORKSPACE_ROOT_FOLDER,
        id: trimId(file.id || id),
        name: String(file.name || "").trim(),
        isSharedDrive: false,
        warning: WORKSPACE_ROOT_FOLDER_WARNING,
        error: "",
      };
    } catch (fileError) {
      return {
        ok: false,
        accessible: false,
        kind: "",
        id,
        name: "",
        isSharedDrive: false,
        warning: "",
        error: isAccessError(fileError) || isAccessError(driveError)
          ? WORKSPACE_ROOT_INACCESSIBLE_ERROR
          : errorMessage(fileError) || WORKSPACE_ROOT_INACCESSIBLE_ERROR,
      };
    }
  }
}

export async function listFolderChildren(auth, google, root, parentId, options = {}) {
  const pageSize = options.pageSize || 200;
  const parent = trimId(parentId);
  const drive = google.drive({ version: "v3", auth });
  const listParams = {
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${parent}' in parents and trashed = false`,
    fields: options.fields || "files(id,name,mimeType,createdTime)",
    pageSize,
    orderBy: options.orderBy || "name_natural",
  };

  if (root?.kind === WORKSPACE_ROOT_SHARED_DRIVE && parent === trimId(root.id)) {
    listParams.corpora = "drive";
    listParams.driveId = root.id;
  }

  const response = await drive.files.list(listParams);
  return response.data.files || [];
}

export async function listWorkspaceRootChildren(auth, google, rootId, options = {}) {
  const root = await inspectConfiguredWorkspaceRoot(auth, google, rootId);
  if (!root.ok) {
    throw new Error(root.error || WORKSPACE_ROOT_INACCESSIBLE_ERROR);
  }
  return listFolderChildren(auth, google, root, root.id, options);
}

export async function findSpreadsheetInWorkspaceRoot(auth, google, rootId, spreadsheetName) {
  const root = await inspectConfiguredWorkspaceRoot(auth, google, rootId);
  if (!root.ok) {
    return "";
  }

  const drive = google.drive({ version: "v3", auth });
  const escapedName = String(spreadsheetName || "").replace(/'/g, "\\'");
  const parentQuery = `'${root.id}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name='${escapedName}'`;

  let response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: parentQuery,
    fields: "files(id,name)",
    pageSize: 5,
  });
  if (response.data.files?.[0]?.id) {
    return response.data.files[0].id;
  }

  if (root.kind === WORKSPACE_ROOT_SHARED_DRIVE) {
    response = await drive.files.list({
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "drive",
      driveId: root.id,
      q: `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name='${escapedName}'`,
      fields: "files(id,name)",
      pageSize: 5,
    });
  }

  return response.data.files?.[0]?.id || "";
}
