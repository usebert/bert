import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "../permissions";
import { canManageLoler } from "../permissions";
import type {
  LolerEquipment,
  LolerEquipmentInput,
  LolerEquipmentSummary,
  LolerExamination,
  LolerExaminationInput,
  LolerSchedule,
} from "../types/loler";
import {
  archiveLolerEquipment,
  createLolerEquipment,
  fetchLolerEquipment,
  fetchLolerExaminations,
  fetchLolerSchedules,
  LOLER_OFFLINE_WRITE_MESSAGE,
  markLolerEquipmentOutOfService,
  readCachedLolerEquipment,
  readCachedLolerExaminations,
  readCachedLolerSchedules,
  recordLolerExamination,
  returnLolerEquipmentToService,
  updateLolerEquipment,
} from "../services/lolerService";
import { fetchCompanyStructure, type StructureEntity } from "../services/companyStructureService";
import { loadScheduleAssigneesCached } from "../services/peopleCache";
import type { ScheduleAssigneeOption } from "../utils/scheduleAssignees";
import { RecordExaminationForm } from "../components/loler/RecordExaminationForm";
import { ExaminationHistory } from "../components/loler/ExaminationHistory";
import { MessagesScreen } from "./MessagesScreen";
import { translateLolerComplianceStatus } from "../i18n/statusLabels";
import type { TFunction } from "i18next";

type Props = {
  role: Role;
  companyFolderId: string;
  masterSheetId?: string;
  userEmail: string;
  offlineMode?: boolean;
  onBack?: () => void;
};

type LolerTab = "register" | "examinations" | "messages";

type StatusFilter = "active_register" | "active" | "due_soon" | "overdue" | "out_of_service" | "archived" | "all";

const EMPTY_SUMMARY: LolerEquipmentSummary = {
  totalActive: 0,
  compliant: 0,
  dueSoon: 0,
  overdue: 0,
  outOfService: 0,
  archived: 0,
};

const QUICK_INTERVALS = [6, 12];

type FormState = {
  assetId: string;
  equipmentName: string;
  equipmentType: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  siteId: string;
  areaId: string;
  ownerDepartment: string;
  intervalChoice: "6" | "12" | "custom";
  customIntervalMonths: string;
  lastExaminationDate: string;
  nextExaminationDueDate: string;
  assignedPersonId: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  assetId: "",
  equipmentName: "",
  equipmentType: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  siteId: "",
  areaId: "",
  ownerDepartment: "",
  intervalChoice: "12",
  customIntervalMonths: "",
  lastExaminationDate: "",
  nextExaminationDueDate: "",
  assignedPersonId: "",
  notes: "",
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "compliant":
      return "bg-emerald-100 text-emerald-800";
    case "due_soon":
      return "bg-amber-100 text-amber-800";
    case "overdue":
      return "bg-red-100 text-red-800";
    case "out_of_service":
      return "bg-slate-200 text-slate-700";
    case "archived":
      return "bg-slate-100 text-slate-500";
    case "upcoming":
      return "bg-sky-100 text-sky-800";
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "cancelled":
      return "bg-slate-100 text-slate-500";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function statusBadge(t: TFunction, status: string): { label: string; className: string } {
  return {
    label: translateLolerComplianceStatus(t, status),
    className: statusBadgeClass(status),
  };
}

function formatDate(dateKey?: string): string {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "—";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function equipmentToForm(equipment: LolerEquipment): FormState {
  const interval = equipment.examinationIntervalMonths;
  const quick = QUICK_INTERVALS.includes(interval);
  return {
    assetId: equipment.assetId,
    equipmentName: equipment.equipmentName,
    equipmentType: equipment.equipmentType,
    manufacturer: equipment.manufacturer || "",
    model: equipment.model || "",
    serialNumber: equipment.serialNumber || "",
    siteId: equipment.siteId || "",
    areaId: equipment.areaId || "",
    ownerDepartment: equipment.ownerDepartment || "",
    intervalChoice: quick ? (String(interval) as "6" | "12") : "custom",
    customIntervalMonths: quick ? "" : String(interval || ""),
    lastExaminationDate: equipment.lastExaminationDate || "",
    nextExaminationDueDate: equipment.nextExaminationDueDate || "",
    assignedPersonId: equipment.assignedPersonId || "",
    notes: equipment.notes || "",
  };
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-slate-500";

export function LolerScreen({ role, companyFolderId, masterSheetId, userEmail, offlineMode = false, onBack }: Props) {
  const { t } = useTranslation();
  const canManage = canManageLoler(role);
  const folderId = String(companyFolderId || "").trim();

  const [tab, setTab] = useState<LolerTab>("register");
  const [equipment, setEquipment] = useState<LolerEquipment[]>(() => readCachedLolerEquipment(folderId)?.equipment || []);
  const [summary, setSummary] = useState<LolerEquipmentSummary>(
    () => readCachedLolerEquipment(folderId)?.summary || EMPTY_SUMMARY,
  );
  const [schedules, setSchedules] = useState<LolerSchedule[]>(() => readCachedLolerSchedules(folderId)?.schedules || []);
  const [examinations, setExaminations] = useState<LolerExamination[]>(
    () => readCachedLolerExaminations(folderId)?.examinations || [],
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [busyEquipmentId, setBusyEquipmentId] = useState("");
  const [recordTarget, setRecordTarget] = useState<{ equipment: LolerEquipment; schedule?: LolerSchedule | null } | null>(
    null,
  );
  const [recording, setRecording] = useState(false);

  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [areaFilter, setAreaFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active_register");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  const [sites, setSites] = useState<StructureEntity[]>([]);
  const [areas, setAreas] = useState<StructureEntity[]>([]);
  const [assignees, setAssignees] = useState<ScheduleAssigneeOption[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [viewingId, setViewingId] = useState("");
  const [returnServiceId, setReturnServiceId] = useState("");
  const [returnDueDate, setReturnDueDate] = useState("");
  const [returnLastExamDate, setReturnLastExamDate] = useState("");

  const isWriteBlocked = offlineMode || (typeof navigator !== "undefined" && navigator.onLine === false);

  const loadData = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!folderId) {
        return;
      }
      const hadCache = equipment.length > 0;
      if (!hadCache) {
        setLoading(true);
      }
      setLoadError("");
      try {
        const [equipmentResult, schedulesResult, examinationsResult] = await Promise.all([
          fetchLolerEquipment(folderId, { refresh: options.refresh }),
          fetchLolerSchedules(folderId, { refresh: options.refresh }),
          fetchLolerExaminations(folderId, { refresh: options.refresh }),
        ]);
        setEquipment(equipmentResult.equipment || []);
        setSummary(equipmentResult.summary || EMPTY_SUMMARY);
        setSchedules(schedulesResult.schedules || []);
        setExaminations(examinationsResult.examinations || []);
      } catch (error) {
        // Keep previously loaded data visible; only surface the load problem.
        setLoadError(error instanceof Error ? error.message : "Could not load LOLER equipment.");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folderId],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!folderId) {
      return;
    }
    let cancelled = false;
    void fetchCompanyStructure(folderId, masterSheetId)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setSites((payload.sites || []).filter((site) => site.status !== "inactive"));
        setAreas((payload.areas || []).filter((area) => area.status !== "inactive"));
      })
      .catch(() => {
        /* site/area pickers stay empty; register still works */
      });
    void loadScheduleAssigneesCached({
      companyId: folderId,
      companyFolderId: folderId,
      companyName: "",
      masterSheetId: String(masterSheetId || ""),
    })
      .then((result) => {
        if (!cancelled) {
          setAssignees(result.data.assignees || []);
        }
      })
      .catch(() => {
        /* assignee picker stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, masterSheetId]);

  const equipmentTypes = useMemo(() => {
    const types = new Set<string>();
    for (const item of equipment) {
      if (item.equipmentType) {
        types.add(item.equipmentType);
      }
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [equipment]);

  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of equipment) {
      if (item.assignedPersonId) {
        seen.set(item.assignedPersonId, item.assignedPersonName || item.assignedPersonId);
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [equipment]);

  const filteredEquipment = useMemo(() => {
    const query = search.trim().toLowerCase();
    return equipment.filter((item) => {
      if (statusFilter === "active_register" && item.complianceStatus === "archived") {
        return false;
      }
      if (statusFilter === "active" && !["compliant", "due_soon", "overdue"].includes(item.complianceStatus)) {
        return false;
      }
      if (
        (statusFilter === "due_soon" || statusFilter === "overdue" || statusFilter === "out_of_service" || statusFilter === "archived") &&
        item.complianceStatus !== statusFilter
      ) {
        return false;
      }
      if (siteFilter && item.siteId !== siteFilter && item.siteName !== siteFilter) {
        return false;
      }
      if (areaFilter && item.areaId !== areaFilter && item.areaName !== areaFilter) {
        return false;
      }
      if (typeFilter && item.equipmentType !== typeFilter) {
        return false;
      }
      if (assigneeFilter && item.assignedPersonId !== assigneeFilter) {
        return false;
      }
      if (query) {
        const haystack = [
          item.assetId,
          item.equipmentName,
          item.equipmentType,
          item.manufacturer,
          item.model,
          item.serialNumber,
        ]
          .map((value) => String(value || "").toLowerCase())
          .join(" ");
        if (!haystack.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [equipment, search, siteFilter, areaFilter, typeFilter, statusFilter, assigneeFilter]);

  const openExaminations = useMemo(
    () =>
      schedules
        .filter((schedule) => ["upcoming", "due_soon", "overdue"].includes(schedule.scheduleStatus))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [schedules],
  );

  const viewingEquipment = viewingId ? equipment.find((item) => item.id === viewingId) : undefined;
  const viewingHistory = useMemo(
    () => (viewingId ? examinations.filter((item) => item.equipmentId === viewingId) : []),
    [examinations, viewingId],
  );

  const guardWrite = useCallback((): boolean => {
    if (isWriteBlocked) {
      setActionError(LOLER_OFFLINE_WRITE_MESSAGE);
      return false;
    }
    return true;
  }, [isWriteBlocked]);

  const canRecordForEquipment = useCallback(
    (item: LolerEquipment) => {
      if (item.status === "archived") {
        return false;
      }
      if (canManage) {
        return true;
      }
      return (
        role === "Auditor" &&
        String(item.assignedPersonId || "").toLowerCase() === String(userEmail || "").toLowerCase()
      );
    },
    [canManage, role, userEmail],
  );

  const saveRecordedExamination = async (input: LolerExaminationInput) => {
    if (!guardWrite()) {
      return;
    }
    setRecording(true);
    setActionError("");
    setActionNotice("");
    try {
      const result = await recordLolerExamination(folderId, input);
      setRecordTarget(null);
      setActionNotice(
        result.requiresAttention
          ? "Examination recorded. Equipment requires attention after a failed result."
          : "Examination recorded.",
      );
      await loadData({ refresh: true });
      if (input.equipmentId) {
        setViewingId(input.equipmentId);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not record examination.");
    } finally {
      setRecording(false);
    }
  };

  const openAddForm = () => {
    setEditingId("");
    setForm(EMPTY_FORM);
    setFormErrors([]);
    setFormOpen(true);
  };

  const openEditForm = (item: LolerEquipment) => {
    setEditingId(item.id);
    setForm(equipmentToForm(item));
    setFormErrors([]);
    setFormOpen(true);
  };

  const resolvedIntervalMonths = (state: FormState): number => {
    if (state.intervalChoice === "custom") {
      return Number(state.customIntervalMonths);
    }
    return Number(state.intervalChoice);
  };

  const validateForm = (state: FormState): string[] => {
    const errors: string[] = [];
    if (!state.assetId.trim()) {
      errors.push("Asset ID is required.");
    }
    const duplicate = equipment.some(
      (item) => item.id !== editingId && item.assetId.trim().toLowerCase() === state.assetId.trim().toLowerCase(),
    );
    if (state.assetId.trim() && duplicate) {
      errors.push("Asset ID already exists in this company.");
    }
    if (!state.equipmentName.trim()) {
      errors.push("Equipment name is required.");
    }
    if (!state.equipmentType.trim()) {
      errors.push("Equipment type is required.");
    }
    const interval = resolvedIntervalMonths(state);
    if (!Number.isInteger(interval) || interval <= 0) {
      errors.push("Examination interval must be a positive whole number of months.");
    }
    if (!state.lastExaminationDate && !state.nextExaminationDueDate) {
      errors.push("Enter a last examination date or an explicit next due date.");
    }
    return errors;
  };

  const submitForm = async () => {
    setActionError("");
    setActionNotice("");
    const errors = validateForm(form);
    setFormErrors(errors);
    if (errors.length > 0) {
      return;
    }
    if (!guardWrite()) {
      return;
    }
    const site = sites.find((entry) => entry.id === form.siteId);
    const area = areas.find((entry) => entry.id === form.areaId);
    const assignee = assignees.find((entry) => entry.email === form.assignedPersonId);
    const input: LolerEquipmentInput = {
      assetId: form.assetId.trim(),
      equipmentName: form.equipmentName.trim(),
      equipmentType: form.equipmentType.trim(),
      manufacturer: form.manufacturer.trim(),
      model: form.model.trim(),
      serialNumber: form.serialNumber.trim(),
      siteId: form.siteId,
      siteName: site?.name || "",
      areaId: form.areaId,
      areaName: area?.name || "",
      ownerDepartment: form.ownerDepartment.trim(),
      examinationIntervalMonths: resolvedIntervalMonths(form),
      lastExaminationDate: form.lastExaminationDate,
      nextExaminationDueDate: form.nextExaminationDueDate,
      assignedPersonId: form.assignedPersonId,
      assignedPersonName: assignee?.name || "",
      notes: form.notes.trim(),
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateLolerEquipment(folderId, editingId, input);
        setActionNotice("Equipment updated.");
      } else {
        await createLolerEquipment(folderId, { ...input, status: "active" });
        setActionNotice("Equipment added to the register.");
      }
      setFormOpen(false);
      setEditingId("");
      setForm(EMPTY_FORM);
      await loadData({ refresh: true });
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : "Could not save equipment."]);
    } finally {
      setSaving(false);
    }
  };

  const runEquipmentAction = async (
    item: LolerEquipment,
    label: string,
    action: () => Promise<unknown>,
  ) => {
    setActionError("");
    setActionNotice("");
    if (!guardWrite()) {
      return;
    }
    setBusyEquipmentId(item.id);
    try {
      await action();
      setActionNotice(`${item.assetId}: ${label}.`);
      await loadData({ refresh: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not update ${item.assetId}.`);
    } finally {
      setBusyEquipmentId("");
    }
  };

  const submitReturnToService = async () => {
    const item = equipment.find((entry) => entry.id === returnServiceId);
    if (!item) {
      return;
    }
    if (!returnDueDate && !returnLastExamDate) {
      setActionError("A valid next examination due date is required before returning equipment to service.");
      return;
    }
    await runEquipmentAction(item, "returned to service", () =>
      returnLolerEquipmentToService(folderId, item.id, {
        nextExaminationDueDate: returnDueDate || undefined,
        lastExaminationDate: returnLastExamDate || undefined,
      }),
    );
    setReturnServiceId("");
    setReturnDueDate("");
    setReturnLastExamDate("");
  };

  const summaryCards: Array<{ label: string; value: number; className: string }> = useMemo(
    () => [
      { label: t("loler.totalActive"), value: summary.totalActive, className: "text-slate-900" },
      { label: t("loler.compliant"), value: summary.compliant, className: "text-emerald-700" },
      { label: t("status.dueSoonLabel"), value: summary.dueSoon, className: "text-amber-700" },
      { label: t("status.overdueLabel"), value: summary.overdue, className: "text-red-700" },
      { label: t("status.outOfService"), value: summary.outOfService, className: "text-slate-600" },
    ],
    [summary, t],
  );

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{t("loler.equipmentCompliance")}</p>
          <h1 className="text-2xl font-black text-slate-900">{t("loler.title")}</h1>
          <p className="mt-1 text-sm text-slate-600">
            Lifting equipment register and thorough examination scheduling.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
            >
              {t("common.back")}
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              onClick={openAddForm}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700"
            >
              {t("loler.addEquipment")}
            </button>
          ) : null}
        </div>
      </header>

      {loadError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {loadError}
          <button type="button" onClick={() => void loadData({ refresh: true })} className="ml-3 font-semibold underline">
            {t("common.retry")}
          </button>
        </div>
      ) : null}
      {actionError ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{actionError}</div>
      ) : null}
      {actionNotice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{actionNotice}</div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {summaryCards.map((card) => (
          <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
            <p className={`mt-1 text-2xl font-black ${card.className}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("register")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            tab === "register" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"
          }`}
        >
          {t("loler.equipmentRegister")}
        </button>
        <button
          type="button"
          onClick={() => setTab("examinations")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            tab === "examinations" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"
          }`}
        >
          {t("loler.examinations")}
        </button>
        <button
          type="button"
          onClick={() => setTab("messages")}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            tab === "messages" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"
          }`}
        >
          {t("loler.messages")}
        </button>
      </div>

      {tab === "messages" ? (
        <MessagesScreen
          companyFolderId={folderId}
          offlineMode={offlineMode}
          onOpenLolerEquipment={(equipmentId) => {
            setViewingId(equipmentId);
            setTab("register");
          }}
        />
      ) : null}

      {tab === "register" ? (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3 lg:grid-cols-6">
            <div className="sm:col-span-3 lg:col-span-2">
              <label className={labelClass} htmlFor="loler-search">
                {t("common.search")}
              </label>
              <input
                id="loler-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Asset ID, name, type, manufacturer, model, serial"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-filter-site">
                Site
              </label>
              <select id="loler-filter-site" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} className={inputClass}>
                <option value="">{t("common.allSites")}</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-filter-area">
                Area
              </label>
              <select id="loler-filter-area" value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)} className={inputClass}>
                <option value="">{t("common.allAreas")}</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-filter-type">
                Type
              </label>
              <select id="loler-filter-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className={inputClass}>
                <option value="">{t("loler.allTypes")}</option>
                {equipmentTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-filter-status">
                {t("common.status")}
              </label>
              <select
                id="loler-filter-status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                className={inputClass}
              >
                <option value="active_register">{t("loler.registerNotArchived")}</option>
                <option value="active">{t("loler.activeOnly")}</option>
                <option value="due_soon">{t("status.dueSoonLabel")}</option>
                <option value="overdue">{t("status.overdueLabel")}</option>
                <option value="out_of_service">{t("status.outOfService")}</option>
                <option value="archived">{t("status.archived")}</option>
                <option value="all">{t("loler.everything")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-filter-assignee">
                {t("loler.assignedPerson")}
              </label>
              <select
                id="loler-filter-assignee"
                value={assigneeFilter}
                onChange={(event) => setAssigneeFilter(event.target.value)}
                className={inputClass}
              >
                <option value="">{t("common.anyone")}</option>
                {assigneeOptions.map(([email, name]) => (
                  <option key={email} value={email}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t("loler.assetId")}</th>
                  <th className="px-4 py-3">{t("loler.equipment")}</th>
                  <th className="px-4 py-3">{t("calendar.type")}</th>
                  <th className="px-4 py-3">Site</th>
                  <th className="px-4 py-3">Area</th>
                  <th className="px-4 py-3">{t("loler.lastExamination")}</th>
                  <th className="px-4 py-3">{t("loler.nextDue")}</th>
                  <th className="px-4 py-3">{t("loler.assignedPerson")}</th>
                  <th className="px-4 py-3">{t("common.status")}</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && equipment.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      Loading LOLER equipment…
                    </td>
                  </tr>
                ) : filteredEquipment.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                      No equipment matches the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredEquipment.map((item) => {
                    const badge = statusBadge(t, item.complianceStatus);
                    const busy = busyEquipmentId === item.id;
                    return (
                      <tr key={item.id} className="align-top">
                        <td className="px-4 py-3 font-semibold text-slate-900">{item.assetId}</td>
                        <td className="px-4 py-3 text-slate-800">{item.equipmentName}</td>
                        <td className="px-4 py-3 text-slate-600">{item.equipmentType}</td>
                        <td className="px-4 py-3 text-slate-600">{item.siteName || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{item.areaName || "—"}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(item.lastExaminationDate)}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{formatDate(item.nextExaminationDueDate)}</td>
                        <td className="px-4 py-3 text-slate-600">{item.assignedPersonName || "—"}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${badge.className}`}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => setViewingId(viewingId === item.id ? "" : item.id)}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                            >
                              View
                            </button>
                            {canRecordForEquipment(item) ? (
                              <button
                                type="button"
                                disabled={busy || isWriteBlocked}
                                onClick={() => {
                                  setActionError("");
                                  setRecordTarget({ equipment: item, schedule: null });
                                }}
                                className="rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-800 disabled:opacity-50"
                              >
                                {t("loler.recordExamination")}
                              </button>
                            ) : null}
                            {canManage && item.status !== "archived" ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => openEditForm(item)}
                                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                                >
                                  Edit
                                </button>
                                {item.status === "active" ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() =>
                                      void runEquipmentAction(item, "marked out of service", () =>
                                        markLolerEquipmentOutOfService(folderId, item.id),
                                      )
                                    }
                                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                                  >
                                    Out of service
                                  </button>
                                ) : null}
                                {item.status === "out_of_service" ? (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => {
                                      setReturnServiceId(item.id);
                                      setReturnDueDate(item.nextExaminationDueDate || "");
                                      setReturnLastExamDate("");
                                      setActionError("");
                                    }}
                                    className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                                  >
                                    Return to service
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() =>
                                    void runEquipmentAction(item, "archived", () => archiveLolerEquipment(folderId, item.id))
                                  }
                                  className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                                >
                                  Archive
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {viewingEquipment ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">
                    {viewingEquipment.assetId} — {viewingEquipment.equipmentName}
                  </h2>
                  <p className="text-sm text-slate-600">{viewingEquipment.equipmentType}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewingId("")}
                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600"
                >
                  Close
                </button>
              </div>
              <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Manufacturer", viewingEquipment.manufacturer],
                  ["Model", viewingEquipment.model],
                  ["Serial number", viewingEquipment.serialNumber],
                  ["Site", viewingEquipment.siteName],
                  ["Area", viewingEquipment.areaName],
                  ["Owner department", viewingEquipment.ownerDepartment],
                  ["Interval", `${viewingEquipment.examinationIntervalMonths} months`],
                  ["Last examination", formatDate(viewingEquipment.lastExaminationDate)],
                  ["Next due", formatDate(viewingEquipment.nextExaminationDueDate)],
                  ["Assigned person", viewingEquipment.assignedPersonName],
                  ["Created", `${formatDate(viewingEquipment.createdAt?.slice(0, 10))} by ${viewingEquipment.createdBy || "—"}`],
                  viewingEquipment.archivedAt
                    ? ["Archived", `${formatDate(viewingEquipment.archivedAt.slice(0, 10))} by ${viewingEquipment.archivedBy || "—"}`]
                    : ["Updated", `${formatDate(viewingEquipment.updatedAt?.slice(0, 10))} by ${viewingEquipment.updatedBy || "—"}`],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
                    <dd className="text-slate-800">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              {viewingEquipment.notes ? (
                <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">{viewingEquipment.notes}</p>
              ) : null}
              <div className="mt-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-black uppercase tracking-wide text-slate-700">{t("loler.examinationHistory")}</h3>
                  {canRecordForEquipment(viewingEquipment) ? (
                    <button
                      type="button"
                      className="rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-800"
                      onClick={() => setRecordTarget({ equipment: viewingEquipment, schedule: null })}
                    >
                      {t("loler.recordExamination")}
                    </button>
                  ) : null}
                </div>
                <ExaminationHistory examinations={viewingHistory} />
              </div>
            </div>
          ) : null}
        </div>
      ) : tab === "examinations" ? (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Due date</th>
                <th className="px-4 py-3">Asset ID</th>
                <th className="px-4 py-3">Equipment</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Area</th>
                <th className="px-4 py-3">Assigned person</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {openExaminations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    {t("loler.noUpcoming")}
                  </td>
                </tr>
              ) : (
                openExaminations.map((schedule) => {
                  const badge = statusBadge(t, schedule.scheduleStatus);
                  const linkedEquipment = equipment.find((item) => item.id === schedule.equipmentId);
                  const canRecord =
                    linkedEquipment && canRecordForEquipment(linkedEquipment);
                  return (
                    <tr key={schedule.lolerScheduleId}>
                      <td className="px-4 py-3 font-semibold text-slate-800">{formatDate(schedule.dueDate)}</td>
                      <td className="px-4 py-3 text-slate-900">{schedule.assetId}</td>
                      <td className="px-4 py-3 text-slate-800">{schedule.equipmentName}</td>
                      <td className="px-4 py-3 text-slate-600">{schedule.siteName || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{schedule.areaName || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{schedule.assignedPersonName || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${badge.className}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {canRecord && linkedEquipment ? (
                          <button
                            type="button"
                            disabled={isWriteBlocked}
                            onClick={() => {
                              setActionError("");
                              setRecordTarget({ equipment: linkedEquipment, schedule });
                            }}
                            className="rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-800 disabled:opacity-50"
                          >
                            {t("loler.recordExamination")}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {returnServiceId ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="text-base font-black text-slate-900">Return to service</h2>
          <p className="mt-1 text-sm text-slate-700">
            A valid next examination due date is required. Enter a new last examination date (the due date is calculated
            from the interval) or set the next due date directly.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor="loler-return-last-exam">
                New last examination date
              </label>
              <input
                id="loler-return-last-exam"
                type="date"
                value={returnLastExamDate}
                onChange={(event) => setReturnLastExamDate(event.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-return-due">
                Next examination due date
              </label>
              <input
                id="loler-return-due"
                type="date"
                value={returnDueDate}
                onChange={(event) => setReturnDueDate(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => void submitReturnToService()}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white"
            >
              Return to service
            </button>
            <button
              type="button"
              onClick={() => setReturnServiceId("")}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {formOpen && canManage ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-black text-slate-900">{editingId ? "Edit equipment" : "Add equipment"}</h2>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600"
            >
              Close
            </button>
          </div>

          {formErrors.length > 0 ? (
            <ul className="mt-3 space-y-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {formErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="loler-form-asset">
                Asset ID *
              </label>
              <input
                id="loler-form-asset"
                value={form.assetId}
                onChange={(event) => setForm((prev) => ({ ...prev, assetId: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-name">
                Equipment name *
              </label>
              <input
                id="loler-form-name"
                value={form.equipmentName}
                onChange={(event) => setForm((prev) => ({ ...prev, equipmentName: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-type">
                Equipment type *
              </label>
              <input
                id="loler-form-type"
                value={form.equipmentType}
                onChange={(event) => setForm((prev) => ({ ...prev, equipmentType: event.target.value }))}
                placeholder="e.g. Overhead crane, Lifting sling"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-manufacturer">
                Manufacturer
              </label>
              <input
                id="loler-form-manufacturer"
                value={form.manufacturer}
                onChange={(event) => setForm((prev) => ({ ...prev, manufacturer: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-model">
                Model
              </label>
              <input
                id="loler-form-model"
                value={form.model}
                onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-serial">
                Serial number
              </label>
              <input
                id="loler-form-serial"
                value={form.serialNumber}
                onChange={(event) => setForm((prev) => ({ ...prev, serialNumber: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-site">
                Site *
              </label>
              <select
                id="loler-form-site"
                value={form.siteId}
                onChange={(event) => setForm((prev) => ({ ...prev, siteId: event.target.value, areaId: "" }))}
                className={inputClass}
              >
                <option value="">Select site</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-area">
                Area
              </label>
              <select
                id="loler-form-area"
                value={form.areaId}
                onChange={(event) => setForm((prev) => ({ ...prev, areaId: event.target.value }))}
                className={inputClass}
              >
                <option value="">Select area</option>
                {areas
                  .filter((area) => !form.siteId || !area.siteId || area.siteId === form.siteId)
                  .map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-department">
                Owner department
              </label>
              <input
                id="loler-form-department"
                value={form.ownerDepartment}
                onChange={(event) => setForm((prev) => ({ ...prev, ownerDepartment: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-interval">
                Examination interval *
              </label>
              <select
                id="loler-form-interval"
                value={form.intervalChoice}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, intervalChoice: event.target.value as FormState["intervalChoice"] }))
                }
                className={inputClass}
              >
                <option value="6">6 months</option>
                <option value="12">12 months</option>
                <option value="custom">Custom</option>
              </select>
              {form.intervalChoice === "custom" ? (
                <input
                  aria-label="Custom interval in months"
                  type="number"
                  min={1}
                  step={1}
                  value={form.customIntervalMonths}
                  onChange={(event) => setForm((prev) => ({ ...prev, customIntervalMonths: event.target.value }))}
                  placeholder="Months"
                  className={`${inputClass} mt-2`}
                />
              ) : null}
              <p className="mt-1 text-xs text-slate-500">
                You are responsible for choosing the correct interval for this equipment and its use.
              </p>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-last-exam">
                Last examination date
              </label>
              <input
                id="loler-form-last-exam"
                type="date"
                value={form.lastExaminationDate}
                onChange={(event) => setForm((prev) => ({ ...prev, lastExaminationDate: event.target.value }))}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500">Next due date is calculated from this date plus the interval.</p>
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-next-due">
                Next due date (if no last examination)
              </label>
              <input
                id="loler-form-next-due"
                type="date"
                value={form.nextExaminationDueDate}
                onChange={(event) => setForm((prev) => ({ ...prev, nextExaminationDueDate: event.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="loler-form-assignee">
                Assigned competent person
              </label>
              <select
                id="loler-form-assignee"
                value={form.assignedPersonId}
                onChange={(event) => setForm((prev) => ({ ...prev, assignedPersonId: event.target.value }))}
                className={inputClass}
              >
                <option value="">Unassigned</option>
                {assignees.map((assignee) => (
                  <option key={assignee.email} value={assignee.email}>
                    {assignee.name} ({assignee.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelClass} htmlFor="loler-form-notes">
                Notes
              </label>
              <textarea
                id="loler-form-notes"
                rows={2}
                value={form.notes}
                onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
                className={inputClass}
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitForm()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add equipment"}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {recordTarget ? (
        <RecordExaminationForm
          equipment={recordTarget.equipment}
          schedule={recordTarget.schedule}
          assignees={assignees}
          userEmail={userEmail}
          saving={recording}
          onCancel={() => setRecordTarget(null)}
          onSave={(input) => void saveRecordedExamination(input)}
        />
      ) : null}

      {role === "Auditor" ? (
        <p className="text-xs text-slate-500">
          You can see LOLER equipment and examinations assigned to {userEmail || "you"}.
        </p>
      ) : null}
    </section>
  );
}
