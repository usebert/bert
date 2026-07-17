import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "../permissions";
import { canAccessCalendar, canManageCalendar } from "../permissions";
import type { CalendarItem, CalendarItemInput, CalendarItemStatus } from "../types/calendar";
import {
  archiveCalendarItem,
  CALENDAR_OFFLINE_WRITE_MESSAGE,
  completeCalendarItem,
  createCalendarItem,
  fetchCalendarItems,
  readCachedCalendarItems,
  updateCalendarItem,
} from "../services/calendarService";
import { fetchCompanyStructure, type StructureEntity } from "../services/companyStructureService";
import { loadScheduleAssigneesCached } from "../services/peopleCache";
import type { ScheduleAssigneeOption } from "../utils/scheduleAssignees";
import { CalendarFilters } from "../components/calendar/CalendarFilters";
import { CalendarMonthView } from "../components/calendar/CalendarMonthView";
import { CalendarAgendaView } from "../components/calendar/CalendarAgendaView";
import { CalendarItemForm } from "../components/calendar/CalendarItemForm";
import {
  EMPTY_CALENDAR_FORM,
  EMPTY_CALENDAR_SUMMARY,
  calendarItemToForm,
  canCompleteCalendarReminder,
  type CalendarFormState,
  type CalendarView,
  type StatusFilter,
  type TypeFilter,
} from "../components/calendar/calendarPresentation";

type Props = {
  role: Role;
  companyFolderId: string;
  masterSheetId?: string;
  userEmail: string;
  offlineMode?: boolean;
  onBack?: () => void;
};

/**
 * Calendar coordinator: owns data + view state and composes the month view,
 * agenda view, filters, and item form. Presentation lives in child components.
 */
export function CalendarScreen({
  role,
  companyFolderId,
  masterSheetId,
  userEmail,
  offlineMode = false,
  onBack,
}: Props) {
  const folderId = String(companyFolderId || "").trim();
  const canManage = canManageCalendar(role);
  const canView = canAccessCalendar(role);

  const cached = readCachedCalendarItems(folderId);
  const [items, setItems] = useState<CalendarItem[]>(cached?.items || []);
  const [summary, setSummary] = useState(cached?.summary || EMPTY_CALENDAR_SUMMARY);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [view, setView] = useState<CalendarView>("month");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [siteFilter, setSiteFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [selectedDateKey, setSelectedDateKey] = useState("");
  const [cursorYear, setCursorYear] = useState(() => new Date().getUTCFullYear());
  const [cursorMonth, setCursorMonth] = useState(() => new Date().getUTCMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CalendarFormState>(EMPTY_CALENDAR_FORM);
  const [saving, setSaving] = useState(false);
  const [sites, setSites] = useState<StructureEntity[]>([]);
  const [areas, setAreas] = useState<StructureEntity[]>([]);
  const [assignees, setAssignees] = useState<ScheduleAssigneeOption[]>([]);

  const refresh = useCallback(async () => {
    if (!folderId || !canView) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await fetchCalendarItems(folderId, { refresh: true });
      setItems(payload.items || []);
      setSummary(payload.summary || EMPTY_CALENDAR_SUMMARY);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calendar items.");
    } finally {
      setLoading(false);
    }
  }, [folderId, canView]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!folderId) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [structure, people] = await Promise.all([
          fetchCompanyStructure(folderId, masterSheetId),
          loadScheduleAssigneesCached({
            companyId: folderId,
            companyFolderId: folderId,
            companyName: "",
            masterSheetId: String(masterSheetId || ""),
          }),
        ]);
        if (cancelled) {
          return;
        }
        setSites((structure.sites || []).filter((site) => site.status !== "inactive"));
        setAreas((structure.areas || []).filter((area) => area.status !== "inactive"));
        setAssignees(people?.data?.assignees || []);
      } catch {
        /* pickers stay empty; list still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folderId, masterSheetId]);

  const areasForSite = useMemo(() => {
    if (!form.siteId) {
      return areas;
    }
    return areas.filter((area) => String(area.siteId || "").trim() === form.siteId);
  }, [areas, form.siteId]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (typeFilter !== "all" && item.itemType !== typeFilter) {
        return false;
      }
      if (siteFilter && String(item.siteId || "") !== siteFilter) {
        return false;
      }
      if (assigneeFilter && String(item.assignedPersonId || "").toLowerCase() !== assigneeFilter.toLowerCase()) {
        return false;
      }
      const status = item.status as CalendarItemStatus;
      if (statusFilter === "open") {
        return status === "upcoming" || status === "due_soon" || status === "overdue";
      }
      if (statusFilter === "all") {
        return status !== "cancelled";
      }
      return status === statusFilter;
    });
  }, [items, typeFilter, siteFilter, assigneeFilter, statusFilter]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, CalendarItem[]>();
    for (const item of filteredItems) {
      if (!item.startDate) {
        continue;
      }
      const list = map.get(item.startDate) || [];
      list.push(item);
      map.set(item.startDate, list);
    }
    return map;
  }, [filteredItems]);

  const agendaItems = useMemo(() => {
    const sorted = [...filteredItems].sort((a, b) => {
      const dateCmp = String(a.startDate).localeCompare(String(b.startDate));
      if (dateCmp !== 0) {
        return dateCmp;
      }
      return String(a.startTime || "").localeCompare(String(b.startTime || ""));
    });
    if (!selectedDateKey) {
      return sorted;
    }
    return sorted.filter((item) => item.startDate === selectedDateKey);
  }, [filteredItems, selectedDateKey]);

  const guardWrite = () => {
    if (offlineMode) {
      setError(CALENDAR_OFFLINE_WRITE_MESSAGE);
      return false;
    }
    return true;
  };

  const openCreate = (dateKey?: string) => {
    if (!canManage) {
      return;
    }
    setEditingId(null);
    setForm({
      ...EMPTY_CALENDAR_FORM,
      startDate: dateKey || selectedDateKey || "",
      endDate: dateKey || selectedDateKey || "",
    });
    setFormOpen(true);
  };

  const openEdit = (item: CalendarItem) => {
    if (!canManage || item.status === "archived" || item.status === "completed") {
      return;
    }
    setEditingId(item.id);
    setForm(calendarItemToForm(item));
    setFormOpen(true);
  };

  const buildInput = (): CalendarItemInput | null => {
    if (!form.title.trim() || !form.startDate.trim()) {
      setError("Title and start date are required.");
      return null;
    }
    const assignee = assignees.find(
      (entry) => String(entry.email || "").trim().toLowerCase() === form.assignedPersonId.toLowerCase(),
    );
    const site = sites.find((entry) => String(entry.id || "").trim() === form.siteId);
    const area = areas.find((entry) => String(entry.id || "").trim() === form.areaId);
    return {
      itemType: form.itemType,
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      startDate: form.startDate,
      startTime: form.allDay ? undefined : form.startTime || undefined,
      endDate: form.endDate || form.startDate,
      endTime: form.allDay ? undefined : form.endTime || undefined,
      allDay: form.allDay,
      assignedPersonId: form.assignedPersonId || undefined,
      assignedPersonName: assignee?.name || undefined,
      assignedPersonEmail: form.assignedPersonId || undefined,
      siteId: form.siteId || undefined,
      siteName: site?.name || undefined,
      areaId: form.areaId || undefined,
      areaName: area?.name || undefined,
      department: form.department.trim() || undefined,
      priority: form.priority,
    };
  };

  const saveForm = async () => {
    if (!canManage || !guardWrite()) {
      return;
    }
    const input = buildInput();
    if (!input) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await updateCalendarItem(folderId, editingId, input);
      } else {
        await createCalendarItem(folderId, input);
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(EMPTY_CALENDAR_FORM);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save calendar item.");
    } finally {
      setSaving(false);
    }
  };

  const onComplete = async (item: CalendarItem) => {
    if (!guardWrite() || !canCompleteCalendarReminder(item, userEmail, canManage)) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await completeCalendarItem(folderId, item.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete reminder.");
    } finally {
      setSaving(false);
    }
  };

  const onArchive = async (item: CalendarItem) => {
    if (!canManage || !guardWrite()) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await archiveCalendarItem(folderId, item.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive item.");
    } finally {
      setSaving(false);
    }
  };

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(cursorYear, cursorMonth + delta, 1));
    setCursorYear(next.getUTCFullYear());
    setCursorMonth(next.getUTCMonth());
  };

  if (!canView) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600">You do not have access to Calendar.</p>
      </div>
    );
  }

  const openCount = summary.upcoming + summary.dueSoon + summary.overdue;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Calendar</p>
          <h1 className="text-2xl font-semibold text-slate-900">Events & reminders</h1>
          <p className="mt-1 text-sm text-slate-600">
            One-off meetings, visits, and follow-ups — separate from audit schedules and LOLER.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onBack ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              onClick={onBack}
            >
              Back
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
          {canManage ? (
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              onClick={() => openCreate()}
            >
              Add item
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Open</p>
          <p className="text-xl font-semibold text-slate-900">{openCount}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Due soon</p>
          <p className="text-xl font-semibold text-amber-700">{summary.dueSoon}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Overdue</p>
          <p className="text-xl font-semibold text-red-700">{summary.overdue}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Completed</p>
          <p className="text-xl font-semibold text-emerald-700">{summary.completed}</p>
        </div>
      </div>

      <CalendarFilters
        view={view}
        onViewChange={setView}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        statusFilter={statusFilter}
        onStatusChange={setStatusFilter}
        siteFilter={siteFilter}
        onSiteChange={setSiteFilter}
        sites={sites}
        assigneeFilter={assigneeFilter}
        onAssigneeChange={setAssigneeFilter}
        assignees={assignees}
        userEmail={userEmail}
        selectedDateKey={selectedDateKey}
        onClearDay={() => setSelectedDateKey("")}
      />

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}
      {loading ? <p className="text-sm text-slate-500">Loading calendar…</p> : null}

      {view === "month" ? (
        <CalendarMonthView
          cursorYear={cursorYear}
          cursorMonth={cursorMonth}
          itemsByDate={itemsByDate}
          selectedDateKey={selectedDateKey}
          onShiftMonth={shiftMonth}
          onSelectDate={(dateKey) => {
            setSelectedDateKey(dateKey);
            setView("agenda");
          }}
          onCreateAt={openCreate}
        />
      ) : (
        <CalendarAgendaView
          items={agendaItems}
          canManage={canManage}
          userEmail={userEmail}
          saving={saving}
          onEdit={openEdit}
          onComplete={(item) => void onComplete(item)}
          onArchive={(item) => void onArchive(item)}
        />
      )}

      {formOpen ? (
        <CalendarItemForm
          editing={Boolean(editingId)}
          form={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          sites={sites}
          areasForSite={areasForSite}
          assignees={assignees}
          saving={saving}
          onCancel={() => {
            setFormOpen(false);
            setEditingId(null);
          }}
          onSave={() => void saveForm()}
        />
      ) : null}
    </div>
  );
}
