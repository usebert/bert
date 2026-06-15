/**
 * Company Google Forms discovery — resolves the company Forms folder and lists Drive forms.
 * Server-side only; uses workspace OAuth with shared-drive options.
 */

import { GOOGLE_FORM_TEMPLATES_TAB } from "./google-form-templates.mjs";

export const GOOGLE_FORMS_MIME = "application/vnd.google-apps.form";

export const COMPANY_GOOGLE_FORMS_SYNC_COLUMNS = [
  "FormId",
  "DriveFileId",
  "Name",
  "CompanyId",
  "CompanyFolderId",
  "GoogleFormsFolderId",
  "WebViewLink",
  "Status",
  "CreatedAt",
  "UpdatedAt",
  "LastSyncedAt",
];

const NESTED_GOOGLE_FORMS_PARENTS = ["08 - Audits", "05 - Forms & Audits", "Forms & Audits"];
const ROOT_GOOGLE_FORMS_CANDIDATES = ["Google Forms", "Forms"];

function safeLower(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeFolderLabel(value = "") {
  return safeLower(value)
    .replace(/^\d+\s*[-–—]?\s*/g, "")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

export function isExactGoogleFormsFolderName(name = "") {
  return safeLower(name) === "google forms";
}

function matchesFolderLabel(name = "", candidate = "") {
  return normalizeFolderLabel(name) === normalizeFolderLabel(candidate);
}

export function buildGoogleFormsFolderQuery(folderId) {
  const id = String(folderId || "").trim();
  return `'${id}' in parents and mimeType = '${GOOGLE_FORMS_MIME}' and trashed = false`;
}

export function isCompanyFormsPermissionError(error) {
  if (!error) return false;
  const status = Number(error.code ?? error.response?.status ?? error.status ?? 0);
  if (status === 403 || status === 401) return true;
  const msg = String(error.message || error.response?.data?.error?.message || "");
  return /permission|forbidden|insufficient|not authorized/i.test(msg);
}

export function isCompanyFormsNotFoundError(error) {
  if (!error) return false;
  const status = Number(error.code ?? error.response?.status ?? error.status ?? 0);
  if (status === 404) return true;
  const msg = String(error.message || error.response?.data?.error?.message || "");
  return /not found|file not found/i.test(msg);
}

async function listChildFolders(drive, parentId) {
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name,createdTime)",
    pageSize: 200,
    orderBy: "name_natural",
  });
  return response.data.files || [];
}

async function ensureNamedFolder(drive, name, parentId) {
  const folders = await listChildFolders(drive, parentId);
  const existing = folders.find((folder) => safeLower(folder.name) === safeLower(name));
  if (existing?.id) {
    return { folder: existing, created: false };
  }
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id,name,createdTime",
  });
  return { folder: created.data, created: true };
}

function pickRootGoogleFormsFolder(folders = []) {
  const exact = folders.find((folder) => isExactGoogleFormsFolderName(folder.name));
  if (exact?.id) {
    return { folder: exact, resolvedVia: "exact_google_forms" };
  }
  for (const candidate of ROOT_GOOGLE_FORMS_CANDIDATES) {
    const match = folders.find((folder) => matchesFolderLabel(folder.name, candidate));
    if (match?.id) {
      return { folder: match, resolvedVia: `root_${normalizeFolderLabel(candidate).replace(/\s+/g, "_")}` };
    }
  }
  return null;
}

async function findNestedGoogleFormsFolder(drive, folders = []) {
  for (const parentLabel of NESTED_GOOGLE_FORMS_PARENTS) {
    const parent = folders.find((folder) => matchesFolderLabel(folder.name, parentLabel));
    if (!parent?.id) {
      continue;
    }
    const children = await listChildFolders(drive, parent.id);
    const exact = children.find((child) => isExactGoogleFormsFolderName(child.name));
    if (exact?.id) {
      return {
        folder: exact,
        parentFolder: parent,
        resolvedVia: `nested_${normalizeFolderLabel(parentLabel).replace(/\s+/g, "_")}_google_forms`,
      };
    }
    const formsChild = children.find((child) => matchesFolderLabel(child.name, "Google Forms"));
    if (formsChild?.id) {
      return {
        folder: formsChild,
        parentFolder: parent,
        resolvedVia: `nested_${normalizeFolderLabel(parentLabel).replace(/\s+/g, "_")}_forms`,
      };
    }
  }
  return null;
}

function resolveApprovedParentForCreate(folders = []) {
  for (const parentLabel of NESTED_GOOGLE_FORMS_PARENTS) {
    const parent = folders.find((folder) => matchesFolderLabel(folder.name, parentLabel));
    if (parent?.id) {
      return parent;
    }
  }
  return null;
}

/**
 * Resolve the company Google Forms folder under companyFolderId.
 * @param {import('googleapis').drive_v3.Drive} drive
 */
export async function resolveCompanyGoogleFormsFolder(drive, companyContext = {}) {
  const companyFolderId = String(
    companyContext.companyFolderId || companyContext.companyId || companyContext.companyRootFolderId || "",
  ).trim();
  const createIfMissing = companyContext.createIfMissing !== false;

  if (!drive || !companyFolderId) {
    return {
      ok: false,
      status: "invalid_input",
      companyFolderId,
      googleFormsFolderId: "",
      googleFormsFolderName: "",
      permissionError: "",
      driveQuery: "",
    };
  }

  let rootFolders = [];
  try {
    const meta = await drive.files.get({
      fileId: companyFolderId,
      supportsAllDrives: true,
      fields: "id,name,mimeType",
    });
    if (meta.data.mimeType !== "application/vnd.google-apps.folder") {
      return {
        ok: false,
        status: "invalid_input",
        companyFolderId,
        googleFormsFolderId: "",
        googleFormsFolderName: "",
        permissionError: "Company folder ID is not a folder.",
        driveQuery: "",
      };
    }
    rootFolders = await listChildFolders(drive, companyFolderId);
  } catch (error) {
    return {
      ok: false,
      status: isCompanyFormsPermissionError(error)
        ? "permission_denied"
        : isCompanyFormsNotFoundError(error)
          ? "folder_not_found"
          : "error",
      companyFolderId,
      googleFormsFolderId: "",
      googleFormsFolderName: "",
      permissionError: error instanceof Error ? error.message : String(error || "Drive lookup failed."),
      driveQuery: "",
    };
  }

  const rootMatch = pickRootGoogleFormsFolder(rootFolders);
  if (rootMatch?.folder?.id) {
    return {
      ok: true,
      status: "found",
      companyFolderId,
      googleFormsFolderId: rootMatch.folder.id,
      googleFormsFolderName: rootMatch.folder.name || "Google Forms",
      parentFolderId: companyFolderId,
      resolvedVia: rootMatch.resolvedVia,
      created: false,
      permissionError: "",
      driveQuery: buildGoogleFormsFolderQuery(rootMatch.folder.id),
    };
  }

  const nestedMatch = await findNestedGoogleFormsFolder(drive, rootFolders);
  if (nestedMatch?.folder?.id) {
    return {
      ok: true,
      status: "found",
      companyFolderId,
      googleFormsFolderId: nestedMatch.folder.id,
      googleFormsFolderName: nestedMatch.folder.name || "Google Forms",
      parentFolderId: nestedMatch.parentFolder?.id || companyFolderId,
      resolvedVia: nestedMatch.resolvedVia,
      created: false,
      permissionError: "",
      driveQuery: buildGoogleFormsFolderQuery(nestedMatch.folder.id),
    };
  }

  if (!createIfMissing) {
    return {
      ok: false,
      status: "folder_not_found",
      companyFolderId,
      googleFormsFolderId: "",
      googleFormsFolderName: "",
      permissionError: "",
      driveQuery: "",
    };
  }

  const approvedParent = resolveApprovedParentForCreate(rootFolders);
  const parentId = approvedParent?.id || companyFolderId;
  try {
    const ensured = await ensureNamedFolder(drive, "Google Forms", parentId);
    return {
      ok: true,
      status: "created",
      companyFolderId,
      googleFormsFolderId: ensured.folder.id,
      googleFormsFolderName: ensured.folder.name || "Google Forms",
      parentFolderId: parentId,
      resolvedVia: approvedParent ? "created_under_parent" : "created_at_company_root",
      created: ensured.created,
      permissionError: "",
      driveQuery: buildGoogleFormsFolderQuery(ensured.folder.id),
    };
  } catch (error) {
    return {
      ok: false,
      status: isCompanyFormsPermissionError(error) ? "permission_denied" : "error",
      companyFolderId,
      googleFormsFolderId: "",
      googleFormsFolderName: "",
      permissionError: error instanceof Error ? error.message : String(error || "Unable to create Google Forms folder."),
      driveQuery: "",
    };
  }
}

/**
 * Recursively list Google Forms under a folder (forms MIME only).
 */
export async function listGoogleFormsInFolderTree(drive, folderId, options = {}) {
  const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : 4;
  const forms = [];
  const seenFormIds = new Set();

  async function walk(currentFolderId, depth, folderPath) {
    if (!currentFolderId || depth > maxDepth) {
      return;
    }
    const response = await drive.files.list({
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: `'${currentFolderId}' in parents and trashed = false`,
      fields: "files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners(emailAddress,displayName),parents)",
      pageSize: 200,
    });
    for (const file of response.data.files || []) {
      if (file.mimeType === GOOGLE_FORMS_MIME) {
        if (seenFormIds.has(file.id)) {
          continue;
        }
        seenFormIds.add(file.id);
        forms.push({
          ...file,
          folderId: currentFolderId,
          folderPath: folderPath || "",
        });
        continue;
      }
      if (file.mimeType === "application/vnd.google-apps.folder") {
        const nextPath = folderPath ? `${folderPath}/${file.name}` : String(file.name || "");
        await walk(file.id, depth + 1, nextPath);
      }
    }
  }

  await walk(String(folderId || "").trim(), 0, "");
  return forms;
}

function mapDriveFormToCompanyForm(file, companyContext, googleFormsFolderId) {
  const owners = (file.owners || [])
    .map((owner) => owner.emailAddress || owner.displayName || "")
    .filter(Boolean);
  return {
    formId: file.id,
    name: file.name || "",
    driveFileId: file.id,
    webViewLink: file.webViewLink || `https://docs.google.com/forms/d/${file.id}/edit`,
    createdTime: file.createdTime || "",
    modifiedTime: file.modifiedTime || "",
    owners,
    folderId: file.folderId || googleFormsFolderId,
    folderPath: file.folderPath || "",
    companyId: String(companyContext.companyId || companyContext.companyFolderId || "").trim(),
    companyFolderId: String(companyContext.companyFolderId || companyContext.companyId || "").trim(),
    googleFormsFolderId,
  };
}

function companyFormToSyncRow(form, syncedAt) {
  return [
    form.formId,
    form.driveFileId,
    form.name,
    form.companyId,
    form.companyFolderId,
    form.googleFormsFolderId,
    form.webViewLink,
    "Discovered",
    form.createdTime,
    form.modifiedTime,
    syncedAt,
  ];
}

async function syncCompanyGoogleFormsToWorkbook(deps, auth, spreadsheetId, forms, companyContext) {
  const {
    google,
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    getTabValues,
    withSheetsQuotaRetry,
    safeLower: safeLowerDep,
  } = deps;
  const lower = safeLowerDep || safeLower;
  const sheetId = String(spreadsheetId || companyContext.masterSheetId || "").trim();
  if (!sheetId || !forms.length) {
    return { synced: 0 };
  }

  let workbook = await getWorkbook(auth, sheetId);
  const { workbook: workbookAfterTab } = await ensureTabExists(auth, sheetId, GOOGLE_FORM_TEMPLATES_TAB, workbook);
  workbook = workbookAfterTab;
  await ensureColumns(auth, sheetId, GOOGLE_FORM_TEMPLATES_TAB, COMPANY_GOOGLE_FORMS_SYNC_COLUMNS);

  const existing = await getTabValues(auth, sheetId, GOOGLE_FORM_TEMPLATES_TAB);
  const headers = (existing[0] || COMPANY_GOOGLE_FORMS_SYNC_COLUMNS).map((value) => String(value || "").trim());
  const headerIndex = Object.fromEntries(headers.map((header, index) => [lower(header), index]));
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const driveFileIdIndex = headerIndex[lower("DriveFileId")];
  const companyFolderIndex = headerIndex[lower("CompanyFolderId")];

  const rows = existing.length > 0 ? existing.slice(1) : [];
  const now = new Date().toISOString();
  const nextRows = [...rows];

  for (const form of forms) {
    const syncRow = companyFormToSyncRow(form, now);
    const padded = headers.map((header, index) => syncRow[index] ?? "");
    const existingIndex = nextRows.findIndex((row) => {
      const sameDrive =
        driveFileIdIndex != null && String(row[driveFileIdIndex] || "").trim() === form.driveFileId;
      const sameCompany =
        !companyFolderId ||
        companyFolderIndex == null ||
        String(row[companyFolderIndex] || "").trim() === companyFolderId;
      return sameDrive && sameCompany;
    });
    if (existingIndex >= 0) {
      nextRows[existingIndex] = padded;
    } else {
      nextRows.push(padded);
    }
  }

  const values = [headers, ...nextRows];
  const sheets = google.sheets({ version: "v4", auth });
  const lastCol =
    headers.length <= 26
      ? String.fromCharCode(64 + headers.length)
      : "Z".repeat(Math.ceil(headers.length / 26));
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${GOOGLE_FORM_TEMPLATES_TAB}!A1:${lastCol}${Math.max(values.length, 2)}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values },
    }),
  );

  return { synced: forms.length };
}

/**
 * Resolve folder and list company Google Forms (recursive, forms MIME only).
 */
export async function listCompanyGoogleForms(drive, companyContext = {}, options = {}) {
  const resolution = await resolveCompanyGoogleFormsFolder(drive, companyContext);
  if (resolution.status === "permission_denied") {
    return {
      ok: false,
      status: "permission_denied",
      error: "BERT cannot access the Google Forms folder.",
      permissionError: resolution.permissionError,
      companyFolderId: resolution.companyFolderId,
      googleFormsFolderId: "",
      driveQuery: "",
      formsFound: 0,
      forms: [],
      diagnostics: {
        companyFolderId: resolution.companyFolderId,
        googleFormsFolderId: "",
        driveQuery: "",
        formsFound: 0,
        permissionError: resolution.permissionError,
      },
    };
  }
  if (!resolution.googleFormsFolderId) {
    return {
      ok: false,
      status: "folder_not_found",
      error: "Google Forms folder could not be found.",
      permissionError: "",
      companyFolderId: resolution.companyFolderId,
      googleFormsFolderId: "",
      driveQuery: "",
      formsFound: 0,
      forms: [],
      diagnostics: {
        companyFolderId: resolution.companyFolderId,
        googleFormsFolderId: "",
        driveQuery: "",
        formsFound: 0,
        permissionError: "",
      },
    };
  }

  let rawForms = [];
  try {
    rawForms = await listGoogleFormsInFolderTree(drive, resolution.googleFormsFolderId, options);
  } catch (error) {
    return {
      ok: false,
      status: isCompanyFormsPermissionError(error) ? "permission_denied" : "error",
      error: isCompanyFormsPermissionError(error)
        ? "BERT cannot access the Google Forms folder."
        : error instanceof Error
          ? error.message
          : "Unable to list Google Forms.",
      permissionError: error instanceof Error ? error.message : String(error || ""),
      companyFolderId: resolution.companyFolderId,
      googleFormsFolderId: resolution.googleFormsFolderId,
      driveQuery: resolution.driveQuery,
      formsFound: 0,
      forms: [],
      diagnostics: {
        companyFolderId: resolution.companyFolderId,
        googleFormsFolderId: resolution.googleFormsFolderId,
        driveQuery: resolution.driveQuery,
        formsFound: 0,
        permissionError: error instanceof Error ? error.message : String(error || ""),
      },
    };
  }

  const forms = rawForms
    .filter((file) => file.mimeType === GOOGLE_FORMS_MIME)
    .map((file) => mapDriveFormToCompanyForm(file, companyContext, resolution.googleFormsFolderId));

  if (options.syncToWorkbook && companyContext.masterSheetId && options.workbookDeps) {
    await syncCompanyGoogleFormsToWorkbook(
      options.workbookDeps,
      options.auth,
      companyContext.masterSheetId,
      forms,
      companyContext,
    );
  }

  return {
    ok: true,
    status: resolution.status === "created" ? "created" : "found",
    companyFolderId: resolution.companyFolderId,
    googleFormsFolderId: resolution.googleFormsFolderId,
    googleFormsFolderName: resolution.googleFormsFolderName,
    resolvedVia: resolution.resolvedVia,
    created: resolution.created,
    driveQuery: resolution.driveQuery,
    formsFound: forms.length,
    forms,
    googleFormsFolder: {
      id: resolution.googleFormsFolderId,
      name: resolution.googleFormsFolderName,
    },
    diagnostics: {
      companyFolderId: resolution.companyFolderId,
      googleFormsFolderId: resolution.googleFormsFolderId,
      driveQuery: resolution.driveQuery,
      formsFound: forms.length,
      permissionError: "",
      resolvedVia: resolution.resolvedVia,
    },
  };
}

export function installCompanyFormsRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    rejectIfCompanyFolderNotUnderCompaniesRoot,
    google,
    sharedDriveId,
    getWorkbook,
    ensureTabExists,
    ensureColumns,
    getTabValues,
    withSheetsQuotaRetry,
    safeLower,
  } = deps;

  app.get("/api/company/:companyFolderId/google-forms", requireGoogleWorkspaceSession, async (req, res) => {
    if (!envConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "Google Workspace is not configured on the server.",
      });
    }
    const auth = getAuthedClient();
    if (!auth) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before loading company Google Forms.",
      });
    }

    const companyFolderId = String(req.params.companyFolderId || "").trim();
    const masterSheetId = String(req.query.masterSheetId || req.query.sheetId || "").trim();
    const syncToWorkbook = String(req.query.sync || "").trim() === "1";
    const createIfMissing = String(req.query.createIfMissing || "").trim() === "1";

    try {
      const folderDenial = await rejectIfCompanyFolderNotUnderCompaniesRoot(
        auth,
        { google, sharedDriveId },
        companyFolderId,
      );
      if (folderDenial) {
        return res.status(403).json(folderDenial);
      }

      const drive = google.drive({ version: "v3", auth });
      const payload = await listCompanyGoogleForms(
        drive,
        {
          companyFolderId,
          companyId: companyFolderId,
          masterSheetId,
          createIfMissing,
        },
        {
          syncToWorkbook,
          auth,
          workbookDeps: syncToWorkbook
            ? {
                google,
                getWorkbook,
                ensureTabExists,
                ensureColumns,
                getTabValues,
                withSheetsQuotaRetry,
                safeLower,
              }
            : null,
        },
      );
      return res.status(payload.ok ? 200 : payload.status === "permission_denied" ? 403 : 404).json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load company Google Forms.",
      });
    }
  });
}
