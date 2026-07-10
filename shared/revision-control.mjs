/**
 * ISO-style form/audit revision control helpers.
 * Revise = same FormNumber, RevisionNumber++
 * Copy = new FormNumber, RevisionNumber 1, new title required
 */

export const FORM_NUMBER_PREFIX = "BERT-AUD-";

export const REVISION_CONTROL_COLUMNS = [
  "Form Number",
  "Revision Number",
  "Revision ID",
  "Supersedes Revision ID",
  "Superseded By Revision ID",
  "Revision Reason",
  "Copy Reason",
];

export const DUPLICATE_TEMPLATE_TITLE_MESSAGE = "An active audit/form with this title already exists.";
export const COPY_TITLE_REQUIRED_MESSAGE = "Enter a title for the copied form.";
export const COPY_TITLE_CHOOSE_DIFFERENT_MESSAGE = "Choose a different title for the copy.";
export const ARCHIVED_TITLE_WARNING_MESSAGE =
  "A previous archived form already used this title. Choose a clearer title.";

function trim(value) {
  return String(value ?? "").trim();
}

export function normalizeTemplateTitle(value) {
  return trim(value).replace(/\s+/g, " ").toLowerCase();
}

export function titlesMatch(left, right) {
  const a = normalizeTemplateTitle(left);
  const b = normalizeTemplateTitle(right);
  return Boolean(a) && a === b;
}

export function parseFormNumberSequence(formNumber) {
  const match = trim(formNumber).match(/^BERT-AUD-(\d+)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function formatFormNumber(sequence) {
  return `${FORM_NUMBER_PREFIX}${String(sequence).padStart(3, "0")}`;
}

export function nextFormNumberFromRecords(records = []) {
  let max = 0;
  for (const record of records) {
    const parsed = parseFormNumberSequence(
      record.form_number || record.formNumber || record["Form Number"] || record.FormNumber,
    );
    if (parsed !== null) {
      max = Math.max(max, parsed);
    }
  }
  return formatFormNumber(max + 1);
}

export function normalizeRevisionNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

export function isActiveTemplateStatus(status) {
  const normalized = trim(status).toLowerCase();
  return !normalized || normalized === "active" || normalized === "draft";
}

export function isArchivedOrSupersededStatus(status) {
  const normalized = trim(status).toLowerCase();
  return (
    normalized === "archived" ||
    normalized === "superseded" ||
    normalized === "inactive" ||
    normalized === "obsolete"
  );
}

/**
 * Validate a title for create/copy (must be unique among active templates).
 * For revise of same FormNumber, same title is allowed.
 */
export function validateTemplateTitle(input = {}) {
  const title = trim(input.title);
  if (!title) {
    return {
      ok: false,
      code: "DUPLICATE_TEMPLATE_TITLE",
      error: COPY_TITLE_REQUIRED_MESSAGE,
      message: COPY_TITLE_REQUIRED_MESSAGE,
    };
  }

  const records = Array.isArray(input.records) ? input.records : [];
  const excludeFormNumber = trim(input.excludeFormNumber);
  const excludeTemplateId = trim(input.excludeTemplateId);
  const allowArchivedConflict = input.allowArchivedConflict === true;

  const activeConflict = records.find((record) => {
    const recordId = trim(record.id || record.templateId || record["Audit ID"]);
    const formNumber = trim(record.form_number || record.formNumber || record["Form Number"]);
    const status = record.status || record.Status || "active";
    if (excludeTemplateId && recordId === excludeTemplateId) return false;
    if (excludeFormNumber && formNumber && formNumber === excludeFormNumber) return false;
    if (!isActiveTemplateStatus(status)) return false;
    return titlesMatch(title, record.template_name || record.name || record["Audit Name"] || record.title);
  });

  if (activeConflict) {
    return {
      ok: false,
      code: "DUPLICATE_TEMPLATE_TITLE",
      error: DUPLICATE_TEMPLATE_TITLE_MESSAGE,
      message: COPY_TITLE_CHOOSE_DIFFERENT_MESSAGE,
    };
  }

  if (!allowArchivedConflict) {
    const archivedConflict = records.find((record) => {
      const recordId = trim(record.id || record.templateId || record["Audit ID"]);
      const formNumber = trim(record.form_number || record.formNumber || record["Form Number"]);
      const status = record.status || record.Status || "active";
      if (excludeTemplateId && recordId === excludeTemplateId) return false;
      if (excludeFormNumber && formNumber && formNumber === excludeFormNumber) return false;
      if (!isArchivedOrSupersededStatus(status)) return false;
      return titlesMatch(title, record.template_name || record.name || record["Audit Name"] || record.title);
    });
    if (archivedConflict) {
      return {
        ok: false,
        code: "DUPLICATE_TEMPLATE_TITLE",
        error: ARCHIVED_TITLE_WARNING_MESSAGE,
        message: ARCHIVED_TITLE_WARNING_MESSAGE,
        archivedConflict: true,
      };
    }
  }

  return { ok: true, title };
}

export function buildRevisionIdentity(input = {}) {
  const formNumber = trim(input.formNumber) || formatFormNumber(1);
  const revisionNumber = normalizeRevisionNumber(input.revisionNumber);
  const revisionId = trim(input.revisionId) || `${formNumber}-REV-${revisionNumber}`;
  return {
    form_number: formNumber,
    revision_number: revisionNumber,
    revision_id: revisionId,
    version: revisionNumber,
  };
}

export function describeRevisionLabel(record = {}) {
  const formNumber = trim(record.form_number || record.formNumber || "");
  const revision = normalizeRevisionNumber(record.revision_number || record.revisionNumber || record.version);
  const status = trim(record.status || "active");
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  if (!formNumber) {
    return `Rev ${revision} · ${statusLabel}`;
  }
  return `${formNumber} · Rev ${revision} · ${statusLabel}`;
}

export function reviseKeepsFormNumber() {
  return true;
}

export function copyCreatesNewFormNumber() {
  return true;
}

export function recordFormNumber(record = {}) {
  return trim(record.form_number || record.formNumber || record["Form Number"] || record.FormNumber);
}

export function recordRevisionNumber(record = {}) {
  return normalizeRevisionNumber(
    record.revision_number || record.revisionNumber || record["Revision Number"] || record.version,
  );
}

export function recordTemplateStatus(record = {}) {
  return trim(record.status || record.Status || "active").toLowerCase();
}

export function isLatestActiveTemplateStatus(status) {
  const normalized = trim(status).toLowerCase();
  return normalized === "active" || normalized === "draft";
}

/**
 * Active working list: one row per FormNumber (highest active/draft revision).
 * Templates without a FormNumber are kept if they are active/draft.
 */
export function filterLatestActiveTemplates(records = []) {
  const list = Array.isArray(records) ? records : [];
  const byFormNumber = new Map();
  const withoutFormNumber = [];

  for (const record of list) {
    const status = recordTemplateStatus(record);
    if (!isLatestActiveTemplateStatus(status)) continue;
    const formNumber = recordFormNumber(record);
    if (!formNumber) {
      withoutFormNumber.push(record);
      continue;
    }
    const revision = recordRevisionNumber(record);
    const existing = byFormNumber.get(formNumber);
    if (!existing || recordRevisionNumber(existing) < revision) {
      byFormNumber.set(formNumber, record);
    }
  }

  return [...byFormNumber.values(), ...withoutFormNumber];
}

export function collectRevisionsForFormNumber(records = [], formNumberInput = "") {
  const formNumber = trim(formNumberInput);
  if (!formNumber) return [];
  return (Array.isArray(records) ? records : [])
    .filter((record) => recordFormNumber(record) === formNumber)
    .sort((left, right) => recordRevisionNumber(right) - recordRevisionNumber(left))
    .map((record) => {
      const revisionNumber = recordRevisionNumber(record);
      const status = recordTemplateStatus(record);
      return {
        id: trim(record.id || record.templateId || record["Audit ID"]),
        template_name: trim(record.template_name || record.name || record["Audit Name"] || record.title),
        form_number: formNumber,
        revision_number: revisionNumber,
        revision_id: trim(record.revision_id || record.revisionId || record["Revision ID"]),
        status,
        revision_label: describeRevisionLabel({
          form_number: formNumber,
          revision_number: revisionNumber,
          status,
        }),
        revision_reason: trim(record.revision_reason || record.revisionReason || record["Revision Reason"]),
        copy_reason: trim(record.copy_reason || record.copyReason || record["Copy Reason"]),
        created_at: trim(record.created_at || record.createdAt || record["Created At"]),
        updated_at: trim(record.updated_at || record.updatedAt || record["Updated At"]),
        created_by: trim(record.created_by || record.createdBy || record["Created By"]),
        superseded_by_revision_id: trim(
          record.superseded_by_revision_id || record.supersededByRevisionId || record["Superseded By Revision ID"],
        ),
        supersedes_revision_id: trim(
          record.supersedes_revision_id || record.supersedesRevisionId || record["Supersedes Revision ID"],
        ),
        is_active: isLatestActiveTemplateStatus(status),
        is_superseded: status === "superseded" || status === "archived" || status === "inactive",
      };
    });
}
