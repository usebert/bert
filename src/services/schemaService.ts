import {
  CONFIG_KEYS,
  CURRENT_SCHEMA_VERSION,
  REQUIRED_COLUMNS,
  REQUIRED_TABS,
  SCHEMA_MIGRATIONS,
  type RequiredTab,
} from "../schema/companySchema";

export type WorkspaceHealthStatus = "Healthy" | "Warning" | "Broken";

export function getExpectedColumns(tab: string) {
  return REQUIRED_COLUMNS[tab as RequiredTab] || [];
}

export function getRequiredTabs() {
  return REQUIRED_TABS;
}

export function getConfigKeys() {
  return CONFIG_KEYS;
}

export function getCurrentSchemaVersion() {
  return CURRENT_SCHEMA_VERSION;
}

export function getSchemaMigrations() {
  return SCHEMA_MIGRATIONS;
}

export function deriveWorkspaceHealth(input: {
  missingTabs?: string[];
  missingColumns?: Record<string, string[]>;
  blockingIssues?: string[];
  warnings?: string[];
}) {
  const blockingCount = input.blockingIssues?.length || input.missingTabs?.length || 0;
  const missingColumnsCount = Object.values(input.missingColumns || {}).reduce((sum, item) => sum + item.length, 0);
  const warningCount = input.warnings?.length || 0;

  if (blockingCount > 0) {
    return "Broken" as WorkspaceHealthStatus;
  }
  if (missingColumnsCount > 0 || warningCount > 0) {
    return "Warning" as WorkspaceHealthStatus;
  }
  return "Healthy" as WorkspaceHealthStatus;
}
