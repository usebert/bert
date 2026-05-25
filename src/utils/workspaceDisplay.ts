const DEFAULT_APP_DISPLAY_NAME = "bert.";

/** Workspace label for banners and headers — never the product brand unless it is the real company name. */
export function resolveWorkspaceDisplayName(
  selectedFolder: { name: string } | null | undefined,
  appDisplayName: string,
  loginHintCompanyName?: string,
): string {
  if (selectedFolder?.name?.trim()) {
    return selectedFolder.name.trim();
  }
  const hint = loginHintCompanyName?.trim();
  if (hint) {
    return hint;
  }
  const configured = appDisplayName.trim();
  if (configured && configured !== DEFAULT_APP_DISPLAY_NAME) {
    return configured;
  }
  return "your workspace";
}
