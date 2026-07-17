import { useTranslation } from "react-i18next";
import type { CalendarItem } from "../../types/calendar";
import { calendarStatusBadge, canCompleteCalendarReminder, formatCalendarDate } from "./calendarPresentation";

type Props = {
  item: CalendarItem;
  canManage: boolean;
  userEmail: string;
  saving: boolean;
  onEdit: (item: CalendarItem) => void;
  onComplete: (item: CalendarItem) => void;
  onArchive: (item: CalendarItem) => void;
};

export function CalendarItemDetails({ item, canManage, userEmail, saving, onEdit, onComplete, onArchive }: Props) {
  const { t } = useTranslation();
  const badge = calendarStatusBadge(item.status, t);
  const canComplete = canCompleteCalendarReminder(item, userEmail, canManage);
  const canEdit = canManage && item.status !== "archived" && item.status !== "completed";
  const canArchive = canManage && item.status !== "archived";

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-slate-900">{item.title}</h3>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] uppercase text-slate-600">
              {item.itemType}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
            {item.priority === "high" ? (
              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">{t("calendar.highPriority")}</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {formatCalendarDate(item.startDate)}
            {!item.allDay && item.startTime ? ` · ${item.startTime}` : ""}
            {item.allDay ? ` · ${t("calendar.allDay")}` : ""}
            {item.endDate && item.endDate !== item.startDate ? ` → ${formatCalendarDate(item.endDate)}` : ""}
          </p>
          {item.description ? <p className="mt-1 text-sm text-slate-500">{item.description}</p> : null}
          <p className="mt-1 text-xs text-slate-500">
            {item.assignedPersonName || item.assignedPersonEmail || t("common.unassigned")}
            {item.siteName ? ` · ${item.siteName}` : ""}
            {item.areaName ? ` / ${item.areaName}` : ""}
            {item.department ? ` · ${item.department}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700"
              onClick={() => onEdit(item)}
              disabled={saving}
            >
              {t("common.edit")}
            </button>
          ) : null}
          {canComplete ? (
            <button
              type="button"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-800"
              onClick={() => onComplete(item)}
              disabled={saving}
            >
              {t("calendar.markComplete")}
            </button>
          ) : null}
          {canArchive ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-500"
              onClick={() => onArchive(item)}
              disabled={saving}
            >
              {t("messages.archive")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
