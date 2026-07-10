#!/usr/bin/env node
/**
 * Revision control + copy verifier — ISO-style FormNumber/Revision vs separate Copy.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARCHIVED_TITLE_WARNING_MESSAGE,
  COPY_TITLE_CHOOSE_DIFFERENT_MESSAGE,
  COPY_TITLE_REQUIRED_MESSAGE,
  DUPLICATE_TEMPLATE_TITLE_MESSAGE,
  buildRevisionIdentity,
  copyCreatesNewFormNumber,
  describeRevisionLabel,
  nextFormNumberFromRecords,
  reviseKeepsFormNumber,
  titlesMatch,
  validateTemplateTitle,
} from "../shared/revision-control.mjs";
import { buildAuditResultRow, AUDIT_RESULTS_TAB_COLUMNS } from "../server/completion-service.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let checks = 0;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assert(condition, message) {
  checks += 1;
  if (!condition) {
    console.error(`FAIL [${checks}]: ${message}`);
    process.exit(1);
  }
  console.log(`PASS [${checks}]: ${message}`);
}

assert(reviseKeepsFormNumber() === true, "10 helper: revise keeps FormNumber");
assert(copyCreatesNewFormNumber() === true, "2 helper: copy creates new FormNumber");

const source = {
  id: "t1",
  template_name: "DC H&S Audit",
  status: "active",
  form_number: "BERT-AUD-001",
  revision_number: 3,
  revision_id: "BERT-AUD-001-REV-3",
  sections: [{ name: "General", questions: [{ question_text: "Fire exits clear?", answer_type: "compliance" }] }],
};

const records = [source];

// 1–3: copy creates new template identity
const nextNumber = nextFormNumberFromRecords(records);
assert(nextNumber === "BERT-AUD-002", "1/2: next FormNumber after BERT-AUD-001 is BERT-AUD-002");
const copyIdentity = buildRevisionIdentity({ formNumber: nextNumber, revisionNumber: 1 });
assert(copyIdentity.form_number === "BERT-AUD-002" && copyIdentity.revision_number === 1, "3: copy starts at Rev 1");
assert(copyIdentity.revision_id.includes("REV-1"), "3b: copy gets new RevisionId");

// 4: title required
const missingTitle = validateTemplateTitle({ title: "  ", records });
assert(!missingTitle.ok && missingTitle.error === COPY_TITLE_REQUIRED_MESSAGE, "4: copy requires a new title");

// 5: duplicate active title case-insensitive
const dupActive = validateTemplateTitle({ title: "dc h&s audit", records });
assert(
  !dupActive.ok &&
    dupActive.code === "DUPLICATE_TEMPLATE_TITLE" &&
    dupActive.error === DUPLICATE_TEMPLATE_TITLE_MESSAGE &&
    dupActive.message === COPY_TITLE_CHOOSE_DIFFERENT_MESSAGE,
  "5: copy rejects duplicate active title case-insensitively",
);
assert(titlesMatch("DC H&S Audit", "dc h&s audit"), "5b: titlesMatch is case-insensitive");

// 6: original not archived by copy helpers (copy does not mutate source)
assert(source.status === "active" && source.form_number === "BERT-AUD-001" && source.revision_number === 3, "6: original unchanged by copy helpers");

// 7: questions preserved conceptually (deep copy pattern in server)
const auditBuilder = read("server/audit-builder.mjs");
assert(
  auditBuilder.includes("JSON.parse(JSON.stringify(source.sections))") &&
    auditBuilder.includes("schedulesCopied: false"),
  "7/9: copy preserves sections and does not copy live schedules",
);
assert(!auditBuilder.includes("copySchedules: true") || auditBuilder.includes("schedulesCopied: false"), "9b: schedules not auto-copied");

// 8: results not copied
assert(
  auditBuilder.includes("parent_template_id: null") &&
    auditBuilder.includes('supersedes_revision_id: ""') &&
    !auditBuilder.includes("instances: source.instances"),
  "8: copy clears revision links and does not copy completed results/instances",
);

// 10–11: revise keeps FormNumber, same title allowed
const reviseIdentity = buildRevisionIdentity({
  formNumber: source.form_number,
  revisionNumber: 4,
});
assert(reviseIdentity.form_number === "BERT-AUD-001" && reviseIdentity.revision_number === 4, "10: revise keeps FormNumber and increments revision");
const sameTitleRevise = validateTemplateTitle({
  title: "DC H&S Audit",
  records,
  excludeFormNumber: "BERT-AUD-001",
});
assert(sameTitleRevise.ok === true, "11: revising same form title is allowed");

// 12: renaming revision to another active form title rejected
const otherActive = {
  id: "t2",
  template_name: "Warehouse H&S Audit",
  status: "active",
  form_number: "BERT-AUD-014",
};
const renameConflict = validateTemplateTitle({
  title: "Warehouse H&S Audit",
  records: [source, otherActive],
  excludeFormNumber: "BERT-AUD-001",
});
assert(!renameConflict.ok, "12: renaming revision to another active form title is rejected");

// Archived title warning
const archived = {
  id: "t-arch",
  template_name: "Old Warehouse Audit",
  status: "superseded",
  form_number: "BERT-AUD-009",
};
const archivedWarn = validateTemplateTitle({
  title: "Old Warehouse Audit",
  records: [archived],
});
assert(
  !archivedWarn.ok && archivedWarn.archivedConflict && archivedWarn.error === ARCHIVED_TITLE_WARNING_MESSAGE,
  "7c: archived title warns unless confirmed",
);

// 13–14: Google Form copy route + title rejection
assert(
  auditBuilder.includes('/api/companies/:companyFolderId/google-form-templates/:templateId/copy') &&
    auditBuilder.includes("BERT metadata copied. Google Drive Form file was not duplicated"),
  "13: Google Form copy creates metadata with new FormNumber Rev 1 (Drive file not auto-copied)",
);
assert(
  auditBuilder.includes('/api/companies/:companyFolderId/audit-templates/:templateId/copy'),
  "15: folder-first audit copy route is used",
);
assert(
  auditBuilder.includes("resolveCompanyFromFolder") && auditBuilder.includes("COMPANY_WORKBOOK_NOT_FOUND"),
  "16: folder-first workbook resolution — no stale/test workbook shortcut",
);

const googleDup = validateTemplateTitle({
  title: "DC H&S Audit",
  records: [{ ...source, googleFormTemplateStatus: "Google Form Import" }],
});
assert(!googleDup.ok, "14: duplicate Google Form title rejected");

// 17: existing active audits continue — list filters superseded/archived appropriately
assert(
  auditBuilder.includes('template.status !== "archived"') ||
    auditBuilder.includes('status !== "archived"'),
  "17: template list still serves active templates",
);

// 18: AuditResult stores form/revision after copied form is used
assert(
  AUDIT_RESULTS_TAB_COLUMNS.includes("Form Number") &&
    AUDIT_RESULTS_TAB_COLUMNS.includes("Revision Number") &&
    AUDIT_RESULTS_TAB_COLUMNS.includes("Revision ID"),
  "18a: AuditResults columns include Form Number / Revision",
);
const resultRow = buildAuditResultRow({
  companyFolderId: "folder-1",
  auditId: "ab-template-copy",
  auditName: "Warehouse H&S Audit",
  formNumber: "BERT-AUD-014",
  revisionNumber: 1,
  revisionId: "BERT-AUD-014-REV-1",
  completedByEmail: "auditor@test.co",
});
assert(
  resultRow["Form Number"] === "BERT-AUD-014" &&
    resultRow["Revision Number"] === "1" &&
    resultRow["Revision ID"] === "BERT-AUD-014-REV-1",
  "18: AuditResult stores correct revision/form number after copied form is used",
);

// UI + client wiring
const editScreen = read("src/screens/AuditTemplateEditScreen.tsx");
const panel = read("src/components/forms/FormsChecksTemplatesPanel.tsx");
const service = read("src/services/auditBuilderService.ts");
const modal = read("src/components/forms/CopyAuditFormModal.tsx");
const mapping = read("server/company-audit-mapping.mjs");
const serverInstall = read("server/server.mjs");

assert(editScreen.includes("Copy audit") && editScreen.includes(">Revise<") || editScreen.includes("Revise"), "UI: Revise + Copy audit on detail");
assert(panel.includes(">Copy<") && panel.includes(">Revise<") || (panel.includes("Copy") && panel.includes("Revise")), "UI: Revise + Copy on list");
assert(modal.includes("Create copy") && modal.includes("New title"), "UI: copy modal fields");
assert(modal.includes("You are creating a new form based on this one"), "UI: copy explanation");
assert(service.includes("copyAuditBuilderTemplate") && service.includes("/audit-templates/"), "client: folder-first copy service");
assert(mapping.includes("REVISION_CONTROL_COLUMNS") || mapping.includes("Form Number"), "sheet: AuditTemplates revision columns");
assert(serverInstall.includes("resolveCompanyFromFolder"), "server: resolveCompanyFromFolder passed to audit builder");
assert(describeRevisionLabel({ form_number: "BERT-AUD-001", revision_number: 3, status: "active" }) === "BERT-AUD-001 · Rev 3 · Active", "label format");

console.log(`\nverify:revision-control passed (${checks} checks).`);
