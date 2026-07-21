#!/usr/bin/env node
/**
 * Archive & Restore centre verifier — navigation, shared helpers, routes, and dashboard filters.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARCHIVE_FIELD_NAMES,
  ARCHIVE_RECORD_TYPES,
  buildArchivePatch,
  canArchiveRecordType,
  canViewArchiveCentre,
  countActiveSetupAdmins,
  filterActiveWorkbookRows,
  filterArchivedWorkbookRows,
  isWorkbookRowActive,
  isWorkbookRowArchived,
  mapArchivedListItem,
  normalizeArchiveType,
  CANNOT_ARCHIVE_LAST_ADMIN_MESSAGE,
} from "../shared/archive.mjs";
import { buildLiveDashboardFromSources } from "../shared/live-dashboard.mjs";

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
}

const CO = "folder-archive-test";
const NOW = new Date("2026-07-09T10:00:00.000Z");
const adminActor = { kind: "company", role: "Admin", email: "admin@test.co", companyId: CO };
const managerActor = { kind: "company", role: "Manager", email: "mgr@test.co", companyId: CO };
const auditorActor = { kind: "company", role: "Auditor", email: "aud@test.co", companyId: CO };

const activeAction = {
  "Action ID": "act-1",
  "Company ID": CO,
  Status: "Open",
  Archived: "false",
  "Due Date": "2026-07-20",
};
const archivedAction = {
  "Action ID": "act-arch",
  "Company ID": CO,
  Status: "Open",
  Archived: "true",
  ArchivedAt: "2026-07-01T10:00:00.000Z",
  ArchivedBy: "admin@test.co",
  ArchiveReason: "Duplicate",
  "Due Date": "2026-06-01",
};

assert(read("src/config/navItems.ts").includes('id: "archive", label: "Archive"'), "1: Archive sidebar item exists");
assert(
  read("src/screens/ArchiveScreen.tsx").includes("View, restore, or reactivate archived records") ||
    read("src/screens/ArchiveScreen.tsx").includes('archiveCentre.subtitle') ||
    read("src/i18n/locales/en.ts").includes("View, restore, or reactivate archived records"),
  "2: Archive page renders title/subtitle",
);
assert(
  ["users", "actions", "ncrs", "incidents", "briefings", "audits", "googleForms"].every((sectionId) =>
    read("src/screens/ArchiveScreen.tsx").includes(`"${sectionId}"`),
  ),
  "3: Archive page sections present",
);

assert(isWorkbookRowActive(activeAction, "action"), "5: row without archive flag is active");
assert(isWorkbookRowArchived(archivedAction, "action"), "5b: archived action detected");
assert(filterActiveWorkbookRows([activeAction, archivedAction], "action").length === 1, "6: active filter hides archived");
assert(filterArchivedWorkbookRows([activeAction, archivedAction], "action").length === 1, "7: archive list shows archived only");

{
  const built = buildLiveDashboardFromSources(
    {
      actions: [activeAction, archivedAction],
      schedules: [],
      auditResults: [],
      incidents: [],
      ncrs: [],
      briefings: [],
      briefingRecipients: [],
      areas: [],
      sites: [],
    },
    { companyFolderId: CO, actor: managerActor, now: NOW },
  );
  assert(built.metrics.openActions === 1, "8: archived actions excluded from open counts");
  assert(built.metrics.overdueActions === 0, "8b: archived overdue actions excluded");
}

{
  const openNcr = { "NCR ID": "n1", "Company ID": CO, Status: "Open", Archived: "false" };
  const archivedNcr = { "NCR ID": "n2", "Company ID": CO, Status: "Open", Archived: "true" };
  const built = buildLiveDashboardFromSources(
    { ncrs: [openNcr, archivedNcr], actions: [], schedules: [], auditResults: [], incidents: [], briefings: [], briefingRecipients: [], areas: [], sites: [] },
    { companyFolderId: CO, actor: adminActor, now: NOW },
  );
  assert(built.metrics.openNcrs === 1, "9: archived NCRs excluded from open counts");
}

{
  const openIncident = { IncidentId: "i1", "Company ID": CO, Status: "Open", Archived: "false" };
  const archivedIncident = { IncidentId: "i2", "Company ID": CO, Status: "Open", Archived: "true" };
  const built = buildLiveDashboardFromSources(
    { incidents: [openIncident, archivedIncident], actions: [], schedules: [], auditResults: [], ncrs: [], briefings: [], briefingRecipients: [], areas: [], sites: [] },
    { companyFolderId: CO, actor: adminActor, now: NOW },
  );
  assert(built.metrics.currentIncidents === 1, "10: archived incidents excluded from active counts");
}

{
  const briefing = { BriefingId: "b1", "Company Folder ID": CO, Status: "Sent", Archived: "true" };
  const recipient = { BriefingId: "b1", RecipientEmail: "aud@test.co", Status: "Sent" };
  const built = buildLiveDashboardFromSources(
    { briefings: [briefing], briefingRecipients: [recipient], actions: [], schedules: [], auditResults: [], incidents: [], ncrs: [], areas: [], sites: [] },
    { companyFolderId: CO, actor: auditorActor, now: NOW },
  );
  assert(built.metrics.pendingBriefings === 0, "11: archived briefings excluded from unread/current counts");
}

{
  const liveSchedule = {
    "Schedule ID": "s-live",
    "Company Folder ID": CO,
    "Schedule Name": "Daily walk",
    Status: "ACTIVE",
    "Start Date": "2026-07-01",
    Frequency: "Daily",
    "Audit ID": "a1",
    "Assigned User Emails": "aud@test.co",
  };
  const archivedSchedule = {
    "Schedule ID": "s-arch",
    "Company Folder ID": CO,
    "Schedule Name": "Old walk",
    Status: "Archived",
    "Start Date": "2026-06-01",
    Frequency: "Daily",
    "Audit ID": "a2",
    "Assigned User Emails": "aud@test.co",
  };
  const built = buildLiveDashboardFromSources(
    { schedules: [liveSchedule, archivedSchedule], actions: [], auditResults: [], incidents: [], ncrs: [], briefings: [], briefingRecipients: [], areas: [], sites: [] },
    { companyFolderId: CO, actor: auditorActor, now: NOW },
  );
  assert(built.metrics.todayDue <= 1, "12: archived schedules excluded from due today");
  assert(built.metrics.overdueInspections === 0, "12b: archived schedules excluded from overdue");
}

assert(
  normalizeArchiveType("googleForms") === "googleForm" && ARCHIVE_RECORD_TYPES.googleForm,
  "13: google forms archive type supported",
);
assert(buildArchivePatch({ archived: false, type: "user" }).Status === "ACTIVE", "15: reactivate user sets ACTIVE");
assert(buildArchivePatch({ archived: true, type: "user" }).Status === "INACTIVE", "16: archived user is INACTIVE");

{
  const users = [
    { Email: "admin@test.co", Role: "Admin", Status: "ACTIVE", Archived: "false" },
    { Email: "mgr@test.co", Role: "Manager", Status: "ACTIVE", Archived: "false" },
  ];
  assert(countActiveSetupAdmins(users) === 1, "20: counts active setup/admin users");
  assert(CANNOT_ARCHIVE_LAST_ADMIN_MESSAGE.includes("last setup/admin"), "20b: last admin message present");
}

assert(ARCHIVE_FIELD_NAMES.includes("ArchivedAt") && ARCHIVE_FIELD_NAMES.includes("ArchiveReason"), "archive fields defined");
assert(mapArchivedListItem(archivedAction, "action").archiveReason === "Duplicate", "archive list item maps metadata");

const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes('app.get("/api/companies/:companyFolderId/archive"'), "22: folder-first archive list route");
assert(routes.includes('app.post("/api/companies/:companyFolderId/archive"'), "22b: archive route");
assert(routes.includes('app.post("/api/companies/:companyFolderId/restore"'), "22c: restore route");
assert(read("server/archive-service.mjs").includes("resolveCompanyScheduleContext"), "23: archive service uses folder-first context");

assert(canViewArchiveCentre(managerActor) && canViewArchiveCentre(adminActor), "Manager/Admin can view archive");
assert(!canViewArchiveCentre(auditorActor), "Auditor archive nav denied by default");
assert(canArchiveRecordType(adminActor, "user") && !canArchiveRecordType(managerActor, "user"), "user archive permission split");

assert(read("src/services/archiveService.ts").includes("ARCHIVE_OFFLINE_MESSAGE"), "24: offline archive message");
assert(read("src/screens/ArchiveScreen.tsx").includes("ARCHIVE_OFFLINE_MESSAGE"), "24b: offline UI message");

const archiveButton = read("src/components/archive/ArchiveRecordButton.tsx");
const archiveDialog = read("src/components/archive/ArchiveConfirmDialog.tsx");
const archivePerms = read("src/utils/archivePermissions.ts");

const archiveLocale = read("src/i18n/locales/en.ts");

assert(
  archiveDialog.includes("Archive this item?") || archiveDialog.includes("archiveThisItem") || archiveLocale.includes('archiveThisItem: "Archive this item?"'),
  "25: archive confirmation title",
);
assert(
  archiveDialog.includes("This will hide it from active views") || archiveDialog.includes("hideItFromActiveViews") || archiveLocale.includes("hide it from active views"),
  "25b: archive confirmation body",
);
assert(
  archiveDialog.includes("Reason for archiving") || archiveDialog.includes("reasonForArchiving") || archiveLocale.includes("Reason for archiving"),
  "25c: archive reason field",
);
assert(archiveButton.includes("archiveCompanyRecord"), "25d: archive button calls folder-first API");
assert(archiveButton.includes("ARCHIVE_OFFLINE_MESSAGE"), "25e: archive button blocks offline");

const activeScreens = [
  ["People / Users", read("src/components/admin/ActiveUserCard.tsx"), "ArchiveRecordButton", "user"],
  ["Actions", `${read("src/screens/ActionsScreen.tsx")}\n${read("src/actions/ActionsWorkspace.tsx")}\n${read("src/actions/components/ActionDetailPanel.tsx")}`, "ArchiveRecordButton", "action"],
  ["NCRs", `${read("src/screens/NonConformanceScreen.tsx")}\n${read("src/ncrs/NcrWorkspace.tsx")}`, "ArchiveRecordButton", "ncr"],
  ["Incidents", `${read("src/screens/IncidentReportingScreen.tsx")}\n${read("src/safety/SafetyWorkspace.tsx")}`, "ArchiveRecordButton", "incident"],
  ["Briefings", read("src/screens/BriefingsScreen.tsx"), "ArchiveRecordButton", "briefing"],
  ["Audits", read("src/screens/AuditTemplateEditScreen.tsx"), "ArchiveRecordButton", "audit"],
  ["Google Forms", read("src/screens/GoogleFormsScreen.tsx"), "ArchiveRecordButton", "googleForm"],
  ["Schedules", read("src/screens/SchedulesScreen.tsx"), "ArchiveRecordButton", "schedule"],
];
for (const [label, source, component, type] of activeScreens) {
  assert(source.includes(component) && source.includes(`recordType="${type}"`), `26: ${label} has archive action wired`);
}

assert(archivePerms.includes("canArchiveCompanyMember"), "27: self/last admin archive guard");
assert(read("src/components/admin/ActiveUserCard.tsx").includes("reactivated from Archive"), "27b: user archive reactivation hint");
assert(read("App.tsx").includes("handleActionArchived"), "28: App removes archived action from active list");
assert(read("App.tsx").includes("invalidateArchiveDashboard"), "28b: App refreshes dashboard after archive");
assert(read("App.tsx").includes("pushArchiveSuccessToast"), "28c: archive success toast");
assert(read("App.tsx").includes("pushArchiveErrorToast"), "28d: archive failure toast");

assert(read("shared/live-dashboard.mjs").includes("isWorkbookRowArchived"), "29: live dashboard ignores archived rows");
assert(!read("src/screens/ArchiveScreen.tsx").includes("PasswordHash"), "21: archive UI does not reference PasswordHash");

const roleNav = read("src/config/roleNavigation.ts");
assert(roleNav.includes('id: "archive", label: "Archive"'), "nav: archive in role navigation");
assert(read("src/permissions.ts").includes('if (itemId === "archive") return canAccessArchiveNav(role)'), "nav permission wired");
assert(read("App.tsx").includes('screen === "archive"'), "Archive page opens in App");

assert(JSON.parse(read("package.json")).scripts["verify:archive"], "verify:archive script registered");

{
  const supersededAudit = {
    "Audit ID": "aud-rev-1",
    "Audit Name": "Bay 2 Fire Safety Inspection",
    Status: "superseded",
    Archived: "",
    "Form Number": "BERT-AUD-001",
    "Revision Number": "1",
    "Superseded By Revision ID": "BERT-AUD-001-REV-2",
    "Revision Reason": "Updated checks",
  };
  const activeAudit = {
    "Audit ID": "aud-rev-2",
    "Audit Name": "Bay 2 Fire Safety Inspection",
    Status: "active",
    Archived: "false",
    "Form Number": "BERT-AUD-001",
    "Revision Number": "2",
  };
  assert(isWorkbookRowArchived(supersededAudit, "audit"), "audit: Status Superseded counts as archived even when Archived blank");
  assert(!isWorkbookRowArchived(activeAudit, "audit"), "audit: active latest revision is not archived");
  const archived = filterArchivedWorkbookRows([supersededAudit, activeAudit], "audit");
  assert(archived.length === 1 && archived[0]["Audit ID"] === "aud-rev-1", "audit: archive list includes superseded only");
  const mapped = mapArchivedListItem(supersededAudit, "audit");
  assert(
    mapped.formNumber === "BERT-AUD-001" &&
      String(mapped.revisionNumber) === "1" &&
      String(mapped.status).toLowerCase() === "superseded",
    "audit: archive item maps Form Number / Revision / Superseded",
  );
  assert(ARCHIVE_RECORD_TYPES.audit.restoreLabel === "Restore as new revision", "audit: restore label is Restore as new revision");
  assert(ARCHIVE_RECORD_TYPES.audit.section === "audits", "audit: section key is exactly audits");
  assert(read("src/screens/ArchiveScreen.tsx").includes('"audits"'), "audit: ArchiveScreen uses audits section id");
  assert(
    read("src/screens/ArchiveScreen.tsx").includes("Restore as new revision") ||
      read("src/screens/ArchiveScreen.tsx").includes("restoreAsRevision") ||
      read("src/i18n/locales/en.ts").includes("Restore as new revision"),
    "audit: Archive UI restore verb",
  );
  assert(read("src/screens/ArchiveScreen.tsx").includes("archive-view-audit-button"), "audit: Archive View button");
  assert(read("server/company-audit-mapping.mjs").includes("preservedHistoric"), "audit: sync preserves historic superseded rows");
  assert(read("server/archive-service.mjs").includes("readSessionArchivedAuditRows"), "audit: archive merges session superseded rows");
  assert(read("server/archive-service.mjs").includes("readAuditArchiveRows"), "audit: archive reads AuditTemplates via dedicated path");
  assert(read("server/archive-service.mjs").includes("sessionDir"), "audit: folder-first archive uses session/workbook context");
  assert(read("server/archive-service.mjs").includes('sectionKey: config.section'), "audit: diagnostics use ArchiveScreen section key");
}

{
  const supersededGoogle = {
    "Google Form ID": "gf-1",
    "Template Name": "Old Google Form",
    Status: "superseded",
    Archived: "",
  };
  const activeGoogle = {
    "Google Form ID": "gf-2",
    "Template Name": "Live Google Form",
    Status: "active",
    Archived: "false",
  };
  assert(isWorkbookRowArchived(supersededGoogle, "googleForm"), "googleForm: superseded appears in Archive");
  assert(!isWorkbookRowArchived(activeGoogle, "googleForm"), "googleForm: active latest does not appear in Archive");
}

{
  // Integration-style: revise leaves superseded row, archive list payload uses section key "audits".
  const afterReviseWorkbook = [
    {
      "Audit ID": "t-rev-1",
      "Audit Name": "Bay 2 Fire Safety Inspection",
      Status: "superseded",
      Archived: "true",
      "Form Number": "BERT-AUD-001",
      "Revision Number": "1",
      "Superseded By Revision ID": "BERT-AUD-001-REV-2",
      "Revision Reason": "Updated extinguisher checks",
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
  const archivedAfterSync = filterArchivedWorkbookRows(afterReviseWorkbook, "audit");
  assert(archivedAfterSync.length === 1, "1/5: old Rev 1 remains after active-list style workbook state");
  const sectionKey = ARCHIVE_RECORD_TYPES.audit.section;
  assert(sectionKey === "audits", "8: section key is exactly the one ArchiveScreen uses");
  const apiSections = { [sectionKey]: archivedAfterSync.map((row) => mapArchivedListItem(row, "audit")) };
  const apiCounts = { [sectionKey]: apiSections[sectionKey].length };
  assert(apiSections.audits.length === 1 && apiSections.audits[0].id === "t-rev-1", "4: response.audits contains old Rev 1");
  assert(apiCounts.audits === 1, "5: Archive summary Archived Audits count is 1");
  assert(!apiSections.audits.some((row) => row.id === "t-rev-2"), "7: active Rev 2 is not in Archive");
  assert(String(apiSections.audits[0].status).toLowerCase() === "superseded", "6: ArchiveScreen would render Rev 1 as Superseded");
  assert(apiSections.audits[0].formNumber === "BERT-AUD-001", "6b: Form Number present for Archive row");
  assert(ARCHIVE_RECORD_TYPES.audit.restoreLabel === "Restore as new revision", "10: Restore as new revision button label");
  assert(
    read("src/screens/ArchiveScreen.tsx").includes("if (!query) return activeItems"),
    "9: search/filter does not hide archived audits by default",
  );
}

{
  // Frontend must unwrap fetchJson { ok, data } or Archive always shows 0.
  const archiveService = read("src/services/archiveService.ts");
  assert(archiveService.includes("unwrapArchivePayload"), "client: archive service unwraps fetchJson data payload");
  assert(archiveService.includes("result.data"), "client: archive list reads result.data sections/counts");
  assert(
    read("src/screens/ArchiveScreen.tsx").includes("result.sections") &&
      archiveService.includes("unwrapArchivePayload"),
    "client: ArchiveScreen receives unwrapped sections from archive service",
  );
  assert(!read("server/archive-service.mjs").includes("stale-test-workbook"), "11: no stale/test workbook shortcut");
  assert(read("server/archive-service.mjs").includes("resolveCompanyScheduleContext"), "11b: folder-first workbook route");
}

console.log(`[verify:archive] OK — ${checks} checks passed`);
