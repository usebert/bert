import { saveCompanyLoginHint } from "../lib/companyLoginHint";
import { getCanonicalCompanyStatus } from "./companyWorkspaceInvite";

export const COMPANY_USER_NO_COMPANY_MESSAGE = "No company is linked to your account.";

export type LinkedCompanyContextInput = {
  companyId?: string;
  companyName?: string;
  masterSheetId?: string;
  registryStatus?: string;
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
    name: String(input.companyName || "").trim() || "Company workspace",
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
  const companyId = String(input.company?.companyId || "").trim();
  const masterSheetId = String(input.company?.masterSheetId || "").trim();
  if (!companyId) {
    return false;
  }

  input.setSelectedFolderId(companyId);
  input.setFolderIdInput?.((current) => current.trim() || companyId);
  if (input.company?.companyName) {
    input.setFolderNameInput?.((current) => current.trim() || input.company?.companyName || "");
  }
  if (masterSheetId) {
    input.setMasterSheetInput?.((current) => current.trim() || masterSheetId);
  }
  input.setFolders((current) => mergeLinkedCompanyFolder(current, input.company || {}));
  if (input.company?.registryStatus) {
    input.setCompanyRegistryStatus?.(
      getCanonicalCompanyStatus({
        status: input.company.registryStatus,
        registryStatus: input.company.registryStatus,
      }),
    );
  }

  const email = String(input.email || "").trim().toLowerCase();
  if (email && masterSheetId) {
    saveCompanyLoginHint({
      email,
      masterSheetId,
      companyFolderId: companyId,
      companyName: input.company?.companyName,
    });
  }

  return true;
}
