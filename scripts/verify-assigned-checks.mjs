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
import { canCompleteAudit } from "../shared/schedule-assignees.mjs";
import {
  isActiveMyCheckScheduleStatus,
  listMyChecks,
  scheduleMatchesCompanyFolder,
} from "../server/schedule-service.mjs";
import { parseCompanyScheduleListFromRecords } from "../shared/schedule-list.mjs";

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
assert(read("src/utils/auditAccess.ts").includes("buildAuditFromAssignedSchedule"), "4g3: audit builder for assigned schedules");
assert(read("src/utils/auditAccess.ts").includes("buildCompleteWorkAssignedAudits"), "4g3b: Complete Work audits built from assigned-checks API only");
assert(read("src/utils/auditAccess.ts").includes("resolveAssignedCheckAuditId"), "4g4: stable audit id for assigned schedules");
assert(read("src/screens/AuditsScreen.tsx").includes("My assigned checks"), "4g5: Admin/Manager assigned checks UI");
assert(read("server/bert-cors.mjs").includes("PUT"), "9: CORS preflight allows PUT for audit-templates");
assert(read("src/utils/scheduleAssignees.ts").includes("deriveScheduleAssigneesFromCompanyMembers"), "4h: assignees helper retained for diagnostics");
assert(appSrc.includes("readScheduleAssigneesCache"), "4i: App reads assignee localStorage cache while loading");
assert(appSrc.includes("writeScheduleAssigneesCache"), "4i1: App writes assignee localStorage cache after load");
assert(!appSrc.includes("readCompanyMembersCache"), "4i2: App does not read company members localStorage cache");
assert(appSrc.includes("fetchScheduleAssignees"), "4i3: App loads schedule assignees from schedule-assignees API");
assert(appSrc.includes("listCompanySchedules"), "4j: App loads company schedules via shared list service");
assert(read("src/screens/SchedulesScreen.tsx").includes("schedulesLoadError"), "4k: schedules UI surfaces list read failures");

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
assert(appSrc.includes("shouldLoadAssignedChecksScreen(screen)"), "8h1: App uses assigned-checks screen gate");
assert(checkService.includes("fetchJson"), "8e: assigned checks uses fetchJson diagnostics");
assert(checkService.includes("loadErrorDetail"), "8f: assigned checks exposes load error detail");
assert(!checkService.includes("error.message : ASSIGNED_CHECKS_USER_MESSAGE"), "8g: assigned checks does not surface raw NetworkError as primary message");
assert(coreRoutes.includes("trustSessionContext"), "8k: assigned-checks route uses session fast path");
assert(read("server/schedule-service.mjs").includes("buildSessionScheduleContext"), "8l: session schedule context helper exists");
assert(read("server/schedule-service.mjs").includes("canonicalSchedulesOnly"), "8m: assigned checks reads canonical Schedules tab only");
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
  assert(read("src/screens/AuditsScreen.tsx").includes('"Start"'), "10n: Complete Work UI exposes Start");
  assert(read("src/screens/AuditsScreen.tsx").includes('"Continue"'), "10o: Complete Work UI exposes Continue");
}

console.log("[verify:assigned-checks] OK: assigned-check contract verified");
