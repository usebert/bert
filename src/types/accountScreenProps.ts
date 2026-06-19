import type { Role } from "../permissions";

export type ThemeMode = "light" | "dark";

export type AccountUser = {
  username: string;
  password: string;
  role: Role;
  name: string;
  email?: string;
};

export type AccountSettingsScreenProps = {
  currentUser: AccountUser;
  accountNameInput: string;
  accountPhotoUrl: string;
  themeMode: ThemeMode;
  companyName: string;
  actingCompanyName?: string;
  slatePrimaryCtaInteract: string;
  onAccountNameChange: (value: string) => void;
  onAccountPhotoChange: (file: File) => void;
  onThemeModeChange: (value: ThemeMode) => void;
  onSave: () => void;
  /** Master is in workspace-setup-only shell (narrow nav). */
  workspaceSetupLimitedShell?: boolean;
  /** Leave setup-only shell and show full Master navigation. */
  onOpenFullAppNavigation?: () => void;
};
