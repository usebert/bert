/**
 * Standard BERT company Drive folder tree (server-side only).
 * Idempotent: reuses folders by exact name under each parent; never deletes.
 */

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
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${COMPANY_FOLDERS_TAB}!A1:G${rowCount}`,
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
      const masterSheetId = String(req.body?.masterSheetId || "").trim();
      const companyName = String(req.body?.companyName || "").trim();

      if (!companyRootFolderId) {
        return res.status(400).json({ ok: false, error: "Company folder ID is required." });
      }

      await getDriveFile(authed, companyRootFolderId);

      const result = await ensureCompanyFolderStructure(deps, authed, {
        companyName,
        companyRootFolderId,
        masterSheetId,
      });

      if (masterSheetId) {
        await ensureTabsAndColumns(authed, masterSheetId, {
          companyId: companyRootFolderId,
          companyName,
        });
        const config = await getConfig(authed, masterSheetId);
        await updateConfig(authed, masterSheetId, {
          ...config,
          ...result.legacyFolderConfig,
          companyFolderStructureVersion: "1",
          companyFolderStructureCheckedAt: new Date().toISOString(),
        });
      }

      return res.json({
        ok: true,
        folderIds: result.folderIds,
        legacyFolderConfig: result.legacyFolderConfig,
        placed: result.placed,
        folderCount: result.entries.length,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to repair company folder structure.",
      });
    }
  });
}
