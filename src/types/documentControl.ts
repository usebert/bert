/** Bert Document Control — client-side types (Phase 1). */

export type DocumentStatus =
  | "draft"
  | "awaiting_approval"
  | "current"
  | "superseded"
  | "archived";

export type RevisionStatus =
  | "draft"
  | "awaiting_approval"
  | "current"
  | "superseded"
  | "rejected"
  | "archived";

export type DocumentReviewStatus =
  | "review_overdue"
  | "review_due_soon"
  | "review_current"
  | "";

export type DocumentType =
  | "policy"
  | "procedure"
  | "work_instruction"
  | "form"
  | "manual"
  | "record_template"
  | "other";

export type DocumentStandard = "ISO9001" | "ISO14001" | "ISO45001" | "IMS" | "COMPANY";

export type ControlledDocument = {
  documentId: string;
  documentNumber: string;
  title: string;
  documentType: DocumentType | string;
  department: string;
  ownerPersonId?: string;
  ownerName?: string;
  ownerEmail?: string;
  primaryStandard: DocumentStandard | string;
  clauseReferences: string[];
  keywords?: string;
  currentRevisionId?: string;
  currentRevision?: string;
  documentStatus: DocumentStatus;
  issueDate?: string;
  effectiveDate?: string;
  nextReviewDate?: string;
  approvalRequired?: boolean;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
  archivedAt?: string;
  archivedBy?: string;
  reviewStatus?: DocumentReviewStatus;
};

export type DocumentRevision = {
  revisionId: string;
  documentId: string;
  documentNumber?: string;
  revision: string;
  revisionSequence: number;
  fileId?: string;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  fileSize?: string;
  revisionStatus: RevisionStatus;
  changeSummary?: string;
  preparedBy?: string;
  preparedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  approvedBy?: string;
  approvedAt?: string;
  issueDate?: string;
  effectiveDate?: string;
  supersededAt?: string;
  supersededByRevisionId?: string;
  createdAt?: string;
  createdBy?: string;
  changeLog?: string;
};

export type DocumentControlSummary = {
  current: number;
  awaitingApproval: number;
  drafts: number;
  reviewsDue: number;
  archived: number;
  total: number;
};

export type DocumentControlClauseGroup = {
  clauseCode: string;
  documents: ControlledDocument[];
};

export type DocumentControlIndexRow = {
  documentNumber: string;
  title: string;
  documentType: string;
  department: string;
  owner: string;
  standard: string;
  clauseReferences: string;
  currentRevision: string;
  issueDate: string;
  effectiveDate: string;
  nextReviewDate: string;
  approvalStatus: string;
  documentStatus: string;
  currentFileUrl: string;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
};

export type DocumentFileRef = {
  fileId?: string;
  fileName?: string;
  fileUrl?: string;
  mimeType?: string;
  fileSize?: string;
  fileDataUrl?: string;
};

export type CreateControlledDocumentInput = {
  title: string;
  documentType: DocumentType | string;
  department: string;
  ownerPersonId?: string;
  ownerName?: string;
  ownerEmail?: string;
  primaryStandard: DocumentStandard | string;
  clauseReferences?: string | string[];
  keywords?: string;
  issueDate?: string;
  effectiveDate?: string;
  nextReviewDate?: string;
  changeSummary?: string;
  approvalRequired?: boolean;
  documentNumber?: string;
} & DocumentFileRef;

export type UpdateControlledDocumentInput = Partial<
  Omit<CreateControlledDocumentInput, "documentNumber" | "fileDataUrl">
>;

export type CreateDocumentRevisionInput = {
  changeSummary: string;
  issueDate?: string;
  effectiveDate?: string;
} & DocumentFileRef;

export type RejectDocumentRevisionInput = {
  reason?: string;
};

export type SupersededWarningPayload = {
  title: string;
  body: string;
  revision: string;
  revisionId: string;
  currentRevision?: string;
  currentRevisionId?: string;
  supersededAt?: string;
};

export type DocumentControlDocumentsListResponse = {
  ok: boolean;
  companyFolderId?: string;
  documents?: ControlledDocument[];
  summary?: DocumentControlSummary;
  clauseGroups?: DocumentControlClauseGroup[];
  canManage?: boolean;
  canApprove?: boolean;
  canViewSuperseded?: boolean;
  message?: string;
};

export type DocumentControlDocumentResponse = {
  ok: boolean;
  document?: ControlledDocument;
  currentRevision?: DocumentRevision | null;
  revisions?: DocumentRevision[];
  resolvedRevisionId?: string;
  canManage?: boolean;
  canApprove?: boolean;
  canViewSuperseded?: boolean;
  message?: string;
};

export type DocumentControlIndexResponse = {
  ok: boolean;
  index?: DocumentControlIndexRow[];
  rebuilt?: boolean;
  message?: string;
};

export type DocumentRevisionFileResponse = {
  ok: boolean;
  revision?: DocumentRevision;
  document?: ControlledDocument;
  file?: DocumentFileRef;
  warning?: SupersededWarningPayload;
  code?: string;
  message?: string;
};

export const DOCUMENT_TYPES: DocumentType[] = [
  "policy",
  "procedure",
  "work_instruction",
  "form",
  "manual",
  "record_template",
  "other",
];

export const DOCUMENT_STANDARDS: DocumentStandard[] = [
  "ISO9001",
  "ISO14001",
  "ISO45001",
  "IMS",
  "COMPANY",
];

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  "draft",
  "awaiting_approval",
  "current",
  "superseded",
  "archived",
];

export const EMPTY_DOCUMENT_CONTROL_SUMMARY: DocumentControlSummary = {
  current: 0,
  awaitingApproval: 0,
  drafts: 0,
  reviewsDue: 0,
  archived: 0,
  total: 0,
};
