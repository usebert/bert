import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border border-slate-300 bg-white p-0.5">
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm ${view === "month" ? "bg-slate-900 text-white" : "text-slate-700"}`}
          onClick={() => onViewChange("month")}
        >
          {t("calendar.month")}
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1.5 text-sm ${view === "agenda" ? "bg-slate-900 text-white" : "text-slate-700"}`}
          onClick={() => onViewChange("agenda")}
        >
          {t("calendar.agenda")}
        </button>
      </div>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={typeFilter}
        onChange={(event) => onTypeChange(event.target.value as TypeFilter)}
        aria-label={t("calendar.type")}
      >
        <option value="all">{t("calendar.allTypes")}</option>
        <option value="event">{t("calendar.events")}</option>
        <option value="reminder">{t("calendar.reminders")}</option>
      </select>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={statusFilter}
        onChange={(event) => onStatusChange(event.target.value as StatusFilter)}
        aria-label={t("common.status")}
      >
        <option value="open">{t("common.openStatus")}</option>
        <option value="upcoming">{t("status.upcoming")}</option>
        <option value="due_soon">{t("status.dueSoonLabel")}</option>
        <option value="overdue">{t("status.overdueLabel")}</option>
        <option value="completed">{t("status.completed")}</option>
        <option value="archived">{t("status.archived")}</option>
        <option value="all">{t("loler.everything")}</option>
      </select>
      <select
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={siteFilter}
        onChange={(event) => onSiteChange(event.target.value)}
        aria-label={t("common.allSites")}
      >
        <option value="">{t("common.allSites")}</option>
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
        aria-label={t("common.assignedTo")}
      >
        <option value="">{t("common.anyone")}</option>
        <option value={userEmail}>{t("calendar.assignedToMe")}</option>
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
          {t("calendar.clearDayFilter")} ({formatCalendarDate(selectedDateKey)})
        </button>
      ) : null}
    </div>
  );
}
