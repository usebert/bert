export type DocumentStatus = "Draft" | "Under Review" | "Approved" | "Obsolete";
export type DocumentVisibility = "All Users" | "Managers and Admins" | "Admins Only";

export type CompanyDocumentUser = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

export type DocumentFolder = {
  folderRecordId: string;
  parentFolderRecordId: string;
  googleFolderId: string;
  folderName: string;
  folderPath: string;
  folderType: string;
  isoClause: string;
  sortOrder: number;
  active: boolean;
  createdAt: string;
};

export type ControlledCompanyDocument = {
  documentId: string;
  documentNumber: string;
  title: string;
  description: string;
  googleFileId: string;
  googleFileName: string;
  mimeType: string;
  folderId: string;
  folderPath: string;
  currentRevision: string;
  status: string;
  isoClause: string;
  department: string;
  ownerUserId: string;
  ownerName: string;
  approverUserId: string;
  approverName: string;
  issueDate: string;
  lastReviewDate: string;
  nextReviewDate: string;
  reviewFrequencyMonths: string;
  reminderDays: string;
  createdAt: string;
  createdByUserId: string;
  createdByName: string;
  lastRevisedAt: string;
  lastRevisedByUserId: string;
  lastRevisedByName: string;
  keywords: string;
  visibility: string;
  isCurrent: boolean;
  archived: boolean;
  archivedAt: string;
  archivedByUserId: string;
};

export type DocumentRevisionRecord = {
  revisionId: string;
  documentId: string;
  revisionNumber: string;
  googleFileId: string;
  googleFileName: string;
  issueDate: string;
  createdAt: string;
  createdByUserId: string;
  createdByName: string;
  changeSummary: string;
  status: string;
  isCurrent: boolean;
  archivedAt: string;
};

export type MasterDocumentIndexRow = {
  documentNumber: string;
  title: string;
  folder: string;
  revision: string;
  status: string;
  owner: string;
  approver: string;
  isoClause: string;
  department: string;
  issueDate: string;
  lastReview: string;
  nextReview: string;
  reminderDays: string;
  documentId: string;
};

export type DocumentSettings = {
  documentsEnabled: boolean;
  defaultReviewFrequencyMonths: number;
  defaultReminderDays: number;
  allowAuditorDocumentRead: boolean;
};

export type DocumentsListResponse = {
  ok: true;
  documents: ControlledCompanyDocument[];
  folders: DocumentFolder[];
  users: CompanyDocumentUser[];
  settings: DocumentSettings;
  masterIndex: MasterDocumentIndexRow[];
};

export type CreateDocumentInput = {
  documentNumber: string;
  title: string;
  description?: string;
  folderRecordId: string;
  ownerUserId: string;
  approverUserId?: string;
  currentRevision: string;
  status: DocumentStatus;
  isoClause?: string;
  department?: string;
  issueDate?: string;
  nextReviewDate?: string;
  reviewFrequencyMonths?: string;
  reminderDays?: string;
  keywords?: string;
  visibility: DocumentVisibility;
  fileName: string;
  mimeType?: string;
  fileDataUrl: string;
};

export const DOCUMENT_STATUSES: DocumentStatus[] = ["Draft", "Under Review", "Approved", "Obsolete"];
export const DOCUMENT_VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "All Users",
  "Managers and Admins",
  "Admins Only",
];

export const EMPTY_DOCUMENT_FORM: CreateDocumentInput = {
  documentNumber: "",
  title: "",
  description: "",
  folderRecordId: "",
  ownerUserId: "",
  approverUserId: "",
  currentRevision: "1",
  status: "Draft",
  isoClause: "",
  department: "",
  issueDate: "",
  nextReviewDate: "",
  reviewFrequencyMonths: "12",
  reminderDays: "14",
  keywords: "",
  visibility: "All Users",
  fileName: "",
  fileDataUrl: "",
};
