/** Shared display helpers and local view types for the Calendar module. */
import type { CalendarItem, CalendarItemsSummary, CalendarItemType, CalendarPriority } from "../../types/calendar";

export type CalendarView = "month" | "agenda";
export type StatusFilter = "open" | "upcoming" | "due_soon" | "overdue" | "completed" | "archived" | "all";
export type TypeFilter = "all" | CalendarItemType;

export type MonthCell = { dateKey: string; inMonth: boolean; day: number };

export type CalendarFormState = {
  itemType: CalendarItemType;
  title: string;
  description: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  assignedPersonId: string;
  siteId: string;
  areaId: string;
  department: string;
  priority: CalendarPriority;
};

export const EMPTY_CALENDAR_SUMMARY: CalendarItemsSummary = {
  total: 0,
  events: 0,
  reminders: 0,
  upcoming: 0,
  dueSoon: 0,
  overdue: 0,
  completed: 0,
  archived: 0,
};

export const EMPTY_CALENDAR_FORM: CalendarFormState = {
  itemType: "event",
  title: "",
  description: "",
  startDate: "",
  startTime: "09:00",
  endDate: "",
  endTime: "10:00",
  allDay: false,
  assignedPersonId: "",
  siteId: "",
  areaId: "",
  department: "",
  priority: "normal",
};

export function calendarStatusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "upcoming":
      return { label: "Upcoming", className: "bg-sky-100 text-sky-800" };
    case "due_soon":
      return { label: "Due soon", className: "bg-amber-100 text-amber-800" };
    case "overdue":
      return { label: "Overdue", className: "bg-red-100 text-red-800" };
    case "completed":
      return { label: "Completed", className: "bg-emerald-100 text-emerald-800" };
    case "archived":
      return { label: "Archived", className: "bg-slate-100 text-slate-500" };
    case "cancelled":
      return { label: "Cancelled", className: "bg-slate-100 text-slate-500" };
    default:
      return { label: status || "—", className: "bg-slate-100 text-slate-600" };
  }
}

export function formatCalendarDate(dateKey?: string): string {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "—";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function calendarMonthLabel(year: number, monthIndex: number): string {
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Monday-first month grid padded to whole weeks. */
export function buildCalendarMonthCells(year: number, monthIndex: number): MonthCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const startWeekday = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const prevMonthDays = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const cells: MonthCell[] = [];

  for (let i = 0; i < startWeekday; i += 1) {
    const day = prevMonthDays - startWeekday + i + 1;
    const date = new Date(Date.UTC(year, monthIndex - 1, day));
    cells.push({ dateKey: date.toISOString().slice(0, 10), inMonth: false, day });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    cells.push({ dateKey: date.toISOString().slice(0, 10), inMonth: true, day });
  }
  while (cells.length % 7 !== 0) {
    const overflow = cells.length - (startWeekday + daysInMonth) + 1;
    const date = new Date(Date.UTC(year, monthIndex + 1, overflow));
    cells.push({ dateKey: date.toISOString().slice(0, 10), inMonth: false, day: overflow });
  }
  return cells;
}

export function calendarItemToForm(item: CalendarItem): CalendarFormState {
  return {
    itemType: item.itemType,
    title: item.title,
    description: item.description || "",
    startDate: item.startDate || "",
    startTime: item.startTime || "09:00",
    endDate: item.endDate || item.startDate || "",
    endTime: item.endTime || "10:00",
    allDay: Boolean(item.allDay),
    assignedPersonId: item.assignedPersonId || "",
    siteId: item.siteId || "",
    areaId: item.areaId || "",
    department: item.department || "",
    priority: item.priority || "normal",
  };
}

/** Whether a given actor may complete this reminder (manager or the assignee). */
export function canCompleteCalendarReminder(item: CalendarItem, userEmail: string, canManage: boolean): boolean {
  if (item.itemType !== "reminder" || item.status === "completed" || item.status === "archived") {
    return false;
  }
  const email = String(userEmail || "").trim().toLowerCase();
  return (
    canManage ||
    String(item.assignedPersonId || "").toLowerCase() === email ||
    String(item.assignedPersonEmail || "").toLowerCase() === email
  );
}
