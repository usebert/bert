import {
  canAccessActions,
  canAccessAuditsCentre,
  canAccessBriefings,
  canAccessDocumentControl,
  canAccessDocuments,
  canAccessLoler,
  canAccessSchedulesScreen,
  canAccessUsersInvitesNav,
  canAccessWorkspaceNav,
  canSubmitIncidents,
  canViewIncidents,
  type Role,
} from "../../permissions";
import type { Site } from "../../types/adminScreenProps";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { ControlledCompanyDocument } from "../../types/documents";
import type { ControlledDocument } from "../../types/documentControl";
import type { User } from "../../types/dashboardScreenProps";
import type { IncidentCorrectiveAction, IncidentRecord } from "../../types/incidentsScreenProps";
import type { LolerEquipment } from "../../types/loler";
import type { NonConformanceRecord } from "../../types/nonConformanceScreenProps";
import type { ActionItem, Audit, ManagedSchedule } from "../../types/reportsScreenProps";
import type { AreaAuditMapping } from "../../utils/areaAuditMapping";
import { buildActionListItems } from "../../actions/adapters/actionListAdapter";
import { buildAuditListItems } from "../../audits/adapters/auditListAdapter";
import { buildNcrListItems } from "../../ncrs/adapters/ncrListAdapter";
import { buildSafetyListItems } from "../../safety/adapters/incidentListAdapter";
import {
  SEARCH_TYPE_LABELS,
  type SearchResultGroup,
  type SearchResultItem,
  type SearchResultKind,
  SEARCH_GROUP_ORDER,
} from "../../presentation/searchPresentation";
import { readCachedDocumentControlDocuments } from "../documentControlService";
import { readCachedDocuments } from "../documentService";
import { readCachedLolerEquipment } from "../lolerService";
import type { CompanyMember } from "../companyUserService";

export type GlobalSearchHistoryEntry = {
  id: string;
  auditId: string;
  auditName: string;
  completedAt: string;
  completedBy: string;
  status?: string;
};

export type GlobalSearchSources = {
  role: Role;
  currentUser: User;
  companyFolderId: string;
  actions: ActionItem[];
  audits: Audit[];
  auditHistory: GlobalSearchHistoryEntry[];
  incidents: IncidentRecord[];
  incidentActions: IncidentCorrectiveAction[];
  ncrs: NonConformanceRecord[];
  sites: Site[];
  areaAudits: AreaAuditMapping[];
  managedSchedules: ManagedSchedule[];
  briefingItems: BriefingRecipientRecord[];
  members: CompanyMember[];
  pendingOfflineActionIds?: Set<string>;
};

function tokenize(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function matchesTokens(haystack: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const normalized = haystack.toLowerCase();
  return tokens.every((token) => normalized.includes(token));
}

function splitSiteArea(value: string): { site: string; area: string } {
  const trimmed = value.trim();
  if (trimmed.includes(" / ")) {
    const [site, area] = trimmed.split(" / ", 2);
    return { site: site || trimmed, area: area || "" };
  }
  return { site: trimmed, area: "" };
}

function pushItem(items: SearchResultItem[], item: SearchResultItem) {
  items.push(item);
}

export function buildGlobalSearchIndex(sources: GlobalSearchSources): SearchResultItem[] {
  const items: SearchResultItem[] = [];
  const { role, currentUser, companyFolderId } = sources;

  if (canAccessActions(role)) {
    const actionItems = buildActionListItems({
      actions: sources.actions,
      currentUser,
      pendingOfflineActionIds: sources.pendingOfflineActionIds,
    });
    for (const entry of actionItems) {
      const { site, area } = splitSiteArea(entry.site || entry.area || entry.action.siteArea || "");
      pushItem(items, {
        id: `action-${entry.id}`,
        kind: "action",
        title: entry.title,
        typeLabel: SEARCH_TYPE_LABELS.action,
        status: entry.status,
        site: site || undefined,
        description: [entry.sourceLabel, entry.sourceReference, area, entry.assignee].filter(Boolean).join(" · "),
        navigate: { screen: "actions", actionId: entry.id },
        searchText: [entry.title, entry.description, entry.sourceReference, site, area, entry.assignee, entry.action.auditName]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  if (canAccessAuditsCentre(role)) {
    const auditItems = buildAuditListItems({
      audits: sources.audits,
      drafts: {},
      role,
    });
    for (const entry of auditItems) {
      pushItem(items, {
        id: `audit-${entry.id}`,
        kind: "audit",
        title: entry.name,
        typeLabel: SEARCH_TYPE_LABELS.audit,
        status: entry.status,
        site: entry.site,
        description: [entry.area, entry.assignee, entry.scheduleName, entry.dueLabel].filter(Boolean).join(" · "),
        navigate: { screen: "audits", auditId: entry.id, openAudit: true },
        searchText: [entry.name, entry.site, entry.area, entry.assignee, entry.scheduleName, entry.dueLabel].filter(Boolean).join(" "),
      });
    }

    for (const entry of sources.auditHistory) {
      pushItem(items, {
        id: `completed-audit-${entry.id}`,
        kind: "completed-audit",
        title: entry.auditName,
        typeLabel: SEARCH_TYPE_LABELS["completed-audit"],
        status: entry.status,
        description: [entry.completedBy, entry.completedAt].filter(Boolean).join(" · "),
        navigate: { screen: "results" },
        searchText: [entry.auditName, entry.completedBy, entry.auditId, entry.completedAt].join(" "),
      });
    }
  }

  if (canAccessDocumentControl(role) && companyFolderId) {
    const cached = readCachedDocumentControlDocuments(companyFolderId);
    for (const doc of cached?.documents || []) {
      appendControlledDocument(items, doc);
    }
  }

  if (canAccessDocuments(role) && companyFolderId) {
    const cached = readCachedDocuments(companyFolderId);
    for (const doc of cached?.documents || []) {
      appendLibraryDocument(items, doc);
    }
  }

  if ((canViewIncidents(role) || canSubmitIncidents(role)) && sources.incidents.length > 0) {
    const safetyItems = buildSafetyListItems(sources.incidents, sources.incidentActions);
    for (const entry of safetyItems) {
      const kind: SearchResultKind = entry.type === "Near Miss" ? "near-miss" : "incident";
      pushItem(items, {
        id: `incident-${entry.id}`,
        kind,
        title: entry.reference,
        typeLabel: SEARCH_TYPE_LABELS[kind],
        status: entry.status,
        site: entry.site,
        description: [entry.title, entry.type, entry.reportedBy].filter(Boolean).join(" · "),
        navigate: { screen: "incidents", incidentId: entry.id },
        searchText: [entry.reference, entry.title, entry.site, entry.area, entry.reportedBy, entry.raw.description, entry.raw.location]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  if (canAccessActions(role) && sources.ncrs.length > 0) {
    for (const entry of buildNcrListItems(sources.ncrs)) {
      pushItem(items, {
        id: `ncr-${entry.id}`,
        kind: "ncr",
        title: entry.reference,
        typeLabel: SEARCH_TYPE_LABELS.ncr,
        status: entry.status,
        site: entry.site,
        description: [entry.title, entry.owner, entry.source].filter(Boolean).join(" · "),
        navigate: { screen: "nonConformance", ncrId: entry.id },
        searchText: [entry.reference, entry.title, entry.site, entry.owner, entry.source].filter(Boolean).join(" "),
      });
    }
  }

  if (canAccessLoler(role) && companyFolderId) {
    const cached = readCachedLolerEquipment(companyFolderId);
    for (const equipment of cached?.equipment || []) {
      appendEquipment(items, equipment);
    }
  }

  if (canAccessUsersInvitesNav(role)) {
    for (const member of sources.members) {
      const name = String(member.name || "").trim();
      const email = String(member.email || "").trim();
      if (!name && !email) continue;
      pushItem(items, {
        id: `person-${email || name}`,
        kind: "person",
        title: name || email,
        typeLabel: SEARCH_TYPE_LABELS.person,
        status: String(member.role || member.status || "").trim() || undefined,
        description: email || undefined,
        navigate: { screen: "users" },
        searchText: [name, email, member.role, member.accessLevel, member.companyAreas?.join(" ")].filter(Boolean).join(" "),
      });
    }
  }

  if (canAccessWorkspaceNav(role)) {
    for (const site of sources.sites) {
      if (!site.active) continue;
      pushItem(items, {
        id: `site-${site.id}`,
        kind: "site",
        title: site.name,
        typeLabel: SEARCH_TYPE_LABELS.site,
        status: site.active ? "Active" : "Inactive",
        description: site.code || undefined,
        navigate: { screen: "admin", siteId: site.id },
        searchText: [site.name, site.code].filter(Boolean).join(" "),
      });
    }

    const siteNameById = new Map(sources.sites.map((site) => [site.id, site.name]));
    for (const mapping of sources.areaAudits) {
      if (mapping.status !== "active") continue;
      const areaName = siteNameById.get(mapping.areaId) || "Area";
      pushItem(items, {
        id: `area-${mapping.areaId}`,
        kind: "area",
        title: areaName,
        typeLabel: SEARCH_TYPE_LABELS.area,
        description: mapping.notes || undefined,
        navigate: { screen: "admin", siteId: mapping.areaId },
        searchText: [areaName, mapping.notes].filter(Boolean).join(" "),
      });
    }
  }

  if (canAccessBriefings(role)) {
    const seenBriefings = new Set<string>();
    for (const item of sources.briefingItems) {
      if (seenBriefings.has(item.briefingId)) continue;
      seenBriefings.add(item.briefingId);
      const briefing = item.briefing;
      const title = briefing?.title || "Briefing";
      pushItem(items, {
        id: `briefing-${item.briefingId}`,
        kind: "briefing",
        title,
        typeLabel: SEARCH_TYPE_LABELS.briefing,
        status: item.status,
        description: [briefing?.type, briefing?.priority, item.recipientName].filter(Boolean).join(" · "),
        navigate: { screen: "briefings", briefingId: item.briefingId },
        searchText: [title, briefing?.type, briefing?.priority, item.recipientName, item.briefingId].filter(Boolean).join(" "),
      });
    }
  }

  if (canAccessSchedulesScreen(role)) {
    for (const schedule of sources.managedSchedules) {
      const primaryAudit = schedule.audits[0];
      pushItem(items, {
        id: `schedule-${schedule.id}`,
        kind: "schedule",
        title: schedule.scheduleName || primaryAudit?.auditName || "Schedule",
        typeLabel: SEARCH_TYPE_LABELS.schedule,
        status: schedule.lifecycle,
        description: [primaryAudit?.auditName, schedule.auditors.join(", ")].filter(Boolean).join(" · "),
        navigate: { screen: "schedules", scheduleId: schedule.id },
        searchText: [
          schedule.scheduleName,
          primaryAudit?.auditName,
          schedule.auditors.join(" "),
          schedule.lifecycle,
        ]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  return items;
}

function appendControlledDocument(items: SearchResultItem[], doc: ControlledDocument) {
  pushItem(items, {
    id: `document-${doc.documentId}`,
    kind: "document",
    title: doc.title,
    typeLabel: SEARCH_TYPE_LABELS.document,
    status: doc.documentStatus,
    site: doc.department,
    description: doc.documentNumber,
    navigate: { screen: "documentControl" },
    searchText: [doc.title, doc.documentNumber, doc.keywords, doc.department, doc.primaryStandard, doc.documentType]
      .filter(Boolean)
      .join(" "),
  });
}

function appendLibraryDocument(items: SearchResultItem[], doc: ControlledCompanyDocument) {
  pushItem(items, {
    id: `document-library-${doc.documentId}`,
    kind: "document-library",
    title: doc.title,
    typeLabel: SEARCH_TYPE_LABELS["document-library"],
    status: doc.status,
    site: doc.folderPath,
    description: doc.documentNumber,
    navigate: { screen: "documentDetail", documentId: doc.documentId },
    searchText: [doc.title, doc.documentNumber, doc.description, doc.folderPath, doc.isoClause, doc.department].filter(Boolean).join(" "),
  });
}

function appendEquipment(items: SearchResultItem[], equipment: LolerEquipment) {
  pushItem(items, {
    id: `equipment-${equipment.id}`,
    kind: "equipment",
    title: equipment.equipmentName,
    typeLabel: SEARCH_TYPE_LABELS.equipment,
    status: equipment.complianceStatus,
    site: equipment.siteName || equipment.areaName,
    description: equipment.assetId,
    navigate: { screen: "loler" },
    searchText: [
      equipment.equipmentName,
      equipment.assetId,
      equipment.equipmentType,
      equipment.siteName,
      equipment.areaName,
      equipment.assignedPersonName,
    ]
      .filter(Boolean)
      .join(" "),
  });
}

export function filterSearchResults(items: SearchResultItem[], query: string): SearchResultItem[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return items.slice(0, 50);
  return items.filter((item) => matchesTokens(item.searchText, tokens)).slice(0, 50);
}

export function groupSearchResults(items: SearchResultItem[]): SearchResultGroup[] {
  return SEARCH_GROUP_ORDER.map((group) => ({
    id: group.id,
    label: group.label,
    items: items.filter((item) => group.kinds.includes(item.kind)),
  })).filter((group) => group.items.length > 0);
}
