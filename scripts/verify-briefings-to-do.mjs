#!/usr/bin/env node
/**
 * Briefings + dashboard To Do foundation verifier.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIEFINGS_TAB,
  BRIEFINGS_TAB_COLUMNS,
  BRIEFING_RECIPIENTS_TAB,
  buildBriefingRow,
  buildRecipientRow,
  canAccessBriefings,
  canManageBriefings,
  canViewBriefingsTracker,
  createAndSendBriefing,
  listBriefingsTodoPreview,
  listMyBriefings,
  listBriefingsTracker,
  mapBriefingRecord,
  openBriefing,
  readBriefing,
  acknowledgeBriefing,
  signBriefing,
  replyToBriefing,
  recipientNeedsAction,
  validateBriefingCreateInput,
} from "../server/briefings-service.mjs";
import { BRIEFINGS_DRIVE_PATH_PREFIX } from "../shared/briefings.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let caseCount = 0;

function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const pkg = JSON.parse(read("package.json"));
const appTsx = read("App.tsx");
const roleNav = read("src/config/roleNavigation.ts");
const permissions = read("src/permissions.ts");
const coreRoutes = read("server/core-workflow-routes.mjs");
const ensureTabs = read("server/ensure-required-tabs.mjs");
const folderStructure = read("server/company-folder-structure.mjs");

assert(pkg.scripts["verify:briefings-to-do"], "PKG: npm script registered");
assert(roleNav.includes('id: "briefings", label: "Briefings"'), "NAV: sidebar includes Briefings");
assert(permissions.includes("canAccessBriefings"), "PERM: canAccessBriefings exists");
assert(permissions.includes("canManageBriefings"), "PERM: canManageBriefings exists");
assert(permissions.includes('if (itemId === "briefings")'), "PERM: briefings nav wired");

assert(read("src/components/dashboard/DashboardToDoSection.tsx").includes("To Do"), "UI: dashboard To Do section title");
assert(read("src/components/dashboard/DashboardToDoSection.tsx").includes("all caught up"), "UI: To Do empty state");
assert(read("src/components/dashboard/AuditorTaskDashboard.tsx").includes("DashboardToDoSection"), "APP: DashboardToDoSection wired");
assert(appTsx.includes("BriefingsScreen"), "APP: BriefingsScreen wired");
assert(appTsx.includes('screen === "briefings"'), "APP: briefings route mounted");
assert(appTsx.includes("fetchBriefingsTodoPreview"), "APP: lazy briefing todo preview");
assert(appTsx.includes("shouldLoadDashboardBriefingsPreview"), "APP: dashboard briefing preview gate");
assert(read("src/components/dashboard/ManagerRoleDashboard.tsx").includes("DashboardToDoSection"), "UI: manager dashboard uses To Do");
assert(
  read("src/components/dashboard/CompanyAdminDashboard.tsx").indexOf("DashboardToDoSection") <
    read("src/components/dashboard/CompanyAdminDashboard.tsx").indexOf("Next steps"),
  "UI: admin To Do before other cards",
);

assert(ensureTabs.includes('"Briefings"') && ensureTabs.includes('"BriefingRecipients"'), "WB: required tabs registered");
assert(BRIEFINGS_TAB_COLUMNS.includes("DocumentDriveFileId"), "WB: drive file id column");
assert(!BRIEFINGS_TAB_COLUMNS.some((col) => /binary|blob|base64/i.test(col)), "WB: no binary columns");

assert(folderStructure.includes("ensureBriefingDocumentFolderId"), "DRIVE: briefing folder helper");
assert(folderStructure.includes("04 - Documents"), "DRIVE: documents folder path");
assert(BRIEFINGS_DRIVE_PATH_PREFIX.includes("Briefings"), "DRIVE: briefings prefix");

assert(coreRoutes.includes("/briefings/mine"), "API: mine route");
assert(coreRoutes.includes("/briefings/todo"), "API: todo route");
assert(coreRoutes.includes("/briefings/tracker"), "API: tracker route");
assert(coreRoutes.includes('app.post("/api/companies/:companyFolderId/briefings"'), "API: create route");
assert(coreRoutes.includes("/briefings/:briefingId/open"), "API: open route");
assert(coreRoutes.includes("/briefings/:briefingId/sign"), "API: sign route");

assert(appTsx.includes("AuditCentreScreen"), "SAFE: Audit Centre still mounted");
assert(read("server/incident-evidence-upload.mjs").includes("INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX"), "SAFE: incident evidence path preserved");

const companyFolderId = "folder-briefings-test";
const masterSheetId = "sheet-briefings-test";
const briefingStore = [];
const recipientStore = [];

async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
  if (tabName === BRIEFINGS_TAB) {
    return { ok: true, records: briefingStore.map((row) => ({ ...row })), rowCount: briefingStore.length };
  }
  if (tabName === BRIEFING_RECIPIENTS_TAB) {
    return { ok: true, records: recipientStore.map((row) => ({ ...row })), rowCount: recipientStore.length };
  }
  return { ok: true, records: [], rowCount: 0 };
}

async function mockAppendTabRows(_auth, _deps, _sheetId, tabName, _columns, rows = []) {
  if (tabName === BRIEFINGS_TAB) briefingStore.push(...rows);
  if (tabName === BRIEFING_RECIPIENTS_TAB) recipientStore.push(...rows);
  return { ok: true, written: rows.length };
}

async function mockWriteTabRecords(_auth, _deps, _sheetId, tabName, _columns, records = []) {
  if (tabName === BRIEFING_RECIPIENTS_TAB) {
    recipientStore.length = 0;
    recipientStore.push(...records);
  }
  if (tabName === BRIEFINGS_TAB) {
    briefingStore.length = 0;
    briefingStore.push(...records);
  }
  return { ok: true };
}

async function mockEnsureTabColumns() {
  return { addedColumns: [], headers: BRIEFINGS_TAB_COLUMNS };
}

async function mockPatchTabRowByHeader(_auth, _deps, _sheetId, tabName, _matchHeader, matchValue, updates = {}) {
  if (tabName === BRIEFINGS_TAB) {
    const row = briefingStore.find((entry) => entry.BriefingId === matchValue);
    if (row) Object.assign(row, updates);
  }
}

async function mockResolveCompanyScheduleContext() {
  return { ok: true, companyId: companyFolderId, companyFolderId, masterSheetId };
}

async function mockReadUsersTabProfiles() {
  return {
    ok: true,
    profiles: [
      { email: "manager@test.co", name: "Manager One", role: "Manager", department: "Ops" },
      { email: "auditor@test.co", name: "Auditor One", role: "Auditor", department: "Ops" },
    ],
  };
}

const mockDeps = {
  readTabRecords: mockReadTabRecords,
  appendTabRows: mockAppendTabRows,
  writeTabRecords: mockWriteTabRecords,
  ensureTabColumns: mockEnsureTabColumns,
  patchTabRowByHeader: mockPatchTabRowByHeader,
  resolveCompanyScheduleContext: mockResolveCompanyScheduleContext,
  readUsersTabProfiles: mockReadUsersTabProfiles,
};

const managerActor = {
  kind: "company",
  role: "Manager",
  email: "manager@test.co",
  companyFolderId,
  masterSheetId,
};

const auditorActor = {
  kind: "company",
  role: "Auditor",
  email: "auditor@test.co",
  companyFolderId,
  masterSheetId,
};

assert(canManageBriefings(managerActor), "ROLE: manager can manage");
assert(canAccessBriefings(auditorActor), "ROLE: auditor can access");
assert(canViewBriefingsTracker(managerActor), "ROLE: manager can view tracker");
assert(!canViewBriefingsTracker(auditorActor), "ROLE: auditor cannot view tracker");

const invalid = validateBriefingCreateInput({ title: "", type: "Notice", targetMode: "everyone" });
assert(!invalid.ok, "VAL: title required");

const row = buildBriefingRow({
  briefingId: "BRF-2026-1001",
  title: "Quality Policy 2026",
  type: "Policy",
  targetMode: "everyone",
  requiresSignature: true,
  documentDriveFileId: "drive-file-123",
  documentDriveLink: "https://drive.google.com/file/d/drive-file-123/view",
  createdByEmail: "manager@test.co",
  recipientCount: 2,
});
assert(row.DocumentDriveFileId === "drive-file-123", "ROW: stores drive file id not binary");
assert(!JSON.stringify(row).includes("base64"), "ROW: no embedded binary");

const sent = await createAndSendBriefing({}, mockDeps, managerActor, companyFolderId, {
  title: "Safety Notice",
  type: "Notice",
  targetMode: "users",
  targetUserEmails: ["auditor@test.co"],
  requiresRead: true,
  requiresAcknowledgement: true,
  message: "Read carefully",
});
assert(sent.ok, "FLOW: manager can create briefing");
assert(recipientStore.length >= 1, "FLOW: briefing recipients created");

const briefingId = sent.briefing.briefingId;
const mineAuditor = await listMyBriefings({}, mockDeps, auditorActor, companyFolderId);
assert(mineAuditor.ok && mineAuditor.items.some((item) => item.briefingId === briefingId), "FLOW: auditor sees assigned briefing");
assert(mineAuditor.items.every((item) => item.recipientEmail === "auditor@test.co"), "FLOW: auditor scoped to own items");

const trackerDenied = await listBriefingsTracker({}, mockDeps, auditorActor, companyFolderId);
assert(!trackerDenied.ok, "FLOW: auditor cannot access tracker");

const opened = await openBriefing({}, mockDeps, auditorActor, companyFolderId, briefingId);
assert(opened.ok && opened.recipient.openedAt, "FLOW: OpenedAt recorded");

const readResult = await readBriefing({}, mockDeps, auditorActor, companyFolderId, briefingId);
assert(readResult.ok && readResult.recipient.readAt, "FLOW: ReadAt recorded");

const ackResult = await acknowledgeBriefing({}, mockDeps, auditorActor, companyFolderId, briefingId);
assert(ackResult.ok && ackResult.recipient.acknowledgedAt, "FLOW: AcknowledgedAt recorded");

const briefing = mapBriefingRecord(briefingStore.find((entry) => entry.BriefingId === briefingId));
assert(!recipientNeedsAction(ackResult.recipient, briefing), "FLOW: completed briefing not active");

const todoAfter = await listBriefingsTodoPreview({}, mockDeps, auditorActor, companyFolderId, 5);
assert((todoAfter.items || []).every((item) => item.briefingId !== briefingId), "FLOW: completed briefing removed from active todo");

const tracker = await listBriefingsTracker({}, mockDeps, managerActor, companyFolderId);
assert(tracker.ok && tracker.items.length >= 1, "FLOW: manager tracker loads");
assert(Number(tracker.items[0].readCount) >= 1, "FLOW: tracker counts update");

const signBriefingId = "BRF-2026-2002";
briefingStore.push(
  buildBriefingRow({
    briefingId: signBriefingId,
    title: "Sign me",
    type: "Policy",
    targetMode: "users",
    requiresSignature: true,
    createdByEmail: "manager@test.co",
    recipientCount: 1,
  }),
);
recipientStore.push(
  buildRecipientRow({
    briefingId: signBriefingId,
    recipientEmail: "auditor@test.co",
    recipientName: "Auditor One",
    status: "New",
  }),
);
const signed = await signBriefing({}, mockDeps, auditorActor, companyFolderId, signBriefingId, {
  signatureName: "Auditor One",
});
assert(signed.ok && signed.recipient.signatureName === "Auditor One" && signed.recipient.signedAt, "FLOW: signature stored");

const replyBriefingId = "BRF-2026-3003";
briefingStore.push(
  buildBriefingRow({
    briefingId: replyBriefingId,
    title: "Reply me",
    type: "Notice",
    targetMode: "users",
    requiresReply: true,
    createdByEmail: "manager@test.co",
    recipientCount: 1,
  }),
);
recipientStore.push(
  buildRecipientRow({
    briefingId: replyBriefingId,
    recipientEmail: "auditor@test.co",
    recipientName: "Auditor One",
    status: "New",
  }),
);
const replied = await replyToBriefing({}, mockDeps, auditorActor, companyFolderId, replyBriefingId, {
  replyText: "Acknowledged in yard",
});
assert(replied.ok && replied.recipient.replyText === "Acknowledged in yard" && replied.recipient.replyAt, "FLOW: reply stored");

console.log(`verify:briefings-to-do — ${caseCount} checks OK`);
