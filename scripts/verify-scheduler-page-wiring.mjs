#!/usr/bin/env node
/** Scheduler page — assignees from schedule-assignees API, schedules list/save via company routes. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const appTsx = read("App.tsx");
const schedulesScreen = read("src/screens/SchedulesScreen.tsx");
const scheduleService = read("src/services/scheduleService.ts");
const contextService = read("src/services/companyContextService.ts");
const pkg = JSON.parse(read("package.json"));

assert(pkg.scripts["verify:scheduler-page-wiring"], "PKG: npm script registered");

/** 1: Assignees — canonical GET /schedule-assignees only. */
assert(scheduleService.includes("fetchScheduleAssignees"), "1: client fetchScheduleAssignees");
assert(scheduleService.includes("/schedule-assignees"), "1b: schedule-assignees API path");
assert(appTsx.includes("fetchScheduleAssignees"), "1c: App loads assignees via fetchScheduleAssignees");
assert(
  /shouldLoadScheduleAssigneesScreen\(screen\)[\s\S]{0,6000}fetchScheduleAssignees/.test(appTsx),
  "1d: schedules/actions screen gate before fetchScheduleAssignees",
);
assert(!appTsx.includes("deriveScheduleAssigneesFromCompanyMembers"), "1e: App does not derive assignees locally");
assert(appTsx.includes("readScheduleAssigneesCache"), "1f: assignee localStorage cache used while loading");
assert(appTsx.includes("writeScheduleAssigneesCache"), "1f2: assignee localStorage cache updated after load");
assert(!appTsx.includes("buildAvailableScheduleAssignees("), "1g: no local assignee filtering in App");

/** 2: Schedules list + save — company API routes. */
assert(scheduleService.includes("listCompanySchedules"), "2: client listCompanySchedules");
assert(scheduleService.includes("saveCompanySchedule"), "2b: client saveCompanySchedule");
assert(appTsx.includes("listCompanySchedules"), "2c: App loads schedules list");
assert(appTsx.includes("saveCompanySchedule"), "2d: App saves via POST schedules route");
assert(appTsx.includes("assignedUserEmails"), "2e: save uses assignedUserEmails");

/** 3: Session company context — no localStorage companyName truth. */
assert(contextService.includes("resolveActiveCompanyContext"), "3: unified company context resolver");
assert(appTsx.includes("activeCompanyContext"), "3b: App uses activeCompanyContext");
assert(appTsx.includes("resolveCompanyMembersLoadContext"), "3c: shared load context for scheduler APIs");

/** 4: Friendly states + timeouts. */
assert(scheduleService.includes("SCHEDULE_ASSIGNEES_LOAD_TIMEOUT_MS"), "4: assignee load timeout");
assert(scheduleService.includes("COMPANY_SCHEDULES_LOAD_TIMEOUT_MS"), "4b: schedules list load timeout");
assert(schedulesScreen.includes("schedulesLoadError"), "4c: schedules list error UI");
assert(schedulesScreen.includes("Assign users to this schedule"), "4d: assignee picker present");
assert(!schedulesScreen.includes("No available auditors"), "4e: no auditor-only empty copy");

/** 5: No auditor-only filtering in App scheduler path. */
assert(!appTsx.includes("findPendingAssigneeInvites"), "5: pending invites not merged into assignees");
assert(!appTsx.includes("buildAvailableScheduleAuditors("), "5b: no auditor-only assignee builder in App");

/** 6: Edit scrolls to the schedule builder form inside the app scroll stage. */
assert(schedulesScreen.includes("onOpenSchedule(schedule.id)"), "6: Edit button opens selected schedule");
assert(
  /onOpenSchedule\(schedule\.id\);\s*requestScrollToEditPanel\(\)/.test(schedulesScreen),
  "6b: Edit action sets pending scroll flag via requestScrollToEditPanel",
);
assert(schedulesScreen.includes("shouldScrollToEditRef"), "6b2: pending scroll uses shouldScrollToEditRef");
assert(schedulesScreen.includes('data-testid="schedule-edit-panel"'), "6c: visible edit panel has data-testid");
assert(schedulesScreen.includes('SCHEDULE_EDIT_PANEL_ID = "schedule-edit-panel"'), "6d: stable schedule-edit-panel id");
assert(schedulesScreen.includes("editPanelRef"), "6e: ref attached to visible edit panel");
assert(schedulesScreen.includes("ref={editPanelRef}"), "6e2: editPanelRef bound on visible panel");
assert(schedulesScreen.includes("findScheduleScrollContainer"), "6f: correct scroll container helper used");
assert(schedulesScreen.includes('closest(".qms-screen-stage")'), "6f2: prefers .qms-screen-stage scroll container");
assert(schedulesScreen.includes("scrollScheduleEditPanelIntoView"), "6f3: scrolls panel into container view");
assert(schedulesScreen.includes("container.scrollTo"), "6f4: nested container scrollTo used");
assert(
  schedulesScreen.includes("editingSchedule?.id") && schedulesScreen.includes("editScrollNonce"),
  "6g: scroll runs after editing schedule state / scroll request",
);
assert(schedulesScreen.includes("focus({ preventScroll: true })"), "6h: focus does not steal scroll");
assert(schedulesScreen.includes("onSave") && schedulesScreen.includes("onCancel"), "6i: Save/cancel still wired");
assert(
  (schedulesScreen.match(/data-testid="schedule-edit-panel"/g) || []).length === 1,
  "6j: single schedule-edit-panel test id",
);
assert(
  (schedulesScreen.match(/id=\{SCHEDULE_EDIT_PANEL_ID\}/g) || []).length === 1,
  "6k: no duplicate edit panel ids",
);

console.log(`[verify:scheduler-page-wiring] OK — ${caseCount} cases passed`);
