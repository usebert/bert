import type { Role } from "../permissions";

export type GoogleFormCopyPlacement = "master" | "company";

export type GoogleFormCopyOptionState = {
  visible: boolean;
  disabled: boolean;
  helperText: string;
  placement: GoogleFormCopyPlacement;
};

const COMPANY_HELPER =
  "Creates a Google Form copy in this company's audit folder. BERT remains the live operational system.";
const MASTER_HELPER =
  "Creates a movable Google Form copy in the backend template library. BERT remains the live operational system.";

export function resolveGoogleFormCopyOptionState(input: {
  role: Role;
  googleConnected: boolean;
  workspaceMapped: boolean;
  formsScopeConnected?: boolean | null;
}): GoogleFormCopyOptionState {
  const visible = input.role === "Master" || input.role === "Admin";
  const placement: GoogleFormCopyPlacement = input.role === "Master" ? "master" : "company";
  const helper =
    placement === "company"
      ? COMPANY_HELPER
      : MASTER_HELPER;

  if (!visible) {
    return { visible: false, disabled: true, helperText: helper, placement };
  }

  if (!input.workspaceMapped) {
    return {
      visible: true,
      disabled: true,
      helperText: "Complete workspace setup before creating Google Form copies.",
      placement,
    };
  }

  if (input.formsScopeConnected === false) {
    return {
      visible: true,
      disabled: true,
      helperText: "Google Forms permission is not connected yet.",
      placement,
    };
  }

  if (!input.googleConnected) {
    return {
      visible: true,
      disabled: true,
      helperText:
        placement === "company"
          ? "Connect Google in Workspace to store Google Form copies in the company audit folder."
          : "Connect Google in Workspace to enable backend Google Form copies.",
      placement,
    };
  }

  return {
    visible: true,
    disabled: false,
    helperText: helper,
    placement,
  };
}

export function isGoogleFormCopyWorkspaceMapped(input: {
  syncState: string;
  companyFolderId?: string;
  masterSheetId?: string;
}): boolean {
  return input.syncState === "Synced" && Boolean(input.companyFolderId?.trim()) && Boolean(input.masterSheetId?.trim());
}
