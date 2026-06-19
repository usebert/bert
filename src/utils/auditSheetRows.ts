import type { Answer, Audit, AuditQuestion, AuditStatus, RiskLevel } from "../types/reportsScreenProps";
import type { EvidenceItem } from "../types/dashboardScreenProps";
import type { AuditFindingRecord, AuditSubmissionSyncPayload } from "../types/complianceLoop";
import type { User } from "../types/dashboardScreenProps";

const CURRENT_SCHEMA_VERSION = "3.0.0";

function riskScore(level: RiskLevel): number {
  switch (level) {
    case "Critical":
      return 100;
    case "High":
      return 75;
    case "Medium":
      return 50;
    default:
      return 25;
  }
}

function maxRiskLevel(levels: RiskLevel[]): RiskLevel {
  const order: RiskLevel[] = ["Low", "Medium", "High", "Critical"];
  return levels.reduce((best, level) => (order.indexOf(level) > order.indexOf(best) ? level : best), "Low" as RiskLevel);
}

function statusLabel(status: AuditStatus): string {
  if (status === "red") return "Failed";
  if (status === "amber") return "Non-conformance";
  return "Passed";
}

export function buildAuditSubmissionBundle(input: {
  audit: Audit;
  areaId: string;
  companyFolderId: string;
  responseMap: Record<string, Answer>;
  noteMap: Record<string, string>;
  evidenceMap: Record<string, EvidenceItem[]>;
  submittedByUser: User;
  completedAt: string;
  signatureDataUrl?: string;
}): {
  outcomeStatus: AuditStatus;
  payload: AuditSubmissionSyncPayload;
  sheetResult: Record<string, string>;
  sheetFindings: Record<string, string>[];
  sheetEvidence: Record<string, string>[];
  sheetSyncLog: Record<string, string>;
} {
  const { audit, areaId, companyFolderId, responseMap, noteMap, evidenceMap, submittedByUser, completedAt, signatureDataUrl } =
    input;
  const answers = Object.values(responseMap);
  const outcomeStatus: AuditStatus = answers.includes("fail")
    ? "red"
    : answers.includes("nc")
      ? "amber"
      : "green";
  const failedQuestions = audit.questions.filter(
    (question) => responseMap[question.id] === "fail" || responseMap[question.id] === "nc",
  );
  const levels = failedQuestions.map(
    (question) => question.riskLevel || (responseMap[question.id] === "fail" ? "Critical" : "High"),
  );
  const totalRiskScore = levels.reduce((sum, level) => sum + riskScore(level), 0);
  const highestRiskLevel = levels.length ? maxRiskLevel(levels) : "Low";
  const numberOfCriticalFindings = levels.filter((level) => level === "Critical").length;
  const numberOfHighFindings = levels.filter((level) => level === "High").length;
  const resultId = `result-${audit.id}-${Date.now()}`;

  const findings: AuditFindingRecord[] = failedQuestions.map((question, index) => {
    const answer = responseMap[question.id] || "fail";
    const riskLevel = question.riskLevel || (answer === "fail" ? "Critical" : "High");
    return {
      id: `finding-${resultId}-${index + 1}`,
      resultId,
      auditId: audit.id,
      companyId: companyFolderId,
      areaId,
      questionId: question.id,
      questionText: question.text,
      answer,
      riskLevel,
      riskCategory: question.riskCategory || "Other",
      autoActionRequired: Boolean(question.autoActionRequired),
      requiresPhotoEvidence: Boolean(question.requiresPhotoEvidence),
      requiresManagerReview: Boolean(question.requiresManagerReview),
      note: noteMap[question.id] || "",
      localEvidenceRefs: (evidenceMap[question.id] || []).map((item) => item.id),
      createdAt: completedAt,
      createdBy: submittedByUser.name,
    };
  });

  const evidenceRecords: Record<string, unknown>[] = [];
  audit.questions.forEach((question) => {
    (evidenceMap[question.id] || []).forEach((item, index) => {
      evidenceRecords.push({
        "Evidence ID": `evidence-${resultId}-${question.id}-${index + 1}`,
        "Company ID": companyFolderId,
        "Audit ID": audit.id,
        "Action ID": "",
        "Finding ID": findings.find((finding) => finding.questionId === question.id)?.id || "",
        "File Name": item.name || `audit-${audit.id}-${question.id}-${index + 1}`,
        "Mime Type": "image/jpeg",
        "Drive File ID": "",
        "Drive Link": "",
        "Local Ref": item.previewUrl || item.id,
        "Created At": completedAt,
        "Updated At": completedAt,
        "Created By": submittedByUser.name,
        "Updated By": submittedByUser.name,
        "Sync Status": "Pending",
        "Sync Attempts": 0,
        "Last Sync Error": "",
        "Remote Row ID": "",
        "Schema Version": CURRENT_SCHEMA_VERSION,
      });
    });
  });

  const answersJson = JSON.stringify({
    auditId: audit.id,
    areaId,
    responses: responseMap,
    notes: noteMap,
    evidenceIds: Object.fromEntries(
      Object.entries(evidenceMap).map(([questionId, items]) => [questionId, items.map((item) => item.id)]),
    ),
  });

  const payload: AuditSubmissionSyncPayload = {
    auditId: audit.id,
    auditName: audit.name,
    areaId,
    companyFolderId,
    resultId,
    completedAt,
    completedBy: submittedByUser.name,
    completedByUserId: submittedByUser.username,
    outcomeStatus,
    signatureDataUrl,
    answersJson,
    totalRiskScore,
    highestRiskLevel,
    criticalFindingsCount: numberOfCriticalFindings,
    highFindingsCount: numberOfHighFindings,
    findings,
    evidenceRecords,
  };

  const sheetResult: Record<string, string> = {
    "Result ID": resultId,
    "Audit ID": audit.id,
    "Area ID": areaId,
    "Company ID": companyFolderId,
    "Audit Name": audit.name,
    "Completed By": submittedByUser.name,
    "Completed At": completedAt,
    Status: statusLabel(outcomeStatus),
    "Total Risk Score": String(totalRiskScore),
    "Highest Risk Level": highestRiskLevel,
    "Critical Findings Count": String(numberOfCriticalFindings),
    "High Findings Count": String(numberOfHighFindings),
    "Answers JSON": answersJson,
    "Signature Ref": signatureDataUrl || "",
    "Created At": completedAt,
    "Updated At": completedAt,
    "Created By": submittedByUser.name,
    "Updated By": submittedByUser.name,
    "Sync Status": "Pending",
    "Sync Attempts": "0",
    "Last Sync Error": "",
    "Remote Row ID": "",
    "Schema Version": CURRENT_SCHEMA_VERSION,
  };

  const sheetFindings = findings.map((finding) => ({
    "Finding ID": finding.id,
    "Result ID": finding.resultId,
    "Audit ID": finding.auditId,
    "Area ID": finding.areaId || areaId,
    "Company ID": finding.companyId,
    "Question ID": finding.questionId,
    "Question Text": finding.questionText,
    Answer: finding.answer,
    "Risk Level": finding.riskLevel,
    "Risk Category": finding.riskCategory,
    "Auto Action Required": String(finding.autoActionRequired),
    "Requires Photo Evidence": String(finding.requiresPhotoEvidence),
    "Requires Manager Review": String(finding.requiresManagerReview),
    Note: finding.note,
    "Local Evidence Refs": finding.localEvidenceRefs.join(", "),
    "Created At": finding.createdAt,
    "Updated At": finding.createdAt,
    "Created By": finding.createdBy,
    "Updated By": finding.createdBy,
    "Sync Status": "Pending",
    "Sync Attempts": "0",
    "Last Sync Error": "",
    "Remote Row ID": "",
    "Schema Version": CURRENT_SCHEMA_VERSION,
  }));

  const sheetEvidence = evidenceRecords as Record<string, string>[];

  const sheetSyncLog: Record<string, string> = {
    "Sync Item ID": `audit-submit-${resultId}`,
    "Company ID": companyFolderId,
    "Entity Type": "auditSubmission",
    "Entity ID": resultId,
    Operation: "Append",
    Status: "Pending",
    "Created At": completedAt,
    "Attempted At": "",
    "Completed At": "",
    "Retry Count": "0",
    Priority: "10",
    "Last Error": "",
    Payload: JSON.stringify({ auditId: audit.id, resultId }),
    "Schema Version": CURRENT_SCHEMA_VERSION,
  };

  return { outcomeStatus, payload, sheetResult, sheetFindings, sheetEvidence, sheetSyncLog };
}

export function parseAuditFindingsFromSheet(
  records: Record<string, string>[],
  companyFolderId: string,
): AuditFindingRecord[] {
  return records
    .map((record, index) => {
      const companyId = String(record["Company ID"] || record.companyId || "").trim();
      if (companyId && companyId !== companyFolderId) {
        return null;
      }
      const id = String(record["Finding ID"] || record.findingId || `finding-row-${index + 1}`).trim();
      const resultId = String(record["Result ID"] || record.resultId || "").trim();
      const auditId = String(record["Audit ID"] || record.auditId || "").trim();
      const questionId = String(record["Question ID"] || record.questionId || "").trim();
      if (!id || !auditId || !questionId) {
        return null;
      }
      return {
        id,
        resultId,
        auditId,
        companyId: companyId || companyFolderId,
        areaId: String(record["Area ID"] || record.areaId || "").trim() || undefined,
        questionId,
        questionText: String(record["Question Text"] || record.questionText || "").trim(),
        answer: String(record.Answer || record.answer || "").trim(),
        riskLevel: (String(record["Risk Level"] || record.riskLevel || "Medium") as AuditFindingRecord["riskLevel"]),
        riskCategory: (String(record["Risk Category"] || record.riskCategory || "Other") as AuditFindingRecord["riskCategory"]),
        autoActionRequired: String(record["Auto Action Required"] || "").toLowerCase() === "true",
        requiresPhotoEvidence: String(record["Requires Photo Evidence"] || "").toLowerCase() === "true",
        requiresManagerReview: String(record["Requires Manager Review"] || "").toLowerCase() === "true",
        note: String(record.Note || record.note || "").trim(),
        localEvidenceRefs: String(record["Local Evidence Refs"] || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        createdAt: String(record["Created At"] || record.createdAt || "").trim(),
        createdBy: String(record["Created By"] || record.createdBy || "").trim(),
      } satisfies AuditFindingRecord;
    })
    .filter(Boolean) as AuditFindingRecord[];
}

export type { AuditQuestion };
