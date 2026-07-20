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
  expandBriefingRecipientProfilesFromRecords,
  isUsableBriefingRecipientStatus,
  listBriefingsTodoPreview,
  listMyBriefings,
  listBriefingsTracker,
  mapBriefingRecord,
  mapRecordToBriefingRecipientProfile,
  openBriefing,
  readBriefing,
  acknowledgeBriefing,
  signBriefing,
  replyToBriefing,
  recipientNeedsAction,
  briefingActionLabel,
  validateBriefingCreateInput,
  actorCanAccessCompanyBriefings,
  briefingApiFailure,
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
assert(read("src/components/dashboard/AuditorTaskDashboard.tsx").includes("My work today"), "APP: auditor simplified dashboard wired");
assert(appTsx.includes("BriefingsScreen"), "APP: BriefingsScreen wired");
assert(appTsx.includes('screen === "briefings"'), "APP: briefings route mounted");
assert(
  appTsx.includes("loadBriefingsTodoPreviewCached") || appTsx.includes("fetchBriefingsTodoPreview"),
  "APP: lazy briefing todo preview",
);
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
assert(coreRoutes.includes("briefingRouteError"), "API: standardized briefing error helper");

const briefingsServiceTs = read("src/services/briefingsService.ts");
assert(briefingsServiceTs.includes("payload?.error || payload?.message"), "CLIENT: prefers backend error field");
assert(briefingsServiceTs.includes("payload?.details"), "CLIENT: appends backend details");
assert(briefingsServiceTs.includes("refresh"), "CLIENT: mine fetch supports refresh after actions");

const briefingsScreenTs = read("src/screens/BriefingsScreen.tsx");
assert(briefingsScreenTs.includes("briefingActionPending"), "UI: briefing actions use pending checks");
assert(briefingsScreenTs.includes("refresh: true"), "UI: reload mine after actions bypasses dedupe");

const briefingActionsTs = read("src/utils/briefingActions.ts");
assert(briefingActionsTs.includes("requiresRead && !item.readAt"), "UI: action order starts with read");
assert(
  briefingActionsTs.indexOf("requiresAcknowledgement") < briefingActionsTs.indexOf("requiresSignature"),
  "UI: acknowledge precedes sign in action order",
);
assert(briefingActionsTs.includes("buildOptimisticBriefingPatch"), "UI: optimistic briefing patch helper");
assert(briefingActionsTs.includes('return "Complete"'), "UI: complete briefings label as Complete");
assert(briefingActionsTs.includes("briefingCompletionSummary"), "UI: completion summary for finished briefings");
assert(briefingActionsTs.includes("briefingActionInFlightKey"), "UI: per-action in-flight dedupe key");

assert(briefingsScreenTs.includes("buildOptimisticBriefingPatch"), "UI: optimistic patch on action click");
assert(briefingsScreenTs.includes("actionInFlightRef"), "UI: blocks duplicate action submits");
assert(briefingsScreenTs.includes("silent: true"), "UI: background refresh without loading gate");
assert(briefingsScreenTs.includes("Sync failed. Please retry."), "UI: failed sync shows retry message");
assert(briefingsScreenTs.includes("isActionPending"), "UI: only clicked action button disabled");
assert(briefingsScreenTs.includes("briefingCompletionSummary"), "UI: complete briefing summary label");
assert(!briefingsScreenTs.includes('Action: {briefingActionLabel'), "UI: no misleading Action: Open on complete");
assert(briefingsScreenTs.includes("Saving…"), "UI: immediate saving feedback");
assert(briefingsScreenTs.includes("loadTracker({ silent: true })"), "UI: tracker refreshes after action success");

const briefingTodoEffectStart = appTsx.indexOf("const cacheKey = briefingsTodoPreviewCacheKey");
const briefingTodoCatch = appTsx.slice(briefingTodoEffectStart, briefingTodoEffectStart + 1200);
const briefingTodoCatchBlock = briefingTodoCatch.slice(briefingTodoCatch.indexOf("} catch {"));
assert(briefingTodoCatch.includes("catch {"), "SOFT: briefing todo uses bare catch");
assert(
  (briefingTodoCatchBlock.includes("items: []") || briefingTodoCatchBlock.includes("items: cached")) &&
    !briefingTodoCatchBlock.includes("loadError:"),
  "SOFT: dashboard briefing todo fails soft without loadError",
);
assert(read("server/incident-evidence-upload.mjs").includes("INCIDENT_EVIDENCE_DRIVE_PATH_PREFIX"), "SAFE: incident evidence path preserved");

assert(appTsx.includes("AuditCentreScreen"), "SAFE: Audit Centre still mounted");

const companyFolderId = "folder-briefings-test";
const masterSheetId = "sheet-briefings-test";
const briefingStore = [];
const recipientStore = [];
let peopleTabRows = [];
let usersTabRows = [
  { Email: "manager@test.co", Name: "Manager One", Role: "Manager", Status: "ACTIVE", Department: "Ops" },
  { Email: "auditor@test.co", Name: "Auditor One", Role: "Auditor", Status: "active", Department: "Ops" },
];

async function mockReadTabRecords(_auth, _deps, _sheetId, tabName) {
  if (tabName === BRIEFINGS_TAB) {
    return { ok: true, records: briefingStore.map((row) => ({ ...row })), rowCount: briefingStore.length };
  }
  if (tabName === BRIEFING_RECIPIENTS_TAB) {
    return { ok: true, records: recipientStore.map((row) => ({ ...row })), rowCount: recipientStore.length };
  }
  if (tabName === "People") {
    return { ok: true, records: peopleTabRows.map((row) => ({ ...row })), rowCount: peopleTabRows.length };
  }
  if (tabName === "Users") {
    return { ok: true, records: usersTabRows.map((row) => ({ ...row })), rowCount: usersTabRows.length };
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
  return {
    ok: true,
    companyId: companyFolderId,
    companyFolderId,
    masterSheetId,
    alternateIds: [companyFolderId],
  };
}

const mockDeps = {
  readTabRecords: mockReadTabRecords,
  appendTabRows: mockAppendTabRows,
  writeTabRecords: mockWriteTabRecords,
  ensureTabColumns: mockEnsureTabColumns,
  patchTabRowByHeader: mockPatchTabRowByHeader,
  resolveCompanyScheduleContext: mockResolveCompanyScheduleContext,
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

const emptyMine = await listMyBriefings({}, mockDeps, auditorActor, companyFolderId);
assert(emptyMine.ok && Array.isArray(emptyMine.items) && emptyMine.items.length === 0, "EMPTY: mine returns ok with empty items");

const emptyTodo = await listBriefingsTodoPreview({}, mockDeps, auditorActor, companyFolderId, 5);
assert(emptyTodo.ok && Array.isArray(emptyTodo.items) && emptyTodo.items.length === 0, "EMPTY: todo returns ok with empty items");

const emptyTracker = await listBriefingsTracker({}, mockDeps, managerActor, companyFolderId);
assert(emptyTracker.ok && Array.isArray(emptyTracker.items) && emptyTracker.items.length === 0, "EMPTY: tracker returns ok with empty items");

const invalidTarget = validateBriefingCreateInput({
  title: "Test",
  type: "Notice",
  targetMode: "users",
  targetUserEmails: [],
});
assert(!invalidTarget.ok && invalidTarget.error, "ERR: validation includes error field");

const dueValid = validateBriefingCreateInput({
  title: "T",
  type: "Notice",
  targetMode: "everyone",
  dueDate: "2026-07-15",
});
assert(dueValid.ok && dueValid.dueDate === "2026-07-15", "DATE: accepts YYYY-MM-DD");

const dueIso = validateBriefingCreateInput({
  title: "T",
  type: "Notice",
  targetMode: "everyone",
  dueDate: "2026-07-15T00:00:00.000Z",
});
assert(dueIso.ok && dueIso.dueDate === "2026-07-15", "DATE: normalizes ISO due date");

const invalid = validateBriefingCreateInput({ title: "", type: "Notice", targetMode: "everyone" });
assert(!invalid.ok && invalid.error, "VAL: title required with error field");

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

const ackResult = await acknowledgeBriefing({ }, mockDeps, auditorActor, companyFolderId, briefingId);
assert(ackResult.ok && ackResult.recipient.acknowledgedAt, "FLOW: AcknowledgedAt recorded");

const briefing = mapBriefingRecord(briefingStore.find((entry) => entry.BriefingId === briefingId));
assert(briefingActionLabel(ackResult.recipient, briefing) === "Open", "FLOW: action label follows workflow order");
assert(!recipientNeedsAction(ackResult.recipient, briefing), "FLOW: completed briefing not active");

const multiActionBriefingId = "BRF-2026-4004";
briefingStore.push(
  buildBriefingRow({
    briefingId: multiActionBriefingId,
    title: "Read then sign",
    type: "Policy",
    targetMode: "users",
    requiresRead: true,
    requiresAcknowledgement: true,
    requiresSignature: true,
    createdByEmail: "manager@test.co",
    recipientCount: 1,
  }),
);
recipientStore.push(
  buildRecipientRow({
    briefingId: multiActionBriefingId,
    recipientEmail: "auditor@test.co",
    recipientName: "Auditor One",
    status: "New",
  }),
);
const multiBriefing = mapBriefingRecord(briefingStore.find((entry) => entry.BriefingId === multiActionBriefingId));
const multiRead = await readBriefing({}, mockDeps, auditorActor, companyFolderId, multiActionBriefingId);
assert(multiRead.ok && multiRead.recipient.readAt, "FLOW: multi-action read recorded");
assert(briefingActionLabel(multiRead.recipient, multiBriefing) === "Acknowledge", "FLOW: after read next action is acknowledge");
const multiAck = await acknowledgeBriefing({}, mockDeps, auditorActor, companyFolderId, multiActionBriefingId);
assert(multiAck.ok && multiAck.recipient.acknowledgedAt, "FLOW: multi-action acknowledge recorded");
assert(briefingActionLabel(multiAck.recipient, multiBriefing) === "Sign", "FLOW: after acknowledge next action is sign");
const multiSign = await signBriefing({}, mockDeps, auditorActor, companyFolderId, multiActionBriefingId, {
  signatureName: "Auditor One",
});
assert(multiSign.ok && multiSign.recipient.signedAt, "FLOW: multi-action sign recorded after read");
assert(!recipientNeedsAction(multiSign.recipient, multiBriefing), "FLOW: multi-action briefing complete");

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

const rootFolderId = "folder-root-briefings";
const registryCompanyId = "company-registry-briefings";
const altMasterSheetId = "sheet-alt-briefings";

async function mockResolveAlternates(_auth, _deps, input = {}) {
  const hint = input.companyFolderId || input.companyId;
  return {
    ok: true,
    companyId: rootFolderId,
    companyFolderId: rootFolderId,
    masterSheetId: altMasterSheetId,
    alternateIds: [registryCompanyId, rootFolderId, hint].filter(Boolean),
  };
}

const altDeps = {
  ...mockDeps,
  resolveCompanyScheduleContext: mockResolveAlternates,
};

const managerAltActor = {
  kind: "company",
  role: "Manager",
  email: "manager@test.co",
  companyId: registryCompanyId,
  masterSheetId: altMasterSheetId,
};

assert(
  actorCanAccessCompanyBriefings(managerAltActor, rootFolderId, [registryCompanyId, rootFolderId]),
  "ALT: session registry id matches resolved alternates",
);

const altMine = await listMyBriefings({}, altDeps, managerAltActor, rootFolderId);
assert(altMine.ok && Array.isArray(altMine.items), "ALT: mine works with alternate company ids");

const altTracker = await listBriefingsTracker({}, altDeps, managerAltActor, rootFolderId);
assert(altTracker.ok && Array.isArray(altTracker.items), "ALT: tracker works with alternate company ids");

const everyoneSent = await createAndSendBriefing({}, altDeps, managerAltActor, rootFolderId, {
  title: "Company-wide notice",
  type: "Notice",
  targetMode: "everyone",
  requiresRead: true,
});
assert(everyoneSent.ok, "EVERYONE: manager can create briefing for everyone");
assert(everyoneSent.recipientCount >= 2, "EVERYONE: expands to company users");

const emptyUsersDeps = {
  ...mockDeps,
};
peopleTabRows = [];
usersTabRows = [];
const noRecipients = await createAndSendBriefing({}, emptyUsersDeps, managerActor, companyFolderId, {
  title: "Nobody home",
  type: "Notice",
  targetMode: "everyone",
});
assert(!noRecipients.ok, "ERR: everyone with no users fails");
assert(noRecipients.error && noRecipients.error.includes("No recipients"), "ERR: clear error message");
assert(noRecipients.details && noRecipients.details.includes("tabs checked"), "ERR: empty workbook includes tabs checked");
assert(!noRecipients.technicalError, "ERR: no technical leak");

peopleTabRows = [
  { PersonEmail: "people.admin@test.co", DisplayName: "People Admin", Roles: "Admin", UserStatus: "ACTIVE" },
  { PersonEmail: "people.auditor@test.co", DisplayName: "People Auditor", Roles: "Auditor", UserStatus: "enabled" },
];
usersTabRows = [];
const peopleExpanded = expandBriefingRecipientProfilesFromRecords(peopleTabRows);
assert(peopleExpanded.length === 2, "EVERYONE: People tab expands valid profiles");
assert(peopleExpanded.some((row) => row.email === "people.admin@test.co"), "EVERYONE: People tab reads PersonEmail");

peopleTabRows = [];
usersTabRows = [
  { UserEmail: "users.manager@test.co", FullName: "Users Manager", Role: "Manager", Status: "Active" },
  { UserEmail: "users.blank@test.co", FullName: "Legacy Blank", Role: "User", Status: "" },
];
const usersExpanded = expandBriefingRecipientProfilesFromRecords(usersTabRows);
assert(usersExpanded.length === 2, "EVERYONE: Users fallback expands valid profiles");
assert(usersExpanded.some((row) => row.email === "users.blank@test.co"), "STATUS: blank legacy status accepted");

assert(isUsableBriefingRecipientStatus("ACTIVE"), "STATUS: ACTIVE casing accepted");
assert(isUsableBriefingRecipientStatus("enabled"), "STATUS: enabled accepted");
assert(!isUsableBriefingRecipientStatus("disabled"), "STATUS: disabled excluded");
assert(!isUsableBriefingRecipientStatus("revoked"), "STATUS: revoked excluded");
assert(!isUsableBriefingRecipientStatus("inactive"), "STATUS: inactive excluded");

const deduped = expandBriefingRecipientProfilesFromRecords([
  { Email: "dup@test.co", Name: "One", Status: "active" },
  { email: "dup@test.co", Name: "Duplicate", Status: "ACTIVE" },
]);
assert(deduped.length === 1 && deduped[0].email === "dup@test.co", "DEDUPE: duplicate emails collapsed");

assert(mapRecordToBriefingRecipientProfile({ Name: "No Email", Status: "active" }) === null, "EMAIL: missing email rows skipped");

const failureShape = briefingApiFailure("TEST_CODE", "Safe user message", "Optional detail");
assert(failureShape.ok === false && failureShape.error === "Safe user message", "ERR: briefingApiFailure shape");

assert(
  read("server/briefings-service.mjs").includes("trustSessionContext"),
  "CTX: briefings resolver forwards session-trusted workbook context",
);
assert(
  read("server/schedule-service.mjs").includes("tryResolveTrustedCompanyScheduleContext"),
  "CTX: schedule service trusted workbook fast path exists",
);

console.log(`verify:briefings-to-do — ${caseCount} checks OK`);
