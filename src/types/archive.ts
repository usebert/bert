export type ArchiveSectionId =
  | "users"
  | "actions"
  | "ncrs"
  | "incidents"
  | "briefings"
  | "audits"
  | "googleForms"
  | "schedules";

export type ArchiveScreenProps = {
  companyFolderId: string;
  masterSheetId?: string;
  offlineMode?: boolean;
  canManageUsers?: boolean;
  canManageRecords?: boolean;
  onToast?: (title: string, message: string, tone?: "success" | "warning" | "neutral") => void;
};
