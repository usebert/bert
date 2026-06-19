/** ISO readiness Drive folder labels (exact names created on provision/repair). */
export const ISO_READINESS_FOLDER_LABELS = {
  setupFolder: "01 Company Setup",
  auditFormsFolder: "02 Audit Forms",
  recordsFolder: "03 Company Records",
  evidenceFolder: "04 Evidence",
  exportsFolder: "05 Exports",
  managementNotesFolder: "06 Management Notes",
} as const;

export type IsoFolderConfigIds = {
  setupFolderId: string;
  auditFormsFolderId: string;
  recordsFolderId: string;
  evidenceFolderId: string;
  exportsFolderId: string;
  managementNotesFolderId: string;
};

export type StoredFolderLinkInputs = {
  folderNameInput?: string;
  folderIdInput?: string;
  auditFormsFolderInput?: string;
  masterSheetInput?: string;
  setupFolderInput?: string;
  recordsFolderInput?: string;
  evidenceFolderInput?: string;
  exportsFolderInput?: string;
  managementNotesFolderInput?: string;
  /** @deprecated migrated from healthSafetyFolderInput */
  healthSafetyFolderInput?: string;
  /** @deprecated migrated from adminNotesFolderInput */
  adminNotesFolderInput?: string;
};

export function migrateStoredFolderLinks(raw: StoredFolderLinkInputs | null): StoredFolderLinkInputs | null {
  if (!raw) {
    return null;
  }
  return {
    ...raw,
    setupFolderInput: raw.setupFolderInput || raw.healthSafetyFolderInput || "",
    managementNotesFolderInput: raw.managementNotesFolderInput || raw.adminNotesFolderInput || "",
  };
}
