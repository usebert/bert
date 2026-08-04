import type { RoutedScreen } from "../types/navigation";
import type { SearchNavigateTarget } from "../presentation/searchPresentation";
import {
  buildActTodayNavigation,
  buildActionSourceLink,
  buildBertRecordLink,
  buildKpiListNavigation,
  enrichOperationalItem,
  enrichOperationalItems,
  mapUrlFilterToActionFilter,
  mapUrlFilterToSafetyTab,
  parseBertRouteSearch,
  searchTargetToRoute,
} from "../../shared/bert-record-navigation.mjs";

export type BertRecordType =
  | "audit"
  | "assigned-check"
  | "action"
  | "incident"
  | "risk-assessment"
  | "briefing"
  | "document"
  | "schedule"
  | "equipment"
  | "inspection"
  | "ncr"
  | "report";

export type BertRecordLink = {
  itemType: BertRecordType | string;
  recordType: BertRecordType | string;
  recordId: string;
  title?: string;
  status?: string;
  dueDate?: string;
  route: string;
  companyFolderId?: string;
  screen: RoutedScreen | string;
  filter?: string;
  actionFilter?: string;
  navigate: SearchNavigateTarget;
  sourceType?: BertRecordType | string;
  sourceId?: string;
  sourceRoute?: string;
  sourceNavigate?: SearchNavigateTarget;
  sourceTitle?: string;
  sourceLabel?: string;
};

export type BuildBertRecordLinkInput = {
  recordType: BertRecordType | string;
  recordId?: string;
  companyFolderId?: string;
  sourceId?: string;
  sourceType?: BertRecordType | string;
  scheduleId?: string;
  templateId?: string;
  title?: string;
  status?: string;
  dueDate?: string;
  filter?: string;
  screen?: RoutedScreen | string;
  sourceTitle?: string;
  sourceScheduleId?: string;
  sourceTemplateId?: string;
};

export {
  buildActTodayNavigation,
  buildActionSourceLink,
  buildBertRecordLink,
  buildKpiListNavigation,
  enrichOperationalItem,
  enrichOperationalItems,
  mapUrlFilterToActionFilter,
  mapUrlFilterToSafetyTab,
  parseBertRouteSearch,
  searchTargetToRoute,
};

export function bertLinkToDashboardTarget(link: BertRecordLink): import("../dashboard/unified/types").DashboardNavTarget {
  if (link.navigate.openAudit && link.navigate.auditId) {
    return {
      kind: "audit",
      auditId: link.navigate.auditId,
      scheduleId: link.navigate.scheduleId,
      route: link.route,
    };
  }
  if (link.recordType === "briefing" && link.navigate.briefingId) {
    return { kind: "briefing", briefingId: link.navigate.briefingId, route: link.route };
  }
  if (link.recordId && link.navigate && Object.keys(link.navigate).some((key) => key.endsWith("Id"))) {
    return { kind: "record", route: link.route, navigate: link.navigate };
  }
  return {
    kind: "screen",
    screen: link.screen as import("../types/navigation").NavItemId,
    actionFilter: link.actionFilter,
    filter: link.filter,
    route: link.route,
  };
}

export function bertNavTargetFromOperationalItem(
  item: Record<string, unknown> & Partial<BertRecordLink>,
  companyFolderId = "",
): import("../dashboard/unified/types").DashboardNavTarget {
  if (item.route && item.navigate) {
    return bertLinkToDashboardTarget({
      itemType: String(item.itemType || item.recordType || ""),
      recordType: String(item.recordType || item.itemType || ""),
      recordId: String(item.recordId || ""),
      route: String(item.route),
      screen: String(item.screen || "dashboard"),
      navigate: item.navigate as SearchNavigateTarget,
      actionFilter: item.actionFilter as string | undefined,
      filter: item.filter as string | undefined,
    });
  }
  const link = buildActTodayNavigation(item, companyFolderId) as BertRecordLink;
  return bertLinkToDashboardTarget(link);
}

export function syncNavigationUrl(route: string, replace = false) {
  if (typeof window === "undefined" || !route) return;
  const next = route.startsWith("/") ? route : `/${route}`;
  if (replace) {
    window.history.replaceState({}, "", next);
    return;
  }
  window.history.pushState({}, "", next);
}

export function applyBertRouteToSearchTarget(parsed: ReturnType<typeof parseBertRouteSearch>): SearchNavigateTarget | null {
  const screen = parsed.screen as RoutedScreen;
  if (!screen) return null;
  const target: SearchNavigateTarget = { screen };
  if (parsed.recordId) {
    if (screen === "actions") target.actionId = parsed.recordId;
    else if (screen === "incidents") target.incidentId = parsed.recordId;
    else if (screen === "briefings") target.briefingId = parsed.recordId;
    else if (screen === "documents" || screen === "documentDetail") target.documentId = parsed.recordId;
    else if (screen === "schedules") target.scheduleId = parsed.recordId;
    else if (screen === "nonConformance") target.ncrId = parsed.recordId;
    else if (screen === "riskAssessments") target.riskAssessmentId = parsed.recordId;
    else if (screen === "audits") {
      target.auditId = parsed.templateId || parsed.recordId;
      target.openAudit = true;
      if (parsed.scheduleId) target.scheduleId = parsed.scheduleId;
    }
  }
  return target;
}
