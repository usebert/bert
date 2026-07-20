/**
 * Controlled Documents module (ISO 9001) — tab names, columns, folder template, enums.
 * Separate from legacy Document Control (ControlledDocuments tab).
 */

export const DOCUMENTS_TAB = "Documents";
export const DOCUMENT_FOLDERS_TAB = "DocumentFolders";
export const DOCUMENT_MODULE_REVISIONS_TAB = "DocumentRevisions";
export const DOCUMENT_REVIEWS_TAB = "DocumentReviews";
export const DOCUMENT_SETTINGS_TAB = "DocumentSettings";

export const CONTROLLED_DOCUMENTS_DRIVE_ROOT = "Controlled Documents";

export const DOCUMENTS_TAB_COLUMNS = [
  "DocumentID",
  "DocumentNumber",
  "Title",
  "Description",
  "GoogleFileID",
  "GoogleFileName",
  "MimeType",
  "FolderID",
  "FolderPath",
  "CurrentRevision",
  "Status",
  "ISOClause",
  "Department",
  "OwnerUserID",
  "OwnerName",
  "ApproverUserID",
  "ApproverName",
  "IssueDate",
  "LastReviewDate",
  "NextReviewDate",
  "ReviewFrequencyMonths",
  "ReminderDays",
  "CreatedAt",
  "CreatedByUserID",
  "CreatedByName",
  "LastRevisedAt",
  "LastRevisedByUserID",
  "LastRevisedByName",
  "Keywords",
  "Visibility",
  "IsCurrent",
  "Archived",
  "ArchivedAt",
  "ArchivedByUserID",
];

export const DOCUMENT_FOLDERS_TAB_COLUMNS = [
  "FolderRecordID",
  "ParentFolderRecordID",
  "GoogleFolderID",
  "FolderName",
  "FolderPath",
  "FolderType",
  "ISOClause",
  "SortOrder",
  "Active",
  "CreatedAt",
];

export const DOCUMENT_MODULE_REVISIONS_TAB_COLUMNS = [
  "RevisionID",
  "DocumentID",
  "RevisionNumber",
  "GoogleFileID",
  "GoogleFileName",
  "IssueDate",
  "CreatedAt",
  "CreatedByUserID",
  "CreatedByName",
  "ChangeSummary",
  "Status",
  "IsCurrent",
  "ArchivedAt",
];

export const DOCUMENT_REVIEWS_TAB_COLUMNS = [
  "ReviewID",
  "DocumentID",
  "RevisionNumber",
  "ReviewDate",
  "ReviewedByUserID",
  "ReviewedByName",
  "Outcome",
  "Comments",
  "NextReviewDate",
  "CreatedAt",
];

export const DOCUMENT_SETTINGS_TAB_COLUMNS = ["SettingKey", "SettingValue", "UpdatedAt", "UpdatedByUserID"];

export const DOCUMENT_MODULE_REQUIRED_TABS = [
  DOCUMENTS_TAB,
  DOCUMENT_FOLDERS_TAB,
  DOCUMENT_MODULE_REVISIONS_TAB,
  DOCUMENT_REVIEWS_TAB,
  DOCUMENT_SETTINGS_TAB,
];

export const DOCUMENT_STATUSES = ["Draft", "Under Review", "Approved", "Obsolete"];
export const DOCUMENT_VISIBILITY_VALUES = ["All Users", "Managers and Admins", "Admins Only"];

export const DEFAULT_DOCUMENT_SETTINGS = {
  documentsEnabled: "true",
  defaultReviewFrequencyMonths: "12",
  defaultReminderDays: "14",
  allowAuditorDocumentRead: "true",
};

export const MAX_DOCUMENT_FILE_BYTES = 25 * 1024 * 1024;

const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
]);

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export const DOCUMENT_SEARCH_FIELDS = [
  "DocumentNumber",
  "Title",
  "Description",
  "Keywords",
  "ISOClause",
  "Department",
  "OwnerName",
  "FolderPath",
  "Status",
];

function trim(value) {
  return String(value ?? "").trim();
}

export function isAllowedDocumentExtension(fileName) {
  const lower = trim(fileName).toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) {
    return false;
  }
  return ALLOWED_DOCUMENT_EXTENSIONS.has(lower.slice(dot));
}

export function isAllowedDocumentMimeType(mimeType) {
  const normalized = trim(mimeType).toLowerCase();
  if (!normalized) {
    return false;
  }
  return ALLOWED_DOCUMENT_MIME_TYPES.has(normalized);
}

export function buildDocumentId() {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `DOC-${year}-${suffix}`;
}

export function buildRevisionId() {
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `REV-${suffix}`;
}

export function buildFolderRecordId() {
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `FDR-${suffix}`;
}

export function normalizeDocumentStatus(value) {
  const text = trim(value);
  const match = DOCUMENT_STATUSES.find((entry) => entry.toLowerCase() === text.toLowerCase());
  return match || "";
}

export function normalizeDocumentVisibility(value) {
  const text = trim(value);
  const match = DOCUMENT_VISIBILITY_VALUES.find((entry) => entry.toLowerCase() === text.toLowerCase());
  return match || "";
}

export function parseBool(value) {
  const text = trim(value).toLowerCase();
  return text === "true" || text === "yes" || text === "1";
}

export function pickRecordField(record = {}, ...keys) {
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  const lowerKeys = keys.map((key) => trim(key).toLowerCase());
  for (const [header, value] of Object.entries(record)) {
    if (lowerKeys.includes(trim(header).toLowerCase()) && trim(value)) {
      return trim(value);
    }
  }
  return "";
}

export function mapDocumentRecord(record = {}) {
  const documentId = pickRecordField(record, "DocumentID", "DocumentId");
  if (!documentId) {
    return null;
  }
  return {
    documentId,
    documentNumber: pickRecordField(record, "DocumentNumber"),
    title: pickRecordField(record, "Title"),
    description: pickRecordField(record, "Description"),
    googleFileId: pickRecordField(record, "GoogleFileID", "GoogleFileId"),
    googleFileName: pickRecordField(record, "GoogleFileName"),
    mimeType: pickRecordField(record, "MimeType"),
    folderId: pickRecordField(record, "FolderID", "FolderId"),
    folderPath: pickRecordField(record, "FolderPath"),
    currentRevision: pickRecordField(record, "CurrentRevision"),
    status: pickRecordField(record, "Status"),
    isoClause: pickRecordField(record, "ISOClause"),
    department: pickRecordField(record, "Department"),
    ownerUserId: pickRecordField(record, "OwnerUserID", "OwnerUserId"),
    ownerName: pickRecordField(record, "OwnerName"),
    approverUserId: pickRecordField(record, "ApproverUserID", "ApproverUserId"),
    approverName: pickRecordField(record, "ApproverName"),
    issueDate: pickRecordField(record, "IssueDate"),
    lastReviewDate: pickRecordField(record, "LastReviewDate"),
    nextReviewDate: pickRecordField(record, "NextReviewDate"),
    reviewFrequencyMonths: pickRecordField(record, "ReviewFrequencyMonths"),
    reminderDays: pickRecordField(record, "ReminderDays"),
    createdAt: pickRecordField(record, "CreatedAt"),
    createdByUserId: pickRecordField(record, "CreatedByUserID", "CreatedByUserId"),
    createdByName: pickRecordField(record, "CreatedByName"),
    lastRevisedAt: pickRecordField(record, "LastRevisedAt"),
    lastRevisedByUserId: pickRecordField(record, "LastRevisedByUserID", "LastRevisedByUserId"),
    lastRevisedByName: pickRecordField(record, "LastRevisedByName"),
    keywords: pickRecordField(record, "Keywords"),
    visibility: pickRecordField(record, "Visibility"),
    isCurrent: parseBool(pickRecordField(record, "IsCurrent")),
    archived: parseBool(pickRecordField(record, "Archived")),
    archivedAt: pickRecordField(record, "ArchivedAt"),
    archivedByUserId: pickRecordField(record, "ArchivedByUserID", "ArchivedByUserId"),
  };
}

export function mapDocumentFolderRecord(record = {}) {
  const folderRecordId = pickRecordField(record, "FolderRecordID", "FolderRecordId");
  if (!folderRecordId) {
    return null;
  }
  return {
    folderRecordId,
    parentFolderRecordId: pickRecordField(record, "ParentFolderRecordID", "ParentFolderRecordId"),
    googleFolderId: pickRecordField(record, "GoogleFolderID", "GoogleFolderId"),
    folderName: pickRecordField(record, "FolderName"),
    folderPath: pickRecordField(record, "FolderPath"),
    folderType: pickRecordField(record, "FolderType"),
    isoClause: pickRecordField(record, "ISOClause"),
    sortOrder: Number(pickRecordField(record, "SortOrder") || 0),
    active: parseBool(pickRecordField(record, "Active", "active")) || pickRecordField(record, "Active") === "",
    createdAt: pickRecordField(record, "CreatedAt"),
  };
}

export function mapDocumentRevisionRecord(record = {}) {
  const revisionId = pickRecordField(record, "RevisionID", "RevisionId");
  const documentId = pickRecordField(record, "DocumentID", "DocumentId");
  if (!revisionId || !documentId) {
    return null;
  }
  return {
    revisionId,
    documentId,
    revisionNumber: pickRecordField(record, "RevisionNumber", "Revision"),
    googleFileId: pickRecordField(record, "GoogleFileID", "GoogleFileId", "FileId"),
    googleFileName: pickRecordField(record, "GoogleFileName", "FileName"),
    issueDate: pickRecordField(record, "IssueDate"),
    createdAt: pickRecordField(record, "CreatedAt"),
    createdByUserId: pickRecordField(record, "CreatedByUserID", "CreatedByUserId", "CreatedBy"),
    createdByName: pickRecordField(record, "CreatedByName"),
    changeSummary: pickRecordField(record, "ChangeSummary"),
    status: pickRecordField(record, "Status", "RevisionStatus"),
    isCurrent: parseBool(pickRecordField(record, "IsCurrent")),
    archivedAt: pickRecordField(record, "ArchivedAt", "SupersededAt"),
  };
}

export function documentNumberAlreadyUsed(documents = [], documentNumber, excludeDocumentId = "") {
  const target = trim(documentNumber).toLowerCase();
  const exclude = trim(excludeDocumentId);
  if (!target) {
    return false;
  }
  return documents.some((doc) => {
    if (exclude && trim(doc.documentId || doc.DocumentID) === exclude) {
      return false;
    }
    if (doc.archived === true || parseBool(doc.Archived)) {
      return false;
    }
    const number = trim(doc.documentNumber || doc.DocumentNumber).toLowerCase();
    return number === target;
  });
}

export function documentMatchesSearch(doc, query) {
  const needle = trim(query).toLowerCase();
  if (!needle) {
    return true;
  }
  for (const field of DOCUMENT_SEARCH_FIELDS) {
    const value = trim(doc[field] || doc[field.charAt(0).toLowerCase() + field.slice(1)] || "");
    if (value.toLowerCase().includes(needle)) {
      return true;
    }
  }
  return false;
}

export function actorCanViewDocument(doc, actor, settings = {}) {
  if (!doc) {
    return false;
  }
  if (doc.archived) {
    return false;
  }
  const role = trim(actor?.role);
  const visibility = normalizeDocumentVisibility(doc.visibility) || "All Users";
  if (visibility === "All Users") {
    return true;
  }
  if (visibility === "Managers and Admins") {
    return role === "Master" || role === "Admin" || role === "Manager";
  }
  if (visibility === "Admins Only") {
    return role === "Master" || role === "Admin";
  }
  if (role === "Auditor" && settings.allowAuditorDocumentRead === false) {
    return false;
  }
  return true;
}

/** Static ISO 9001 folder tree (year subfolder resolved at provision time). */
export function buildIso9001FolderTemplate(currentYear = new Date().getFullYear()) {
  const year = String(currentYear);
  return {
    name: CONTROLLED_DOCUMENTS_DRIVE_ROOT,
    folderType: "root",
    sortOrder: 0,
    children: [
      {
        name: "ISO 9001 Quality Management System",
        folderType: "standard-root",
        sortOrder: 1,
        children: [
          {
            name: "00 QMS Manual, Process Map and Document Register",
            isoClause: "4",
            sortOrder: 0,
            children: [
              { name: "Master Document Register", folderType: "register", sortOrder: 0 },
              { name: "Process Map", sortOrder: 1 },
              { name: "Archived and Obsolete Documents", folderType: "archive", sortOrder: 2 },
            ],
          },
          { name: "01 Context, Scope and Interested Parties - Clause 4", isoClause: "4", sortOrder: 1 },
          {
            name: "02 Leadership, Policy and Responsibilities - Clause 5",
            isoClause: "5",
            sortOrder: 2,
            children: [
              { name: "5.1 Leadership and Commitment", isoClause: "5.1", sortOrder: 0 },
              { name: "5.2 Quality Policy", isoClause: "5.2", sortOrder: 1 },
              { name: "5.3 Roles, Responsibilities and Authorities", isoClause: "5.3", sortOrder: 2 },
            ],
          },
          {
            name: "03 Risks, Opportunities, Objectives and Change - Clause 6",
            isoClause: "6",
            sortOrder: 3,
            children: [
              { name: "6.1 Risks and Opportunities", isoClause: "6.1", sortOrder: 0 },
              { name: "6.2 Quality Objectives", isoClause: "6.2", sortOrder: 1 },
              { name: "6.3 Planning of Changes", isoClause: "6.3", sortOrder: 2 },
            ],
          },
          {
            name: "04 Support - Clause 7",
            isoClause: "7",
            sortOrder: 4,
            children: [
              { name: "Resources", sortOrder: 0 },
              { name: "Competence and Training", sortOrder: 1 },
              { name: "Awareness", sortOrder: 2 },
              { name: "Communication", sortOrder: 3 },
              { name: "Documented Information", sortOrder: 4 },
              { name: "Work Instructions", sortOrder: 5 },
            ],
          },
          {
            name: "05 Operational Planning and Control - Clause 8",
            isoClause: "8",
            sortOrder: 5,
            children: [
              { name: "Customer Requirements", sortOrder: 0 },
              { name: "Design and Development", sortOrder: 1 },
              { name: "Supplier and Purchasing Controls", sortOrder: 2 },
              { name: "Service Delivery", sortOrder: 3 },
              { name: "Release of Products and Services", sortOrder: 4 },
              { name: "Nonconforming Outputs", sortOrder: 5 },
            ],
          },
          {
            name: "06 Performance Evaluation - Clause 9",
            isoClause: "9",
            sortOrder: 6,
            children: [
              { name: "Monitoring and Measurement", sortOrder: 0 },
              { name: "Customer Satisfaction", sortOrder: 1 },
              { name: "Internal Audits", sortOrder: 2 },
              { name: "Management Review", sortOrder: 3 },
            ],
          },
          { name: "07 Nonconformity and Corrective Action - Clause 10.2", isoClause: "10.2", sortOrder: 7 },
          {
            name: "08 Continual Improvement - Clauses 10.1 and 10.3",
            isoClause: "10",
            sortOrder: 8,
            children: [
              { name: "Improvement Projects", sortOrder: 0 },
              { name: "Improvement Register", sortOrder: 1 },
              { name: "Lessons Learned", sortOrder: 2 },
            ],
          },
          { name: "11 Blank Forms and Templates", folderType: "templates", sortOrder: 9 },
          {
            name: "12 Completed Records",
            folderType: "records-root",
            sortOrder: 10,
            children: [
              {
                name: year,
                folderType: "records-year",
                sortOrder: 0,
                children: [
                  { name: "Audits", sortOrder: 0 },
                  { name: "Calibration and Maintenance", sortOrder: 1 },
                  { name: "Customer Complaints", sortOrder: 2 },
                  { name: "Inspections", sortOrder: 3 },
                  { name: "Management Reviews", sortOrder: 4 },
                  { name: "Nonconformities and Corrective Actions", sortOrder: 5 },
                  { name: "Operational Records", sortOrder: 6 },
                  { name: "Supplier Evaluations", sortOrder: 7 },
                  { name: "Training", sortOrder: 8 },
                ],
              },
              { name: "Archived Records", folderType: "records-archive", sortOrder: 1 },
            ],
          },
          {
            name: "13 External Documents and Legislation",
            folderType: "external",
            sortOrder: 11,
            children: [
              { name: "Customer Specifications", sortOrder: 0 },
              { name: "Industry Guidance", sortOrder: 1 },
              { name: "Legislation and Standards", sortOrder: 2 },
            ],
          },
        ],
      },
    ],
  };
}

/** Flatten template nodes for verification (expected folder count). */
export function flattenFolderTemplate(node, parentPath = "", sortBase = 0) {
  const entries = [];
  let order = sortBase;
  function walk(current, parentRecordId, pathPrefix) {
    const name = trim(current.name);
    if (!name) {
      return;
    }
    const folderPath = pathPrefix ? `${pathPrefix}/${name}` : name;
    const folderRecordId = buildFolderRecordId();
    const entry = {
      folderRecordId,
      parentFolderRecordId: parentRecordId || "",
      folderName: name,
      folderPath,
      folderType: trim(current.folderType) || "folder",
      isoClause: trim(current.isoClause),
      sortOrder: Number.isFinite(current.sortOrder) ? current.sortOrder : order++,
      children: [],
    };
    entries.push(entry);
    for (const child of current.children || []) {
      walk(child, folderRecordId, folderPath);
    }
  }
  walk(node, "", parentPath);
  return entries;
}

export function countTemplateFolders(template = buildIso9001FolderTemplate()) {
  let count = 0;
  function walk(node) {
    if (trim(node.name)) {
      count += 1;
    }
    for (const child of node.children || []) {
      walk(child);
    }
  }
  walk(template);
  return count;
}
