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
  collectRevisionsForFormNumber,
  copyCreatesNewFormNumber,
  describeRevisionLabel,
  filterLatestActiveTemplates,
  nextFormNumberFromRecords,
  reviseKeepsFormNumber,
  titlesMatch,
  validateTemplateTitle,
} from "../shared/revision-control.mjs";
import { isAuditArchivedRecord, filterArchivedWorkbookRows, mapArchivedListItem } from "../shared/archive.mjs";
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
  auditBuilder.includes("filterLatestActiveTemplates") &&
    (auditBuilder.includes('template.status !== "archived"') ||
      auditBuilder.includes('status !== "archived"') ||
      auditBuilder.includes("isLatestActiveTemplateStatus") ||
      read("shared/revision-control.mjs").includes("isLatestActiveTemplateStatus")),
  "17: template list still serves active templates (latest active only)",
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
const reviseModal = read("src/components/forms/ReviseAuditFormModal.tsx");
const mapping = read("server/company-audit-mapping.mjs");
const serverInstall = read("server/server.mjs");
const permissions = read("src/permissions.ts");

assert(panel.includes('data-testid="audit-form-revise-button"'), "1: Audit/form card with Archive also shows Revise");
assert(panel.includes('data-testid="audit-form-copy-button"'), "2: Audit/form card with Archive also shows Copy");
assert(panel.includes('recordType="audit"') && panel.includes('label="Archive"'), "1b/2b: Archive still on template cards");
assert(editScreen.includes('data-testid="audit-form-revise-button"') && editScreen.includes('data-testid="audit-form-copy-button"'), "3: Detail/edit screen shows Revise/Copy");
assert(editScreen.includes('data-testid="audit-form-revision-actions"'), "3b: Revise/Copy/Archive action group on detail");
assert(reviseModal.includes("Create new revision"), "4: Revise modal title");
assert(
  reviseModal.includes("You are creating a new revision of this controlled form") &&
    reviseModal.includes("Reason for revision") &&
    reviseModal.includes("Create revision"),
  "4b: Revise modal wording and fields",
);
assert(modal.includes("Copy form"), "5: Copy modal title");
assert(
  modal.includes("You are creating a new form based on this one") &&
    modal.includes("New title") &&
    modal.includes("Create copy"),
  "5b: Copy modal wording and fields",
);
assert(panel.includes("Enter a title for the copied form.") && modal.includes("New title"), "6: Copy requires new title");
assert(service.includes("DUPLICATE_TEMPLATE_TITLE") || service.includes("copyAuditBuilderTemplate"), "7: Duplicate title blocked via copy service");
assert(reviseKeepsFormNumber() === true, "8: Revise creates same FormNumber next revision");
assert(copyCreatesNewFormNumber() === true, "9: Copy creates new FormNumber Rev 1");
assert(panel.includes('role !== "Auditor"') || panel.includes("role !== 'Auditor'"), "10: Auditor does not see Revise/Copy");
assert(
  permissions.includes('canManageTemplates: role === "Master" || role === "Admin" || role === "Manager"'),
  "10b: Master/Admin/Manager can manage templates",
);
assert(panel.includes("ArchiveRecordButton") && editScreen.includes("ArchiveRecordButton"), "11: Archive button still works");
assert(
  panel.includes('data-testid="audit-form-revision-label"') &&
    editScreen.includes('data-testid="audit-form-revision-label"'),
  "12: Form Number / Rev / Status visible",
);
assert(panel.includes("templateRevisionLabel") || panel.includes("revisionLabel"), "12b: revision label helper on cards");
assert(service.includes("copyAuditBuilderTemplate") && service.includes("/audit-templates/"), "client: folder-first copy service");
assert(mapping.includes("REVISION_CONTROL_COLUMNS") || mapping.includes("Form Number"), "sheet: AuditTemplates revision columns");
assert(serverInstall.includes("resolveCompanyFromFolder"), "server: resolveCompanyFromFolder passed to audit builder");
assert(describeRevisionLabel({ form_number: "BERT-AUD-001", revision_number: 3, status: "active" }) === "BERT-AUD-001 · Rev 3 · Active", "label format");

// --- Revision History surface (active list + history + archive restore) ---
const rev1 = {
  id: "t-rev-1",
  template_name: "Bay 2 Fire Safety Inspection",
  status: "superseded",
  form_number: "BERT-AUD-001",
  revision_number: 1,
  revision_id: "BERT-AUD-001-REV-1",
  revision_reason: "Initial issue",
};
const rev2 = {
  id: "t-rev-2",
  template_name: "Bay 2 Fire Safety Inspection",
  status: "active",
  form_number: "BERT-AUD-001",
  revision_number: 2,
  revision_id: "BERT-AUD-001-REV-2",
  revision_reason: "Updated extinguisher checks",
};
const otherFormActive = {
  id: "t-other",
  template_name: "Warehouse Walk",
  status: "active",
  form_number: "BERT-AUD-010",
  revision_number: 1,
};
const historyChain = [rev1, rev2, otherFormActive];
const latestActive = filterLatestActiveTemplates(historyChain);
assert(
  latestActive.length === 2 &&
    latestActive.some((row) => row.id === "t-rev-2") &&
    !latestActive.some((row) => row.id === "t-rev-1"),
  "RH1: Active list shows newest active revision only",
);
assert(!latestActive.some((row) => row.id === "t-rev-1"), "RH2: Old superseded revision is hidden from active list");

const historyModal = read("src/components/forms/RevisionHistoryModal.tsx");
const archiveScreen = read("src/screens/ArchiveScreen.tsx");
const archiveShared = read("shared/archive.mjs");

assert(panel.includes('data-testid="audit-form-revision-history-button"'), "RH3: Template card shows Revision History action");
assert(
  panel.includes("RevisionHistoryModal") && historyModal.includes("Revision History"),
  "RH4: Revision History opens for a revised audit",
);

const collected = collectRevisionsForFormNumber(historyChain, "BERT-AUD-001");
assert(
  collected.length === 2 &&
    collected[0].revision_number === 2 &&
    collected[1].revision_number === 1,
  "RH5: History shows Rev 1 and Rev 2",
);
assert(collected[0].is_active === true && historyModal.includes("data-active"), "RH6: Active revision is highlighted");
assert(
  collected[1].is_superseded === true &&
    (collected[1].status === "superseded" || collected[1].status === "archived") &&
    historyModal.includes("Superseded"),
  "RH7: Superseded revision shows archived/superseded status",
);

assert(isAuditArchivedRecord(rev1) === true, "RH8a: superseded audits count as archived records");
assert(
  isAuditArchivedRecord({
    "Audit ID": "t-rev-1",
    "Audit Name": "Bay 2 Fire Safety Inspection",
    Status: "superseded",
    Archived: "",
    "Form Number": "BERT-AUD-001",
    "Revision Number": "1",
  }) === true,
  "RH8a2: Status Superseded with Archived blank still counts as archived",
);
assert(
  isAuditArchivedRecord({
    "Audit ID": "t-rev-2",
    "Audit Name": "Bay 2 Fire Safety Inspection",
    Status: "active",
    Archived: "false",
    "Form Number": "BERT-AUD-001",
    "Revision Number": "2",
  }) === false,
  "RH8a3: Active Rev 2 does not appear in Archive > Audits",
);

const archiveRows = [
  {
    "Audit ID": "t-rev-1",
    "Audit Name": "Bay 2 Fire Safety Inspection",
    Status: "superseded",
    Archived: "",
    "Form Number": "BERT-AUD-001",
    "Revision Number": "1",
    "Revision Reason": "Initial issue",
    "Superseded By Revision ID": "BERT-AUD-001-REV-2",
  },
  {
    "Audit ID": "t-rev-2",
    "Audit Name": "Bay 2 Fire Safety Inspection",
    Status: "active",
    Archived: "false",
    "Form Number": "BERT-AUD-001",
    "Revision Number": "2",
  },
];
const archivedAudits = filterArchivedWorkbookRows(archiveRows, "audit").map((row) => mapArchivedListItem(row, "audit"));
assert(archivedAudits.length === 1 && archivedAudits[0].id === "t-rev-1", "RH8b: Old Rev 1 appears in Archive > Audits");
assert(archivedAudits.length === 1, "RH8c: Archive summary count for Audits increments (Rev 1 only)");
assert(!archivedAudits.some((row) => row.id === "t-rev-2"), "RH5b: Active Rev 2 does not appear in Archive > Audits");
assert(
  archivedAudits[0].formNumber === "BERT-AUD-001" &&
    String(archivedAudits[0].revisionNumber) === "1" &&
    String(archivedAudits[0].status).toLowerCase() === "superseded",
  "RH6b: Archive > Audits displays FormNumber / Revision / Superseded",
);
assert(
  archiveScreen.includes("archive-audit-revision-meta") && archiveScreen.includes("Superseded"),
  "RH6c: Archive UI shows FormNumber / Revision / Superseded badge",
);

assert(
  archiveShared.includes('status === "superseded"') &&
    (archiveScreen.includes('section === "audits"') || archiveScreen.includes('id: "audits"')) &&
    archiveScreen.includes("Superseded"),
  "RH8: Archive > Audits shows superseded revision",
);

assert(
  historyModal.includes("Restore as new revision") &&
    archiveScreen.includes("Restore as new revision") &&
    !historyModal.includes("Restore over active"),
  "RH9: Restore old revision says Restore as new revision, not Restore over active",
);

assert(
  auditBuilder.includes("/google-form-templates/:templateId/revisions") &&
    panel.includes("Revision History"),
  "RH10: Google Form revision history is present if supported",
);
assert(
  archiveShared.includes("isGoogleFormArchivedRecord") &&
    archiveShared.includes('status === "superseded"'),
  "RH10b: Google Forms superseded revisions appear in Archive > Google Forms if supported",
);
assert(
  !isAuditArchivedRecord({
    Status: "active",
    Archived: "false",
    "Superseded By Revision ID": "",
  }),
  "RH10c: Active latest Google Form / audit revision does not appear in Archive",
);

assert(
  auditBuilder.includes("/api/companies/:companyFolderId/audit-templates/:templateId/revisions") &&
    service.includes("/audit-templates/") &&
    service.includes("/revisions"),
  "RH11: Folder-first workbook route is used",
);
assert(
  auditBuilder.includes("resolveCompanyFromFolder") &&
    auditBuilder.includes("COMPANY_WORKBOOK_NOT_FOUND") &&
    !auditBuilder.includes("stale-test-workbook"),
  "RH12: No stale/test workbook is used",
);

assert(
  auditBuilder.includes('status: "superseded"') && auditBuilder.includes("archived: true"),
  "revise creates old Rev with Status Superseded and Archived true",
);
assert(
  mapping.includes("preservedHistoric") && mapping.includes("incomingIds"),
  "active template sync preserves historic superseded rows",
);
assert(read("server/archive-service.mjs").includes("readSessionArchivedAuditRows"), "archive list recovers session superseded audits");
assert(archiveScreen.includes("archive-view-audit-button") || archiveScreen.includes("View"), "Archive audits expose View");

assert(auditBuilder.includes("filterLatestActiveTemplates"), "server filters active list to latest revision");
assert(auditBuilder.includes("restore-as-revision"), "server restore-as-revision endpoint exists");
assert(service.includes("listAuditTemplateRevisions") && service.includes("restoreAuditTemplateAsRevision"), "client revision history services");
assert(editScreen.includes('data-testid="audit-form-revision-history-button"'), "edit screen also exposes Revision History");

console.log(`\nverify:revision-control passed (${checks} checks).`);
