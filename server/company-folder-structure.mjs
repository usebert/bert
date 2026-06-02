/**
 * Standard BERT company Drive folder tree (server-side only).
 * Idempotent: reuses folders by exact name under each parent; never deletes.
 */

export const AUDITS_GOOGLE_FORMS_FOLDER_KEY = "AUDITS_GOOGLE_FORMS";
export const COMPANY_GOOGLE_FORM_STORAGE_PATH = "08 - Audits / Google Forms";

export const COMPANY_FOLDERS_TAB = "CompanyFolders";
export const COMPANY_FOLDERS_COLUMNS = [
  "Folder Key",
  "Folder Name",
  "Folder ID",
  "Parent Folder ID",
  "Path",
  "Created At",
  "Last Checked At",
  "Status",
];

/** Nested folder tree under the company root. */
export const COMPANY_FOLDER_TREE = [
  {
    key: "ADMIN",
    name: "00 - Admin",
    children: [
      { key: "ADMIN_COMPANY_SETUP", name: "Company Setup" },
      { key: "ADMIN_USERS_ROLES", name: "Users & Roles" },
      { key: "ADMIN_CONTACTS", name: "Contacts" },
      { key: "ADMIN_NOTES", name: "Notes" },
    ],
  },
  {
    key: "BERT_SYSTEM_FILES",
    name: "01 - BERT System Files",
    children: [
      { key: "BERT_COMPANY_WORKBOOK", name: "Company Workbook" },
      { key: "BERT_CONFIG_BACKUPS", name: "Config Backups" },
      { key: "BERT_IMPORT_LOGS", name: "Import Logs" },
      { key: "BERT_SYNC_LOGS", name: "Sync Logs" },
      { key: "BERT_SYSTEM_EXPORTS", name: "System Exports" },
    ],
  },
  {
    key: "FORMS_CHECKS",
    name: "02 - Forms & Checks",
    children: [
      { key: "FORMS_LIVE", name: "Live" },
      { key: "FORMS_DRAFT", name: "Draft" },
      { key: "FORMS_ARCHIVED", name: "Archived" },
      { key: "FORMS_GOOGLE_COPIES", name: "Google Form Copies" },
    ],
  },
  {
    key: "EVIDENCE",
    name: "03 - Evidence",
    children: [
      { key: "EVIDENCE_PHOTOS", name: "Photos" },
      { key: "EVIDENCE_DOCUMENTS", name: "Documents" },
      { key: "EVIDENCE_OFFLINE_UPLOADS", name: "Offline Uploads" },
      { key: "EVIDENCE_ARCHIVED", name: "Archived" },
    ],
  },
  {
    key: "REPORTS",
    name: "04 - Reports",
    children: [
      { key: "REPORTS_AUDIT", name: "Audit" },
      { key: "REPORTS_CHECK", name: "Check" },
      { key: "REPORTS_MANAGEMENT", name: "Management" },
      { key: "REPORTS_ARCHIVED", name: "Archived" },
    ],
  },
  {
    key: "ACTIONS_FINDINGS",
    name: "05 - Actions & Findings",
    children: [
      { key: "ACTIONS_OPEN", name: "Open" },
      { key: "ACTIONS_CLOSED", name: "Closed" },
      { key: "ACTIONS_NC", name: "NC" },
      { key: "ACTIONS_CORRECTIVE", name: "Corrective" },
    ],
  },
  {
    key: "ISO_COMPLIANCE",
    name: "06 - ISO & Compliance",
    children: [
      { key: "ISO_9001", name: "9001" },
      { key: "ISO_14001", name: "14001" },
      { key: "ISO_45001", name: "45001" },
      { key: "ISO_POLICIES", name: "Policies" },
      { key: "ISO_PROCEDURES", name: "Procedures" },
      { key: "ISO_RISK", name: "Risk" },
      { key: "ISO_COSHH", name: "COSHH" },
      { key: "ISO_TRAINING_RECORDS", name: "Training Records" },
    ],
  },
  {
    key: "HEALTH_SAFETY",
    name: "07 - Health & Safety",
    children: [
      { key: "HS_SITE_SAFETY", name: "Site Safety" },
      { key: "HS_FIRE", name: "Fire" },
      { key: "HS_FIRST_AID", name: "First Aid" },
      { key: "HS_EQUIPMENT", name: "Equipment" },
      { key: "HS_INCIDENT", name: "Incident" },
      { key: "HS_NEAR_MISS", name: "Near Miss" },
      { key: "HS_TOOLBOX", name: "Toolbox" },
    ],
  },
  {
    key: "AUDITS",
    name: "08 - Audits",
    children: [
      { key: "AUDITS_INTERNAL", name: "Internal" },
      { key: "AUDITS_SUPPLIER", name: "Supplier" },
      { key: "AUDITS_SITE", name: "Site" },
      { key: "AUDITS_PROCESS", name: "Process" },
      { key: "AUDITS_ARCHIVED", name: "Archived" },
      { key: "AUDITS_GOOGLE_FORMS", name: "Google Forms" },
    ],
  },
  {
    key: "TRAINING",
    name: "09 - Training",
    children: [
      { key: "TRAINING_INDUCTIONS", name: "Inductions" },
      { key: "TRAINING_COMPETENCY", name: "Competency" },
      { key: "TRAINING_TOOLBOX_SIGNOFFS", name: "Toolbox Sign-Offs" },
      { key: "TRAINING_CERTIFICATES", name: "Certificates" },
    ],
  },
  {
    key: "ARCHIVE",
    name: "99 - Archive",
    children: [
      { key: "ARCHIVE_OLD_REPORTS", name: "Old Reports" },
      { key: "ARCHIVE_EVIDENCE", name: "Old Evidence" },
      { key: "ARCHIVE_FORMS", name: "Forms" },
      { key: "ARCHIVE_SYSTEM_FILES", name: "System Files" },
    ],
  },
];

/** Legacy ISO readiness folder names at company root (pre-standard tree). */
export const LEGACY_ISO_ROOT_ALIASES = {
  setupFolderId: ["01 company setup", "company setup", "master data sheet"],
  auditFormsFolderId: ["02 audit forms", "audit forms", "audits"],
  recordsFolderId: ["03 company records", "company records"],
  evidenceFolderId: ["03 evidence", "04 evidence", "evidence"],
  exportsFolderId: ["05 exports", "exports"],
  managementNotesFolderId: ["06 management notes", "management notes", "admin notes"],
};

function safeLower(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeFolderName(value = "") {
  return safeLower(value)
    .replace(/^\d+\s*[-–—]?\s*/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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

async function findFolderByExactName(drive, parentId, name) {
  const target = safeLower(name);
  const folders = await listChildFolders(drive, parentId);
  return folders.find((folder) => safeLower(folder.name) === target) || null;
}

async function ensureNamedFolder(drive, name, parentId) {
  const existing = await findFolderByExactName(drive, parentId, name);
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

async function ensureFolderNode(drive, node, parentId, parentPath, entries, folderIds) {
  const path = parentPath ? `${parentPath}/${node.name}` : node.name;
  const { folder, created } = await ensureNamedFolder(drive, node.name, parentId);
  const folderId = folder.id;
  folderIds[node.key] = folderId;
  entries.push({
    key: node.key,
    name: node.name,
    folderId,
    parentFolderId: parentId,
    path,
    createdAt: folder.createdTime || new Date().toISOString(),
    status: created ? "Created" : "Existing",
  });

  for (const child of node.children || []) {
    await ensureFolderNode(drive, child, folderId, path, entries, folderIds);
  }
}

function findLegacyRootFolder(children, legacyKey) {
  const aliases = LEGACY_ISO_ROOT_ALIASES[legacyKey] || [];
  const normalizedAliases = aliases.map((name) => normalizeFolderName(name));
  return (
    children.find((file) => {
      if (file.mimeType !== "application/vnd.google-apps.folder") {
        return false;
      }
      const normalized = normalizeFolderName(file.name);
      return normalizedAliases.includes(normalized);
    }) || null
  );
}

/**
 * Maps standard folder keys to legacy config keys used across the app.
 */
export function buildLegacyFolderConfigFromStructure(folderIds, legacyRootIds = {}) {
  return {
    setupFolderId:
      folderIds.ADMIN_COMPANY_SETUP || legacyRootIds.setupFolderId || "",
    auditFormsFolderId: folderIds.FORMS_LIVE || legacyRootIds.auditFormsFolderId || "",
    recordsFolderId: folderIds.ISO_COMPLIANCE || legacyRootIds.recordsFolderId || "",
    evidenceFolderId: folderIds.EVIDENCE_PHOTOS || legacyRootIds.evidenceFolderId || "",
    exportsFolderId: folderIds.BERT_SYSTEM_EXPORTS || legacyRootIds.exportsFolderId || "",
    managementNotesFolderId: folderIds.ADMIN_NOTES || legacyRootIds.managementNotesFolderId || "",
    companyWorkbookFolderId: folderIds.BERT_COMPANY_WORKBOOK || "",
    formsGoogleCopiesFolderId: folderIds.FORMS_GOOGLE_COPIES || "",
    auditsGoogleFormsFolderId: folderIds.AUDITS_GOOGLE_FORMS || "",
    reportsFolderId: folderIds.REPORTS || "",
    evidenceOfflineUploadsFolderId: folderIds.EVIDENCE_OFFLINE_UPLOADS || "",
    evidenceDocumentsFolderId: folderIds.EVIDENCE_DOCUMENTS || "",
    bertSyncLogsFolderId: folderIds.BERT_SYNC_LOGS || "",
    bertImportLogsFolderId: folderIds.BERT_IMPORT_LOGS || "",
  };
}

export function resolveEvidenceUploadFolderId(folderIds = {}, legacyEvidenceFolderId = "", options = {}) {
  const kind = safeLower(options.kind || "photo");
  if (kind === "offline" && folderIds.EVIDENCE_OFFLINE_UPLOADS) {
    return folderIds.EVIDENCE_OFFLINE_UPLOADS;
  }
  if ((kind === "document" || kind === "file") && folderIds.EVIDENCE_DOCUMENTS) {
    return folderIds.EVIDENCE_DOCUMENTS;
  }
  if (folderIds.EVIDENCE_PHOTOS) {
    return folderIds.EVIDENCE_PHOTOS;
  }
  if (folderIds.EVIDENCE) {
    return folderIds.EVIDENCE;
  }
  return legacyEvidenceFolderId || "";
}

function sheetEndColumnLetter(columnCount) {
  const count = Math.max(Number(columnCount) || 1, 1);
  if (count <= 26) {
    return String.fromCharCode(64 + count);
  }
  let remaining = count;
  let letters = "";
  while (remaining > 0) {
    const index = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + index) + letters;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return letters;
}

async function writeCompanyFoldersTab(deps, auth, spreadsheetId, entries) {
  const {
    ensureTabExists,
    ensureColumns,
    getWorkbook,
    getTabValues,
    google,
    withSheetsQuotaRetry,
    safeLower: safeLowerDep,
  } = deps;
  const lower = safeLowerDep || safeLower;
  let workbook = await getWorkbook(auth, spreadsheetId);
  const { workbook: workbookAfterTab } = await ensureTabExists(auth, spreadsheetId, COMPANY_FOLDERS_TAB, workbook);
  workbook = workbookAfterTab;
  await ensureColumns(auth, spreadsheetId, COMPANY_FOLDERS_TAB, COMPANY_FOLDERS_COLUMNS);

  const now = new Date().toISOString();
  const rows = [
    COMPANY_FOLDERS_COLUMNS,
    ...entries.map((entry) => [
      entry.key,
      entry.name,
      entry.folderId,
      entry.parentFolderId,
      entry.path,
      entry.createdAt,
      now,
      entry.status,
    ]),
  ];

  const sheets = google.sheets({ version: "v4", auth });
  const existing = await getTabValues(auth, spreadsheetId, COMPANY_FOLDERS_TAB);
  const rowCount = Math.max(existing.length, rows.length, 2);
  const columnCount = Math.max(
    COMPANY_FOLDERS_COLUMNS.length,
    ...rows.map((row) => row.length),
  );
  const lastCol = sheetEndColumnLetter(columnCount);
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${COMPANY_FOLDERS_TAB}!A1:${lastCol}${rowCount}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    }),
  );

  const sheet = workbook.data.sheets?.find(
    (item) => lower(item.properties?.title) === lower(COMPANY_FOLDERS_TAB),
  );
  const sheetId = sheet?.properties?.sheetId;
  if (sheetId != null && rowCount < existing.length) {
    await withSheetsQuotaRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: "ROWS",
                  startIndex: rows.length,
                  endIndex: existing.length,
                },
              },
            },
          ],
        },
      }),
    );
  }
}

export function buildCompanyMasterSheetName(companyName = "") {
  const safe = String(companyName || "").trim() || "Company";
  return `${safe} - BERT Master Sheet`;
}

function matchesCompanyMasterSheetName(name = "", companyName = "") {
  const lower = safeLower(name);
  const expected = safeLower(buildCompanyMasterSheetName(companyName));
  if (lower === expected) {
    return true;
  }
  if (lower === "company master sheet") {
    return true;
  }
  if (lower.endsWith(" - bert master sheet")) {
    return true;
  }
  return false;
}

async function listSpreadsheetsInFolder(drive, folderId) {
  if (!folderId) {
    return [];
  }
  const response = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`,
    fields: "files(id,name,webViewLink,createdTime)",
    pageSize: 50,
    orderBy: "createdTime",
  });
  return response.data.files || [];
}

function buildSpreadsheetLink(spreadsheetId, webViewLink = "") {
  if (webViewLink) {
    return webViewLink;
  }
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

async function createCompanySpreadsheet(drive, name, parentId) {
  const created = await drive.files.create({
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.spreadsheet",
      parents: [parentId],
    },
    fields: "id,name,webViewLink",
  });
  return created.data;
}

/**
 * Find, reuse, or create the company master spreadsheet in Company Workbook. Idempotent.
 */
export async function ensureCompanyMasterSheet(drive, input) {
  const companyName = String(input.companyName || "").trim();
  const masterSheetIdHint = String(input.masterSheetId || "").trim();
  const workbookFolderId = String(input.workbookFolderId || "").trim();
  const legacySetupFolderId = String(input.legacySetupFolderId || "").trim();
  const searchFolderIds = Array.from(new Set([workbookFolderId, legacySetupFolderId].filter(Boolean)));

  if (masterSheetIdHint) {
    try {
      const meta = await drive.files.get({
        fileId: masterSheetIdHint,
        supportsAllDrives: true,
        fields: "id,name,mimeType,webViewLink",
      });
      if (meta.data.mimeType === "application/vnd.google-apps.spreadsheet") {
        if (workbookFolderId) {
          await moveFileToFolderIfNeeded(drive, masterSheetIdHint, workbookFolderId);
        }
        return {
          masterSheetId: meta.data.id,
          masterSheetName: meta.data.name,
          masterSheetLink: buildSpreadsheetLink(meta.data.id, meta.data.webViewLink),
          status: "linked",
          created: false,
        };
      }
    } catch {
      // Hint invalid — search or create below.
    }
  }

  for (const folderId of searchFolderIds) {
    const spreadsheets = await listSpreadsheetsInFolder(drive, folderId);
    const match = spreadsheets.find((file) => matchesCompanyMasterSheetName(file.name, companyName));
    if (match?.id) {
      if (workbookFolderId && folderId !== workbookFolderId) {
        await moveFileToFolderIfNeeded(drive, match.id, workbookFolderId);
      }
      return {
        masterSheetId: match.id,
        masterSheetName: match.name,
        masterSheetLink: buildSpreadsheetLink(match.id, match.webViewLink),
        status: "reused",
        created: false,
      };
    }
  }

  const parentId = workbookFolderId || searchFolderIds[0];
  if (!parentId) {
    throw new Error("Company Workbook folder not found. Run folder structure repair first.");
  }
  const sheetName = buildCompanyMasterSheetName(companyName);
  const created = await createCompanySpreadsheet(drive, sheetName, parentId);
  console.log("[provision] company_master_sheet created", {
    spreadsheetId: created.id,
    workbookFolderId: parentId,
    companyNameLen: companyName.length,
  });
  return {
    masterSheetId: created.id,
    masterSheetName: created.name,
    masterSheetLink: buildSpreadsheetLink(created.id, created.webViewLink),
    status: "created",
    created: true,
  };
}

async function moveFileToFolderIfNeeded(drive, fileId, targetFolderId) {
  if (!fileId || !targetFolderId) {
    return { moved: false };
  }
  const meta = await drive.files.get({
    fileId,
    supportsAllDrives: true,
    fields: "id,parents,mimeType",
  });
  const parents = meta.data.parents || [];
  if (parents.includes(targetFolderId)) {
    return { moved: false };
  }
  await drive.files.update({
    fileId,
    supportsAllDrives: true,
    addParents: targetFolderId,
    removeParents: parents.join(","),
    fields: "id,parents",
  });
  return { moved: true };
}

async function placeSystemFiles(drive, { masterSheetId, folderIds, legacyRootIds }) {
  const placed = [];
  const workbookFolderId = folderIds.BERT_COMPANY_WORKBOOK;
  if (masterSheetId && workbookFolderId) {
    const result = await moveFileToFolderIfNeeded(drive, masterSheetId, workbookFolderId);
    if (result.moved) {
      placed.push({ type: "workbook", fileId: masterSheetId, folderId: workbookFolderId });
    }
  }

  const legacySetupId = legacyRootIds.setupFolderId;
  if (
    masterSheetId &&
    legacySetupId &&
    legacySetupId !== workbookFolderId &&
    workbookFolderId
  ) {
    const legacyChildren = await listChildFolders(drive, legacySetupId);
    for (const child of legacyChildren) {
      if (child.mimeType === "application/vnd.google-apps.spreadsheet" && child.id === masterSheetId) {
        continue;
      }
      if (child.mimeType === "application/vnd.google-apps.spreadsheet") {
        const moveResult = await moveFileToFolderIfNeeded(drive, child.id, workbookFolderId);
        if (moveResult.moved) {
          placed.push({ type: "spreadsheet", fileId: child.id, folderId: workbookFolderId });
        }
      }
    }
  }

  return placed;
}

/**
 * Ensure the full standard folder tree under a company root. Idempotent.
 * @returns {Promise<{ folderIds: Record<string, string>, entries: object[], legacyRootIds: object, placed: object[] }>}
 */
export async function ensureCompanyFolderStructure(deps, auth, input) {
  const { google } = deps;
  const companyName = String(input.companyName || "").trim();
  const companyRootFolderId = String(input.companyRootFolderId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  const syncWorkbookTab = input.syncWorkbookTab !== false;
  const placeFiles = input.placeFiles !== false;

  if (!companyRootFolderId) {
    throw new Error("companyRootFolderId is required.");
  }

  const drive = google.drive({ version: "v3", auth });
  const rootMeta = await drive.files.get({
    fileId: companyRootFolderId,
    supportsAllDrives: true,
    fields: "id,name,mimeType",
  });
  if (rootMeta.data.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("The company root folder ID is missing or invalid.");
  }

  const allChildrenResponse = await drive.files.list({
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    q: `'${companyRootFolderId}' in parents and trashed = false`,
    fields: "files(id,name,mimeType)",
    pageSize: 200,
  });
  const rootFiles = allChildrenResponse.data.files || [];

  const legacyRootIds = {};
  for (const legacyKey of Object.keys(LEGACY_ISO_ROOT_ALIASES)) {
    const match = findLegacyRootFolder(rootFiles, legacyKey);
    if (match?.id) {
      legacyRootIds[legacyKey] = match.id;
    }
  }

  const entries = [];
  const folderIds = {};
  for (const node of COMPANY_FOLDER_TREE) {
    await ensureFolderNode(drive, node, companyRootFolderId, companyName || rootMeta.data.name || "", entries, folderIds);
  }

  if (masterSheetId && syncWorkbookTab) {
    await writeCompanyFoldersTab(deps, auth, masterSheetId, entries);
  }

  let placed = [];
  if (placeFiles) {
    placed = await placeSystemFiles(drive, { masterSheetId, folderIds, legacyRootIds });
  }

  return {
    folderIds,
    entries,
    legacyRootIds,
    legacyFolderConfig: buildLegacyFolderConfigFromStructure(folderIds, legacyRootIds),
    placed,
  };
}

export function installCompanyFolderStructureRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireWorkspaceAdminActor,
    ensureTabsAndColumns,
    ensureCompanyMappingTabs,
    ensureAreasTab,
    updateConfig,
    getConfig,
    getDriveFile,
  } = deps;

  app.post("/api/company-folder/:folderId/ensure-structure", requireGoogleWorkspaceSession, requireWorkspaceAdminActor, async (req, res) => {
    if (!envConfigured()) {
      return res.status(503).json({
        ok: false,
        error: "Google Workspace is not configured on the server. Connect Google in platform setup first.",
      });
    }
    const authed = getAuthedClient();
    if (!authed) {
      return res.status(401).json({
        ok: false,
        error: "Please connect Google before repairing the company folder structure.",
      });
    }

    try {
      const companyRootFolderId = String(req.params.folderId || "").trim();
      const masterSheetIdInput = String(req.body?.masterSheetId || "").trim();
      const companyName = String(req.body?.companyName || "").trim();
      const ensureMasterSheet = req.body?.ensureMasterSheet !== false;

      if (!companyRootFolderId) {
        return res.status(400).json({ ok: false, error: "Company folder ID is required." });
      }

      const companyRoot = await getDriveFile(authed, companyRootFolderId);
      const resolvedCompanyName = companyName || companyRoot.name || "";

      const structureWithoutSheet = await ensureCompanyFolderStructure(deps, authed, {
        companyName: resolvedCompanyName,
        companyRootFolderId,
        syncWorkbookTab: false,
        placeFiles: false,
      });

      const drive = deps.google.drive({ version: "v3", auth: authed });
      let masterSheet = null;
      if (ensureMasterSheet || masterSheetIdInput) {
        masterSheet = await ensureCompanyMasterSheet(drive, {
          companyName: resolvedCompanyName,
          masterSheetId: masterSheetIdInput,
          workbookFolderId: structureWithoutSheet.folderIds.BERT_COMPANY_WORKBOOK || "",
          legacySetupFolderId: structureWithoutSheet.legacyRootIds.setupFolderId || "",
        });
      }

      const resolvedMasterSheetId = masterSheet?.masterSheetId || masterSheetIdInput;
      const result = await ensureCompanyFolderStructure(deps, authed, {
        companyName: resolvedCompanyName,
        companyRootFolderId,
        masterSheetId: resolvedMasterSheetId,
        syncWorkbookTab: Boolean(resolvedMasterSheetId),
        placeFiles: Boolean(resolvedMasterSheetId),
      });

      if (resolvedMasterSheetId) {
        await ensureTabsAndColumns(authed, resolvedMasterSheetId, {
          companyId: companyRootFolderId,
          companyName: resolvedCompanyName,
        });
        if (typeof ensureCompanyMappingTabs === "function") {
          await ensureCompanyMappingTabs(deps, authed, resolvedMasterSheetId);
        }
        if (typeof ensureAreasTab === "function") {
          await ensureAreasTab(authed, resolvedMasterSheetId);
        }
        const config = await getConfig(authed, resolvedMasterSheetId);
        await updateConfig(authed, resolvedMasterSheetId, {
          ...config,
          ...result.legacyFolderConfig,
          masterSheetId: resolvedMasterSheetId,
          companyFolderStructureVersion: "1",
          companyFolderStructureCheckedAt: new Date().toISOString(),
        });
      }

      if (masterSheet?.status) {
        console.log("[provision] company_master_sheet", {
          status: masterSheet.status,
          spreadsheetId: masterSheet.masterSheetId,
          companyFolderId: companyRootFolderId,
        });
      }

      return res.json({
        ok: true,
        folderIds: result.folderIds,
        legacyFolderConfig: result.legacyFolderConfig,
        placed: result.placed,
        folderCount: result.entries.length,
        masterSheetId: resolvedMasterSheetId || "",
        masterSheetName: masterSheet?.masterSheetName || "",
        masterSheetLink: masterSheet?.masterSheetLink || "",
        masterSheetStatus: masterSheet?.status || (resolvedMasterSheetId ? "linked" : ""),
        masterSheetCreated: Boolean(masterSheet?.created),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to repair company folder structure.",
      });
    }
  });
}
