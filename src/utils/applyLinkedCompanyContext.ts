import { saveCompanyLoginHint } from "../lib/companyLoginHint";
import { getCanonicalCompanyStatus } from "./companyWorkspaceInvite";
import { validateCompanyDriveIds } from "./googleDriveId";

export const COMPANY_USER_NO_COMPANY_MESSAGE = "No company is linked to your account.";

export type LinkedCompanyContextInput = {
  companyId?: string;
  companyName?: string;
  masterSheetId?: string;
  registryStatus?: string;
  folderPlacementOk?: boolean;
  reasonCode?: string;
  role?: string;
  accessLevel?: string;
  companyAreas?: string[];
};

export type LinkedCompanyFolder = {
  id: string;
  name: string;
  onboardingFormName: string;
  auditFormCount: number;
  responseSheetName: string;
  responseSheetId?: string;
  linkedAt: string;
  onboardingVerified: boolean;
  auditFormsVerified: boolean;
  responseSheetVerified: boolean;
  masterSheetId?: string;
  registryStatus?: string;
};

export function buildLinkedCompanyFolder(input: LinkedCompanyContextInput): LinkedCompanyFolder | null {
  const companyId = String(input.companyId || "").trim();
  const masterSheetId = String(input.masterSheetId || "").trim();
  if (!companyId) {
    return null;
  }
  const registryStatus = getCanonicalCompanyStatus({
    status: input.registryStatus,
    registryStatus: input.registryStatus,
  });
  return {
    id: companyId,
    name: String(input.companyName || "").trim(),
    onboardingFormName: "",
    auditFormCount: 0,
    responseSheetName: "",
    responseSheetId: masterSheetId || undefined,
    linkedAt: new Date().toISOString(),
    onboardingVerified: false,
    auditFormsVerified: false,
    responseSheetVerified: Boolean(masterSheetId),
    masterSheetId: masterSheetId || undefined,
    registryStatus: registryStatus || undefined,
  };
}

export function mergeLinkedCompanyFolder<T extends LinkedCompanyFolder>(
  folders: T[],
  input: LinkedCompanyContextInput,
): T[] {
  const nextFolder = buildLinkedCompanyFolder(input);
  if (!nextFolder) {
    return folders;
  }
  const existing = folders.find((folder) => folder.id === nextFolder.id);
  if (!existing) {
    return [...folders, nextFolder as T];
  }
  return folders.map((folder) =>
    folder.id === nextFolder.id
      ? {
          ...folder,
          name: nextFolder.name || folder.name,
          masterSheetId: nextFolder.masterSheetId || folder.masterSheetId,
          responseSheetId: nextFolder.responseSheetId || folder.responseSheetId,
          responseSheetVerified: Boolean(nextFolder.responseSheetId) || folder.responseSheetVerified,
          registryStatus: nextFolder.registryStatus || folder.registryStatus,
        }
      : folder,
  );
}

export function applyLinkedCompanyContext(input: {
  email: string;
  company?: LinkedCompanyContextInput | null;
  setSelectedFolderId: (value: string) => void;
  setFolders: (updater: (current: LinkedCompanyFolder[]) => LinkedCompanyFolder[]) => void;
  setFolderIdInput?: (updater: (current: string) => string) => void;
  setFolderNameInput?: (updater: (current: string) => string) => void;
  setMasterSheetInput?: (updater: (current: string) => string) => void;
  setCompanyRegistryStatus?: (value: string) => void;
}): boolean {
  if (input.company?.folderPlacementOk === false) {
    return false;
  }
  const companyId = String(input.company?.companyId || "").trim();
  const masterSheetId = String(input.company?.masterSheetId || "").trim();
  const validatedIds = validateCompanyDriveIds({ companyFolderId: companyId, masterSheetId });
  if (!companyId || !validatedIds) {
    return false;
  }

  input.setSelectedFolderId(validatedIds.companyFolderId);
  input.setFolderIdInput?.((current) => current.trim() || validatedIds.companyFolderId);
  if (input.company?.companyName) {
    input.setFolderNameInput?.((current) => current.trim() || input.company?.companyName || "");
  }
  input.setMasterSheetInput?.((current) => current.trim() || validatedIds.masterSheetId);
  input.setFolders((current) =>
    mergeLinkedCompanyFolder(current, {
      ...(input.company || {}),
      companyId: validatedIds.companyFolderId,
      masterSheetId: validatedIds.masterSheetId,
    }),
  );
  if (input.company?.registryStatus) {
    input.setCompanyRegistryStatus?.(
      getCanonicalCompanyStatus({
        status: input.company.registryStatus,
        registryStatus: input.company.registryStatus,
      }),
    );
  }

  const email = String(input.email || "").trim().toLowerCase();
  if (email && validatedIds.masterSheetId) {
    saveCompanyLoginHint({
      email,
      masterSheetId: validatedIds.masterSheetId,
      companyFolderId: validatedIds.companyFolderId,
      companyName: input.company?.companyName,
    });
  }

  return true;
}
