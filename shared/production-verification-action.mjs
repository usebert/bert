/**
 * Dedicated production smoke verification Action for Dovecote Manufacturing Ltd.
 * Stable markers — safe to rerun; identifies verification-only workbook rows.
 */

export const PRODUCTION_VERIFICATION_ACTION_ID_PREFIX = "bert-smoke-action-";
export const PRODUCTION_VERIFICATION_ACTION_TITLE = "BERT Verification Action";
export const PRODUCTION_VERIFICATION_ACTION_DESCRIPTION =
  "Automated production Actions workflow verification. Safe to remove.";
export const PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE = "verification";
export const PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE = "production-actions-workflow";
export const PRODUCTION_VERIFICATION_ACTION_MARKER = "verification";
export const PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS = "verification-cleaned";
export const PRODUCTION_VERIFICATION_ACTION_PROGRESS_NOTE =
  "Production smoke verification progress update.";

function trim(value) {
  return String(value ?? "").trim();
}

function normalize(value) {
  return trim(value).toLowerCase();
}

export function extractActionField(record, keys) {
  const normalizedKeys = keys.map((key) => normalize(key).replace(/[^a-z0-9]/g, ""));
  for (const [header, value] of Object.entries(record || {})) {
    const normalizedHeader = normalize(header).replace(/[^a-z0-9]/g, "");
    if (normalizedKeys.some((key) => normalizedHeader === key || normalizedHeader.includes(key))) {
      const text = trim(value);
      if (text) {
        return text;
      }
    }
  }
  return "";
}

function actionField(record, keys) {
  if (!record || typeof record !== "object") {
    return "";
  }
  for (const key of keys) {
    const direct = trim(record[key]);
    if (direct) {
      return direct;
    }
  }
  return extractActionField(record, keys);
}

export function isVerificationActionId(actionId = "") {
  return trim(actionId).startsWith(PRODUCTION_VERIFICATION_ACTION_ID_PREFIX);
}

export function isVerificationAction(record = {}) {
  const actionId = actionField(record, ["id", "Action ID", "actionId"]);
  if (isVerificationActionId(actionId)) {
    return true;
  }

  const status = normalize(actionField(record, ["status", "Status"]));
  if (
    status === PRODUCTION_VERIFICATION_ACTION_MARKER ||
    status === PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS
  ) {
    const auditName = actionField(record, ["auditName", "Source Audit Name", "audit name"]);
    if (normalize(auditName) === normalize(PRODUCTION_VERIFICATION_ACTION_TITLE)) {
      return true;
    }
  }

  const auditId = actionField(record, ["auditId", "Source Audit ID", "audit id"]);
  const sourceAnswer = actionField(record, ["sourceAnswer", "Source Answer", "source answer"]);
  const riskCategory = actionField(record, ["riskCategory", "Risk Category", "risk category"]);
  const correctiveAction = actionField(record, ["correctiveAction", "Corrective Action", "corrective action"]);
  const rootCause = actionField(record, ["rootCause", "Root Cause", "root cause"]);

  if (auditId === PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE) {
    return true;
  }
  if (
    sourceAnswer === PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE &&
    normalize(actionField(record, ["auditName", "Source Audit Name"])) ===
      normalize(PRODUCTION_VERIFICATION_ACTION_TITLE)
  ) {
    return true;
  }
  if (riskCategory === PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE && correctiveAction === PRODUCTION_VERIFICATION_ACTION_MARKER) {
    return true;
  }
  if (rootCause === `${PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE}:${PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE}`) {
    return true;
  }

  const auditName = actionField(record, ["auditName", "Source Audit Name", "audit name"]);
  return normalize(auditName) === normalize(PRODUCTION_VERIFICATION_ACTION_TITLE);
}

export function isActiveVerificationAction(record = {}) {
  if (!isVerificationAction(record)) {
    return false;
  }
  const status = normalize(actionField(record, ["status", "Status"]));
  return (
    status !== PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS &&
    status !== "closed" &&
    status !== "rejected"
  );
}

export function isOperationalAction(record = {}) {
  if (!isVerificationAction(record)) {
    return true;
  }
  const status = normalize(actionField(record, ["status", "Status"]));
  return status === PRODUCTION_VERIFICATION_ACTION_CLEANED_STATUS;
}

export function buildProductionVerificationActionId(runId = Date.now()) {
  return `${PRODUCTION_VERIFICATION_ACTION_ID_PREFIX}${runId}`;
}

export function buildProductionVerificationAction({
  actionId,
  companyFolderId,
  assigneeUserId,
  assigneeName,
  createdByUserId,
  dueDate,
  now = new Date(),
} = {}) {
  const iso = now.toISOString();
  const id = trim(actionId) || buildProductionVerificationActionId(now.getTime());
  const folderId = trim(companyFolderId);
  return {
    id,
    companyId: folderId,
    auditId: PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE,
    auditName: PRODUCTION_VERIFICATION_ACTION_TITLE,
    questionId: PRODUCTION_VERIFICATION_ACTION_MARKER,
    questionText: PRODUCTION_VERIFICATION_ACTION_DESCRIPTION,
    sourceAnswer: PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE,
    severity: "Low",
    status: "Open",
    assignedToUserId: trim(assigneeUserId),
    assignedToName: trim(assigneeName) || trim(assigneeUserId),
    createdByUserId: trim(createdByUserId) || trim(assigneeUserId),
    createdAt: iso,
    updatedAt: iso,
    dueDate: trim(dueDate),
    closedAt: "",
    verifiedByUserId: "",
    verificationNotes: "",
    evidenceLinks: [],
    localEvidenceRefs: [],
    comments: "",
    recurrenceFlag: false,
    rootCause: `${PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE}:${PRODUCTION_VERIFICATION_ACTION_SOURCE_REFERENCE}`,
    correctiveAction: PRODUCTION_VERIFICATION_ACTION_MARKER,
    preventiveAction: "",
    riskCategory: PRODUCTION_VERIFICATION_ACTION_SOURCE_TYPE,
    requiresManagerReview: false,
    syncStatus: "Synced",
  };
}

export function mapWorkbookRowToAction(record = {}, companyFolderId = "") {
  const rowCompanyId = extractActionField(record, ["company id", "company folder id"]) || companyFolderId;
  return {
    id: extractActionField(record, ["action id"]) || "",
    companyId: rowCompanyId,
    auditId: extractActionField(record, ["source audit id", "audit id"]),
    auditName: extractActionField(record, ["source audit name", "audit name"]),
    questionId: extractActionField(record, ["source question id", "question id"]),
    questionText: extractActionField(record, ["source question text", "question text"]),
    sourceAnswer: extractActionField(record, ["source answer", "answer"]),
    severity: extractActionField(record, ["severity"]) || "Low",
    status: extractActionField(record, ["status"]) || "Open",
    assignedToUserId: extractActionField(record, ["assigned to user id", "assigned user id"]),
    assignedToName: extractActionField(record, ["assigned to name", "assigned to"]) || "Unassigned",
    createdByUserId: extractActionField(record, ["created by user id", "created by"]),
    createdAt: extractActionField(record, ["created at"]),
    updatedAt: extractActionField(record, ["updated at"]),
    dueDate: extractActionField(record, ["due date"]),
    closedAt: extractActionField(record, ["closed at"]),
    verifiedByUserId: extractActionField(record, ["verified by user id", "verified by"]),
    verificationNotes: extractActionField(record, ["verification notes"]),
    evidenceLinks: extractActionField(record, ["evidence links"])
      .split(",")
      .map((item) => trim(item))
      .filter(Boolean),
    localEvidenceRefs: extractActionField(record, ["local evidence refs", "local evidence"])
      .split(",")
      .map((item) => trim(item))
      .filter(Boolean),
    comments: extractActionField(record, ["comments"]),
    recurrenceFlag: normalize(extractActionField(record, ["recurrence flag"])) === "true",
    rootCause: extractActionField(record, ["root cause"]),
    correctiveAction: extractActionField(record, ["corrective action"]),
    preventiveAction: extractActionField(record, ["preventive action"]),
    riskCategory: extractActionField(record, ["risk category", "category"]) || "Other",
    requiresManagerReview: normalize(extractActionField(record, ["requires manager review"])) === "true",
  };
}

export function listActiveVerificationActions(actions = []) {
  return (Array.isArray(actions) ? actions : []).filter((action) => isActiveVerificationAction(action));
}

export function countActionBaselines(actions = []) {
  const operational = (Array.isArray(actions) ? actions : []).filter((action) => isOperationalAction(action));
  let open = 0;
  let awaitingVerification = 0;
  let closed = 0;
  for (const action of operational) {
    const status = normalize(action.status || action.Status);
    if (status === "closed" || status === "rejected" || status === "complete" || status === "completed") {
      closed += 1;
    } else if (status === "awaiting verification") {
      awaitingVerification += 1;
    } else {
      open += 1;
    }
  }
  return {
    total: operational.length,
    open,
    awaitingVerification,
    closed,
  };
}
