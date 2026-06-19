const DEFAULT_APP_DISPLAY_NAME = "bert.";

/** Workspace label for banners and headers — never localStorage hints or the product brand unless configured. */
export function resolveWorkspaceDisplayName(
  selectedFolder: { name: string } | null | undefined,
  appDisplayName: string,
  resolvedCompanyName?: string,
): string {
  const fromContext = String(resolvedCompanyName || "").trim();
  if (fromContext) {
    return fromContext;
  }
  if (selectedFolder?.name?.trim()) {
    return selectedFolder.name.trim();
  }
  const configured = appDisplayName.trim();
  if (configured && configured !== DEFAULT_APP_DISPLAY_NAME) {
    return configured;
  }
  return "your workspace";
}
