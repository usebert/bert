import {
  canAccessActions,
  canAccessBriefings,
  canAccessCompanyOnboardingNav,
  canAccessCoshh,
  canAccessDocumentControl,
  canAccessLoler,
  canAccessPilotSetup,
  canAccessRiddor,
  canSubmitIncidents,
  canViewIncidents,
  canViewSyncCentre,
  type Role,
} from "../../permissions";
import { buildActionListItems } from "../../actions/adapters/actionListAdapter";
import { buildAuditListItems } from "../../audits/adapters/auditListAdapter";
import { buildNcrListItems } from "../../ncrs/adapters/ncrListAdapter";
import { buildSafetyListItems } from "../../safety/adapters/incidentListAdapter";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { User } from "../../types/dashboardScreenProps";
import type { BriefingRecipientRecord } from "../../types/briefings";
import type { IncidentCorrectiveAction, IncidentRecord } from "../../types/incidentsScreenProps";
import type { NonConformanceRecord } from "../../types/nonConformanceScreenProps";
import type { ActionItem, Audit } from "../../types/reportsScreenProps";
import { briefingRecipientNeedsAction } from "../../utils/briefingActions";
import { isOverdue as isActionOverdue } from "../../utils/managerDashboard";
import { isUkToday } from "../../utils/ukDateTime";
import {
  NOTIFICATION_GROUP_LABELS,
  NOTIFICATION_GROUP_ORDER,
  NOTIFICATION_PRIORITY,
  type BertNotification,
  type BertNotificationSeverity,
  type NotificationGroupId,
} from "../../presentation/notificationPresentation";
import { readCachedDocumentControlDocuments } from "../documentControlService";
import { readCachedCoshhList, readCachedRiddorList } from "../healthSafetyService";
import { readCachedLolerEquipment } from "../lolerService";
import { coshhStatusLabel } from "../../health-safety/adapters/coshhListAdapter";
import { riddorDecisionLabel, riddorSubmissionLabel } from "../../health-safety/adapters/riddorListAdapter";

export type NotificationSources = {
  role: Role;
  currentUser: User;
  companyFolderId: string;
  actions: ActionItem[];
  audits: Audit[];
  drafts: Record<string, AuditDraft>;
  unsyncedAuditIds?: Set<string>;
  incidents: IncidentRecord[];
  incidentActions: IncidentCorrectiveAction[];
  ncrs: NonConformanceRecord[];
  briefingItems: BriefingRecipientRecord[];
  briefingLoading?: boolean;
  pendingSyncCount: number;
  failedSyncCount: number;
  syncCentreWaitingCount: number;
  syncCentreFailedCount: number;
  pendingOnboardingCount?: number;
  godmodeIncompleteCompanySetup?: boolean;
};

function splitSiteArea(value: string): { site: string; area: string } {
  const trimmed = value.trim();
  if (trimmed.includes(" / ")) {
    const [site, area] = trimmed.split(" / ", 2);
    return { site: site || trimmed, area: area || "" };
  }
  return { site: trimmed, area: "" };
}

function severityFromRisk(level?: string): BertNotificationSeverity {
  if (level === "Critical" || level === "Fatality" || level === "Major Incident") return "critical";
  if (level === "High" || level === "Lost Time Injury") return "high";
  if (level === "Medium" || level === "Medical Treatment") return "warning";
  return "info";
}

function groupForNotification(
  type: BertNotification["type"],
  priority: number,
  status?: string,
  severity?: BertNotificationSeverity,
): NotificationGroupId {
  if (type === "onboarding") return "setup";
  if (type === "sync") return "sync";
  if (priority <= NOTIFICATION_PRIORITY.AUDIT_OVERDUE || severity === "critical") return "urgent";
  if (status === "Due today" || status?.toLowerCase().includes("due today")) return "due-today";
  if (status?.toLowerCase().includes("awaiting") || status?.toLowerCase().includes("required")) {
    return "awaiting-review";
  }
  if (priority <= NOTIFICATION_PRIORITY.DUE_TODAY) return "due-today";
  if (priority <= NOTIFICATION_PRIORITY.AWAITING_VERIFICATION) return "awaiting-review";
  return "upcoming";
}

function pushNotification(items: BertNotification[], item: BertNotification) {
  items.push(item);
}

function isAssignedToCurrentUser(action: ActionItem, currentUser: User): boolean {
  const userId = currentUser.username.trim().toLowerCase();
  const userName = currentUser.name.trim().toLowerCase();
  const assigneeId = action.assignedToUserId?.trim().toLowerCase() || "";
  const assigneeName = action.assignedToName?.trim().toLowerCase() || "";
  return Boolean((assigneeId && assigneeId === userId) || (assigneeName && assigneeName === userName));
}

export function buildNotificationIndex(sources: NotificationSources): BertNotification[] {
  const items: BertNotification[] = [];
  const { role, currentUser, companyFolderId } = sources;

  if (sources.syncCentreFailedCount > 0 && canViewSyncCentre(role)) {
    pushNotification(items, {
      key: "sync:failed",
      type: "sync",
      title: `${sources.syncCentreFailedCount} offline submission${sources.syncCentreFailedCount === 1 ? "" : "s"} failed to sync`,
      description: "Open Sync Centre to retry",
      status: "Sync failed",
      severity: "critical",
      destination: { screen: "sync" },
      sourceRecordKey: "sync-failed",
      priority: NOTIFICATION_PRIORITY.SYNC_FAILED,
      group: "sync",
    });
  } else if (sources.syncCentreWaitingCount > 0 && canViewSyncCentre(role)) {
    pushNotification(items, {
      key: "sync:queued",
      type: "sync",
      title: `${sources.syncCentreWaitingCount} submission${sources.syncCentreWaitingCount === 1 ? "" : "s"} awaiting sync`,
      description: "Added to queue — will sync when online",
      status: "Awaiting sync",
      severity: "info",
      destination: { screen: "sync" },
      sourceRecordKey: "sync-queued",
      priority: NOTIFICATION_PRIORITY.SYNC_QUEUED,
      group: "sync",
    });
  }

  if (canViewIncidents(role) || canSubmitIncidents(role)) {
    const safetyItems = buildSafetyListItems(sources.incidents, sources.incidentActions);
    for (const entry of safetyItems) {
      if (entry.raw.status === "Closed") continue;
      const overdue = entry.investigationStatus === "Overdue";
      const needsInvestigation = entry.raw.status === "Under Investigation";
      const isNearMiss = entry.type === "Near Miss";
      const highSeverity = entry.severity === "Fatality" || entry.severity === "Major Incident" || entry.severity === "Lost Time Injury";
      const needsFollowUp = isNearMiss && (entry.status === "Action required" || needsInvestigation);

      if (!overdue && !needsInvestigation && !highSeverity && !needsFollowUp && entry.status !== "Action required") {
        continue;
      }

      let title = entry.title;
      let status: string = entry.status;
      let priority: number = NOTIFICATION_PRIORITY.UPCOMING;
      let severity: BertNotificationSeverity = severityFromRisk(entry.severity);

      if (overdue) {
        title = isNearMiss ? "Near miss follow-up is overdue" : "Incident investigation is overdue";
        status = "Overdue";
        priority = NOTIFICATION_PRIORITY.SAFETY_CRITICAL;
        severity = "critical";
      } else if (highSeverity) {
        title = `Open ${isNearMiss ? "near miss" : "incident"} — ${entry.severity}`;
        status = entry.raw.status;
        priority = NOTIFICATION_PRIORITY.SAFETY_CRITICAL;
      } else if (needsFollowUp) {
        title = "Near miss requires follow-up";
        status = "Follow-up required";
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      } else if (needsInvestigation) {
        title = `${isNearMiss ? "Near miss" : "Incident"} requires investigation`;
        status = "Under investigation";
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      } else if (entry.status === "Action required") {
        title = "Incident corrective action required";
        status = "Action required";
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      }

      pushNotification(items, {
        key: `safety:${entry.id}`,
        type: "safety",
        title,
        description: entry.reference,
        status,
        severity,
        siteName: entry.site,
        areaName: entry.area,
        dueAt: entry.raw.dueDate,
        createdAt: entry.raw.createdAt,
        destination: { screen: "incidents", incidentId: entry.id },
        sourceRecordKey: entry.id,
        priority,
        group: groupForNotification("safety", priority, status, severity),
      });
    }
  }

  const auditItems = buildAuditListItems({
    audits: sources.audits,
    drafts: sources.drafts,
    unsyncedAuditIds: sources.unsyncedAuditIds,
    role,
  });

  for (const entry of auditItems) {
    if (entry.status === "Completed" || entry.status === "Upcoming" || entry.status === "Available") continue;
    const overdue = entry.status === "Overdue";
    const dueToday = entry.status === "Due today";
    const inProgress = entry.status === "In progress";
    if (!overdue && !dueToday && !inProgress) continue;

    const priority = overdue
      ? NOTIFICATION_PRIORITY.AUDIT_OVERDUE
      : dueToday
        ? NOTIFICATION_PRIORITY.DUE_TODAY
        : NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;

    pushNotification(items, {
      key: `audit:${entry.id}`,
      type: "audit",
      title: overdue
        ? `${entry.name} is overdue`
        : dueToday
          ? `${entry.name} is due today`
          : `${entry.name} awaiting completion`,
      description: entry.scheduleName || entry.assignee,
      status: entry.status,
      severity: overdue ? "high" : dueToday ? "warning" : "info",
      siteName: entry.site,
      areaName: entry.area,
      dueAt: entry.dueLabel,
      destination: { screen: "audits", auditId: entry.id, openAudit: true },
      sourceRecordKey: entry.id,
      priority,
      group: groupForNotification("audit", priority, entry.status),
    });
  }

  if (canAccessActions(role)) {
    const actionItems = buildActionListItems({
      actions: sources.actions,
      currentUser,
    });

    for (const entry of actionItems) {
      if (entry.action.status === "Closed") continue;
      const overdue = entry.status === "Overdue" || isActionOverdue(entry.action);
      const dueToday = entry.status === "Due today";
      const awaitingVerification = entry.action.status === "Awaiting Verification";
      const highRisk =
        !overdue &&
        !dueToday &&
        !awaitingVerification &&
        (entry.action.severity === "Critical" || entry.action.severity === "High");
      const assigned = isAssignedToCurrentUser(entry.action, currentUser);

      const assignedOpen =
        assigned && entry.action.status === "Open" && !overdue && !dueToday && !awaitingVerification && !highRisk;

      if (!overdue && !dueToday && !awaitingVerification && !highRisk && !assignedOpen) continue;

      let title = entry.title;
      let status: string = entry.status;
      let priority: number = NOTIFICATION_PRIORITY.UPCOMING;

      if (overdue) {
        title = "Corrective action is overdue";
        status = "Overdue";
        priority = NOTIFICATION_PRIORITY.ACTION_OVERDUE;
      } else if (dueToday) {
        title = "Corrective action due today";
        status = "Due today";
        priority = NOTIFICATION_PRIORITY.DUE_TODAY;
      } else if (awaitingVerification) {
        title = "Corrective action awaiting verification";
        status = "Awaiting verification";
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      } else if (highRisk) {
        title = `${entry.action.severity}-risk action requires attention`;
        status = entry.action.severity;
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      } else if (assigned) {
        title = "Action assigned to you";
        status = entry.status;
        priority = NOTIFICATION_PRIORITY.UPCOMING;
      }

      const { site, area } = splitSiteArea(entry.site || entry.area || entry.action.siteArea || "");

      pushNotification(items, {
        key: `action:${entry.id}`,
        type: "action",
        title,
        description: entry.sourceReference || entry.description,
        status,
        severity: severityFromRisk(entry.action.severity),
        siteName: site,
        areaName: area,
        dueAt: entry.action.dueDate,
        createdAt: entry.action.createdAt,
        destination: { screen: "actions", actionId: entry.id },
        sourceRecordKey: entry.id,
        priority,
        group: groupForNotification("action", priority, status),
      });
    }

    for (const entry of buildNcrListItems(sources.ncrs)) {
      if (entry.raw.status === "Completed") continue;
      const overdue = entry.status === "Overdue";
      const awaitingVerification = entry.status === "Awaiting verification";
      const correctiveRequired = entry.status === "Corrective action required" || entry.status === "Cause analysis required";
      if (!overdue && !awaitingVerification && !correctiveRequired) continue;

      let title = entry.reference;
      let status: string = entry.status;
      let priority: number = NOTIFICATION_PRIORITY.UPCOMING;

      if (overdue) {
        title = `${entry.reference} is overdue`;
        priority = NOTIFICATION_PRIORITY.NCR_OVERDUE;
      } else if (awaitingVerification) {
        title = `${entry.reference} awaiting verification`;
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      } else if (correctiveRequired) {
        title = `${entry.reference} requires corrective action`;
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      }

      pushNotification(items, {
        key: `ncr:${entry.id}`,
        type: "ncr",
        title,
        description: entry.title,
        status,
        severity: entry.severity === "High" ? "high" : "warning",
        siteName: entry.site,
        dueAt: entry.dueDate,
        createdAt: entry.dateRaised,
        destination: { screen: "nonConformance", ncrId: entry.id },
        sourceRecordKey: entry.id,
        priority,
        group: groupForNotification("ncr", priority, status),
      });
    }
  }

  if (canAccessDocumentControl(role) && companyFolderId) {
    const cached = readCachedDocumentControlDocuments(companyFolderId);
    for (const doc of cached?.documents || []) {
      if (doc.documentStatus === "archived" || doc.documentStatus === "superseded") continue;
      let title: string | null = null;
      let status: string | null = null;
      let priority: number = NOTIFICATION_PRIORITY.DOCUMENT_REVIEW;

      if (doc.documentStatus === "awaiting_approval") {
        title = `${doc.title} awaiting approval`;
        status = "Awaiting approval";
        priority = NOTIFICATION_PRIORITY.AWAITING_VERIFICATION;
      } else if (doc.reviewStatus === "review_overdue") {
        title = `${doc.title} review is overdue`;
        status = "Review overdue";
        priority = NOTIFICATION_PRIORITY.NCR_OVERDUE;
      } else if (doc.reviewStatus === "review_due_soon") {
        title = `${doc.title} due for review`;
        status = "Review due soon";
        priority = NOTIFICATION_PRIORITY.DOCUMENT_REVIEW;
      }

      if (!title || !status) continue;

      pushNotification(items, {
        key: `document:${doc.documentId}`,
        type: "document",
        title,
        description: doc.documentNumber,
        status,
        severity: status.includes("overdue") ? "high" : "warning",
        siteName: doc.department,
        dueAt: doc.nextReviewDate,
        destination: { screen: "documentControl" },
        sourceRecordKey: doc.documentId,
        priority,
        group: groupForNotification("document", priority, status),
      });
    }
  }

  if (canAccessBriefings(role)) {
    const seen = new Set<string>();
    for (const item of sources.briefingItems) {
      if (!briefingRecipientNeedsAction(item)) continue;
      if (seen.has(item.briefingId)) continue;
      seen.add(item.briefingId);

      const briefing = item.briefing;
      const requiresSignature = briefing?.requiresSignature;
      const overdue = item.overdue || item.status === "Overdue";
      const dueToday = Boolean(briefing?.dueDate && isUkToday(briefing.dueDate));
      const title = briefing?.title || "Briefing";

      let status = "Awaiting signature";
      let priority: number = NOTIFICATION_PRIORITY.BRIEFING_MANDATORY;
      if (requiresSignature) {
        status = overdue ? "Overdue" : dueToday ? "Due today" : "Awaiting signature";
      } else if (briefing?.requiresAcknowledgement) {
        status = "Awaiting acknowledgement";
      } else if (briefing?.requiresRead) {
        status = "Awaiting read";
      }

      if (overdue) priority = NOTIFICATION_PRIORITY.ACTION_OVERDUE;
      else if (dueToday) priority = NOTIFICATION_PRIORITY.DUE_TODAY;

      pushNotification(items, {
        key: `briefing:${item.briefingId}`,
        type: "briefing",
        title: overdue
          ? `Mandatory briefing overdue — ${title}`
          : dueToday
            ? `Briefing due today — ${title}`
            : requiresSignature
              ? `Mandatory briefing awaiting signature — ${title}`
              : `Briefing requires your attention — ${title}`,
        description: briefing?.type,
        status,
        severity: overdue ? "high" : requiresSignature ? "warning" : "info",
        dueAt: briefing?.dueDate,
        destination: { screen: "briefings", briefingId: item.briefingId },
        sourceRecordKey: item.briefingId,
        priority,
        group: groupForNotification("briefing", priority, status),
      });
    }
  }

  if (canAccessLoler(role) && companyFolderId) {
    const cached = readCachedLolerEquipment(companyFolderId);
    for (const equipment of cached?.equipment || []) {
      if (equipment.status === "archived" || equipment.complianceStatus === "archived") continue;
      const overdue = equipment.complianceStatus === "overdue";
      const dueSoon = equipment.complianceStatus === "due_soon";
      if (!overdue && !dueSoon) continue;

      pushNotification(items, {
        key: `equipment:${equipment.id}`,
        type: "equipment",
        title: overdue
          ? `LOLER inspection overdue — ${equipment.equipmentName}`
          : `LOLER inspection due soon — ${equipment.equipmentName}`,
        description: equipment.assetId,
        status: overdue ? "Overdue" : "Inspection due",
        severity: overdue ? "high" : "warning",
        siteName: equipment.siteName,
        areaName: equipment.areaName,
        dueAt: equipment.nextExaminationDueDate,
        destination: { screen: "loler" },
        sourceRecordKey: equipment.id,
        priority: overdue ? NOTIFICATION_PRIORITY.LOLER_OVERDUE : NOTIFICATION_PRIORITY.DUE_TODAY,
        group: groupForNotification("equipment", overdue ? NOTIFICATION_PRIORITY.LOLER_OVERDUE : NOTIFICATION_PRIORITY.DUE_TODAY, overdue ? "Overdue" : "Due today"),
      });
    }
  }

  if (canAccessCoshh(role) && companyFolderId) {
    const cached = readCachedCoshhList(companyFolderId);
    for (const record of cached?.items || []) {
      if (record.status === "archived") continue;
      if (record.status === "overdue" || record.status === "review_due") {
        pushNotification(items, {
          key: `coshh-review:${record.id}`,
          type: "safety",
          title: `COSHH review ${record.status === "overdue" ? "overdue" : "due"} — ${record.productName}`,
          description: coshhStatusLabel(record.status),
          status: coshhStatusLabel(record.status),
          severity: record.status === "overdue" ? "high" : "warning",
          dueAt: record.reviewDate,
          destination: { screen: "healthSafetyCoshh", coshhId: record.id },
          sourceRecordKey: record.id,
          priority: record.status === "overdue" ? NOTIFICATION_PRIORITY.NCR_OVERDUE : NOTIFICATION_PRIORITY.DUE_TODAY,
          group: groupForNotification("safety", record.status === "overdue" ? NOTIFICATION_PRIORITY.NCR_OVERDUE : NOTIFICATION_PRIORITY.DUE_TODAY, coshhStatusLabel(record.status)),
        });
      }
      if (record.status === "missing_sds") {
        pushNotification(items, {
          key: `coshh-sds:${record.id}`,
          type: "safety",
          title: `Missing SDS — ${record.productName}`,
          description: record.manufacturer,
          status: "Missing SDS",
          severity: "warning",
          destination: { screen: "healthSafetyCoshh", coshhId: record.id },
          sourceRecordKey: record.id,
          priority: NOTIFICATION_PRIORITY.AWAITING_VERIFICATION,
          group: groupForNotification("safety", NOTIFICATION_PRIORITY.AWAITING_VERIFICATION, "Missing SDS"),
        });
      }
    }
  }

  if (canAccessRiddor(role) && companyFolderId) {
    const cached = readCachedRiddorList(companyFolderId);
    for (const record of cached?.items || []) {
      if (record.archivedAt) continue;
      if (record.decisionStatus === "decision_required" || record.decisionStatus === "information_required") {
        pushNotification(items, {
          key: `riddor-decision:${record.id}`,
          type: "safety",
          title: "RIDDOR decision required",
          description: record.incidentId,
          status: riddorDecisionLabel(record.decisionStatus),
          severity: "high",
          destination: { screen: "healthSafetyRiddor", riddorId: record.id, incidentId: record.incidentId },
          sourceRecordKey: record.id,
          priority: NOTIFICATION_PRIORITY.SAFETY_CRITICAL,
          group: groupForNotification("safety", NOTIFICATION_PRIORITY.SAFETY_CRITICAL, "Decision required"),
        });
      }
      if (record.submissionStatus === "follow_up_required" || (record.followUpRequired && record.followUpDate)) {
        pushNotification(items, {
          key: `riddor-followup:${record.id}`,
          type: "safety",
          title: "RIDDOR follow-up due",
          description: record.incidentId,
          status: riddorSubmissionLabel(record.submissionStatus),
          severity: "warning",
          dueAt: record.followUpDate,
          destination: { screen: "healthSafetyRiddor", riddorId: record.id, incidentId: record.incidentId },
          sourceRecordKey: record.id,
          priority: NOTIFICATION_PRIORITY.AWAITING_VERIFICATION,
          group: groupForNotification("safety", NOTIFICATION_PRIORITY.AWAITING_VERIFICATION, "Follow-up required"),
        });
      }
    }
  }

  if (canAccessCompanyOnboardingNav(role) && (sources.pendingOnboardingCount ?? 0) > 0) {
    const count = sources.pendingOnboardingCount ?? 0;
    pushNotification(items, {
      key: "onboarding:pending",
      type: "onboarding",
      title: `${count} compan${count === 1 ? "y" : "ies"} awaiting onboarding`,
      description: "Finish provisioning before users can sign in",
      status: "Setup required",
      severity: "warning",
      destination: { screen: "onboarding" },
      sourceRecordKey: "onboarding-pending",
      priority: NOTIFICATION_PRIORITY.ONBOARDING,
      group: "setup",
    });
  }

  if (canAccessPilotSetup(role) && sources.godmodeIncompleteCompanySetup) {
    pushNotification(items, {
      key: "onboarding:incomplete-setup",
      type: "onboarding",
      title: "Company workspace setup is incomplete",
      description: "Finish setup to unlock operational screens",
      status: "Setup required",
      severity: "warning",
      destination: { screen: "onboarding" },
      sourceRecordKey: "onboarding-incomplete",
      priority: NOTIFICATION_PRIORITY.ONBOARDING,
      group: "setup",
    });
  }

  return items.sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    const leftDue = Date.parse(left.dueAt || "") || Number.POSITIVE_INFINITY;
    const rightDue = Date.parse(right.dueAt || "") || Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;
    const leftCreated = Date.parse(left.createdAt || "") || 0;
    const rightCreated = Date.parse(right.createdAt || "") || 0;
    return rightCreated - leftCreated;
  });
}

export function filterNotificationsByType(
  notifications: BertNotification[],
  filterId: string,
  availableFilters: Set<string>,
): BertNotification[] {
  if (filterId === "all" || !availableFilters.has(filterId)) return notifications;
  const typeMap: Record<string, BertNotification["type"]> = {
    audits: "audit",
    actions: "action",
    safety: "safety",
    ncrs: "ncr",
    documents: "document",
    equipment: "equipment",
    briefings: "briefing",
    sync: "sync",
  };
  const type = typeMap[filterId];
  if (!type) return notifications;
  return notifications.filter((item) => item.type === type);
}

export function groupNotifications(
  notifications: Array<BertNotification & { isUnread: boolean }>,
): Array<{ id: NotificationGroupId; label: string; items: Array<BertNotification & { isUnread: boolean }> }> {
  return NOTIFICATION_GROUP_ORDER.map((groupId) => ({
    id: groupId,
    label: NOTIFICATION_GROUP_LABELS[groupId],
    items: notifications.filter((item) => item.group === groupId),
  })).filter((group) => group.items.length > 0);
}
