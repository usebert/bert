import type { ActionItem } from "../types/reportsScreenProps";

export type LiveOpenActionsScope = {
  companyFolderId?: string;
  pendingOfflineActionIds?: ReadonlySet<string>;
};

export function isDemoAction(action: ActionItem): boolean {
  return action.id.startsWith("action-demo-") || action.companyId === "demo-company";
}

export function isOpenActionStatus(status: ActionItem["status"]): boolean {
  return status !== "Closed" && status !== "Rejected";
}

export function matchesLiveActionCompany(action: ActionItem, companyFolderId: string | undefined): boolean {
  if (!companyFolderId) {
    return true;
  }
  const actionCompanyId = String(action.companyId || "").trim();
  if (!actionCompanyId) {
    return true;
  }
  if (actionCompanyId === companyFolderId) {
    return true;
  }
  if (actionCompanyId === "local-company" && companyFolderId) {
    return true;
  }
  return false;
}

export function isLiveOpenAction(action: ActionItem, scope: LiveOpenActionsScope = {}): boolean {
  if (!isOpenActionStatus(action.status)) {
    return false;
  }
  if (isDemoAction(action)) {
    return false;
  }
  if (!matchesLiveActionCompany(action, scope.companyFolderId)) {
    return false;
  }
  if (scope.pendingOfflineActionIds?.has(action.id)) {
    return false;
  }
  return true;
}

export function filterLiveOpenActions(actions: ActionItem[], scope: LiveOpenActionsScope = {}): ActionItem[] {
  return actions.filter((action) => isLiveOpenAction(action, scope));
}

export function countLiveOpenActions(actions: ActionItem[], scope: LiveOpenActionsScope = {}): number {
  return filterLiveOpenActions(actions, scope).length;
}
