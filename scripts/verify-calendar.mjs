#!/usr/bin/env node
/**
 * verify:calendar — Bert Calendar Stage 1 (CalendarItems events + reminders).
 * Unit-tests shared helpers and the server service against an in-memory workbook
 * mock, plus static wiring checks. Asserts auth/login/LOLER/Schedules are untouched.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CALENDAR_DUE_SOON_DAYS,
  CALENDAR_ITEMS_TAB,
  CALENDAR_ITEMS_TAB_COLUMNS,
  calendarItemStatusForDate,
  mapCalendarItemRecord,
  normalizeCalendarDateKey,
  normalizeCalendarTime,
  summarizeCalendarItems,
  validateCalendarItemInput,
} from "../shared/calendar.mjs";
import {
  archiveCalendarItem,
  canCompleteCalendarItem,
  canManageCalendar,
  canViewCalendar,
  completeCalendarItem,
  createCalendarItem,
  listCalendarItems,
  updateCalendarItem,
} from "../server/calendar-service.mjs";

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
            String(candidate[matchHeader] || "")
              .trim()
              .toLowerCase() ===
            String(matchValue || "")
              .trim()
              .toLowerCase(),
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
const FOLDER_A = "1CalendarCoFolderIdAAAAAAAABBBBBBBCCCC";
const SHEET_A = "1CalendarMasterSheetIdAAAAAAAABBBBBBBCCCCDD";
const FOLDER_B = "1OtherCalendarFolderIdAAAAAABBBBBBCCCCDD";
const SHEET_B = "1OtherCalendarSheetIdAAAAAAAABBBBBBCCCCDDD";

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

const contextA = { companyFolderId: FOLDER_A, masterSheetId: SHEET_A };
const contextB = { companyFolderId: FOLDER_B, masterSheetId: SHEET_B };

/* ---------- Shared helpers ---------- */

assert(CALENDAR_ITEMS_TAB === "CalendarItems", "tab name is CalendarItems");
assert(CALENDAR_ITEMS_TAB_COLUMNS[0] === "CalendarItemId", "first column is CalendarItemId");
assert(CALENDAR_ITEMS_TAB_COLUMNS.includes("AssignedPersonEmail"), "AssignedPersonEmail column present");
assert(CALENDAR_DUE_SOON_DAYS === 7, "due-soon window is 7 days");
assert(normalizeCalendarDateKey("17/07/2026") === "2026-07-17", "DMY dates normalize");
assert(normalizeCalendarTime("9:05") === "09:05", "times normalize to HH:MM");
assert(normalizeCalendarTime("25:00") === "", "invalid times rejected");

assert(
  calendarItemStatusForDate({ startDate: "2026-08-01", status: "upcoming" }, TODAY) === "upcoming",
  "far-future item is upcoming",
);
assert(
  calendarItemStatusForDate({ startDate: "2026-07-20", status: "upcoming" }, TODAY) === "due_soon",
  "near-future item is due_soon",
);
assert(
  calendarItemStatusForDate({ startDate: "2026-07-10", status: "upcoming" }, TODAY) === "overdue",
  "past open item is overdue",
);
assert(
  calendarItemStatusForDate({ startDate: "2026-07-10", status: "completed" }, TODAY) === "completed",
  "completed status is terminal",
);

const validationOk = validateCalendarItemInput({
  itemType: "event",
  title: "Management meeting",
  startDate: "2026-07-20",
  startTime: "10:00",
  assignedPersonId: "Joe.Jones@Example.com",
});
assert(validationOk.ok, "valid event input accepted");
assert(validationOk.normalized.assignedPersonId === "joe.jones@example.com", "assignee email lowercased");

const validationBad = validateCalendarItemInput({ itemType: "reminder", title: "", startDate: "nope" });
assert(!validationBad.ok, "invalid reminder input rejected");

const mapped = mapCalendarItemRecord({
  CalendarItemId: "CAL-TEST-001",
  ItemType: "reminder",
  Title: "Certificate expiry",
  StartDate: "2026-07-10",
  AllDay: "true",
  Status: "upcoming",
  Priority: "high",
  AssignedPersonId: "auditor@example.com",
});
assert(mapped?.allDay === true, "AllDay maps to boolean");
assert(mapped?.itemType === "reminder", "ItemType maps");

/* ---------- Service against mock workbook ---------- */

const mock = createWorkbookMock();
assert(canViewCalendar(managerActor), "manager can view calendar");
assert(canManageCalendar(managerActor), "manager can manage calendar");
assert(canViewCalendar(auditorActor), "auditor can view calendar");
assert(!canManageCalendar(auditorActor), "auditor cannot manage calendar");

const createdEvent = await createCalendarItem(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    itemType: "event",
    title: "Customer visit",
    startDate: "2026-08-01",
    startTime: "14:00",
    endTime: "15:00",
    siteId: "site-1",
    siteName: "Main Site",
    department: "Sales",
    assignedPersonId: "auditor@example.com",
    assignedPersonName: "Auditor User",
  },
  { todayKey: TODAY },
);
assert(createdEvent.ok, "create event succeeds");
assert(createdEvent.item?.itemType === "event", "created item is event");
assert(createdEvent.item?.status === "upcoming", "future event is upcoming");

const createdReminder = await createCalendarItem(
  {},
  mock.deps,
  contextA,
  managerActor,
  {
    itemType: "reminder",
    title: "Training renewal",
    startDate: "2026-07-10",
    allDay: true,
    assignedPersonId: "auditor@example.com",
    assignedPersonName: "Auditor User",
    priority: "high",
  },
  { todayKey: TODAY },
);
assert(createdReminder.ok, "create reminder succeeds");
assert(createdReminder.item?.status === "overdue", "past reminder is overdue");

const listed = await listCalendarItems({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
assert(listed.ok && listed.items.length === 2, "manager sees both company items");
assert(listed.summary.overdue === 1, "summary counts overdue");
assert(listed.summary.events === 1 && listed.summary.reminders === 1, "summary splits types");

const auditorList = await listCalendarItems({}, mock.deps, contextA, auditorActor, { todayKey: TODAY });
assert(auditorList.ok && auditorList.items.length === 2, "auditor sees assigned items");

const otherCompany = await createCalendarItem(
  {},
  mock.deps,
  contextB,
  { ...managerActor, companyFolderId: FOLDER_B, companyId: FOLDER_B },
  {
    itemType: "event",
    title: "Other company meeting",
    startDate: "2026-08-05",
    assignedPersonId: "auditor@example.com",
  },
  { todayKey: TODAY },
);
assert(otherCompany.ok, "other company item created");

const crossList = await listCalendarItems({}, mock.deps, contextA, managerActor, { todayKey: TODAY });
assert(
  crossList.items.every((item) => item.title !== "Other company meeting"),
  "company A list never includes company B items",
);

assert(
  canCompleteCalendarItem(auditorActor, createdReminder.item),
  "assignee can complete own reminder",
);
assert(
  !canCompleteCalendarItem(auditorActor, {
    ...createdReminder.item,
    assignedPersonId: "someoneelse@example.com",
    assignedPersonEmail: "someoneelse@example.com",
  }),
  "auditor cannot complete unassigned reminder",
);

const completed = await completeCalendarItem(
  {},
  mock.deps,
  contextA,
  auditorActor,
  createdReminder.item.id,
  { todayKey: TODAY },
);
assert(completed.ok && completed.item.status === "completed", "reminder marked complete");
assert(Boolean(completed.item.completedAt), "CompletedAt set");

const completeEvent = await completeCalendarItem(
  {},
  mock.deps,
  contextA,
  managerActor,
  createdEvent.item.id,
  { todayKey: TODAY },
);
assert(!completeEvent.ok && completeEvent.code === "CALENDAR_NOT_REMINDER", "events cannot be completed");

const updated = await updateCalendarItem(
  {},
  mock.deps,
  contextA,
  managerActor,
  createdEvent.item.id,
  { title: "Customer visit (updated)", areaId: "area-1", areaName: "Bay 1" },
  { todayKey: TODAY },
);
assert(updated.ok && updated.item.title.includes("updated"), "event update works");
assert(updated.item.areaName === "Bay 1", "optional area link stored");

const archived = await archiveCalendarItem({}, mock.deps, contextA, managerActor, createdEvent.item.id, {
  todayKey: TODAY,
});
assert(archived.ok && archived.item.status === "archived", "event archived");

const tabKey = `${SHEET_A}:${CALENDAR_ITEMS_TAB}`;
assert(mock.tabs.has(tabKey), "CalendarItems tab was ensured");
assert(
  ![...mock.tabs.keys()].some((k) => k.endsWith(":Schedules") || k.endsWith(":LOLERSchedules")),
  "never touches Schedules or LOLERSchedules tabs",
);

const summary = summarizeCalendarItems(
  [
    { itemType: "event", startDate: "2026-08-01", status: "upcoming" },
    { itemType: "reminder", startDate: "2026-07-10", status: "upcoming" },
    { itemType: "reminder", startDate: "2026-07-10", status: "completed" },
  ],
  TODAY,
);
assert(summary.overdue === 1 && summary.completed === 1 && summary.upcoming === 1, "summarizeCalendarItems counts");

/* ---------- Static wiring / isolation checks ---------- */

const routes = read("server/core-workflow-routes.mjs");
assert(routes.includes('/api/companies/:companyFolderId/calendar/items'), "list route registered");
assert(routes.includes('/api/companies/:companyFolderId/calendar/items/:itemId/complete'), "complete route registered");
assert(routes.includes('/api/companies/:companyFolderId/calendar/items/:itemId/archive'), "archive route registered");
assert(routes.includes("from \"./calendar-service.mjs\""), "calendar service imported in routes");

const app = read("App.tsx");
assert(app.includes("CalendarScreen"), "App imports CalendarScreen");
assert(app.includes('screen === "calendar"'), "App renders calendar screen");

const permissions = read("src/permissions.ts");
assert(permissions.includes("canAccessCalendar"), "canAccessCalendar defined");
assert(permissions.includes("canManageCalendar"), "canManageCalendar defined");
assert(permissions.includes('itemId === "calendar"'), "nav gate includes calendar");

const navItems = read("src/config/navItems.ts");
assert(navItems.includes('id: "calendar"'), "navItems includes calendar");

const roleNav = read("src/config/roleNavigation.ts");
assert((roleNav.match(/id: "calendar"/g) || []).length >= 4, "calendar in all role nav buckets");

const navTypes = read("src/types/navigation.ts");
assert(navTypes.includes('"calendar"'), "RoutedScreen includes calendar");

const client = read("src/services/calendarService.ts");
assert(client.includes("dedupeInFlight"), "client uses request dedupe");
assert(client.includes("invalidateCalendarCache"), "client cache invalidation present");
assert(!client.includes("/api/auth/"), "calendar client never calls auth routes");

const screen = read("src/screens/CalendarScreen.tsx");
assert(screen.includes('view === "month"'), "month view branch present");
assert(screen.includes("CalendarAgendaView"), "agenda view composed");
assert(screen.includes("CalendarMonthView"), "month view composed");
assert(screen.includes("CalendarFilters"), "filters composed");
assert(screen.includes("CalendarItemForm"), "item form composed");

/* ---------- Modular component structure ---------- */

const monthView = read("src/components/calendar/CalendarMonthView.tsx");
assert(monthView.includes("buildCalendarMonthCells"), "month view builds grid cells");
const agendaView = read("src/components/calendar/CalendarAgendaView.tsx");
assert(agendaView.includes("CalendarItemDetails"), "agenda view uses item details");
const itemForm = read("src/components/calendar/CalendarItemForm.tsx");
assert(itemForm.includes("Priority") && itemForm.includes("All day"), "item form has fields");
const filters = read("src/components/calendar/CalendarFilters.tsx");
assert(filters.includes("Month") && filters.includes("Agenda"), "filters expose view toggle");
const details = read("src/components/calendar/CalendarItemDetails.tsx");
assert(details.includes("Mark complete"), "complete action lives in item details");
const presentation = read("src/components/calendar/calendarPresentation.ts");
assert(presentation.includes("calendarStatusBadge") && presentation.includes("buildCalendarMonthCells"), "shared helpers extracted");
const summaryCard = read("src/components/dashboard/CalendarSummaryCard.tsx");
assert(summaryCard.includes('onNavigate("calendar")'), "summary card navigates to calendar");

const screenLineCount = screen.split("\n").length;
assert(screenLineCount < 500, `CalendarScreen stays lean (coordinator): ${screenLineCount} lines`);

const cardDefs = read("src/dashboard-layout/cardDefinitions.ts");
assert(cardDefs.includes('"calendar-summary"'), "calendar summary card registered");
const managerDash = read("src/components/dashboard/ManagerRoleDashboard.tsx");
assert(managerDash.includes("CalendarSummaryCard"), "manager dashboard renders calendar card");
const adminDash = read("src/components/dashboard/CompanyAdminDashboard.tsx");
assert(adminDash.includes("CalendarSummaryCard"), "admin dashboard renders calendar card");

const clearStale = read("src/utils/clearStaleCompanyLocalStorage.ts");
assert(clearStale.includes("invalidateCalendarCache"), "logout clears calendar cache");

const serverMjs = read("server/server.mjs");
assert(!serverMjs.includes("calendar-service"), "server startup does not import calendar service");
assert(!serverMjs.includes("bootstrapCalendar"), "no calendar bootstrap on startup");

const authIndex = read("server/auth-index.mjs");
assert(!authIndex.includes("CalendarItems"), "auth-index untouched by calendar");

const userAuth = read("server/user-auth-service.mjs");
assert(!userAuth.includes("CalendarItems") && !userAuth.includes("calendar-service"), "user-auth untouched");

const lolerService = read("server/loler-service.mjs");
assert(!lolerService.includes("CalendarItems"), "LOLER service untouched");

const scheduleService = read("server/schedule-service.mjs");
assert(!scheduleService.includes("CalendarItems"), "schedule service untouched");

const packageJson = read("package.json");
assert(packageJson.includes("verify:calendar"), "package.json has verify:calendar script");

console.log(`verify:calendar passed (${caseCount} checks).`);
