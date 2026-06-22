/**
 * googleFormsService — company Google Forms folder resolve, Drive list, GoogleFormTemplates tab I/O.
 * Scoped to company folder only; never searches all of Drive.
 */
import { GOOGLE_FORM_TEMPLATES_TAB } from "./google-form-templates.mjs";
import { resolveCompanyFromFolder } from "./company-service.mjs";
import {
  readTabRecords as workbookReadTabRecords,
  writeTabRecords as workbookWriteTabRecords,
  ensureTabColumns as workbookEnsureTabColumns,
} from "./workbook-service.mjs";

export const GOOGLE_FORMS_MIME = "application/vnd.google-apps.form";

export const GOOGLE_FORMS_FOLDER_LOOKUP_FAILED = "GOOGLE_FORMS_FOLDER_LOOKUP_FAILED";

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

export const GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS = COMPANY_GOOGLE_FORMS_SYNC_COLUMNS;

const FALLBACK_FORMS_FOLDER_NAMES = [
  "05 - Forms & Audits",
  "Forms & Audits",
  "Forms",
  "08 - Audits",
];

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

function driveClient(auth, deps = {}) {
  if (!auth || !deps?.google) {
    throw new Error("Google auth and deps.google are required.");
  }
  return deps.google.drive({ version: "v3", auth });
}

function resolveReadTabRecords(deps) {
  return typeof deps?.readTabRecords === "function" ? deps.readTabRecords : workbookReadTabRecords;
}

function resolveWriteTabRecords(deps) {
  return typeof deps?.writeTabRecords === "function" ? deps.writeTabRecords : workbookWriteTabRecords;
}

function resolveEnsureTabColumns(deps) {
  return typeof deps?.ensureTabColumns === "function" ? deps.ensureTabColumns : workbookEnsureTabColumns;
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

function pickExactGoogleFormsAtRoot(folders = []) {
  const exact = folders.find((folder) => isExactGoogleFormsFolderName(folder.name));
  if (exact?.id) {
    return { folder: exact, resolvedVia: "exact_google_forms" };
  }
  return null;
}

async function pickFallbackGoogleFormsFolder(drive, companyFolderId, rootFolders = []) {
  for (const candidate of FALLBACK_FORMS_FOLDER_NAMES) {
    const parent = rootFolders.find((folder) => matchesFolderLabel(folder.name, candidate));
    if (!parent?.id) {
      continue;
    }

    if (normalizeFolderLabel(candidate) === "forms") {
      return {
        folder: parent,
        parentFolder: { id: companyFolderId },
        resolvedVia: "fallback_forms",
      };
    }

    const children = await listChildFolders(drive, parent.id);
    const exact = children.find((child) => isExactGoogleFormsFolderName(child.name));
    if (exact?.id) {
      return {
        folder: exact,
        parentFolder: parent,
        resolvedVia: `fallback_${normalizeFolderLabel(candidate).replace(/\s+/g, "_")}_google_forms`,
      };
    }

    const formsChild = children.find((child) => matchesFolderLabel(child.name, "Google Forms"));
    if (formsChild?.id) {
      return {
        folder: formsChild,
        parentFolder: parent,
        resolvedVia: `fallback_${normalizeFolderLabel(candidate).replace(/\s+/g, "_")}_forms`,
      };
    }
  }
  return null;
}

function buildFolderLookupFailure(companyFolderId, status, permissionError = "") {
  return {
    ok: false,
    status: status === "permission_denied" ? "permission_denied" : "folder_lookup_failed",
    code:
      status === "permission_denied" ? "GOOGLE_FORMS_PERMISSION_DENIED" : GOOGLE_FORMS_FOLDER_LOOKUP_FAILED,
    error:
      status === "permission_denied"
        ? "BERT cannot access the Google Forms folder."
        : "Google Forms folder could not be found or accessed under this company folder.",
    permissionError,
    companyFolderId,
    googleFormsFolderId: "",
    googleFormsFolderName: "",
    driveQuery: "",
  };
}

/**
 * Resolve the company Google Forms folder under companyFolderId (Drive client API).
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
      code: GOOGLE_FORMS_FOLDER_LOOKUP_FAILED,
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
        code: GOOGLE_FORMS_FOLDER_LOOKUP_FAILED,
        companyFolderId,
        googleFormsFolderId: "",
        googleFormsFolderName: "",
        permissionError: "Company folder ID is not a folder.",
        driveQuery: "",
      };
    }
    rootFolders = await listChildFolders(drive, companyFolderId);
  } catch (error) {
    const status = isCompanyFormsPermissionError(error)
      ? "permission_denied"
      : isCompanyFormsNotFoundError(error)
        ? "folder_not_found"
        : "error";
    return {
      ...buildFolderLookupFailure(companyFolderId, status, error instanceof Error ? error.message : String(error || "")),
      status,
    };
  }

  const rootMatch = pickExactGoogleFormsAtRoot(rootFolders);
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

  const fallbackMatch = await pickFallbackGoogleFormsFolder(drive, companyFolderId, rootFolders);
  if (fallbackMatch?.folder?.id) {
    return {
      ok: true,
      status: "found",
      companyFolderId,
      googleFormsFolderId: fallbackMatch.folder.id,
      googleFormsFolderName: fallbackMatch.folder.name || "Google Forms",
      parentFolderId: fallbackMatch.parentFolder?.id || companyFolderId,
      resolvedVia: fallbackMatch.resolvedVia,
      created: false,
      permissionError: "",
      driveQuery: buildGoogleFormsFolderQuery(fallbackMatch.folder.id),
    };
  }

  if (!createIfMissing) {
    return {
      ...buildFolderLookupFailure(companyFolderId, "folder_not_found"),
      status: "folder_not_found",
    };
  }

  try {
    const ensured = await ensureNamedFolder(drive, "Google Forms", companyFolderId);
    return {
      ok: true,
      status: "created",
      companyFolderId,
      googleFormsFolderId: ensured.folder.id,
      googleFormsFolderName: ensured.folder.name || "Google Forms",
      parentFolderId: companyFolderId,
      resolvedVia: "created_at_company_root",
      created: ensured.created,
      permissionError: "",
      driveQuery: buildGoogleFormsFolderQuery(ensured.folder.id),
    };
  } catch (error) {
    const status = isCompanyFormsPermissionError(error) ? "permission_denied" : "error";
    return {
      ...buildFolderLookupFailure(
        companyFolderId,
        status,
        error instanceof Error ? error.message : String(error || "Unable to create Google Forms folder."),
      ),
      status,
    };
  }
}

/** Canonical resolve — creates Drive client from auth/deps. */
export async function resolveGoogleFormsFolder(auth, deps, companyFolderId, options = {}) {
  const drive = driveClient(auth, deps);
  return resolveCompanyGoogleFormsFolder(drive, {
    companyFolderId,
    companyId: companyFolderId,
    createIfMissing: options.createIfMissing !== false,
  });
}

/** List Google Forms in a folder (direct children, forms MIME only). */
export async function listGoogleFormsInFolder(drive, folderId) {
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: buildGoogleFormsFolderQuery(folderId),
    fields: "files(id,name,mimeType,webViewLink,createdTime,modifiedTime,owners(emailAddress,displayName),parents)",
    pageSize: 200,
    orderBy: "name_natural",
  });
  return (response.data.files || []).filter((file) => file.mimeType === GOOGLE_FORMS_MIME);
}

/**
 * @deprecated Prefer listGoogleFormsInFolder — kept for legacy folder tree callers.
 */
export async function listGoogleFormsInFolderTree(drive, folderId, options = {}) {
  const maxDepth = Number(options.maxDepth) > 0 ? Number(options.maxDepth) : 4;
  const forms = [];
  const seenFormIds = new Set();

  async function walk(currentFolderId, depth) {
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
        forms.push({ ...file, folderId: currentFolderId });
        continue;
      }
      if (file.mimeType === "application/vnd.google-apps.folder") {
        await walk(file.id, depth + 1);
      }
    }
  }

  await walk(String(folderId || "").trim(), 0);
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
    companyId: String(companyContext.companyId || companyContext.companyFolderId || "").trim(),
    companyFolderId: String(companyContext.companyFolderId || companyContext.companyId || "").trim(),
    googleFormsFolderId,
  };
}

function formToSyncRowObject(form, syncedAt) {
  return {
    FormId: form.formId,
    DriveFileId: form.driveFileId,
    Name: form.name,
    CompanyId: form.companyId,
    CompanyFolderId: form.companyFolderId,
    GoogleFormsFolderId: form.googleFormsFolderId,
    WebViewLink: form.webViewLink,
    Status: "Discovered",
    CreatedAt: form.createdTime,
    UpdatedAt: form.modifiedTime,
    LastSyncedAt: syncedAt,
  };
}

function pickRecordField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = String(record[key] ?? "").trim();
    if (direct) {
      return direct;
    }
    const match = Object.entries(record).find(([header]) => safeLower(header) === safeLower(key));
    if (match && String(match[1] ?? "").trim()) {
      return String(match[1]).trim();
    }
  }
  return "";
}

export async function readGoogleFormTemplatesFromTab(auth, deps, masterSheetId, companyFolderId = "") {
  const sheetId = String(masterSheetId || "").trim();
  if (!sheetId) {
    return { ok: false, error: "masterSheetId is required.", records: [] };
  }

  const readTabRecords = resolveReadTabRecords(deps);
  const readResult = await readTabRecords(auth, deps, sheetId, GOOGLE_FORM_TEMPLATES_TAB, {
    expectedHeaders: GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS,
  });
  let records = readResult.records || [];
  const targetFolder = String(companyFolderId || "").trim();
  if (targetFolder) {
    records = records.filter((record) => {
      const folderId = pickRecordField(record, "CompanyFolderId", "Company Folder ID");
      const companyId = pickRecordField(record, "CompanyId", "Company ID");
      return folderId === targetFolder || companyId === targetFolder;
    });
  }
  return { ok: true, records, rowCount: records.length, masterSheetId: sheetId };
}

export async function syncGoogleFormTemplatesToTab(auth, deps, companyContext, forms = []) {
  const sheetId = String(companyContext.masterSheetId || "").trim();
  if (!sheetId) {
    return { ok: false, synced: 0, error: "masterSheetId is required for GoogleFormTemplates sync." };
  }
  if (!Array.isArray(forms) || forms.length === 0) {
    return { ok: true, synced: 0 };
  }

  const readTabRecords = resolveReadTabRecords(deps);
  const writeTabRecords = resolveWriteTabRecords(deps);
  const ensureTabColumns = resolveEnsureTabColumns(deps);
  await ensureTabColumns(auth, deps, sheetId, GOOGLE_FORM_TEMPLATES_TAB, GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS);

  const existing = await readTabRecords(auth, deps, sheetId, GOOGLE_FORM_TEMPLATES_TAB, {
    expectedHeaders: GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS,
  });
  const companyFolderId = String(companyContext.companyFolderId || companyContext.companyId || "").trim();
  const now = new Date().toISOString();
  const otherCompanyRows = [];
  const currentCompanyRows = new Map();

  for (const record of existing.records || []) {
    const driveFileId = pickRecordField(record, "DriveFileId");
    const recordFolder = pickRecordField(record, "CompanyFolderId", "Company Folder ID");
    if (companyFolderId && recordFolder && recordFolder !== companyFolderId) {
      otherCompanyRows.push(record);
      continue;
    }
    if (driveFileId) {
      currentCompanyRows.set(driveFileId, record);
    } else {
      otherCompanyRows.push(record);
    }
  }

  for (const form of forms) {
    currentCompanyRows.set(form.driveFileId, formToSyncRowObject(form, now));
  }

  const mergedRows = [...otherCompanyRows, ...currentCompanyRows.values()];

  await writeTabRecords(auth, deps, sheetId, GOOGLE_FORM_TEMPLATES_TAB, GOOGLE_FORM_TEMPLATES_SYNC_COLUMNS, mergedRows);
  return { ok: true, synced: forms.length, masterSheetId: sheetId };
}

function buildListFailure(resolution) {
  const isPermission = resolution.status === "permission_denied";
  return {
    ok: false,
    status: isPermission ? "permission_denied" : "folder_lookup_failed",
    code: isPermission ? "GOOGLE_FORMS_PERMISSION_DENIED" : GOOGLE_FORMS_FOLDER_LOOKUP_FAILED,
    error: isPermission
      ? "BERT cannot access the Google Forms folder."
      : resolution.error || "Google Forms folder could not be found or accessed under this company folder.",
    permissionError: resolution.permissionError || "",
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
      permissionError: resolution.permissionError || "",
      folderLookupFailed: !isPermission,
    },
  };
}

/** Drive-client list helper (unit tests and legacy server callers). */
export async function listCompanyGoogleFormsFromDrive(drive, companyContext = {}, options = {}) {
  const resolution = await resolveCompanyGoogleFormsFolder(drive, companyContext);
  if (!resolution.ok || !resolution.googleFormsFolderId) {
    return buildListFailure(resolution);
  }

  let rawForms = [];
  try {
    rawForms = await listGoogleFormsInFolder(drive, resolution.googleFormsFolderId);
  } catch (error) {
    return {
      ok: false,
      status: isCompanyFormsPermissionError(error) ? "permission_denied" : "error",
      code: isCompanyFormsPermissionError(error) ? "GOOGLE_FORMS_PERMISSION_DENIED" : "GOOGLE_FORMS_LIST_FAILED",
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

  const forms = rawForms.map((file) => mapDriveFormToCompanyForm(file, companyContext, resolution.googleFormsFolderId));

  if (options.syncToWorkbook && companyContext.masterSheetId) {
    await syncGoogleFormTemplatesToTab(options.auth || null, options.workbookDeps || {}, companyContext, forms);
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

/** Canonical list — auth/deps entry point. */
export async function listCompanyGoogleForms(auth, deps, companyContext = {}, options = {}) {
  const drive = driveClient(auth, deps);
  return listCompanyGoogleFormsFromDrive(drive, companyContext, {
    ...options,
    auth,
    workbookDeps: options.workbookDeps || deps,
  });
}

const FOLDER_RESOLVE_OPTS = {
  ensureTabsSync: false,
  ensureStructure: false,
  createIfMissing: false,
  skipFolderPlacementCheck: true,
  preferFolderResolution: true,
};

function resolveFolderContextFn(deps) {
  return typeof deps?.resolveCompanyFromFolder === "function"
    ? deps.resolveCompanyFromFolder
    : resolveCompanyFromFolder;
}

function buildWorkbookDeps(deps) {
  const { google, withSheetsQuotaRetry, safeLower } = deps;
  return {
    google,
    withSheetsQuotaRetry,
    safeLower,
    readTabRecords: deps.readTabRecords,
    writeTabRecords: deps.writeTabRecords,
    ensureTabColumns: deps.ensureTabColumns,
    getTabValues: deps.getTabValues,
    getWorkbook: deps.getWorkbook,
    ensureTabExists: deps.ensureTabExists,
    ensureColumns: deps.ensureColumns,
  };
}

function googleFormsHttpStatus(payload = {}) {
  if (payload.ok) {
    return 200;
  }
  if (payload.status === "permission_denied") {
    return 403;
  }
  if (payload.status === "folder_lookup_failed") {
    return 404;
  }
  return 500;
}

async function resolveCompanyGoogleFormsRouteContext(auth, deps, req, routeContext = {}) {
  const companyId = String(
    routeContext.companyId || req.params?.companyId || req.params?.companyFolderId || "",
  ).trim();
  const actor =
    typeof deps.parseBertActorFromRequest === "function" ? deps.parseBertActorFromRequest(req) : null;
  const companyFolderId = String(
    routeContext.companyFolderId ||
      req.query?.companyFolderId ||
      actor?.companyFolderId ||
      actor?.companyId ||
      companyId,
  ).trim();
  const createIfMissing =
    routeContext.createIfMissing !== undefined
      ? routeContext.createIfMissing
      : String(req.query?.createIfMissing || "").trim() !== "0";

  let masterSheetId = "";
  if (auth && companyFolderId) {
    const folderResolved = await resolveFolderContextFn(deps)(
      auth,
      deps,
      companyFolderId,
      FOLDER_RESOLVE_OPTS,
    );
    if (folderResolved?.ok && folderResolved.masterSheetId) {
      masterSheetId = String(folderResolved.masterSheetId).trim();
    }
  }

  return {
    companyId,
    companyFolderId,
    masterSheetId,
    createIfMissing,
    actor,
  };
}

/** Canonical GET handler — shared by /api/companies/:companyId/google-forms and legacy alias. */
export async function handleCompanyGoogleFormsGet(req, res, deps, routeContext = {}) {
  const { getAuthedClient, envConfigured, rejectIfCompanyFolderNotUnderCompaniesRoot, google, sharedDriveId } =
    deps;

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

  const syncToWorkbook =
    routeContext.syncToWorkbook === true || String(req.query?.sync || "").trim() === "1";

  try {
    const context = await resolveCompanyGoogleFormsRouteContext(auth, deps, req, routeContext);
    const folderDenial = await rejectIfCompanyFolderNotUnderCompaniesRoot(
      auth,
      { google, sharedDriveId },
      context.companyFolderId,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    const payload = await listCompanyGoogleForms(
      auth,
      buildWorkbookDeps(deps),
      {
        companyFolderId: context.companyFolderId,
        companyId: context.companyFolderId,
        masterSheetId: context.masterSheetId,
        createIfMissing: context.createIfMissing,
      },
      { syncToWorkbook },
    );

    return res.status(googleFormsHttpStatus(payload)).json(payload);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to load company Google Forms.",
    });
  }
}

/** Canonical POST sync handler — lists Drive forms and writes GoogleFormTemplates tab. */
export async function handleCompanyGoogleFormsSyncPost(req, res, deps, routeContext = {}) {
  return handleCompanyGoogleFormsGet(req, res, deps, { ...routeContext, syncToWorkbook: true });
}

function canCreateBertCheckFromGoogleForm(actor) {
  const role = actor?.role === "Master" ? "Master" : String(actor?.role || "").trim();
  return ["Master", "Admin", "Manager"].includes(role);
}

export function resolveSyncedGoogleFormRecord(records = [], formId = "") {
  const needle = String(formId || "").trim();
  if (!needle) {
    return null;
  }
  for (const record of records) {
    const recordFormId = pickRecordField(record, "FormId");
    const driveFileId = pickRecordField(record, "DriveFileId");
    if (needle === recordFormId || needle === driveFileId) {
      return {
        formId: recordFormId || driveFileId,
        driveFileId: driveFileId || recordFormId,
        name: pickRecordField(record, "Name"),
        webViewLink: pickRecordField(record, "WebViewLink"),
      };
    }
  }
  return null;
}

async function resolveGoogleFormForBertImport(auth, deps, context, formId) {
  const workbookDeps = buildWorkbookDeps(deps);
  const tabResult = await readGoogleFormTemplatesFromTab(auth, workbookDeps, context.masterSheetId, context.companyFolderId);
  const fromTab = resolveSyncedGoogleFormRecord(tabResult.records || [], formId);
  if (fromTab) {
    return fromTab;
  }

  const listed = await listCompanyGoogleForms(auth, workbookDeps, {
    companyFolderId: context.companyFolderId,
    companyId: context.companyFolderId,
    masterSheetId: context.masterSheetId,
    createIfMissing: false,
  });
  if (!listed.ok) {
    return null;
  }
  const match = (listed.forms || []).find(
    (form) => form.formId === formId || form.driveFileId === formId,
  );
  if (!match) {
    return null;
  }
  return {
    formId: match.formId || match.driveFileId,
    driveFileId: match.driveFileId || match.formId,
    name: match.name,
    webViewLink: match.webViewLink,
  };
}

/** POST /api/companies/:companyId/google-forms/:formId/create-bert-check */
export async function handleCreateBertCheckFromGoogleFormPost(req, res, deps, routeContext = {}) {
  const { getAuthedClient, envConfigured, rejectIfCompanyFolderNotUnderCompaniesRoot, google, sharedDriveId, sessionDir } =
    deps;

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
      error: "Please connect Google before creating a BERT check from a Google Form.",
    });
  }

  const actor =
    typeof deps.parseBertActorFromRequest === "function" ? deps.parseBertActorFromRequest(req) : null;
  if (!canCreateBertCheckFromGoogleForm(actor)) {
    return res.status(403).json({
      ok: false,
      error: "Only Admin or Manager roles can create BERT checks from Google Forms.",
    });
  }

  const formId = String(routeContext.formId || req.params?.formId || "").trim();
  if (!formId) {
    return res.status(400).json({ ok: false, error: "formId is required." });
  }

  try {
    const context = await resolveCompanyGoogleFormsRouteContext(auth, deps, req, routeContext);
    if (!context.masterSheetId) {
      return res.status(400).json({
        ok: false,
        error: "Link your company folder and master workbook before importing Google Forms as BERT checks.",
      });
    }

    const folderDenial = await rejectIfCompanyFolderNotUnderCompaniesRoot(
      auth,
      { google, sharedDriveId },
      context.companyFolderId,
    );
    if (folderDenial) {
      return res.status(403).json(folderDenial);
    }

    const googleForm = await resolveGoogleFormForBertImport(auth, deps, context, formId);
    if (!googleForm) {
      return res.status(404).json({
        ok: false,
        error: "Synced Google Form not found for this company. Sync Google Forms to your workbook first.",
      });
    }

    const { createBertCheckFromSyncedGoogleForm } = await import("./audit-builder.mjs");
    const sheetDeps = {
      google,
      ensureColumns: deps.ensureColumns,
      getTabValues: deps.getTabValues,
      rowsToRecords: deps.rowsToRecords,
      withSheetsQuotaRetry: deps.withSheetsQuotaRetry,
    };
    const actorEmail = String(actor?.email || "BERT").trim().toLowerCase() || "bert@import";
    const result = await createBertCheckFromSyncedGoogleForm({
      sessionDir,
      sheetDeps,
      authed: auth,
      masterSheetId: context.masterSheetId,
      actorEmail,
      googleForm,
    });

    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create BERT check from Google Form.",
    });
  }
}

export function installCompanyFormsRoutes(app, deps) {
  const { requireGoogleWorkspaceSession } = deps;

  app.get("/api/company/:companyFolderId/google-forms", requireGoogleWorkspaceSession, async (req, res) => {
    return handleCompanyGoogleFormsGet(req, res, deps, {
      companyId: String(req.params.companyFolderId || "").trim(),
      companyFolderId: String(req.params.companyFolderId || "").trim(),
    });
  });
}
