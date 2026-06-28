#!/usr/bin/env node
/** Assigned-check contract — save, load, dashboard filter, completion roles, legacy fallbacks. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assignedUserEmailsFromSchedule,
  buildSchedulesTabRows,
  parseAssignedUsersFromRecord,
} from "../shared/schedule-save.mjs";
import {
  getScheduleAssignedEmails,
  isScheduleAssignedToUser,
  isScheduleAssignedToAnyEmail,
} from "../shared/schedule-assignment.mjs";
import { canCompleteAudit, isAssignableScheduleUser } from "../shared/schedule-assignees.mjs";
import {
  isActiveMyCheckScheduleStatus,
  listMyChecks,
  scheduleMatchesCompanyFolder,
} from "../server/schedule-service.mjs";
import { parseCompanyScheduleListFromRecords } from "../shared/schedule-list.mjs";
import {
  enrichAssignedSchedulesWithCompletion,
  isAssignedCheckCompletedForCurrentDue,
  isCompletionForCurrentDueInstance,
  normalizeScheduleCompletionMode,
  resolveAssignedCheckCompletion,
  shouldHideAssignedCheckAfterCompletion,
} from "../shared/assigned-check-completion.mjs";
import { submitCompletedCheck } from "../server/completion-service.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function assert(condition, message) {
  if (!condition) {
    console.error("FAIL:", message);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const roles = [
  { email: "admin@testco.test", name: "Co Admin", role: "Admin" },
  { email: "manager@testco.test", name: "Site Manager", role: "Manager" },
  { email: "auditor@testco.test", name: "Field Auditor", role: "Auditor" },
  { email: "user@testco.test", name: "Operator", role: "User" },
  { email: "master@testco.test", name: "Platform Owner", role: "Master" },
];

const sampleSchedule = {
  id: "schedule-1",
  companyFolderId: "company-1",
  scheduleName: "Daily walk",
  lifecycle: "Live",
  startDate: "2026-06-01",
  endDate: "",
  audits: [{ auditId: "audit-1", auditName: "Fire walk", frequency: "Daily" }],
};

/** 1: save writes assignedUserEmails on schedule payload and sheet rows. */
{
  const assignedUsers = roles.slice(0, 2).map((user) => ({
    email: user.email,
    name: user.name,
    role: user.role,
    accessLevel: "operational",
  }));
  const payload = {
    ...sampleSchedule,
    assignedUserEmails: assignedUsers.map((user) => user.email),
    assignedUsers,
    auditors: assignedUsers.map((user) => user.email),
  };
  assert(
    assignedUserEmailsFromSchedule(payload).join(",") === "admin@testco.test,manager@testco.test",
    "1: save payload exposes assignedUserEmails",
  );
  const rows = buildSchedulesTabRows(payload, assignedUsers);
  assert(rows[0]["Assigned User Emails"] === "admin@testco.test, manager@testco.test", "1b: sheet Assigned User Emails written");
}

/** 2: load reads assignedUserEmails with legacy fallbacks. */
{
  const fromCanonical = parseAssignedUsersFromRecord({
    "Assigned User Emails": "manager@testco.test",
    "Assigned User Names": "Site Manager",
    "Assigned User Roles": "Manager",
  });
  assert(fromCanonical[0]?.email === "manager@testco.test", "2: load from Assigned User Emails");

  const legacy = getScheduleAssignedEmails({ auditors: "auditor@testco.test, user@testco.test" });
  assert(legacy.length === 2 && legacy.includes("auditor@testco.test"), "2b: legacy auditors fallback");

  const fromJson = getScheduleAssignedEmails({
    assignedUsersJson: JSON.stringify([{ email: "admin@testco.test", role: "Admin" }]),
  });
  assert(fromJson[0] === "admin@testco.test", "2c: assignedUsersJson fallback");
}

/** 3: helper normalizes trim + lowercase; no Auditor-only gate. */
{
  const schedule = { assignedUserEmails: " Manager@TestCo.TEST , auditor@testco.test " };
  assert(isScheduleAssignedToUser(schedule, "  MANAGER@testco.test "), "3: email match is trim+lowercase");
  assert(!isScheduleAssignedToUser(schedule, "other@testco.test"), "3b: non-assignee rejected");
  assert(
    isScheduleAssignedToAnyEmail(schedule, new Set(["AUDITOR@testco.test"])),
    "3c: Set membership uses normalized emails",
  );
}

/** 4: each assignable role can complete; shared module used across app surfaces. */
for (const user of roles) {
  assert(canCompleteAudit(user), `4: ${user.role} can complete assigned checks`);
}
const appSrc = read("App.tsx");
const complianceSrc = read("src/utils/complianceSchedule.ts");
const scheduleSaveSrc = read("shared/schedule-save.mjs");
assert(appSrc.includes("getScheduleAssignedEmails"), "4b: App uses getScheduleAssignedEmails");
assert(appSrc.includes("assignedUserEmails"), "4c: App persists assignedUserEmails");
assert(appSrc.includes("isScheduleAssignedToAnyEmail"), "4d: App filters by assignment helper");
assert(complianceSrc.includes("getScheduleAssignedEmails"), "4e: compliance schedule uses helper");
assert(scheduleSaveSrc.includes("getScheduleAssignedEmails"), "4f: schedule save uses helper");
assert(read("src/permissions.ts").includes("canCompleteAssignedCheck"), "4g: completion permission helper exists");
assert(read("src/permissions.ts").includes("usesAssignedChecksCompletionFlow"), "4g1: assigned-check completion flow helper exists");
assert(appSrc.includes("usesAssignedChecksCompletionFlow"), "4g2: App uses assigned-check completion flow");
assert(appSrc.includes("assignedChecksRequestRef"), "4g2a: assigned-check fetch guarded against stale responses");
assert(appSrc.includes("hasLoadedOnce"), "4g2b: assigned-check state tracks settled load");
assert(read("src/components/dashboard/DashboardThingsToDoSection.tsx").includes("Things to do"), "4g2c: dashboard Things to do section retained");
assert(read("src/utils/auditAccess.ts").includes("buildAuditFromAssignedSchedule"), "4g3: audit builder for assigned schedules");
assert(read("src/utils/auditAccess.ts").includes("buildCompleteWorkAssignedAudits"), "4g3b: Complete Work audits built from assigned-checks API only");
assert(read("src/utils/auditAccess.ts").includes("resolveAssignedCheckAuditId"), "4g4: stable audit id for assigned schedules");
assert(read("src/screens/AuditsScreen.tsx").includes("My assigned checks"), "4g5: Admin/Manager assigned checks UI");
assert(read("src/components/dashboard/ManagerRoleDashboard.tsx").includes("DashboardThingsToDoSection"), "4g5a: manager dashboard Things to do section");
assert(read("src/components/dashboard/CompanyAdminDashboard.tsx").includes("DashboardThingsToDoSection"), "4g5a2: admin dashboard Things to do section");
assert(read("src/components/dashboard/AuditorTaskDashboard.tsx").includes("DashboardThingsToDoSection"), "4g5a3: auditor dashboard Things to do section");
assert(read("src/components/dashboard/MasterPlatformDashboard.tsx").includes("DashboardThingsToDoSection"), "4g5a4: master dashboard Things to do section when company linked");
assert(read("src/permissions.ts").includes('role === "Master"'), "4g5a5: Master role uses assigned-check completion flow");
assert(read("src/components/dashboard/DashboardThingsToDoSection.tsx").includes("Things to do"), "4g5a1: Things to do section title");
assert(read("src/components/dashboard/DashboardThingsToDoSection.tsx").includes("No checks due right now."), "4g5b: dashboard empty state for assigned checks");
assert(read("src/components/checks/AssignedCheckActionRow.tsx").includes('"Start check"'), "4g5c: dashboard assigned-check row Start check");
assert(read("src/components/checks/AssignedCheckActionRow.tsx").includes('"Continue check"'), "4g5d: dashboard assigned-check row Continue check");
assert(read("src/utils/assignedCheckDisplay.ts").includes('"Overdue"'), "4g5e: assigned check status includes Overdue");
assert(read("src/utils/assignedCheckDisplay.ts").includes('"Not due yet"'), "4g5f: assigned check status includes Not due yet");
assert(read("src/utils/assignedCheckDisplay.ts").includes("assignedCheckStatusLabel"), "4g5g: assigned check status label helper");
assert(read("server/bert-cors.mjs").includes("PUT"), "9: CORS preflight allows PUT for audit-templates");
assert(read("src/utils/scheduleAssignees.ts").includes("deriveScheduleAssigneesFromCompanyMembers"), "4h: assignees helper retained for diagnostics");
assert(appSrc.includes("readScheduleAssigneesCache"), "4i: App reads assignee localStorage cache while loading");
assert(appSrc.includes("writeScheduleAssigneesCache"), "4i1: App writes assignee localStorage cache after load");
assert(!appSrc.includes("readCompanyMembersCache"), "4i2: App does not read company members localStorage cache");
assert(appSrc.includes("fetchScheduleAssignees"), "4i3: App loads schedule assignees from schedule-assignees API");
assert(appSrc.includes("listCompanySchedules"), "4j: App loads company schedules via shared list service");
assert(read("src/screens/SchedulesScreen.tsx").includes("schedulesLoadError"), "4k: schedules UI surfaces list read failures");

/** 4l: ACTIVE-only assignee filter — inactive and invited excluded; Master assignable. */
{
  const companyId = "company-1";
  const activeMaster = {
    email: "master@testco.test",
    name: "Platform Owner",
    role: "Master",
    status: "ACTIVE",
    companyId,
  };
  const inactive = {
    email: "inactive@testco.test",
    name: "Inactive User",
    role: "Auditor",
    status: "INVITED",
    companyId,
  };
  assert(isAssignableScheduleUser(activeMaster), "4l: active Master assignable");
  assert(!isAssignableScheduleUser(inactive), "4l2: invited user not assignable");
  const { assignees } = (await import("../shared/schedule-assignees.mjs")).buildAvailableScheduleAssigneesFromUsers(
    [activeMaster, inactive],
    { companyId },
  );
  assert(assignees.some((row) => row.email === activeMaster.email), "4l3: assignee picker includes active Master");
  assert(!assignees.some((row) => row.email === inactive.email), "4l4: assignee picker excludes invited user");
}

/** 5: assigned users see schedule; non-selected users do not. */
{
  const schedule = {
    assignedUserEmails: ["manager@testco.test", "auditor@testco.test"],
    auditors: ["manager@testco.test", "auditor@testco.test"],
  };
  assert(isScheduleAssignedToUser(schedule, "manager@testco.test"), "5: selected manager sees schedule");
  assert(isScheduleAssignedToUser(schedule, "auditor@testco.test"), "5b: selected auditor sees schedule");
  assert(!isScheduleAssignedToUser(schedule, "user@testco.test"), "5c: non-selected user hidden");
  assert(!isScheduleAssignedToUser(schedule, "admin@testco.test"), "5d: non-selected admin hidden");
}

/** 6: active schedules remain visible when due date is upcoming (not only due today). */
{
  const complianceSrcText = read("src/utils/complianceSchedule.ts");
  assert(
    complianceSrcText.includes("isActiveScheduleRow") && complianceSrcText.includes("nextDueDate.trim()"),
    "6: upcoming assigned schedules stay visible",
  );
}

/** 7: userMatchesScheduleAssignment no longer gates on assignedRole. */
{
  assert(!complianceSrc.includes("assignedRole && schedule.assignedRole"), "7: no assignedRole gate on schedule match");
}

/** 8: My Checks uses GET /api/me/assigned-checks — session identity, no client email filter. */
const checkService = read("src/services/checkService.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
assert(checkService.includes("/api/me/assigned-checks"), "8: frontend assigned-checks API path");
assert(!checkService.includes('params.set("companyFolderId"'), "8a: client does not send companyFolderId query param");
assert(!checkService.includes('params.set("masterSheetId"'), "8a2: client does not send masterSheetId query param");
assert(!checkService.includes("URLSearchParams"), "8a3: client does not build assigned-checks query string");
assert(coreRoutes.includes('app.get("/api/me/assigned-checks"'), "8b: server assigned-checks route");
assert(coreRoutes.includes("SESSION_COMPANY_REQUIRED"), "8b2: route requires session company folder");
assert(
  /assigned-checks[\s\S]{0,2200}actor\?\.companyFolderId \|\| actor\?\.companyId/.test(coreRoutes),
  "8b3: company folder derived from session actor only",
);
assert(
  !/assigned-checks[\s\S]{0,2200}req\.query\.companyFolderId/.test(coreRoutes),
  "8b4: route does not trust companyFolderId query param",
);
assert(
  !/assigned-checks[\s\S]{0,2200}req\.query\.masterSheetId/.test(coreRoutes),
  "8b5: route does not trust masterSheetId query param",
);
assert(!checkService.includes("isScheduleAssignedToUser"), "8c: frontend does not client-filter by email");
assert(appSrc.includes("fetchAssignedChecks"), "8d: App loads assigned checks from API");
assert(read("src/config/roleNavigation.ts").includes("shouldLoadAssignedChecksScreen"), "8h: Complete Work screen gate helper exists");
assert(appSrc.includes("shouldLoadAssignedChecksScreen(screen, currentUser.role)"), "8h1: App uses assigned-checks screen gate");
assert(checkService.includes("fetchJson"), "8e: assigned checks uses fetchJson diagnostics");
assert(checkService.includes("loadErrorDetail"), "8f: assigned checks exposes load error detail");
assert(!checkService.includes("error.message : ASSIGNED_CHECKS_USER_MESSAGE"), "8g: assigned checks does not surface raw NetworkError as primary message");
assert(coreRoutes.includes("trustSessionContext"), "8k: assigned-checks route uses session fast path");
assert(read("server/schedule-service.mjs").includes("buildSessionScheduleContext"), "8l: session schedule context helper exists");
assert(read("server/schedule-service.mjs").includes("mergeCompanyScheduleLists"), "8m: assigned checks merge canonical + legacy schedule lists");
assert(read("server/schedule-service.mjs").includes("canonicalSchedulesCount"), "8m1: assigned-checks diagnostics include canonicalSchedulesCount");
assert(read("server/schedule-service.mjs").includes("legacyScheduleCount"), "8m2: assigned-checks diagnostics include legacyScheduleCount");
assert(read("server/schedule-service.mjs").includes("scheduleNamesListed"), "8m3: assigned-checks diagnostics include scheduleNamesListed");
assert(read("server/schedule-service.mjs").includes("dataSource"), "8m4: assigned-checks diagnostics include dataSource");
assert(
  read("server/schedule-service.mjs").includes('assignedChecksDiagnosticsVersion: ASSIGNED_CHECKS_DIAGNOSTICS_VERSION'),
  "8m4a: assigned-checks diagnostics include version marker",
);
assert(
  read("server/schedule-service.mjs").includes('ASSIGNED_CHECKS_DIAGNOSTICS_VERSION = "canonical-legacy-merge-v2"'),
  "8m4b: assigned-checks diagnostics version is canonical-legacy-merge-v2",
);
assert(!read("server/schedule-service.mjs").includes("canonicalSchedulesOnly: true"), "8m5: assigned checks does not skip legacy fallback when canonical has rows");
assert(read("server/schedule-service.mjs").includes("templateHydrationMs"), "8n: assigned-checks diagnostics include templateHydrationMs");
assert(read("server/schedule-service.mjs").includes("resolveContextMs"), "8o: assigned-checks diagnostics include resolveContextMs");
{
  const timeoutMatch = checkService.match(/ASSIGNED_CHECKS_LOAD_TIMEOUT_MS\s*=\s*([\d_]+)/);
  const timeoutMs = Number(String(timeoutMatch?.[1] || "0").replace(/_/g, ""));
  assert(timeoutMs >= 180_000, "8p: assigned checks timeout is production-safe");
}
assert(appSrc.includes("readAssignedChecksCache"), "8q: App reads assigned checks cache while refreshing");
assert(appSrc.includes("writeAssignedChecksCache"), "8r: App writes assigned checks cache after load");
assert(/listMyChecks[\s\S]{0,500}readSchedulesFromTab/.test(read("server/schedule-service.mjs")), "8s: listMyChecks uses direct Schedules tab read");
assert(read("src/utils/auditAccess.ts").includes("buildAuditFromAssignedSchedule"), "8t: Complete Work cards render without template hydration requirement");

/** 10: Production fixture — icloud assignee + gf-check audit + folder id alternates. */
{
  const signedInEmail = "dovecotestudio@icloud.com";
  const sessionFolderId = "dovecote-root-folder";
  const registryCompanyId = "dovecote-company-id";
  const scheduleRecords = [
    {
      "Schedule ID": "schedule-3",
      "Company Folder ID": registryCompanyId,
      "Schedule Name": "schdule 3",
      Status: "ACTIVE",
      "Assigned User Emails": "dovecotestudio@icloud.com",
      "Assigned User Names": "Edward Thomas",
      "Assigned User Roles": "Admin",
      "Audit ID": "gf-check-dc-hs-audit",
      "Template Name": "DC H&S Audit",
      Frequency: "Weekly",
    },
  ];

  const parsed = parseCompanyScheduleListFromRecords(scheduleRecords, sessionFolderId, [
    sessionFolderId,
    registryCompanyId,
  ]);
  assert(parsed.length === 1, "10: schedule parses for registry company folder id");
  assert(isScheduleAssignedToUser(parsed[0], signedInEmail), "10b: icloud email matches assignedUserEmails");
  assert(
    parsed[0].assignedUsers.some((user) => user.email === signedInEmail && user.role === "Admin"),
    "10c: assignedUsers includes Admin icloud email",
  );
  assert(
    parsed[0].audits.some((audit) => audit.auditId.startsWith("gf-check") && audit.auditName === "DC H&S Audit"),
    "10d: gf-check audit retained",
  );
  assert(!scheduleMatchesCompanyFolder(parsed[0], sessionFolderId), "10e: strict folder match fails without alternates");
  assert(
    scheduleMatchesCompanyFolder(parsed[0], sessionFolderId, [registryCompanyId]),
    "10f: alternate company id resolves folder match",
  );

  const filtered = parsed.filter(
    (schedule) =>
      scheduleMatchesCompanyFolder(schedule, sessionFolderId, [sessionFolderId, registryCompanyId]) &&
      isActiveMyCheckScheduleStatus(schedule) &&
      isScheduleAssignedToUser(schedule, signedInEmail),
  );
  assert(filtered.length === 1, "10g: icloud Admin assigned to gf-check schedule passes My Checks filters");

  const myChecks = await listMyChecks(
    {},
    {
      readTabRecords: async () => ({
        ok: true,
        records: [{ ...scheduleRecords[0], "Company Folder ID": sessionFolderId }],
        rowCount: 1,
      }),
      getTabValues: async () => [],
      resolveCompanyFromFolder: async () => ({
        ok: true,
        companyFolderId: sessionFolderId,
        companyId: sessionFolderId,
        masterSheetId: "sheet-dovecote",
      }),
      masterSheetCache: {
        getEntry: () => ({ masterSheetId: "sheet-dovecote" }),
      },
    },
    {
      email: signedInEmail,
      companyFolderId: sessionFolderId,
      masterSheetId: "sheet-dovecote",
      trustSessionContext: true,
      includeDiagnostics: true,
    },
  );
  assert(myChecks.ok, "10h: listMyChecks succeeds for icloud fixture");
  assert(myChecks.schedules.length === 1, "10i: assigned schedule returned for icloud Admin");
  assert(myChecks.diagnostics?.signedInEmail === signedInEmail, "10j: diagnostics include signedInEmail");
  assert(Array.isArray(myChecks.diagnostics?.included) && myChecks.diagnostics.included.length === 1, "10k: diagnostics include assigned schedule");
  const gfAudit = myChecks.schedules[0].audits.find((row) => row.auditName === "DC H&S Audit");
  assert(gfAudit && gfAudit.auditId.startsWith("gf-check"), "10l: gf-check audit present in API schedules");

  const cards = [];
  for (const schedule of myChecks.schedules) {
    for (const scheduleAudit of schedule.audits) {
      const auditId = String(scheduleAudit.auditId || "").trim();
      const auditName = String(scheduleAudit.auditName || schedule.scheduleName || "Scheduled check").trim();
      if (!auditId && !auditName) {
        continue;
      }
      cards.push({
        id: auditId || auditName.toLowerCase().replace(/\s+/g, "-"),
        name: auditName,
      });
    }
  }
  assert(myChecks.diagnostics?.timing?.templateHydrationMs === 0, "10m1: diagnostics report no template hydration");
  assert(typeof myChecks.diagnostics?.timing?.totalMs === "number", "10m2: diagnostics include totalMs");
  assert(
    cards.some((card) => card.name === "DC H&S Audit" && card.id.startsWith("gf-check")),
    "10m: Complete Work renders DC H&S Audit card with Start/Continue id",
  );
  assert(read("src/screens/AuditsScreen.tsx").includes("AssignedCheckActionRow"), "10n: Complete Work UI uses shared Start row");
  assert(read("src/components/checks/AssignedCheckActionRow.tsx").includes('"Start check"'), "10n1: Complete Work UI exposes Start check");
  assert(read("src/components/checks/AssignedCheckActionRow.tsx").includes('"Continue check"'), "10o: Complete Work UI exposes Continue check");
}

/** 11: Canonical verifier row + legacy "schdule 3" — assigned-checks must list the real schedule. */
{
  const signedInEmail = "dovecotestudio@icloud.com";
  const companyFolderId = "dovecote-root-folder";
  const canonicalRecords = [
    {
      "Schedule ID": "foundation-verify",
      "Company Folder ID": companyFolderId,
      "Schedule Name": "Foundation verify check",
      Status: "ACTIVE",
      "Assigned User Emails": "verify.foundation+1782200530242@usebert.co.uk",
      "Audit ID": "gf-check-foundation",
      "Template Name": "Foundation verify",
      Frequency: "Weekly",
    },
  ];
  const legacyRecords = [
    {
      "Schedule ID": "schedule-3",
      "Company Folder ID": companyFolderId,
      "Schedule Name": "schdule 3",
      Status: "ACTIVE",
      "Assigned User Emails": "dovecotestudio@icloud.com",
      "Audit ID": "gf-check-dc-hs-audit",
      "Template Name": "DC H&S Audit",
      Frequency: "Weekly",
    },
  ];
  const legacyHeaders = [
    "Schedule ID",
    "Company Folder ID",
    "Schedule Name",
    "Status",
    "Assigned User Emails",
    "Audit ID",
    "Template Name",
    "Frequency",
  ];

  async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
    if (tabName === "Schedules") {
      return { ok: true, records: canonicalRecords, rowCount: canonicalRecords.length };
    }
    if (tabName === "Schedule") {
      return { ok: true, records: legacyRecords, rowCount: legacyRecords.length };
    }
    return { ok: true, records: [], rowCount: 0 };
  }
  async function mockGetTabValues(_auth, _deps, _sheetId, tabName) {
    if (tabName === "Schedule") {
      return [
        legacyHeaders,
        ...legacyRecords.map((row) => legacyHeaders.map((header) => row[header] ?? "")),
      ];
    }
    return [];
  }

  const myChecks = await listMyChecks(
    {},
    {
      readTabRecords: mockReadTabRecords,
      getTabValues: mockGetTabValues,
      rowsToRecords: (rows) => {
        if (!Array.isArray(rows) || rows.length < 2) {
          return [];
        }
        const headers = rows[0];
        return rows.slice(1).map((row) => {
          const record = {};
          headers.forEach((header, index) => {
            record[String(header)] = String(row[index] ?? "");
          });
          return record;
        });
      },
      masterSheetCache: {
        getEntry: () => ({ masterSheetId: "sheet-dovecote" }),
      },
    },
    {
      email: signedInEmail,
      companyFolderId,
      masterSheetId: "sheet-dovecote",
      trustSessionContext: true,
      includeDiagnostics: true,
    },
  );

  assert(myChecks.ok, "11: listMyChecks succeeds with canonical + legacy sources");
  assert(
    myChecks.diagnostics?.assignedChecksDiagnosticsVersion === "canonical-legacy-merge-v2",
    "11a: diagnostics version marker is canonical-legacy-merge-v2",
  );
  assert((myChecks.diagnostics?.canonicalSchedulesCount || 0) === 1, "11b: diagnostics count canonical schedule");
  assert((myChecks.diagnostics?.legacyScheduleCount || 0) === 1, "11c: diagnostics count legacy schedule");
  assert(
    (myChecks.diagnostics?.scheduleNamesListed || []).includes("schdule 3"),
    "11d: diagnostics list schdule 3 from merged sources",
  );
  assert(myChecks.diagnostics?.dataSource === "schedules_tab+legacy_schedule", "11e: diagnostics dataSource is merged");
  assert(myChecks.schedules.length === 1, "11f: only schdule 3 assigned to signed-in user");
  assert(myChecks.schedules[0].scheduleName === "schdule 3", "11g: assigned schedule is schdule 3");
  const audit = myChecks.schedules[0].audits.find((row) => row.auditName === "DC H&S Audit");
  assert(audit && audit.auditId.startsWith("gf-check"), "11h: schdule 3 exposes DC H&S Audit");
}

/** 12: Completed assigned check no longer appears as due for the current instance. */
{
  const signedInEmail = "manager@testco.test";
  const companyFolderId = "company-1";
  const scheduleId = "schedule-due-1";
  const auditId = "audit-due-1";
  const scheduleRecords = [
    {
      "Schedule ID": scheduleId,
      "Company Folder ID": companyFolderId,
      "Schedule Name": "Daily walk",
      Status: "ACTIVE",
      "Assigned User Emails": signedInEmail,
      "Audit ID": auditId,
      "Template Name": "Fire walk",
      Frequency: "Daily",
      "Next Due At": "2026-06-24T08:00:00.000Z",
      "Completion Mode": "once-per-period",
    },
  ];
  const auditResultStore = [];

  async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
    if (tabName === "Schedules") {
      return { ok: true, records: scheduleRecords, rowCount: scheduleRecords.length };
    }
    if (tabName === "AuditResults") {
      return { ok: true, records: [...auditResultStore], rowCount: auditResultStore.length };
    }
    return { ok: true, records: [], rowCount: 0 };
  }

  const deps = {
    readTabRecords: mockReadTabRecords,
    appendTabRows: async (_auth, _deps, _sheetId, tabName, _columns, rows = []) => {
      if (tabName === "AuditResults") {
        auditResultStore.push(...rows);
      }
      return { ok: true, written: rows.length };
    },
    ensureTabColumns: async () => ({ addedColumns: [], headers: [] }),
    masterSheetCache: {
      getEntry: () => ({ masterSheetId: "sheet-1" }),
    },
  };

  const beforeCompletion = await listMyChecks(
    {},
    deps,
    {
      email: signedInEmail,
      companyFolderId,
      masterSheetId: "sheet-1",
      trustSessionContext: true,
    },
  );
  assert(beforeCompletion.ok, "12: listMyChecks succeeds before completion");
  const beforeAudit = beforeCompletion.schedules[0]?.audits?.[0];
  assert(beforeAudit && beforeAudit.completedForCurrentDue !== true, "12a: assigned check is due before completion");

  const submitted = await submitCompletedCheck(
    {},
    deps,
    {
      scheduleId,
      email: signedInEmail,
      companyFolderId,
      masterSheetId: "sheet-1",
      auditId,
      auditName: "Fire walk",
      answers: { q1: "pass" },
      findings: [],
      evidence: [],
      completedAt: "2026-06-24T09:15:00.000Z",
    },
  );
  assert(submitted.ok, "12b: completion writes AuditResults row");

  const completion = resolveAssignedCheckCompletion(
    auditResultStore,
    {
      scheduleId,
      auditId,
      auditName: "Fire walk",
      email: signedInEmail,
      nextDueAt: "2026-06-24T08:00:00.000Z",
      frequency: "Daily",
    },
    new Date("2026-06-24T12:00:00.000Z"),
  );
  assert(completion.completedForCurrentDue, "12c: completion matches current due instance");
  assert(
    isCompletionForCurrentDueInstance(auditResultStore[0], {
      scheduleId,
      auditId,
      auditName: "Fire walk",
      email: signedInEmail,
      nextDueAt: "2026-06-24T08:00:00.000Z",
      frequency: "Daily",
    }),
    "12d: isCompletionForCurrentDueInstance true for submitted row",
  );

  const afterCompletion = await listMyChecks(
    {},
    deps,
    {
      email: signedInEmail,
      companyFolderId,
      masterSheetId: "sheet-1",
      trustSessionContext: true,
    },
  );
  assert(afterCompletion.ok, "12e: listMyChecks succeeds after completion");
  const afterAudit = afterCompletion.schedules[0]?.audits?.[0];
  assert(afterAudit?.completedForCurrentDue === true, "12f: assigned check marked completed for current due");
  const dueAudits = (afterCompletion.schedules || []).flatMap((schedule) =>
    (schedule.audits || []).filter((audit) => !isAssignedCheckCompletedForCurrentDue(schedule, audit)),
  );
  assert(dueAudits.length === 0, "12g: no assigned checks remain due after once-per-period completion");

  const enrichedOnly = enrichAssignedSchedulesWithCompletion(
    beforeCompletion.schedules,
    auditResultStore,
    signedInEmail,
    new Date("2026-06-24T12:00:00.000Z"),
  );
  assert(
    enrichedOnly[0]?.audits?.[0]?.completedForCurrentDue === true,
    "12h: enrichAssignedSchedulesWithCompletion marks current due complete",
  );
}

assert(read("shared/assigned-check-completion.mjs").includes("enrichAssignedSchedulesWithCompletion"), "12i: shared completion helper exists");
assert(read("server/schedule-service.mjs").includes("enrichAssignedSchedulesWithCompletion"), "12j: listMyChecks enriches schedules from AuditResults");
assert(read("src/utils/auditAccess.ts").includes("shouldHideCompletedAssignedScheduleAudit"), "12k: Complete Work filters completed due instances by mode");
assert(read("src/utils/scheduleCompletionMode.ts").includes("resolveScheduleCompletionMode"), "12k1: schedule completion mode helper exists");
assert(read("src/components/checks/AssignedCheckActionRow.tsx").includes('"Start check"'), "12k2: repeatable completion exposes Start check");
assert(read("shared/schedule-completion-mode.mjs").includes("once-per-period"), "12k3: shared schedule completion mode helper exists");
assert(read("src/utils/assignedCheckCompletion.ts").includes("mergeScheduleLastCompletedFromResults"), "12l: schedules merge last completed from results");
assert(read("src/screens/SchedulesScreen.tsx").includes("Last completed"), "12m: schedules UI shows last completed date");
assert(read("src/utils/assignedCheckCompletion.ts").includes("Never completed"), "12m1: schedule last completed fallback is Never completed");
assert(read("src/screens/SchedulesScreen.tsx").includes("Next due"), "12m2: schedules UI shows next due");
assert(read("src/screens/SchedulesScreen.tsx").includes("Completion mode"), "12m2a: schedules UI shows completion mode");
assert(read("src/utils/assignedCheckCompletion.ts").includes("resolveScheduleListStatusChip"), "12m3: schedule list status chip helper exists");
assert(read("src/utils/assignedCheckCompletion.ts").includes('"Completed for period"'), "12m3a: schedule list status includes Completed for period");
assert(read("src/utils/assignedCheckCompletion.ts").includes('"Active"'), "12m3b: schedule list status includes Active");
assert(read("src/utils/assignedCheckCompletion.ts").includes('"Due soon"'), "12m3c: schedule list status includes Due soon");
assert(read("src/utils/assignedCheckCompletion.ts").includes("formatScheduleLastCompletedLabel"), "12m4: schedule last completed label helper exists");
assert(read("src/components/dashboard/DashboardThingsToDoSection.tsx").includes("AssignedCheckActionRow"), "12n: dashboard Things to do still uses assigned-check row");
assert(read("src/utils/auditAccess.ts").includes("buildCompleteWorkAssignedAudits"), "12o: Complete Work still builds from assigned-checks API");

/** 13: Schedule list completion polish — labels + enrichment from AuditResults. */
{
  const scheduleId = "schedule-polish-1";
  const completedAt = "2026-06-24T09:15:00.000Z";
  const nextDueAt = "2026-06-24T08:00:00.000Z";

  assert(
    read("src/utils/assignedCheckCompletion.ts").includes('return "Never completed"'),
    "13a: no completion shows Never completed",
  );
  assert(
    read("src/utils/assignedCheckCompletion.ts").includes("formatScheduleNextDueLabel"),
    "13b: schedule next due label helper exists",
  );

  const completion = resolveAssignedCheckCompletion(
    [
      {
        "Schedule ID": scheduleId,
        "Audit ID": "audit-1",
        "Audit Name": "Fire walk",
        "Completed At": completedAt,
        "Completed By Email": "manager@testco.test",
        Status: "completed",
      },
    ],
    {
      scheduleId,
      auditId: "audit-1",
      auditName: "Fire walk",
      email: "manager@testco.test",
      nextDueAt,
      frequency: "Daily",
    },
    new Date("2026-06-24T12:00:00.000Z"),
  );
  assert(completion.completedForCurrentDue, "13c: AuditResults completion resolves for current due");
  assert(completion.lastCompletedAt === completedAt, "13d: AuditResults completion exposes lastCompletedAt");

  const scheduleRecords = [
    {
      "Schedule ID": scheduleId,
      "Company Folder ID": "company-1",
      "Schedule Name": "Daily walk",
      Status: "ACTIVE",
      "Assigned User Emails": "manager@testco.test",
      "Audit ID": "audit-1",
      "Template Name": "Fire walk",
      Frequency: "Daily",
      "Next Due At": nextDueAt,
      "Completion Mode": "once-per-period",
    },
  ];
  const parsed = parseCompanyScheduleListFromRecords(scheduleRecords, "company-1");
  assert(parsed.length === 1, "13e: schedule with due info parses for list display");
  assert(String(parsed[0].nextDueAt || "").trim() === nextDueAt, "13f: schedule list retains nextDueAt");

  const enriched = enrichAssignedSchedulesWithCompletion(
    parsed,
    [
      {
        "Schedule ID": scheduleId,
        "Audit ID": "audit-1",
        "Audit Name": "Fire walk",
        "Completed At": completedAt,
        "Completed By Email": "manager@testco.test",
        Status: "completed",
      },
    ],
    "manager@testco.test",
    new Date("2026-06-24T12:00:00.000Z"),
  );
  assert(enriched[0]?.audits?.[0]?.completedForCurrentDue === true, "13g: enriched schedule audit completed for current due");
  const dueAudits = enriched.flatMap((schedule) =>
    (schedule.audits || []).filter((audit) => !isAssignedCheckCompletedForCurrentDue(schedule, audit)),
  );
  assert(dueAudits.length === 0, "13h: enriched once-per-period schedule hides completed due audit");
}

/** 14: Completion mode behaviour — once-per-period hides; repeatable stays available. */
{
  const {
    duePeriodStart,
    isCompletionForCurrentDueInstance,
    resolveAssignedCheckCompletion,
  } = await import("../shared/assigned-check-completion.mjs");
  const {
    resolveScheduleCompletionMode,
    shouldHideCompletedAssignedScheduleAudit,
  } = await import("../shared/schedule-completion-mode.mjs");
  const signedInEmail = "manager@testco.test";
  const companyFolderId = "company-1";
  const now = new Date("2026-06-24T12:00:00.000Z");

  assert(resolveScheduleCompletionMode({}) === "repeatable", "14a: default completion mode is repeatable");
  assert(
    resolveScheduleCompletionMode({ completionMode: "once-per-period" }) === "once-per-period",
    "14b: once-per-period mode resolves",
  );

  const dailyOnceSchedule = {
    id: "schedule-daily-once",
    companyFolderId,
    scheduleName: "Daily once",
    lifecycle: "Live",
    completionMode: "once-per-period",
    nextDueAt: "2026-06-24T08:00:00.000Z",
    audits: [{ auditId: "audit-daily", auditName: "Daily walk", frequency: "Daily", completedForCurrentDue: true }],
  };
  const dailyRepeatSchedule = {
    ...dailyOnceSchedule,
    id: "schedule-daily-repeat",
    scheduleName: "Daily repeat",
    completionMode: "repeatable",
  };

  assert(
    shouldHideCompletedAssignedScheduleAudit(dailyOnceSchedule, dailyOnceSchedule.audits[0]),
    "14c: daily once-per-period hides after completion",
  );
  assert(
    !shouldHideCompletedAssignedScheduleAudit(dailyRepeatSchedule, dailyRepeatSchedule.audits[0]),
    "14d: repeatable daily stays available after completion",
  );

  const weeklyNextDue = "2026-06-27T08:00:00.000Z";
  const weeklyCompletedAt = "2026-06-24T09:00:00.000Z";
  const weeklyCtx = {
    scheduleId: "schedule-weekly-once",
    auditId: "audit-weekly",
    auditName: "Weekly walk",
    email: signedInEmail,
    nextDueAt: weeklyNextDue,
    frequency: "Weekly",
  };
  const weeklyResult = {
    "Schedule ID": weeklyCtx.scheduleId,
    "Audit ID": weeklyCtx.auditId,
    "Audit Name": weeklyCtx.auditName,
    "Completed At": weeklyCompletedAt,
    "Completed By Email": signedInEmail,
    "Next Due At": weeklyNextDue,
    Frequency: "Weekly",
    Status: "completed",
  };
  assert(
    isCompletionForCurrentDueInstance(weeklyResult, weeklyCtx, now),
    "14e: weekly once-per-period completion matches current week",
  );
  const futureWeeklyCtx = {
    ...weeklyCtx,
    nextDueAt: "2026-07-04T08:00:00.000Z",
  };
  assert(
    !isCompletionForCurrentDueInstance(weeklyResult, futureWeeklyCtx, new Date("2026-07-05T12:00:00.000Z")),
    "14f: future weekly period is not marked complete by prior week",
  );
  assert(
    duePeriodStart("2026-07-04T08:00:00.000Z", "Weekly", new Date("2026-07-05T12:00:00.000Z")).getTime() >
      new Date(weeklyCompletedAt).getTime(),
    "14g: future weekly due period starts after prior completion",
  );

  const repeatableCompletion = resolveAssignedCheckCompletion([weeklyResult], weeklyCtx, now);
  assert(repeatableCompletion.lastCompletedAt === weeklyCompletedAt, "14h: last completed updates for completion modes");

  const dueAuditsOnce = dailyOnceSchedule.audits.filter(
    (audit) => !shouldHideCompletedAssignedScheduleAudit(dailyOnceSchedule, audit),
  );
  const dueAuditsRepeat = dailyRepeatSchedule.audits.filter(
    (audit) => !shouldHideCompletedAssignedScheduleAudit(dailyRepeatSchedule, audit),
  );
  assert(dueAuditsOnce.length === 0, "14i: once-per-period removes due audit for current period");
  assert(dueAuditsRepeat.length === 1, "14j: repeatable keeps due audit after completion");
}

/** 15: Dashboard status clarity — due/overdue/completed labels and Things to do filter. */
{
  const assignedCheckDisplay = read("src/utils/assignedCheckDisplay.ts");
  const thingsToDoSection = read("src/components/dashboard/DashboardThingsToDoSection.tsx");
  const assignedCheckRow = read("src/components/checks/AssignedCheckActionRow.tsx");
  const assignedCheckCompletion = read("src/utils/assignedCheckCompletion.ts");
  const schedulesScreen = read("src/screens/SchedulesScreen.tsx");

  assert(assignedCheckDisplay.includes('export type AssignedCheckCardStatus = "Due" | "Overdue" | "Completed" | "Not due yet"'), "15a: assigned-check card status union");
  assert(assignedCheckDisplay.includes("assignedCheckCardStatus"), "15b: assigned-check card status helper");
  assert(assignedCheckDisplay.includes("filterAssignedChecksForThingsToDo"), "15c: Things to do due-check filter");
  assert(thingsToDoSection.includes("filterAssignedChecksForThingsToDo"), "15d: Things to do uses due-check filter");
  assert(thingsToDoSection.includes("No checks due right now."), "15e: Things to do empty state");
  assert(assignedCheckRow.includes('"Overdue"') || assignedCheckDisplay.includes('"Overdue"'), "15f: overdue status label");
  assert(assignedCheckDisplay.includes('"Not due yet"'), "15g: not-due-yet status label");
  assert(assignedCheckRow.includes("assignedCheckCardStatus"), "15h: action row uses card status helper");
  assert(assignedCheckRow.includes("assignedCheckDueWindowLine"), "15i: action row shows due window");
  assert(assignedCheckCompletion.includes('"Completed for period"'), "15j: schedule list completed-for-period label");
  assert(assignedCheckCompletion.includes('"Due soon"'), "15k: schedule list due-soon label");
  assert(assignedCheckCompletion.includes('"Active"'), "15l: schedule list active label");
  assert(schedulesScreen.includes("resolveScheduleListStatusChip"), "15m: schedules screen shows management status chip");
}

console.log("[verify:assigned-checks] OK: assigned-check contract verified");
