/**
 * Health & Safety overview — pure aggregation for status, attention, and activity.
 * Used by server/health-safety-service.mjs and verify:health-safety.
 */
import { lolerEquipmentComplianceStatus } from "./loler.mjs";
import { isUkOverdue } from "./uk-date-time.mjs";
import { isHighOrVeryHighRisk } from "./risk-assessments.mjs";
import { isOperationalRiskAssessment } from "./production-verification-risk-assessment.mjs";
import { isOperationalIncident } from "./production-verification-incident.mjs";
import {
  isOperationalLolerEquipment,
  isOperationalLolerExamination,
} from "./production-verification-loler.mjs";
import {
  isOperationalCoshhAssessment,
  isOperationalCoshhRegister,
} from "./production-verification-coshh.mjs";

const HIGH_RISK_SEVERITIES = new Set(["fatality", "major incident", "lost time injury"]);
const RIDDOR_DECISION_REQUIRED = new Set(["decision_required", "information_required"]);
const RIDDOR_REPORTABLE = new Set(["confirmed_reportable", "likely_reportable"]);
const CLOSED_RIDDOR_SUBMISSION = new Set(["submitted", "closed"]);
const OPEN_INCIDENT_ACTION = new Set(["open", "in progress", "in_progress"]);

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

function parseIso(value) {
  const parsed = Date.parse(trim(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOpenIncident(incident) {
  return normalize(incident?.status) !== "closed";
}

export function isHighRiskIncident(incident) {
  if (!isOpenIncident(incident)) return false;
  if (normalize(incident?.priority) === "high") return true;
  return HIGH_RISK_SEVERITIES.has(normalize(incident?.severity));
}

export function isIncidentAwaitingInvestigation(incident) {
  return isOpenIncident(incident) && normalize(incident?.status) === "under investigation";
}

export function isRiddorDecisionRequired(record) {
  if (record?.archivedAt) return false;
  return RIDDOR_DECISION_REQUIRED.has(normalize(record?.decisionStatus));
}

export function isRiddorReportableRequiringAction(record, todayKey) {
  if (record?.archivedAt) return false;
  if (!RIDDOR_REPORTABLE.has(normalize(record?.decisionStatus))) return false;
  const submission = normalize(record?.submissionStatus);
  if (submission === "follow_up_required" && record?.followUpDate && record.followUpDate <= todayKey) {
    return true;
  }
  if (!CLOSED_RIDDOR_SUBMISSION.has(submission)) {
    if (record?.followUpRequired && record?.followUpDate && record.followUpDate <= todayKey) {
      return true;
    }
    if (submission === "not_started" || submission === "in_preparation") {
      return true;
    }
  }
  return false;
}

export function isRiddorFollowUpDue(record, todayKey) {
  if (record?.archivedAt) return false;
  if (normalize(record?.submissionStatus) === "closed") return false;
  return Boolean(record?.followUpRequired) && trim(record?.followUpDate) && record.followUpDate <= todayKey;
}

function isOpenIncidentAction(action) {
  return OPEN_INCIDENT_ACTION.has(normalize(action?.status));
}

export function isOverdueIncidentAction(action, todayKey) {
  if (!isOpenIncidentAction(action)) return false;
  const dueDate = trim(action?.dueDate);
  if (!dueDate) return false;
  return isUkOverdue(dueDate) || dueDate < todayKey;
}

export function mapIncidentActionRecord(record = {}) {
  const pick = (...keys) => {
    for (const key of keys) {
      const direct = trim(record[key]);
      if (direct) return direct;
    }
    return "";
  };
  return {
    id: pick("Action ID", "ActionId", "actionId"),
    incidentId: pick("Incident ID", "IncidentId", "incidentId"),
    description: pick("Description", "description"),
    owner: pick("Owner", "owner"),
    dueDate: pick("Due Date", "DueDate", "dueDate"),
    status: pick("Status", "status") || "Open",
    completedAt: pick("Completed At", "CompletedAt", "completedAt"),
    createdAt: pick("Created At", "CreatedAt", "createdAt"),
    updatedAt: pick("Updated At", "UpdatedAt", "updatedAt"),
    createdBy: pick("Created By", "CreatedBy", "createdBy"),
    completedBy: pick("Completed By", "CompletedBy", "completedBy"),
  };
}

export function mapExaminationActivityRecord(record = {}) {
  const pick = (...keys) => {
    for (const key of keys) {
      const direct = trim(record[key]);
      if (direct) return direct;
    }
    return "";
  };
  return {
    id: pick("ExaminationId", "examinationId"),
    equipmentId: pick("EquipmentId", "equipmentId"),
    equipmentName: pick("EquipmentName", "equipmentName"),
    assetId: pick("AssetId", "assetId"),
    recordedAt: pick("RecordedAt", "recordedAt", "UpdatedAt", "updatedAt"),
    recordedBy: pick("RecordedBy", "recordedBy", "ExaminerName", "examinerName"),
    examinationDate: pick("ExaminationDate", "examinationDate"),
  };
}

function incidentSiteLabel(incident) {
  const department = trim(incident?.department);
  if (department.includes(" / ")) {
    const [site, area] = department.split(" / ", 2);
    return { siteName: site, areaName: area };
  }
  return { siteName: trim(incident?.location) || department, areaName: "" };
}

function coshhSiteLabel(item) {
  return { siteId: trim(item?.siteId), siteName: trim(item?.siteId), areaId: trim(item?.areaId), areaName: trim(item?.areaId) };
}

function equipmentSiteLabel(item) {
  return {
    siteId: trim(item?.siteId),
    siteName: trim(item?.siteName) || trim(item?.siteId),
    areaId: trim(item?.areaId),
    areaName: trim(item?.areaName) || trim(item?.areaId),
  };
}

function dedupeAttentionItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = `${item.type}::${item.recordId || item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

const ATTENTION_PRIORITY = {
  risk_assessment_very_high: 0,
  risk_assessment_overdue_high: 1,
  high_risk_incident_investigation: 2,
  risk_assessment_overdue: 3,
  risk_assessment_awaiting_approval: 4,
  riddor_reportable_action: 5,
  riddor_decision: 6,
  equipment_overdue: 7,
  coshh_review_overdue: 8,
  missing_sds: 9,
  risk_assessment_review_due_soon: 10,
  hs_action_overdue: 11,
  risk_assessment_control_action_overdue: 12,
  equipment_due_soon: 13,
  coshh_review_due_soon: 14,
};

function attentionSeverity(priority) {
  return priority <= 4 ? "urgent" : "attention";
}

function riskAssessmentSiteLabel(item) {
  return {
    siteId: trim(item?.siteId),
    siteName: trim(item?.siteName) || trim(item?.siteId),
    areaId: trim(item?.areaId),
    areaName: trim(item?.areaName) || trim(item?.areaId),
  };
}

function legacyAttentionKind(type) {
  switch (type) {
    case "high_risk_incident_investigation":
      return "incident_investigation";
    case "riddor_reportable_action":
    case "riddor_decision":
      return "riddor_decision";
    case "coshh_review_overdue":
    case "coshh_review_due_soon":
      return "coshh_review";
    case "missing_sds":
      return "missing_sds";
    case "equipment_overdue":
    case "equipment_due_soon":
      return "equipment_overdue";
    case "hs_action_overdue":
      return "hs_action_overdue";
    case "risk_assessment_very_high":
    case "risk_assessment_overdue_high":
    case "risk_assessment_overdue":
    case "risk_assessment_awaiting_approval":
    case "risk_assessment_review_due_soon":
    case "risk_assessment_control_action_overdue":
      return "risk_assessment";
    default:
      return type;
  }
}

function toLegacyAttention(item) {
  const navigate = { screen: item.route };
  if (item.type.includes("incident") || item.type === "hs_action_overdue") {
    navigate.incidentId = item.recordId;
  }
  if (item.type.startsWith("riddor")) {
    navigate.riddorId = item.recordId;
  }
  if (item.type.startsWith("coshh") || item.type === "missing_sds") {
    navigate.coshhId = item.recordId;
  }
  if (item.type.startsWith("equipment")) {
    navigate.equipmentId = item.recordId;
  }
  if (item.type.startsWith("risk_assessment")) {
    navigate.riskAssessmentId = item.recordId;
  }
  return {
    id: item.id,
    kind: legacyAttentionKind(item.type),
    title: item.title,
    status: item.severity,
    site: item.siteName || item.siteId || "",
    dueDate: item.dueDate || "",
    navigate,
    rank: item.priority,
  };
}

export function buildHealthSafetyMetrics(input = {}) {
  const todayKey = trim(input.todayKey);
  const incidents = Array.isArray(input.incidents)
    ? input.incidents.filter((item) => isOperationalIncident(item))
    : [];
  const riddor = Array.isArray(input.riddor) ? input.riddor : [];
  const coshh = (Array.isArray(input.coshh) ? input.coshh : []).filter((item) => isOperationalCoshhRegister(item));
  const equipment = Array.isArray(input.equipment)
    ? input.equipment.filter((item) => isOperationalLolerEquipment(item))
    : [];
  const incidentActions = Array.isArray(input.incidentActions) ? input.incidentActions : [];
  const riskAssessments = Array.isArray(input.riskAssessments)
    ? input.riskAssessments.filter((item) => isOperationalRiskAssessment(item))
    : [];
  const incidentById = new Map(incidents.map((item) => [trim(item.id), item]));

  const openIncidents = incidents.filter(isOpenIncident);
  const highRiskIncidents = openIncidents.filter(isHighRiskIncident);
  const incidentsAwaitingInvestigation = openIncidents.filter(isIncidentAwaitingInvestigation);
  const riddorDecisionsRequired = riddor.filter(isRiddorDecisionRequired);
  const openRiddorReports = riddor.filter((item) => normalize(item.submissionStatus) !== "closed" && !item.archivedAt);
  const riddorFollowUpsDue = riddor.filter((item) => isRiddorFollowUpDue(item, todayKey));
  const riddorReportableActionsDue = riddor.filter((item) => isRiddorReportableRequiringAction(item, todayKey));
  const coshhReviewsOverdue = coshh.filter((item) => item.status === "overdue");
  const coshhReviewsDueSoon = coshh.filter((item) => item.status === "review_due");
  const chemicalsMissingSds = coshh.filter((item) => item.status === "missing_sds");
  const coshhAssessmentsDue = coshh.filter((item) => item.status === "assessment_required");
  const equipmentInspectionsOverdue = equipment.filter((item) => lolerEquipmentComplianceStatus(item, todayKey) === "overdue");
  const equipmentInspectionsDueSoon = equipment.filter((item) => lolerEquipmentComplianceStatus(item, todayKey) === "due_soon");
  const equipmentOutOfService = equipment.filter((item) => lolerEquipmentComplianceStatus(item, todayKey) === "out_of_service");

  const overdueIncidentActions = incidentActions.filter((action) => isOverdueIncidentAction(action, todayKey));
  const highPriorityOverdueActions = overdueIncidentActions.filter((action) => {
    const incident = incidentById.get(trim(action.incidentId));
    return incident ? isHighRiskIncident(incident) : false;
  });

  const activeRiskAssessments = riskAssessments.filter((item) => !item.archivedAt && (item.status === "Active" || item.status === "Review Due"));
  const draftRiskAssessments = riskAssessments.filter((item) => !item.archivedAt && item.status === "Draft");
  const awaitingApprovalRiskAssessments = riskAssessments.filter((item) => !item.archivedAt && item.status === "Submitted");
  const reviewDueRiskAssessments = riskAssessments.filter((item) => !item.archivedAt && item.status === "Review Due");
  const overdueRiskAssessments = riskAssessments.filter((item) => !item.archivedAt && item.status === "Overdue");
  const highResidualRiskAssessments = riskAssessments.filter(
    (item) => !item.archivedAt && isHighOrVeryHighRisk(item.highestResidualRiskScore) && item.status !== "Archived" && item.status !== "Superseded",
  );
  const veryHighResidualRiskAssessments = riskAssessments.filter(
    (item) => !item.archivedAt && Number(item.highestResidualRiskScore) >= 17 && item.status !== "Archived" && item.status !== "Superseded",
  );

  return {
    openIncidents: openIncidents.length,
    highRiskIncidents: highRiskIncidents.length,
    incidentsAwaitingInvestigation: incidentsAwaitingInvestigation.length,
    riddorDecisionsRequired: riddorDecisionsRequired.length,
    openRiddorReports: openRiddorReports.length,
    riddorFollowUpsDue: riddorFollowUpsDue.length,
    riddorReportableActionsDue: riddorReportableActionsDue.length,
    coshhReviewsOverdue: coshhReviewsOverdue.length,
    coshhReviewsDueSoon: coshhReviewsDueSoon.length,
    chemicalsMissingSds: chemicalsMissingSds.length,
    coshhAssessmentsDue: coshhAssessmentsDue.length,
    equipmentInspectionsOverdue: equipmentInspectionsOverdue.length,
    equipmentInspectionsDueSoon: equipmentInspectionsDueSoon.length,
    equipmentOutOfService: equipmentOutOfService.length,
    overdueHealthSafetyActions: overdueIncidentActions.length,
    highPriorityOverdueActions: highPriorityOverdueActions.length,
    activeRiskAssessments: activeRiskAssessments.length,
    draftRiskAssessments: draftRiskAssessments.length,
    awaitingApprovalRiskAssessments: awaitingApprovalRiskAssessments.length,
    reviewDueRiskAssessments: reviewDueRiskAssessments.length,
    overdueRiskAssessments: overdueRiskAssessments.length,
    highResidualRiskAssessments: highResidualRiskAssessments.length,
    veryHighResidualRiskAssessments: veryHighResidualRiskAssessments.length,
  };
}

export function buildHealthSafetyAttentionItems(input = {}) {
  const todayKey = trim(input.todayKey);
  const incidents = Array.isArray(input.incidents)
    ? input.incidents.filter((item) => isOperationalIncident(item))
    : [];
  const riddor = Array.isArray(input.riddor) ? input.riddor : [];
  const coshh = (Array.isArray(input.coshh) ? input.coshh : []).filter((item) => isOperationalCoshhRegister(item));
  const equipment = Array.isArray(input.equipment)
    ? input.equipment.filter((item) => isOperationalLolerEquipment(item))
    : [];
  const incidentActions = Array.isArray(input.incidentActions) ? input.incidentActions : [];
  const riskAssessments = Array.isArray(input.riskAssessments)
    ? input.riskAssessments.filter((item) => isOperationalRiskAssessment(item))
    : [];
  const incidentById = new Map(incidents.map((item) => [trim(item.id), item]));

  const items = [];

  for (const assessment of riskAssessments) {
    if (assessment.archivedAt || assessment.status === "Superseded") continue;
    const site = riskAssessmentSiteLabel(assessment);
    const title = trim(assessment.title) || trim(assessment.assessmentNumber) || assessment.id;
    if (Number(assessment.highestResidualRiskScore) >= 17) {
      items.push({
        id: `attention-ra-very-high-${assessment.id}`,
        type: "risk_assessment_very_high",
        title,
        reason: "Risk assessment has Very High residual risk.",
        priority: ATTENTION_PRIORITY.risk_assessment_very_high,
        severity: attentionSeverity(ATTENTION_PRIORITY.risk_assessment_very_high),
        siteId: site.siteId,
        siteName: site.siteName,
        areaId: site.areaId,
        areaName: site.areaName,
        dueDate: trim(assessment.reviewDate),
        route: "riskAssessments",
        recordId: assessment.id,
        actionLabel: "Review assessment",
      });
    }
    if (assessment.status === "Overdue") {
      const priority = isHighOrVeryHighRisk(assessment.highestResidualRiskScore)
        ? ATTENTION_PRIORITY.risk_assessment_overdue_high
        : ATTENTION_PRIORITY.risk_assessment_overdue;
      items.push({
        id: `attention-ra-overdue-${assessment.id}`,
        type: priority === ATTENTION_PRIORITY.risk_assessment_overdue_high ? "risk_assessment_overdue_high" : "risk_assessment_overdue",
        title,
        reason: isHighOrVeryHighRisk(assessment.highestResidualRiskScore)
          ? "Overdue risk assessment with High or Very High residual risk."
          : "Risk assessment review is overdue.",
        priority,
        severity: attentionSeverity(priority),
        siteId: site.siteId,
        siteName: site.siteName,
        areaId: site.areaId,
        areaName: site.areaName,
        dueDate: trim(assessment.reviewDate),
        route: "riskAssessments",
        recordId: assessment.id,
        actionLabel: "Start review",
      });
    }
    if (assessment.status === "Submitted") {
      items.push({
        id: `attention-ra-awaiting-${assessment.id}`,
        type: "risk_assessment_awaiting_approval",
        title,
        reason: "Risk assessment is awaiting approval.",
        priority: ATTENTION_PRIORITY.risk_assessment_awaiting_approval,
        severity: attentionSeverity(ATTENTION_PRIORITY.risk_assessment_awaiting_approval),
        siteId: site.siteId,
        siteName: site.siteName,
        areaId: site.areaId,
        areaName: site.areaName,
        dueDate: "",
        route: "riskAssessments",
        recordId: assessment.id,
        actionLabel: "Review submission",
      });
    }
    if (assessment.status === "Review Due") {
      items.push({
        id: `attention-ra-review-due-${assessment.id}`,
        type: "risk_assessment_review_due_soon",
        title,
        reason: "Risk assessment review is due soon.",
        priority: ATTENTION_PRIORITY.risk_assessment_review_due_soon,
        severity: attentionSeverity(ATTENTION_PRIORITY.risk_assessment_review_due_soon),
        siteId: site.siteId,
        siteName: site.siteName,
        areaId: site.areaId,
        areaName: site.areaName,
        dueDate: trim(assessment.reviewDate),
        route: "riskAssessments",
        recordId: assessment.id,
        actionLabel: "Start review",
      });
    }
    if (isHighOrVeryHighRisk(assessment.highestResidualRiskScore) && assessment.status === "Active") {
      items.push({
        id: `attention-ra-high-residual-${assessment.id}`,
        type: "risk_assessment_very_high",
        title,
        reason: "Active risk assessment has High or Very High residual risk requiring review.",
        priority: ATTENTION_PRIORITY.risk_assessment_very_high,
        severity: attentionSeverity(ATTENTION_PRIORITY.risk_assessment_very_high),
        siteId: site.siteId,
        siteName: site.siteName,
        areaId: site.areaId,
        areaName: site.areaName,
        dueDate: trim(assessment.reviewDate),
        route: "riskAssessments",
        recordId: assessment.id,
        actionLabel: "Review assessment",
      });
    }
    if (Number(assessment.outstandingActions) > 0) {
      items.push({
        id: `attention-ra-control-action-${assessment.id}`,
        type: "risk_assessment_control_action_overdue",
        title,
        reason: "Risk assessment has outstanding control actions.",
        priority: ATTENTION_PRIORITY.risk_assessment_control_action_overdue,
        severity: attentionSeverity(ATTENTION_PRIORITY.risk_assessment_control_action_overdue),
        siteId: site.siteId,
        siteName: site.siteName,
        areaId: site.areaId,
        areaName: site.areaName,
        dueDate: "",
        route: "riskAssessments",
        recordId: assessment.id,
        actionLabel: "Review controls",
      });
    }
  }

  for (const incident of incidents) {
    if (!isHighRiskIncident(incident) || !isIncidentAwaitingInvestigation(incident)) continue;
    const site = incidentSiteLabel(incident);
    items.push({
      id: `attention-incident-hr-${incident.id}`,
      type: "high_risk_incident_investigation",
      title: trim(incident.description).slice(0, 80) || trim(incident.incidentType) || "High-risk incident",
      reason: "High-risk incident is awaiting investigation.",
      priority: ATTENTION_PRIORITY.high_risk_incident_investigation,
      severity: attentionSeverity(ATTENTION_PRIORITY.high_risk_incident_investigation),
      siteId: "",
      siteName: site.siteName,
      areaId: "",
      areaName: site.areaName,
      dueDate: trim(incident.dueDate),
      route: "incidents",
      recordId: incident.id,
      actionLabel: "Review incident",
    });
  }

  for (const record of riddor) {
    if (!isRiddorReportableRequiringAction(record, todayKey)) continue;
    items.push({
      id: `attention-riddor-reportable-${record.id}`,
      type: "riddor_reportable_action",
      title: `RIDDOR reportable case (${record.incidentId || record.id})`,
      reason: "A reportable RIDDOR case needs submission or follow-up action.",
      priority: ATTENTION_PRIORITY.riddor_reportable_action,
      severity: attentionSeverity(ATTENTION_PRIORITY.riddor_reportable_action),
      siteId: "",
      siteName: "",
      areaId: "",
      areaName: "",
      dueDate: trim(record.followUpDate) || trim(record.decisionDate),
      route: "healthSafetyRiddor",
      recordId: record.id,
      actionLabel: "Open RIDDOR record",
    });
  }

  for (const record of riddor) {
    if (!isRiddorDecisionRequired(record)) continue;
    items.push({
      id: `attention-riddor-decision-${record.id}`,
      type: "riddor_decision",
      title: `RIDDOR decision required (${record.incidentId || record.id})`,
      reason: "A RIDDOR decision is required for this incident.",
      priority: ATTENTION_PRIORITY.riddor_decision,
      severity: attentionSeverity(ATTENTION_PRIORITY.riddor_decision),
      siteId: "",
      siteName: "",
      areaId: "",
      areaName: "",
      dueDate: trim(record.followUpDate) || trim(record.decisionDate),
      route: "healthSafetyRiddor",
      recordId: record.id,
      actionLabel: "Complete RIDDOR decision",
    });
  }

  for (const item of equipment) {
    if (lolerEquipmentComplianceStatus(item, todayKey) !== "overdue") continue;
    const site = equipmentSiteLabel(item);
    items.push({
      id: `attention-equipment-overdue-${item.id}`,
      type: "equipment_overdue",
      title: `${trim(item.equipmentName) || trim(item.assetId)} inspection overdue`,
      reason: "Equipment examination is overdue.",
      priority: ATTENTION_PRIORITY.equipment_overdue,
      severity: attentionSeverity(ATTENTION_PRIORITY.equipment_overdue),
      siteId: site.siteId,
      siteName: site.siteName,
      areaId: site.areaId,
      areaName: site.areaName,
      dueDate: trim(item.nextExaminationDueDate),
      route: "loler",
      recordId: item.id,
      actionLabel: "Open equipment",
    });
  }

  for (const item of coshh) {
    if (item.status !== "overdue") continue;
    const site = coshhSiteLabel(item);
    items.push({
      id: `attention-coshh-overdue-${item.id}`,
      type: "coshh_review_overdue",
      title: `${item.productName} review overdue`,
      reason: "COSHH review date has passed.",
      priority: ATTENTION_PRIORITY.coshh_review_overdue,
      severity: attentionSeverity(ATTENTION_PRIORITY.coshh_review_overdue),
      siteId: site.siteId,
      siteName: site.siteName,
      areaId: site.areaId,
      areaName: site.areaName,
      dueDate: trim(item.reviewDate),
      route: "healthSafetyCoshh",
      recordId: item.id,
      actionLabel: "Review COSHH record",
    });
  }

  for (const item of coshh) {
    if (item.status !== "missing_sds") continue;
    const site = coshhSiteLabel(item);
    items.push({
      id: `attention-sds-${item.id}`,
      type: "missing_sds",
      title: `${item.productName} missing SDS`,
      reason: "Safety data sheet is not linked to this chemical.",
      priority: ATTENTION_PRIORITY.missing_sds,
      severity: attentionSeverity(ATTENTION_PRIORITY.missing_sds),
      siteId: site.siteId,
      siteName: site.siteName,
      areaId: site.areaId,
      areaName: site.areaName,
      dueDate: "",
      route: "healthSafetyCoshh",
      recordId: item.id,
      actionLabel: "Add SDS",
    });
  }

  for (const action of incidentActions) {
    if (!isOverdueIncidentAction(action, todayKey)) continue;
    const incident = incidentById.get(trim(action.incidentId));
    const site = incident ? incidentSiteLabel(incident) : { siteName: "", areaName: "" };
    items.push({
      id: `attention-hs-action-${action.id}`,
      type: "hs_action_overdue",
      title: trim(action.description).slice(0, 80) || "Overdue corrective action",
      reason: "Health & Safety corrective action is overdue.",
      priority: ATTENTION_PRIORITY.hs_action_overdue,
      severity: attentionSeverity(ATTENTION_PRIORITY.hs_action_overdue),
      siteId: "",
      siteName: site.siteName,
      areaId: "",
      areaName: site.areaName,
      dueDate: trim(action.dueDate),
      route: "incidents",
      recordId: trim(action.incidentId) || action.id,
      actionLabel: "Review action",
    });
  }

  for (const item of equipment) {
    if (lolerEquipmentComplianceStatus(item, todayKey) !== "due_soon") continue;
    const site = equipmentSiteLabel(item);
    items.push({
      id: `attention-equipment-due-soon-${item.id}`,
      type: "equipment_due_soon",
      title: `${trim(item.equipmentName) || trim(item.assetId)} inspection due soon`,
      reason: "Equipment examination is due within the next 30 days.",
      priority: ATTENTION_PRIORITY.equipment_due_soon,
      severity: attentionSeverity(ATTENTION_PRIORITY.equipment_due_soon),
      siteId: site.siteId,
      siteName: site.siteName,
      areaId: site.areaId,
      areaName: site.areaName,
      dueDate: trim(item.nextExaminationDueDate),
      route: "loler",
      recordId: item.id,
      actionLabel: "Open equipment",
    });
  }

  for (const item of coshh) {
    if (item.status !== "review_due") continue;
    const site = coshhSiteLabel(item);
    items.push({
      id: `attention-coshh-due-soon-${item.id}`,
      type: "coshh_review_due_soon",
      title: `${item.productName} review due soon`,
      reason: "COSHH review is due within the next 30 days.",
      priority: ATTENTION_PRIORITY.coshh_review_due_soon,
      severity: attentionSeverity(ATTENTION_PRIORITY.coshh_review_due_soon),
      siteId: site.siteId,
      siteName: site.siteName,
      areaId: site.areaId,
      areaName: site.areaName,
      dueDate: trim(item.reviewDate),
      route: "healthSafetyCoshh",
      recordId: item.id,
      actionLabel: "Review COSHH record",
    });
  }

  return dedupeAttentionItems(items).sort((left, right) => left.priority - right.priority || left.title.localeCompare(right.title));
}

function buildStatusExplanation(metrics) {
  const parts = [];
  if (metrics.openIncidents > 0) {
    parts.push(`${metrics.openIncidents} open incident${metrics.openIncidents === 1 ? "" : "s"}`);
  }
  if (metrics.highRiskIncidents > 0) {
    parts.push(`${metrics.highRiskIncidents} high-risk incident${metrics.highRiskIncidents === 1 ? "" : "s"}`);
  }
  if (metrics.equipmentInspectionsOverdue > 0) {
    parts.push(`${metrics.equipmentInspectionsOverdue} overdue equipment inspection${metrics.equipmentInspectionsOverdue === 1 ? "" : "s"}`);
  }
  if (metrics.riddorDecisionsRequired > 0) {
    parts.push(`${metrics.riddorDecisionsRequired} RIDDOR decision${metrics.riddorDecisionsRequired === 1 ? "" : "s"} required`);
  }
  if (metrics.coshhReviewsOverdue > 0) {
    parts.push(`${metrics.coshhReviewsOverdue} overdue COSHH review${metrics.coshhReviewsOverdue === 1 ? "" : "s"}`);
  }
  if (metrics.chemicalsMissingSds > 0) {
    parts.push(`${metrics.chemicalsMissingSds} chemical${metrics.chemicalsMissingSds === 1 ? "" : "s"} missing SDS`);
  }
  if (metrics.overdueHealthSafetyActions > 0) {
    parts.push(`${metrics.overdueHealthSafetyActions} overdue corrective action${metrics.overdueHealthSafetyActions === 1 ? "" : "s"}`);
  }
  if (metrics.overdueRiskAssessments > 0) {
    parts.push(`${metrics.overdueRiskAssessments} overdue risk assessment${metrics.overdueRiskAssessments === 1 ? "" : "s"}`);
  }
  if (metrics.awaitingApprovalRiskAssessments > 0) {
    parts.push(`${metrics.awaitingApprovalRiskAssessments} risk assessment${metrics.awaitingApprovalRiskAssessments === 1 ? "" : "s"} awaiting approval`);
  }
  if (metrics.veryHighResidualRiskAssessments > 0) {
    parts.push(`${metrics.veryHighResidualRiskAssessments} risk assessment${metrics.veryHighResidualRiskAssessments === 1 ? "" : "s"} with Very High residual risk`);
  }
  if (parts.length === 0) {
    return "No open Health & Safety issues are recorded in BERT right now.";
  }
  const hasUrgentDrivers =
    metrics.highRiskIncidents > 0 ||
    metrics.equipmentInspectionsOverdue > 0 ||
    metrics.highPriorityOverdueActions > 0 ||
    metrics.veryHighResidualRiskAssessments > 0 ||
    metrics.overdueRiskAssessments > 0;
  if (!hasUrgentDrivers && metrics.openIncidents > 0) {
    return `There are ${metrics.openIncidents} open incident${metrics.openIncidents === 1 ? "" : "s"}, but no high-risk incidents or overdue equipment inspections.`;
  }
  return `There are ${parts.join(", ")}.`;
}

export function buildHealthSafetyStatusSummary(metrics, attentionItems = [], updatedAt = "") {
  const urgentDrivers =
    metrics.highRiskIncidents > 0 ||
    metrics.equipmentInspectionsOverdue > 0 ||
    metrics.highPriorityOverdueActions > 0 ||
    metrics.riddorReportableActionsDue > 0 ||
    metrics.veryHighResidualRiskAssessments > 0 ||
    metrics.overdueRiskAssessments > 0;

  const attentionDrivers =
    metrics.openIncidents > 0 ||
    metrics.riddorDecisionsRequired > 0 ||
    metrics.coshhReviewsOverdue > 0 ||
    metrics.chemicalsMissingSds > 0 ||
    metrics.equipmentInspectionsDueSoon > 0 ||
    metrics.overdueHealthSafetyActions > 0 ||
    metrics.coshhReviewsDueSoon > 0 ||
    metrics.awaitingApprovalRiskAssessments > 0 ||
    metrics.reviewDueRiskAssessments > 0 ||
    metrics.highResidualRiskAssessments > 0;

  let level = "good";
  if (urgentDrivers) level = "urgent";
  else if (attentionDrivers) level = "attention";

  const urgentCount = attentionItems.filter((item) => item.severity === "urgent").length;
  const attentionCount = attentionItems.length;

  return {
    level,
    urgentCount,
    attentionCount,
    explanation: buildStatusExplanation(metrics),
    updatedAt: trim(updatedAt),
  };
}

function pushActivity(target, entry) {
  if (!entry.occurredAt) return;
  target.push(entry);
}

export function buildHealthSafetyRecentActivity(input = {}) {
  const incidents = Array.isArray(input.incidents)
    ? input.incidents.filter((item) => isOperationalIncident(item))
    : [];
  const riddor = Array.isArray(input.riddor) ? input.riddor : [];
  const coshh = (Array.isArray(input.coshh) ? input.coshh : []).filter((item) => isOperationalCoshhRegister(item));
  const assessments = (Array.isArray(input.assessments) ? input.assessments : []).filter((item) =>
    isOperationalCoshhAssessment(item),
  );
  const riskAssessments = Array.isArray(input.riskAssessments)
    ? input.riskAssessments.filter((item) => isOperationalRiskAssessment(item))
    : [];
  const equipment = Array.isArray(input.equipment)
    ? input.equipment.filter((item) => isOperationalLolerEquipment(item))
    : [];
  const examinations = Array.isArray(input.examinations)
    ? input.examinations.filter((item) => isOperationalLolerExamination(item))
    : [];
  const incidentActions = Array.isArray(input.incidentActions) ? input.incidentActions : [];

  const activity = [];

  for (const incident of incidents) {
    const site = incidentSiteLabel(incident);
    pushActivity(activity, {
      id: `activity-incident-created-${incident.id}`,
      type: "incident_created",
      summary: `Incident reported: ${trim(incident.incidentType) || "Incident"}`,
      actorName: trim(incident.reporterName) || trim(incident.createdBy),
      occurredAt: trim(incident.createdAt),
      siteName: site.siteName,
      areaName: site.areaName,
      route: "incidents",
      recordId: incident.id,
    });
    const updatedAt = trim(incident.updatedAt);
    const createdAt = trim(incident.createdAt);
    if (updatedAt && updatedAt !== createdAt && isIncidentAwaitingInvestigation(incident)) {
      pushActivity(activity, {
        id: `activity-incident-investigation-${incident.id}-${updatedAt}`,
        type: "incident_investigation_updated",
        summary: `Investigation updated for incident ${trim(incident.incidentId) || incident.id}`,
        actorName: trim(incident.assignedToName) || trim(incident.assignedTo),
        occurredAt: updatedAt,
        siteName: site.siteName,
        areaName: site.areaName,
        route: "incidents",
        recordId: incident.id,
      });
    }
  }

  for (const record of riddor) {
    pushActivity(activity, {
      id: `activity-riddor-created-${record.id}`,
      type: "riddor_decision_recorded",
      summary: `RIDDOR decision recorded (${record.decisionStatus.replace(/_/g, " ")})`,
      actorName: trim(record.decisionBy) || trim(record.createdBy),
      occurredAt: trim(record.decisionDate) || trim(record.createdAt),
      siteName: "",
      areaName: "",
      route: "healthSafetyRiddor",
      recordId: record.id,
    });
    if (trim(record.submittedAt)) {
      pushActivity(activity, {
        id: `activity-riddor-submitted-${record.id}`,
        type: "riddor_submission_recorded",
        summary: "RIDDOR submission recorded",
        actorName: trim(record.submittedBy),
        occurredAt: trim(record.submittedAt),
        siteName: "",
        areaName: "",
        route: "healthSafetyRiddor",
        recordId: record.id,
      });
    }
    const updatedAt = trim(record.updatedAt);
    const createdAt = trim(record.createdAt);
    if (updatedAt && updatedAt !== createdAt) {
      pushActivity(activity, {
        id: `activity-riddor-updated-${record.id}-${updatedAt}`,
        type: "riddor_decision_recorded",
        summary: "RIDDOR record updated",
        actorName: trim(record.updatedBy),
        occurredAt: updatedAt,
        siteName: "",
        areaName: "",
        route: "healthSafetyRiddor",
        recordId: record.id,
      });
    }
  }

  for (const item of coshh) {
    const site = coshhSiteLabel(item);
    pushActivity(activity, {
      id: `activity-coshh-created-${item.id}`,
      type: "coshh_chemical_added",
      summary: `Chemical added: ${item.productName}`,
      actorName: trim(item.createdBy),
      occurredAt: trim(item.createdAt),
      siteName: site.siteName,
      areaName: site.areaName,
      route: "healthSafetyCoshh",
      recordId: item.id,
    });
    if (trim(item.sdsDocumentId) || trim(item.sdsFileName)) {
      pushActivity(activity, {
        id: `activity-coshh-sds-${item.id}-${trim(item.updatedAt)}`,
        type: "coshh_sds_updated",
        summary: `SDS linked: ${item.productName}`,
        actorName: trim(item.updatedBy),
        occurredAt: trim(item.updatedAt) || trim(item.createdAt),
        siteName: site.siteName,
        areaName: site.areaName,
        route: "healthSafetyCoshh",
        recordId: item.id,
      });
    }
  }

  for (const assessment of assessments) {
    const occurredAt = trim(assessment.approvedAt) || trim(assessment.createdAt);
    pushActivity(activity, {
      id: `activity-coshh-assessment-${assessment.id}`,
      type: trim(assessment.approvedAt) ? "coshh_assessment_approved" : "coshh_assessment_created",
      summary: trim(assessment.approvedAt)
        ? `COSHH assessment approved: ${assessment.assessmentTitle || assessment.id}`
        : `COSHH assessment created: ${assessment.assessmentTitle || assessment.id}`,
      actorName: trim(assessment.approvedBy) || trim(assessment.createdBy),
      occurredAt,
      siteName: "",
      areaName: "",
      route: "healthSafetyCoshh",
      recordId: assessment.coshhId || assessment.id,
    });
  }

  for (const item of equipment) {
    const site = equipmentSiteLabel(item);
    pushActivity(activity, {
      id: `activity-equipment-added-${item.id}`,
      type: "equipment_added",
      summary: `Equipment added: ${trim(item.equipmentName) || trim(item.assetId)}`,
      actorName: trim(item.createdBy),
      occurredAt: trim(item.createdAt),
      siteName: site.siteName,
      areaName: site.areaName,
      route: "loler",
      recordId: item.id,
    });
  }

  for (const assessment of riskAssessments) {
    const site = riskAssessmentSiteLabel(assessment);
    pushActivity(activity, {
      id: `activity-ra-created-${assessment.id}`,
      type: "risk_assessment_created",
      summary: `Risk assessment created: ${trim(assessment.title) || assessment.assessmentNumber}`,
      actorName: trim(assessment.createdBy),
      occurredAt: trim(assessment.createdAt),
      siteName: site.siteName,
      areaName: site.areaName,
      route: "riskAssessments",
      recordId: assessment.id,
    });
    if (trim(assessment.submittedAt)) {
      pushActivity(activity, {
        id: `activity-ra-submitted-${assessment.id}`,
        type: "risk_assessment_submitted",
        summary: `Risk assessment submitted: ${trim(assessment.title) || assessment.assessmentNumber}`,
        actorName: trim(assessment.submittedBy),
        occurredAt: trim(assessment.submittedAt),
        siteName: site.siteName,
        areaName: site.areaName,
        route: "riskAssessments",
        recordId: assessment.id,
      });
    }
    if (trim(assessment.approvedAt)) {
      pushActivity(activity, {
        id: `activity-ra-approved-${assessment.id}`,
        type: "risk_assessment_approved",
        summary: `Risk assessment approved: ${trim(assessment.title) || assessment.assessmentNumber}`,
        actorName: trim(assessment.approvedBy),
        occurredAt: trim(assessment.approvedAt),
        siteName: site.siteName,
        areaName: site.areaName,
        route: "riskAssessments",
        recordId: assessment.id,
      });
    }
  }

  for (const exam of examinations.filter((item) => isOperationalLolerExamination(item))) {
    pushActivity(activity, {
      id: `activity-examination-${exam.id}`,
      type: "equipment_examination_recorded",
      summary: `Examination recorded: ${trim(exam.equipmentName) || trim(exam.assetId)}`,
      actorName: trim(exam.recordedBy),
      occurredAt: trim(exam.recordedAt) || trim(exam.examinationDate),
      siteName: "",
      areaName: "",
      route: "loler",
      recordId: trim(exam.equipmentId),
    });
  }

  for (const action of incidentActions) {
    if (normalize(action.status) !== "complete" || !trim(action.completedAt)) continue;
    const incident = incidents.find((item) => trim(item.id) === trim(action.incidentId));
    const site = incident ? incidentSiteLabel(incident) : { siteName: "", areaName: "" };
    pushActivity(activity, {
      id: `activity-hs-action-closed-${action.id}`,
      type: "hs_action_closed",
      summary: `Corrective action closed: ${trim(action.description).slice(0, 60) || action.id}`,
      actorName: trim(action.completedBy),
      occurredAt: trim(action.completedAt),
      siteName: site.siteName,
      areaName: site.areaName,
      route: "incidents",
      recordId: trim(action.incidentId) || action.id,
    });
  }

  const seen = new Set();
  return activity
    .filter((entry) => {
      if (!entry.occurredAt || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => parseIso(right.occurredAt) - parseIso(left.occurredAt))
    .slice(0, 8);
}

export function buildLegacyHealthSafetySummary(metrics) {
  return {
    openIncidents: metrics.openIncidents,
    highRiskIncidents: metrics.highRiskIncidents,
    riddorDecisionsRequired: metrics.riddorDecisionsRequired,
    openRiddorReports: metrics.openRiddorReports,
    coshhAssessmentsOverdue: metrics.coshhReviewsOverdue + metrics.coshhReviewsDueSoon,
    chemicalsMissingSds: metrics.chemicalsMissingSds,
    equipmentInspectionsOverdue: metrics.equipmentInspectionsOverdue,
    openHealthSafetyActions: metrics.overdueHealthSafetyActions,
    overdueRiskAssessments: metrics.overdueRiskAssessments,
    awaitingApprovalRiskAssessments: metrics.awaitingApprovalRiskAssessments,
    highResidualRiskAssessments: metrics.highResidualRiskAssessments,
  };
}

export function buildHealthSafetyOverviewPayload(input = {}) {
  const updatedAt = trim(input.updatedAt) || new Date().toISOString();
  const metrics = buildHealthSafetyMetrics(input);
  const attentionItems = buildHealthSafetyAttentionItems(input);
  const statusSummary = buildHealthSafetyStatusSummary(metrics, attentionItems, updatedAt);
  const recentActivity = buildHealthSafetyRecentActivity(input);
  const attention = attentionItems.map(toLegacyAttention);

  return {
    ok: true,
    updatedAt,
    statusSummary,
    metrics,
    attentionItems,
    recentActivity,
    summary: buildLegacyHealthSafetySummary(metrics),
    attention,
  };
}
