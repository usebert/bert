/** Bert Calendar — client-side types (Stage 1). */

export type CalendarItemType = "event" | "reminder";

export type CalendarItemStatus =
  | "upcoming"
  | "due_soon"
  | "overdue"
  | "completed"
  | "cancelled"
  | "archived";

export type CalendarPriority = "low" | "normal" | "high";

export type CalendarItem = {
  id: string;
  itemType: CalendarItemType;
  title: string;
  description?: string;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  allDay: boolean;
  assignedPersonId?: string;
  assignedPersonName?: string;
  assignedPersonEmail?: string;
  siteId?: string;
  siteName?: string;
  areaId?: string;
  areaName?: string;
  department?: string;
  status: CalendarItemStatus;
  priority: CalendarPriority;
  completedAt?: string;
  completedBy?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string;
  archivedBy?: string;
};

export type CalendarItemsSummary = {
  total: number;
  events: number;
  reminders: number;
  upcoming: number;
  dueSoon: number;
  overdue: number;
  completed: number;
  archived: number;
};

export type CalendarItemInput = {
  itemType: CalendarItemType;
  title: string;
  description?: string;
  startDate: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  allDay?: boolean;
  assignedPersonId?: string;
  assignedPersonName?: string;
  assignedPersonEmail?: string;
  siteId?: string;
  siteName?: string;
  areaId?: string;
  areaName?: string;
  department?: string;
  priority?: CalendarPriority;
};
