#!/usr/bin/env node
/** Eight schedule auditor loading cases — Users tab rows, casing, area, company scope, diagnostics. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAvailableScheduleAuditorsFromUsers,
  buildScheduleAuditorDiagnostics,
  belongsToCurrentCompany,
  isActiveUser,
  isAuditorUser,
} from "../shared/schedule-auditors.mjs";

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

const ownCompany = "company-folder-own";
const otherCompany = "company-folder-other";

const activeAuditorByRole = {
  email: "auditor.role@example.com",
  name: "Role Auditor",
  role: "Auditor",
  accessLevel: "operational",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: [],
};

const activeAuditorByAccessLevel = {
  email: "auditor.access@example.com",
  name: "Access Auditor",
  role: "User",
  accessLevel: "AUDITOR",
  status: "Active",
  companyId: ownCompany,
  companyAreas: [],
};

const mixedCaseAuditor = {
  email: "auditor.mixed@example.com",
  name: "Mixed Case",
  role: "auditor",
  accessLevel: "Auditor",
  status: "active",
  companyId: ownCompany,
  companyAreas: [],
};

const blankAreasAuditor = {
  email: "auditor.blank@example.com",
  name: "Blank Areas",
  role: "Auditor",
  accessLevel: "AUDITOR",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: [],
};

const matchingAreaAuditor = {
  email: "auditor.area@example.com",
  name: "Area Match",
  role: "Auditor",
  accessLevel: "AUDITOR",
  status: "ACTIVE",
  companyId: ownCompany,
  companyAreas: ["Bay 2"],
};

const otherCompanyAuditor = {
  email: "auditor.other@example.com",
  name: "Other Company",
  role: "Auditor",
  accessLevel: "AUDITOR",
  status: "ACTIVE",
  companyId: otherCompany,
  companyAreas: [],
};

const inactiveAuditor = {
  email: "auditor.inactive@example.com",
  name: "Inactive",
  role: "Auditor",
  accessLevel: "AUDITOR",
  status: "INVITED",
  companyId: ownCompany,
  companyAreas: [],
};

/** 1: Role Auditor + Status ACTIVE appears. */
{
  const { auditors } = buildAvailableScheduleAuditorsFromUsers([activeAuditorByRole], {
    companyId: ownCompany,
  });
  assert(auditors.some((item) => item.email === activeAuditorByRole.email), "1: Role Auditor + ACTIVE appears");
}

/** 2: AccessLevel AUDITOR + Status ACTIVE appears. */
{
  const { auditors } = buildAvailableScheduleAuditorsFromUsers([activeAuditorByAccessLevel], {
    companyId: ownCompany,
  });
  assert(
    auditors.some((item) => item.email === activeAuditorByAccessLevel.email),
    "2: AccessLevel AUDITOR + ACTIVE appears",
  );
}

/** 3: Lowercase/mixed-case role/status still appears. */
{
  const { auditors } = buildAvailableScheduleAuditorsFromUsers([mixedCaseAuditor], {
    companyId: ownCompany,
  });
  assert(auditors.some((item) => item.email === mixedCaseAuditor.email), "3: mixed-case role/status appears");
  assert(isActiveUser(mixedCaseAuditor) && isAuditorUser(mixedCaseAuditor), "3b: helpers accept mixed case");
}

/** 4: Blank CompanyAreas appears when no schedule area selected. */
{
  const { auditors } = buildAvailableScheduleAuditorsFromUsers([blankAreasAuditor], {
    companyId: ownCompany,
    selectedArea: "",
  });
  assert(auditors.some((item) => item.email === blankAreasAuditor.email), "4: blank CompanyAreas with no area filter");
}

/** 5: Matching selected area appears. */
{
  const { auditors } = buildAvailableScheduleAuditorsFromUsers([matchingAreaAuditor], {
    companyId: ownCompany,
    selectedArea: "Bay 2",
  });
  assert(auditors.some((item) => item.email === matchingAreaAuditor.email), "5: matching selected area appears");
}

/** 6: Auditor from another company does not appear. */
{
  const { auditors } = buildAvailableScheduleAuditorsFromUsers([otherCompanyAuditor], {
    companyId: ownCompany,
  });
  assert(!auditors.some((item) => item.email === otherCompanyAuditor.email), "6: other-company auditor excluded");
  assert(!belongsToCurrentCompany(otherCompanyAuditor, ownCompany), "6b: belongsToCurrentCompany rejects other company");
}

/** 7: PasswordHash is not returned from server sanitisation path. */
{
  const companyUsersSrc = read("server/company-users.mjs");
  const serverSrc = read("server/server.mjs");
  assert(companyUsersSrc.includes("sanitizeUsersTabRecords"), "7: sanitizeUsersTabRecords exists");
  assert(serverSrc.includes("sanitizeUsersTabRecords(records)"), "7b: company sheet read sanitises Users tab");
  assert(serverSrc.includes("/api/schedules/auditors"), "7c: schedule auditors endpoint exists");
}

/** 8: Diagnostics show why a user was excluded. */
{
  const diagnostics = buildScheduleAuditorDiagnostics(
    [activeAuditorByRole, inactiveAuditor, otherCompanyAuditor],
    { companyId: ownCompany, masterSheetId: "sheet-123", selectedArea: "" },
  );
  assert(diagnostics.totalRows === 3, "8: diagnostics total rows");
  assert(diagnostics.excludedByStatus >= 1, "8b: inactive user counted in excludedByStatus");
  assert(diagnostics.excludedByCompany >= 1, "8c: other-company user counted in excludedByCompany");
  const inactiveCandidate = diagnostics.candidates.find((item) => item.email === inactiveAuditor.email);
  const otherCandidate = diagnostics.candidates.find((item) => item.email === otherCompanyAuditor.email);
  assert(inactiveCandidate?.excludedReason === "inactive_status", "8d: inactive exclusion reason");
  assert(otherCandidate?.excludedReason === "wrong_company", "8e: company exclusion reason");
}

const scheduleAuditorsSrc = read("src/utils/scheduleAuditors.ts");
const appSrc = read("App.tsx");
assert(scheduleAuditorsSrc.includes("CompanyUsersTabRow"), "8f: scheduleAuditors defines CompanyUsersTabRow");
assert(appSrc.includes("companyUsersTabRows"), "8g: App stores Users tab rows for schedule builder");
assert(appSrc.includes("parseCompanyUsersTabRows"), "8h: App parses Users tab rows from company sheet");

console.log("[verify:schedule-auditors] OK: all 8 schedule auditor cases passed");
