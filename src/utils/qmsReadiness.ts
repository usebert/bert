import type { AuditFindingRecord } from "../types/complianceLoop";
import type { NonConformanceRecord } from "../types/nonConformanceScreenProps";
import type { ActionItem, HistoryEntry } from "../types/reportsScreenProps";
import type {
  QMSDocument,
  QMSRisk,
  QMSTrainingRecord,
  QmsReadinessSummary,
} from "../types/qms";
import { isOverdue } from "./managerDashboard";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function daysUntil(value: string): number | null {
  const parsed = parseDate(value);
  if (parsed === null) return null;
  return Math.ceil((parsed - Date.now()) / MS_PER_DAY);
}

export function documentNeedsReview(doc: QMSDocument, withinDays = 30): boolean {
  if (doc.status === "Archived") return false;
  const days = daysUntil(doc.reviewDate);
  if (days === null) return false;
  return days <= withinDays;
}

export function isTrainingExpiringSoon(record: QMSTrainingRecord, withinDays = 30): boolean {
  if (record.status === "Expired") return true;
  const days = daysUntil(record.expiry);
  if (days === null) return false;
  return days <= withinDays && days >= 0;
}

export function riskNeedsReview(risk: QMSRisk, withinDays = 30): boolean {
  if (risk.status === "Closed") return false;
  const days = daysUntil(risk.reviewDate);
  if (days === null) return false;
  return days <= withinDays;
}

export function buildQmsReadinessSummary(input: {
  documents: QMSDocument[];
  training: QMSTrainingRecord[];
  nonConformances: NonConformanceRecord[];
  actions: ActionItem[];
  risks: QMSRisk[];
  auditFindings: AuditFindingRecord[];
  history: HistoryEntry[];
}): QmsReadinessSummary {
  const documentsNeedingReview = input.documents.filter((doc) => documentNeedsReview(doc)).length;
  const trainingExpiringSoon = input.training.filter((row) => isTrainingExpiringSoon(row)).length;
  const openNonConformances = input.nonConformances.filter((ncr) => ncr.status !== "Completed").length;
  const overdueCorrectiveActions = input.actions.filter((action) => isOverdue(action)).length;
  const risksNeedingReview = input.risks.filter((risk) => riskNeedsReview(risk)).length;

  const attentionCount =
    documentsNeedingReview +
    trainingExpiringSoon +
    openNonConformances +
    overdueCorrectiveActions +
    risksNeedingReview;

  const hasActivity =
    input.history.length > 0 ||
    input.auditFindings.length > 0 ||
    input.documents.length > 0 ||
    input.training.length > 0;

  let managementReviewStatus: QmsReadinessSummary["managementReviewStatus"] = "not_started";
  let managementReviewDetail = "Add records and complete checks to build your review pack.";

  if (hasActivity) {
    if (attentionCount === 0) {
      managementReviewStatus = "ready";
      managementReviewDetail = "Key registers are up to date. Preview the pack before your review meeting.";
    } else {
      managementReviewStatus = "attention";
      managementReviewDetail = `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention before review.`;
    }
  }

  return {
    documentsNeedingReview,
    trainingExpiringSoon,
    openNonConformances,
    overdueCorrectiveActions,
    risksNeedingReview,
    managementReviewStatus,
    managementReviewDetail,
  };
}

export function newQmsId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
