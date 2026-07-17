#!/usr/bin/env node
/**
 * verify:loler-phase2 — examination recording, operational messages, timed reminders.
 * Asserts auth/login/Schedules/Phase 1 invariants remain intact.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LOLER_EXAMINATIONS_TAB,
  LOLER_EXAMINATIONS_TAB_COLUMNS,
  LOLER_EXAMINATION_RESULTS,
  resolveLolerReminderSchedule,
  subtractDaysFromDateKey,
  validateLolerExaminationInput,
} from "../shared/loler.mjs";
import {
  OPERATIONAL_MESSAGES_TAB,
  validateOperationalMessageInput,
} from "../shared/operational-messages.mjs";
import { CALENDAR_ITEMS_TAB_COLUMNS } from "../shared/calendar.mjs";
import {
  canManageLoler,
  canRecordLolerExamination,
  createLolerEquipment,
  listLolerEquipment,
  listLolerExaminations,
  listLolerSchedules,
  recordLolerExamination,
} from "../server/loler-service.mjs";
import {
  createOperationalMessage,
  listOperationalMessages,
  markOperationalMessageRead,
} from "../server/operational-messages-service.mjs";
import { listCalendarItems } from "../server/calendar-service.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

let caseCount = 0;
function assert(condition, message) {
  caseCount += 1;
  if (!condition) {
    console.error(`FAIL [${caseCount}]: ${message}`);
    process.exit(1);
  }
  console.log(`ok ${caseCount}: ${message}`);
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

function createWorkbookMock() {
  const tabs = new Map();
  const key = (sheetId, tab) => `${sheetId}:${tab}`;
  const ensure = (sheetId, tab, headers = []) => {
    const k = key(sheetId, tab);
    if (!tabs.has(k)) {
      tabs.set(k, { headers: [...headers], rows: [] });
    } else if (headers.length) {
      const entry = tabs.get(k);
      for (const header of headers) {
        if (!entry.headers.includes(header)) {
          entry.headers.push(header);
        }
      }
    }
    return tabs.get(k);
  };
  return {
    tabs,
    deps: {
      ensureTabColumns: async (_auth, _deps, sheetId, tab, headers) => {
        ensure(sheetId, tab, headers);
        return { addedColumns: [], headers };
      },
      readTabRecords: async (_auth, _deps, sheetId, tab, options = {}) => {
        const entry = ensure(sheetId, tab, options.expectedHeaders || []);
        return { ok: true, records: entry.rows.map((row) => ({ ...row })), rowCount: entry.rows.length };
      },
      appendTabRows: async (_auth, _deps, sheetId, tab, headers, rowObjects = []) => {
        const entry = ensure(sheetId, tab, headers);
        for (const row of rowObjects) {
          const normalized = {};
          for (const header of headers) {
            normalized[header] = String(row[header] ?? "").trim();
          }
          entry.rows.push(normalized);
        }
        return { ok: true, written: rowObjects.length };
      },
      patchTabRowByHeader: async (_auth, _deps, sheetId, tab, matchHeader, matchValue, updates = {}) => {
        const entry = ensure(sheetId, tab);
        const row = entry.rows.find(
          (candidate) =>
            String(candidate[matchHeader] || "").trim().toLowerCase() ===
            String(matchValue || "").trim().toLowerCase(),
        );
        if (!row) {
          throw new Error(`No row found where ${matchHeader}=${matchValue}.`);
        }
        for (const [header, value] of Object.entries(updates)) {
          row[header] = String(value ?? "").trim();
        }
        return { ok: true };
      },
    },
  };
}

const TODAY = "2026-07-17";
const FOLDER_A = "1LolerPhase2FolderIdAAAAAAAABBBBBBCCCC";
const SHEET_A = "1LolerPhase2SheetIdAAAAAAAABBBBBBCCCCDDDD";
const FOLDER_B = "1OtherPhase2FolderIdAAAAAAAABBBBBBCCCC";
const SHEET_B = "1OtherPhase2SheetIdAAAAAAAABBBBBBCCCCDDD";

const managerActor = {
  kind: "company",
  role: "Manager",
  email: "manager@example.com",
  companyFolderId: FOLDER_A,
  companyId: FOLDER_A,
};
const auditorActor = {
  kind: "company",
  role: "Auditor",
  email: "auditor@example.com",
  companyFolderId: FOLDER_A,
  companyId: FOLDER_A,
};
const otherAuditor = {
  kind: "company",
  role: "Auditor",
  email: "other.auditor@example.com",
  companyFolderId: FOLDER_A,
  companyId: FOLDER_A,
};
const contextA = { companyFolderId: FOLDER_A, masterSheetId: SHEET_A };
const contextB = { companyFolderId: FOLDER_B, masterSheetId: SHEET_B };

assert(LOLER_EXAMINATIONS_TAB === "LOLERExaminations", "examinations tab name");
assert(LOLER_EXAMINATIONS_TAB_COLUMNS.includes("ExaminationResult"), "result column present");
assert(LOLER_EXAMINATION_RESULTS.includes("failed"), "failed result supported");
assert(OPERATIONAL_MESSAGES_TAB === "OperationalMessages", "messages tab name");
assert(CALENDAR_ITEMS_TAB_COLUMNS.includes("RelatedModule"), "calendar RelatedModule additive");
assert(CALENDAR_ITEMS_TAB_COLUMNS.includes("RelatedExaminationId"), "calendar RelatedExaminationId additive");

assert(subtractDaysFromDateKey("2026-08-01", 7) === "2026-07-25", "reminder date calc 7 days before");
assert(subtractDaysFromDateKey("2026-08-01", 30) === "2026-07-02", "reminder date calc 30 days before");
assert(resolveLolerReminderSchedule({ reminderOption: "none" }).enabled === false, "no reminder when disabled");
assert(
  resolveLolerReminderSchedule({ reminderOption: "7", nextExaminationDueDate: "2026-08-01" }).startDate ===
    "2026-07-25",
  "7-day reminder schedule resolved",
);

const validationOk = validateLolerExaminationInput({
  examinationDate: "2026-07-17",
  examinerPersonId: "auditor@example.com",
  examinationResult: "passed",
  nextExaminationDueDate: "2027-01-17",
});
assert(validationOk.ok, "valid examination input accepted");
assert(!validateLolerExaminationInput({ examinationDate: "", examinationResult: "nope" }).ok, "invalid exam rejected");

const mock = createWorkbookMock();

const created = await createLolerEquipment(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    assetId: "HOIST-P2-1",
    equipmentName: "Chain hoist",
    equipmentType: "Hoist",
    examinationIntervalMonths: 6,
    lastExaminationDate: "2026-01-17",
    nextExaminationDueDate: "2026-07-17",
    assignedPersonId: "auditor@example.com",
    assignedPersonName: "Auditor User",
  },
  { todayKey: TODAY },
);
assert(created.ok, "1. Phase 1 equipment still creatable");
const equipmentId = created.equipment.id;

assert(canManageLoler(managerActor), "3a. manager can manage");
assert(canRecordLolerExamination(managerActor, created.equipment), "3b. manager can record");
assert(canRecordLolerExamination(auditorActor, created.equipment), "4a. assigned auditor can record");
assert(!canRecordLolerExamination(otherAuditor, created.equipment), "4b. unassigned auditor cannot record");

const beforeSchedules = await listLolerSchedules({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
assert(beforeSchedules.schedules.length === 1, "open schedule exists before recording");
const openScheduleId = beforeSchedules.schedules[0].lolerScheduleId;

const recorded = await recordLolerExamination(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    equipmentId,
    examinationDate: "2026-07-17",
    examinerPersonId: "auditor@example.com",
    examinerName: "Auditor User",
    examinerEmail: "auditor@example.com",
    examinationResult: "passed",
    observations: "All good",
    nextExaminationDueDate: "2027-01-17",
    currentScheduleId: openScheduleId,
    reminderOption: "none",
  },
  { todayKey: TODAY },
);
assert(recorded.ok, "1. examination record created");
assert(recorded.examination?.examinationId, "stable examination id");
assert(recorded.examination.examinationResult === "passed", "result stored");
assert(recorded.completedScheduleIds?.includes(openScheduleId), "6. existing schedule completed");

const afterEquipment = await listLolerEquipment({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
const updated = afterEquipment.equipment.find((item) => item.id === equipmentId);
assert(updated.lastExaminationDate === "2026-07-17", "7. last examination date updated");
assert(updated.nextExaminationDueDate === "2027-01-17", "8. next due date updated");

const afterSchedules = await listLolerSchedules({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
const openAfter = afterSchedules.schedules.filter(
  (schedule) =>
    schedule.equipmentId === equipmentId && ["upcoming", "due_soon", "overdue"].includes(schedule.scheduleStatus),
);
const completed = afterSchedules.schedules.filter(
  (schedule) => schedule.equipmentId === equipmentId && schedule.scheduleStatus === "completed",
);
assert(openAfter.length === 1, "9. exactly one next open schedule");
assert(openAfter[0].dueDate === "2027-01-17", "next open schedule uses new due date");
assert(openAfter[0].lolerScheduleId !== openScheduleId, "next schedule is a new row");
assert(completed.length === 1, "10. no duplicate open; previous completed preserved");

const history = await listLolerExaminations({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
assert(history.examinations.length === 1, "11. examination history intact");

const failed = await recordLolerExamination(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    equipmentId,
    examinationDate: "2026-07-17",
    examinerPersonId: "manager@example.com",
    examinationResult: "failed",
    defectsFound: "Crack in hook",
    nextExaminationDueDate: "2026-08-17",
    markOutOfService: false,
    reminderOption: "none",
  },
  { todayKey: TODAY },
);
assert(failed.ok && failed.requiresAttention, "12. failed result clearly recorded");
assert(String(failed.equipment.notes || "").toLowerCase().includes("requires attention"), "failed attention note");

const denied = await recordLolerExamination(
  {},
  mock.deps,
  contextA,
  otherAuditor,
  {
    equipmentId,
    examinationDate: "2026-07-17",
    examinerPersonId: "other.auditor@example.com",
    examinationResult: "passed",
    nextExaminationDueDate: "2027-01-01",
  },
  { todayKey: TODAY },
);
assert(!denied.ok && denied.code === "LOLER_EXAMINATION_FORBIDDEN", "3/4. unauthorised record rejected server-side");

const crossCompany = await listLolerExaminations({}, mock.deps, contextB, {
  ...managerActor,
  companyFolderId: FOLDER_B,
  companyId: FOLDER_B,
});
assert(crossCompany.ok && crossCompany.examinations.length === 0, "5. examinations stay company-scoped");

// Report metadata path — mock upload by writing fields through a second passed exam with empty file (skipped)
assert(recorded.examination.reportFileId === undefined || recorded.examination.reportFileId === "", "13. empty report when none uploaded");

const msgValidation = validateOperationalMessageInput({
  recipientEmail: "auditor@example.com",
  subject: "LOLER follow-up",
  messageBody: "Please check the hoist.",
  relatedModule: "loler",
  relatedEquipmentId: equipmentId,
});
assert(msgValidation.ok, "message validation ok");

const messageCreate = await createOperationalMessage(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    recipientEmail: "auditor@example.com",
    recipientName: "Auditor User",
    subject: "LOLER follow-up",
    messageBody: "Please check the hoist.",
    relatedModule: "loler",
    relatedEquipmentId: equipmentId,
    relatedExaminationId: recorded.examination.examinationId,
  },
);
assert(messageCreate.ok, "14. message created without reminder");
assert(messageCreate.message.status === "unread", "message starts unread");

const auditorMessages = await listOperationalMessages({}, mock.deps, contextA, auditorActor);
assert(auditorMessages.messages.some((m) => m.messageId === messageCreate.message.messageId), "15. recipient sees company message");

const otherList = await listOperationalMessages({}, mock.deps, contextA, otherAuditor);
assert(
  !otherList.messages.some((m) => m.messageId === messageCreate.message.messageId),
  "18. other users cannot read another recipient’s private message",
);

const marked = await markOperationalMessageRead({}, mock.deps, contextA, auditorActor, messageCreate.message.messageId);
assert(marked.ok && marked.message.status === "read", "16. recipient can mark message read");
assert(marked.message.relatedEquipmentId === equipmentId, "17. linked LOLER equipment id present");

const withReminder = await createLolerEquipment(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    assetId: "HOIST-P2-2",
    equipmentName: "Second hoist",
    equipmentType: "Hoist",
    examinationIntervalMonths: 12,
    lastExaminationDate: "2025-07-17",
    nextExaminationDueDate: "2026-07-17",
    assignedPersonId: "auditor@example.com",
    assignedPersonName: "Auditor User",
  },
  { todayKey: TODAY },
);
const reminderRecord = await recordLolerExamination(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    equipmentId: withReminder.equipment.id,
    examinationDate: "2026-07-17",
    examinerPersonId: "manager@example.com",
    examinationResult: "passed",
    nextExaminationDueDate: "2027-07-17",
    reminderOption: "7",
    reminderAssigneeEmail: "auditor@example.com",
    reminderAssigneeName: "Auditor User",
    messageRecipientEmail: "auditor@example.com",
    messageRecipientName: "Auditor User",
    messageSubject: "Next LOLER due",
    messageBody: "Reminder linked to examination.",
  },
  { todayKey: TODAY },
);
assert(reminderRecord.ok && reminderRecord.reminder, "19. timed reminder creates CalendarItems reminder");
assert(reminderRecord.reminder.itemType === "reminder", "reminder item type");
assert(reminderRecord.reminder.startDate === "2027-07-10", "20. reminder date 7 days before due");
assert(reminderRecord.reminder.relatedModule === "loler", "related module set");
assert(reminderRecord.message?.messageId, "message+reminder path also creates message");

const noReminder = await recordLolerExamination(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    equipmentId: withReminder.equipment.id,
    examinationDate: "2026-07-17",
    examinerPersonId: "manager@example.com",
    examinationResult: "passed_with_observations",
    nextExaminationDueDate: "2027-08-17",
    reminderOption: "none",
  },
  { todayKey: TODAY },
);
assert(noReminder.ok && !noReminder.reminder, "21. no reminder when option disabled");

const calendarList = await listCalendarItems({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
assert(calendarList.items.length === 1, "22. existing calendar items unaffected (only the one reminder)");

assert(![...mock.tabs.keys()].some((k) => k.endsWith(":Schedules")), "23. general Schedules untouched");
assert(mock.tabs.has(`${SHEET_A}:LOLEREquipment`), "24. Phase 1 equipment tab remains");
assert(mock.tabs.has(`${SHEET_A}:LOLERSchedules`), "24b. Phase 1 schedules tab remains");
assert(mock.tabs.has(`${SHEET_A}:LOLERExaminations`), "examinations tab ensured");

const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes("/loler/examinations"), "examinations routes registered");
assert(routes.includes("/messages/:messageId/read"), "messages read route registered");
assert(routes.includes("recordLolerExamination"), "record examination wired");

const screen = read("src/screens/LolerScreen.tsx");
assert(screen.includes("Record examination"), "UI has Record examination");
assert(screen.includes("LolerRecordExaminationForm"), "record form composed");
assert(screen.includes("OperationalMessagesPanel"), "messages panel composed");
assert(screen.includes("LolerExaminationHistory"), "examination history composed");

const authIndex = read("server/auth-index.mjs");
assert(!authIndex.includes("LOLERExaminations") && !authIndex.includes("OperationalMessages"), "25. auth-index untouched");
const userAuth = read("server/user-auth-service.mjs");
assert(!userAuth.includes("LOLERExaminations") && !userAuth.includes("recordLolerExamination"), "25b. user-auth untouched");
const serverMjs = read("server/server.mjs");
assert(!serverMjs.includes("recordLolerExamination"), "25c. no login/startup examination work");
const scheduleService = read("server/schedule-service.mjs");
assert(!scheduleService.includes("LOLERExaminations"), "23b. schedule-service untouched");

const packageJson = read("package.json");
assert(packageJson.includes("verify:loler-phase2"), "package script present");

console.log(`verify:loler-phase2 passed (${caseCount} checks).`);
