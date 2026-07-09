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
assert(read("src/screens/ArchiveScreen.tsx").includes("View, restore, or reactivate archived records"), "2: Archive page renders title/subtitle");
assert(
  ["Users", "Actions", "NCRs", "Incidents", "Briefings", "Audits", "Google Forms"].every((label) =>
    read("src/screens/ArchiveScreen.tsx").includes(label),
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

assert(read("shared/live-dashboard.mjs").includes("isWorkbookRowArchived"), "26: live dashboard ignores archived rows");
assert(!read("src/screens/ArchiveScreen.tsx").includes("PasswordHash"), "21: archive UI does not reference PasswordHash");

const roleNav = read("src/config/roleNavigation.ts");
assert(roleNav.includes('id: "archive", label: "Archive"'), "nav: archive in role navigation");
assert(read("src/permissions.ts").includes('if (itemId === "archive") return canAccessArchiveNav(role)'), "nav permission wired");
assert(read("App.tsx").includes('screen === "archive"'), "Archive page opens in App");

assert(JSON.parse(read("package.json")).scripts["verify:archive"], "verify:archive script registered");

console.log(`[verify:archive] OK — ${checks} checks passed`);
