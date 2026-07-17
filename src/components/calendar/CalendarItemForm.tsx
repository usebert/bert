import { useTranslation } from "react-i18next";
import type { StructureEntity } from "../../services/companyStructureService";
import type { ScheduleAssigneeOption } from "../../utils/scheduleAssignees";
import type { CalendarItemType, CalendarPriority } from "../../types/calendar";
import { translatePriority } from "../../i18n/statusLabels";
import type { CalendarFormState } from "./calendarPresentation";

type Props = {
  editing: boolean;
  form: CalendarFormState;
  onChange: (patch: Partial<CalendarFormState>) => void;
  sites: StructureEntity[];
  areasForSite: StructureEntity[];
  assignees: ScheduleAssigneeOption[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
};

export function CalendarItemForm({
  editing,
  form,
  onChange,
  sites,
  areasForSite,
  assignees,
  saving,
  onCancel,
  onSave,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900">{editing ? t("calendar.editItem") : t("calendar.addItem")}</h2>
        <div className="mt-3 grid gap-3">
          <label className="text-sm text-slate-700">
            {t("calendar.type")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.itemType}
              onChange={(event) => onChange({ itemType: event.target.value as CalendarItemType })}
            >
              <option value="event">{t("calendar.events")}</option>
              <option value="reminder">{t("calendar.reminders")}</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            {t("calendar.titleLabel")}
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.title}
              onChange={(event) => onChange({ title: event.target.value })}
            />
          </label>
          <label className="text-sm text-slate-700">
            {t("calendar.description")}
            <textarea
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              rows={3}
              value={form.description}
              onChange={(event) => onChange({ description: event.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-700">
              {t("calendar.startDate")}
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                value={form.startDate}
                onChange={(event) =>
                  onChange({ startDate: event.target.value, endDate: form.endDate || event.target.value })
                }
              />
            </label>
            <label className="text-sm text-slate-700">
              {t("calendar.endDate")}
              <input
                type="date"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                value={form.endDate}
                onChange={(event) => onChange({ endDate: event.target.value })}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.allDay}
              onChange={(event) => onChange({ allDay: event.target.checked })}
            />
            {t("calendar.allDay")}
          </label>
          {!form.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-slate-700">
                {t("calendar.startTime")}
                <input
                  type="time"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={form.startTime}
                  onChange={(event) => onChange({ startTime: event.target.value })}
                />
              </label>
              <label className="text-sm text-slate-700">
                {t("calendar.endTime")}
                <input
                  type="time"
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
                  value={form.endTime}
                  onChange={(event) => onChange({ endTime: event.target.value })}
                />
              </label>
            </div>
          ) : null}
          <label className="text-sm text-slate-700">
            {t("common.assignedTo")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.assignedPersonId}
              onChange={(event) => onChange({ assignedPersonId: event.target.value })}
            >
              <option value="">{t("common.unassigned")}</option>
              {assignees.map((person) => (
                <option key={person.email} value={person.email}>
                  {person.name || person.email}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Site
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.siteId}
              onChange={(event) => onChange({ siteId: event.target.value, areaId: "" })}
            >
              <option value="">None</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Area
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.areaId}
              onChange={(event) => onChange({ areaId: event.target.value })}
            >
              <option value="">None</option>
              {areasForSite.map((area) => (
                <option key={area.id} value={area.id}>
                  {area.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Department
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.department}
              onChange={(event) => onChange({ department: event.target.value })}
            />
          </label>
          <label className="text-sm text-slate-700">
            {t("common.priority")}
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              value={form.priority}
              onChange={(event) => onChange({ priority: event.target.value as CalendarPriority })}
            >
              <option value="low">{translatePriority(t, "low")}</option>
              <option value="normal">{translatePriority(t, "normal")}</option>
              <option value="high">{translatePriority(t, "high")}</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            onClick={onCancel}
            disabled={saving}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
