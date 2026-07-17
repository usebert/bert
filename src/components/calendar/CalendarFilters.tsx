import type { StructureEntity } from "../../services/companyStructureService";
import type { ScheduleAssigneeOption } from "../../utils/scheduleAssignees";
import { formatCalendarDate, type CalendarView, type StatusFilter, type TypeFilter } from "./calendarPresentation";

type Props = {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  typeFilter: TypeFilter;
  onTypeChange: (value: TypeFilter) => void;
  statusFilter: StatusFilter;
  onStatusChange: (value: StatusFilter) => void;
  siteFilter: string;
  onSiteChange: (value: string) => void;
  sites: StructureEntity[];
  assigneeFilter: string;
  onAssigneeChange: (value: string) => void;
  assignees: ScheduleAssigneeOption[];
  userEmail: string;
  selectedDateKey: string;
  onClearDay: () => void;
};

export function CalendarFilters({
  view,
  onViewChange,
  typeFilter,
  onTypeChange,
  statusFilter,
  onStatusChange,
  siteFilter,
  onSiteChange,
  sites,
  assigneeFilter,
  onAssigneeChange,
  assignees,
  userEmail,
  selectedDateKey,
  onClearDay,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm ${view === "month" ? "bg-slate-900 text-white" : "text-slate-700"}`}
          onClick={() => onViewChange("month")}
        >
          Month
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm ${view === "agenda" ? "bg-slate-900 text-white" : "text-slate-700"}`}
          onClick={() => onViewChange("agenda")}
        >
          Agenda
        </button>
      </div>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={typeFilter}
        onChange={(event) => onTypeChange(event.target.value as TypeFilter)}
        aria-label="Filter by type"
      >
        <option value="all">All types</option>
        <option value="event">Events</option>
        <option value="reminder">Reminders</option>
      </select>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={statusFilter}
        onChange={(event) => onStatusChange(event.target.value as StatusFilter)}
        aria-label="Filter by status"
      >
        <option value="open">Open</option>
        <option value="upcoming">Upcoming</option>
        <option value="due_soon">Due soon</option>
        <option value="overdue">Overdue</option>
        <option value="completed">Completed</option>
        <option value="archived">Archived</option>
        <option value="all">All</option>
      </select>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={siteFilter}
        onChange={(event) => onSiteChange(event.target.value)}
        aria-label="Filter by site"
      >
        <option value="">All sites</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={assigneeFilter}
        onChange={(event) => onAssigneeChange(event.target.value)}
        aria-label="Filter by assignee"
      >
        <option value="">All assignees</option>
        <option value={userEmail}>Assigned to me</option>
        {assignees.map((person) => (
          <option key={person.email} value={person.email}>
            {person.name || person.email}
          </option>
        ))}
      </select>
      {selectedDateKey ? (
        <button
          type="button"
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
          onClick={onClearDay}
        >
          Clear day filter ({formatCalendarDate(selectedDateKey)})
        </button>
      ) : null}
    </div>
  );
}
