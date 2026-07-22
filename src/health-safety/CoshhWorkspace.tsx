import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "../permissions";
import { canInvestigateIncidents } from "../permissions";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/LoadingStates";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";
import { StatusBadge } from "../components/ui/StatusBadge";
import { EMPTY_STATE_COPY } from "../presentation/emptyStates";
import { fetchCompanyStructure, type StructureEntity } from "../services/companyStructureService";
import {
  archiveCoshhRecord,
  createCoshhAssessment,
  createCoshhRecord,
  fetchCoshhAssessments,
  fetchCoshhList,
  HEALTH_SAFETY_OFFLINE_WRITE_MESSAGE,
  readCachedCoshhList,
  restoreCoshhRecord,
  updateCoshhRecord,
} from "../services/healthSafetyService";
import type { CoshhAssessment, CoshhRecord, CoshhRecordInput } from "../types/healthSafety";
import {
  buildCoshhListItems,
  buildCoshhSummary,
  coshhStatusLabel,
  coshhStatusVariant,
  filterCoshhItems,
  sortCoshhItems,
  type CoshhFilterState,
} from "./adapters/coshhListAdapter";
import { COSHH_ASSESSMENTS_DRIVE_PATH, COSHH_SDS_DRIVE_PATH } from "./constants";

export type CoshhWorkspaceProps = {
  role: Role;
  companyFolderId: string;
  masterSheetId?: string;
  offlineMode?: boolean;
  initialCoshhId?: string;
  initialOpenCreateForm?: boolean;
  onBack?: () => void;
};

type FormState = {
  productName: string;
  manufacturer: string;
  supplier: string;
  productCode: string;
  description: string;
  physicalForm: string;
  signalWord: string;
  hazardPictograms: string;
  hazardStatements: string;
  precautionaryStatements: string;
  primaryUse: string;
  siteId: string;
  areaId: string;
  storageLocation: string;
  sdsDocumentId: string;
  sdsFileName: string;
  sdsIssueDate: string;
  sdsVersion: string;
  assessmentRequired: boolean;
  approvedForUse: boolean;
  reviewDate: string;
};

const EMPTY_FORM: FormState = {
  productName: "",
  manufacturer: "",
  supplier: "",
  productCode: "",
  description: "",
  physicalForm: "",
  signalWord: "",
  hazardPictograms: "",
  hazardStatements: "",
  precautionaryStatements: "",
  primaryUse: "",
  siteId: "",
  areaId: "",
  storageLocation: "",
  sdsDocumentId: "",
  sdsFileName: "",
  sdsIssueDate: "",
  sdsVersion: "",
  assessmentRequired: false,
  approvedForUse: false,
  reviewDate: "",
};

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";
const labelClass = "block text-xs font-semibold uppercase tracking-wide text-slate-500";

function recordToForm(record: CoshhRecord): FormState {
  return {
    productName: record.productName,
    manufacturer: record.manufacturer,
    supplier: record.supplier,
    productCode: record.productCode,
    description: record.description,
    physicalForm: record.physicalForm,
    signalWord: record.signalWord,
    hazardPictograms: record.hazardPictograms,
    hazardStatements: record.hazardStatements,
    precautionaryStatements: record.precautionaryStatements,
    primaryUse: record.primaryUse,
    siteId: record.siteId,
    areaId: record.areaId,
    storageLocation: record.storageLocation,
    sdsDocumentId: record.sdsDocumentId,
    sdsFileName: record.sdsFileName,
    sdsIssueDate: record.sdsIssueDate,
    sdsVersion: record.sdsVersion,
    assessmentRequired: record.assessmentRequired,
    approvedForUse: record.approvedForUse,
    reviewDate: record.reviewDate,
  };
}

function formToInput(form: FormState): CoshhRecordInput {
  return {
    productName: form.productName.trim(),
    manufacturer: form.manufacturer.trim(),
    supplier: form.supplier.trim(),
    productCode: form.productCode.trim(),
    description: form.description.trim(),
    physicalForm: form.physicalForm.trim(),
    signalWord: form.signalWord.trim(),
    hazardPictograms: form.hazardPictograms.trim(),
    hazardStatements: form.hazardStatements.trim(),
    precautionaryStatements: form.precautionaryStatements.trim(),
    primaryUse: form.primaryUse.trim(),
    siteId: form.siteId,
    areaId: form.areaId,
    storageLocation: form.storageLocation.trim(),
    sdsDocumentId: form.sdsDocumentId.trim(),
    sdsFileName: form.sdsFileName.trim(),
    sdsIssueDate: form.sdsIssueDate,
    sdsVersion: form.sdsVersion.trim(),
    assessmentRequired: form.assessmentRequired,
    approvedForUse: form.approvedForUse,
    reviewDate: form.reviewDate,
  };
}

function formatDate(dateKey?: string) {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw || "—";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function sdsDriveUrl(documentId: string) {
  const id = String(documentId || "").trim();
  if (!id) return "";
  return `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
}

export function CoshhWorkspace({
  role,
  companyFolderId,
  masterSheetId,
  offlineMode = false,
  initialCoshhId,
  initialOpenCreateForm = false,
  onBack,
}: CoshhWorkspaceProps) {
  const folderId = String(companyFolderId || "").trim();
  const canManage = canInvestigateIncidents(role);
  const isWriteBlocked = offlineMode || (typeof navigator !== "undefined" && navigator.onLine === false);

  const [records, setRecords] = useState<CoshhRecord[]>(() => readCachedCoshhList(folderId)?.items || []);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [filters, setFilters] = useState<CoshhFilterState>({ query: "", status: "active_register", site: "" });
  const [selectedId, setSelectedId] = useState(initialCoshhId || "");
  const [assessments, setAssessments] = useState<CoshhAssessment[]>([]);
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [sites, setSites] = useState<StructureEntity[]>([]);
  const [areas, setAreas] = useState<StructureEntity[]>([]);

  const loadRecords = useCallback(
    async (options: { refresh?: boolean } = {}) => {
      if (!folderId) return;
      const hadCache = records.length > 0;
      if (!hadCache) setLoading(true);
      setLoadError("");
      try {
        const result = await fetchCoshhList(folderId, { refresh: options.refresh, includeArchived: true });
        setRecords(result.items || []);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Could not load COSHH register.");
      } finally {
        setLoading(false);
      }
    },
    [folderId, records.length],
  );

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    if (initialCoshhId) {
      setSelectedId(initialCoshhId);
    }
  }, [initialCoshhId]);

  useEffect(() => {
    if (!folderId) return;
    let cancelled = false;
    void fetchCompanyStructure(folderId, masterSheetId)
      .then((payload) => {
        if (cancelled) return;
        setSites((payload.sites || []).filter((site) => site.status !== "inactive"));
        setAreas((payload.areas || []).filter((area) => area.status !== "inactive"));
      })
      .catch(() => {
        /* optional pickers */
      });
    return () => {
      cancelled = true;
    };
  }, [folderId, masterSheetId]);

  const selected = records.find((item) => item.id === selectedId) || null;

  const loadAssessments = useCallback(
    async (coshhId: string) => {
      if (!folderId || !coshhId) {
        setAssessments([]);
        return;
      }
      setAssessmentsLoading(true);
      try {
        const result = await fetchCoshhAssessments(folderId, coshhId, { refresh: true });
        setAssessments(result.items || []);
      } catch {
        setAssessments([]);
      } finally {
        setAssessmentsLoading(false);
      }
    },
    [folderId],
  );

  useEffect(() => {
    if (selected?.id) {
      void loadAssessments(selected.id);
    } else {
      setAssessments([]);
    }
  }, [selected?.id, loadAssessments]);

  const summary = useMemo(() => buildCoshhSummary(records), [records]);
  const listItems = useMemo(() => sortCoshhItems(filterCoshhItems(buildCoshhListItems(records), filters)), [records, filters]);

  const guardWrite = () => {
    if (isWriteBlocked) {
      setActionError(HEALTH_SAFETY_OFFLINE_WRITE_MESSAGE);
      return false;
    }
    return true;
  };

  const openAddForm = () => {
    setEditingId("");
    setForm(EMPTY_FORM);
    setFormErrors([]);
    setFormOpen(true);
  };

  useEffect(() => {
    if (initialOpenCreateForm && canManage) {
      openAddForm();
    }
  }, [initialOpenCreateForm, canManage]);

  const openEditForm = (record: CoshhRecord) => {
    setEditingId(record.id);
    setForm(recordToForm(record));
    setFormErrors([]);
    setFormOpen(true);
  };

  const validateForm = (state: FormState) => {
    const errors: string[] = [];
    if (!state.productName.trim()) errors.push("Product name is required.");
    return errors;
  };

  const submitForm = async (event?: FormEvent) => {
    event?.preventDefault();
    setActionError("");
    setActionNotice("");
    const errors = validateForm(form);
    setFormErrors(errors);
    if (errors.length > 0 || !guardWrite()) return;

    setSaving(true);
    try {
      const input = formToInput(form);
      if (editingId) {
        await updateCoshhRecord(folderId, editingId, input);
        setActionNotice("COSHH record updated.");
        setSelectedId(editingId);
      } else {
        const created = await createCoshhRecord(folderId, input);
        setActionNotice("COSHH record added.");
        if (created.item?.id) setSelectedId(created.item.id);
      }
      setFormOpen(false);
      setEditingId("");
      setForm(EMPTY_FORM);
      await loadRecords({ refresh: true });
    } catch (error) {
      setFormErrors([error instanceof Error ? error.message : "Could not save COSHH record."]);
    } finally {
      setSaving(false);
    }
  };

  const runRecordAction = async (record: CoshhRecord, label: string, action: () => Promise<unknown>) => {
    setActionError("");
    setActionNotice("");
    if (!guardWrite()) return;
    setBusyId(record.id);
    try {
      await action();
      setActionNotice(`${record.productName}: ${label}.`);
      await loadRecords({ refresh: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `Could not update ${record.productName}.`);
    } finally {
      setBusyId("");
    }
  };

  const createAssessment = async () => {
    if (!selected || !guardWrite()) return;
    setBusyId(selected.id);
    setActionError("");
    try {
      await createCoshhAssessment(folderId, selected.id, {
        assessmentTitle: `${selected.productName} assessment`,
        status: "draft",
      });
      setActionNotice("Draft assessment created.");
      await loadAssessments(selected.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not create assessment.");
    } finally {
      setBusyId("");
    }
  };

  const summaryCards = [
    { label: "Active substances", value: summary.total },
    { label: "Review due", value: summary.reviewDue, tone: "warning" as const },
    { label: "Overdue", value: summary.overdue, tone: "danger" as const },
    { label: "Missing SDS", value: summary.missingSds, tone: "danger" as const },
    { label: "Assessment required", value: summary.assessmentRequired, tone: "info" as const },
  ];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Health & Safety"
        title="COSHH register"
        description="Chemical register, safety data sheets, and COSHH assessments."
        primaryAction={
          canManage ? (
            <Button type="button" variant="primary" onClick={openAddForm}>
              Add substance
            </Button>
          ) : undefined
        }
        secondaryActions={
          onBack ? (
            <Button type="button" variant="secondary" onClick={onBack}>
              Back
            </Button>
          ) : undefined
        }
      />

      {loadError ? (
        <Section>
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {loadError}
            <button type="button" onClick={() => void loadRecords({ refresh: true })} className="ml-3 font-semibold underline">
              Retry
            </button>
          </div>
        </Section>
      ) : null}
      {actionError ? (
        <Section>
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{actionError}</p>
        </Section>
      ) : null}
      {actionNotice ? (
        <Section>
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{actionNotice}</p>
        </Section>
      ) : null}

      <Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {summaryCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{card.label}</p>
              <p
                className={[
                  "mt-1 text-2xl font-black",
                  card.tone === "danger" ? "text-red-700" : card.tone === "warning" ? "text-amber-700" : "text-slate-900",
                ].join(" ")}
              >
                {card.value}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Register">
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="coshh-search">
              Search
            </label>
            <input
              id="coshh-search"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Product, manufacturer, supplier, code"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="coshh-status">
              Status
            </label>
            <select
              id="coshh-status"
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as CoshhFilterState["status"] }))}
              className={inputClass}
            >
              <option value="active_register">Active register</option>
              <option value="current">Current</option>
              <option value="review_due">Review due</option>
              <option value="overdue">Overdue</option>
              <option value="missing_sds">Missing SDS</option>
              <option value="assessment_required">Assessment required</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="coshh-site">
              Site
            </label>
            <select
              id="coshh-site"
              value={filters.site}
              onChange={(event) => setFilters((current) => ({ ...current, site: event.target.value }))}
              className={inputClass}
            >
              <option value="">All sites</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">Manufacturer</th>
                <th className="px-4 py-3">Site</th>
                <th className="px-4 py-3">Review date</th>
                <th className="px-4 py-3">SDS</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    Loading COSHH register…
                  </td>
                </tr>
              ) : listItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8">
                    <EmptyState
                      title={records.length === 0 ? "No COSHH records yet" : "No substances match these filters"}
                      description={
                        records.length === 0
                          ? "Add hazardous substances to the register and link their safety data sheets."
                          : EMPTY_STATE_COPY.incidents.description
                      }
                    />
                  </td>
                </tr>
              ) : (
                listItems.map((item) => {
                  const siteName = sites.find((site) => site.id === item.siteId)?.name || item.siteId || "—";
                  const sdsUrl = sdsDriveUrl(item.raw.sdsDocumentId);
                  const busy = busyId === item.id;
                  return (
                    <tr key={item.id} className={selectedId === item.id ? "bg-sky-50/60" : undefined}>
                      <td className="px-4 py-3 font-semibold text-slate-900">{item.productName}</td>
                      <td className="px-4 py-3 text-slate-600">{item.manufacturer || "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{siteName}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(item.reviewDate)}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {sdsUrl ? (
                          <a href={sdsUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-700 underline">
                            {item.raw.sdsFileName || "Open SDS"}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge variant={coshhStatusVariant(item.status)}>{coshhStatusLabel(item.status)}</StatusBadge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedId(item.id)}
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700"
                          >
                            View
                          </button>
                          {canManage && item.status !== "archived" ? (
                            <>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => openEditForm(item.raw)}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void runRecordAction(item.raw, "archived", () => archiveCoshhRecord(folderId, item.id))}
                                className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                              >
                                Archive
                              </button>
                            </>
                          ) : null}
                          {canManage && item.status === "archived" ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void runRecordAction(item.raw, "restored", () => restoreCoshhRecord(folderId, item.id))}
                              className="rounded-lg border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-50"
                            >
                              Restore
                            </button>
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
      </Section>

      {selected ? (
        <Section title={`${selected.productName} — assessments`}>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-600">{selected.description || selected.primaryUse || "No description recorded."}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Storage: {selected.storageLocation || "—"} · Review: {formatDate(selected.reviewDate)}
                </p>
              </div>
              {canManage ? (
                <Button type="button" variant="secondary" disabled={busyId === selected.id} onClick={() => void createAssessment()}>
                  New assessment
                </Button>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Assessment documents are stored in Drive at <span className="font-semibold">{COSHH_ASSESSMENTS_DRIVE_PATH}</span>.
            </p>
            {assessmentsLoading ? (
              <p className="mt-4 text-sm text-slate-500">Loading assessments…</p>
            ) : assessments.length === 0 ? (
              <EmptyState title="No assessments yet" description="Create a COSHH assessment for this substance." />
            ) : (
              <div className="mt-4 space-y-2">
                {assessments.map((assessment) => (
                  <div key={assessment.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm">
                    <p className="min-w-[12rem] flex-1 font-semibold text-slate-900">{assessment.assessmentTitle}</p>
                    <p className="text-slate-600">{assessment.assessorName || "—"}</p>
                    <p className="text-slate-600">{formatDate(assessment.assessmentDate)}</p>
                    <StatusBadge variant={assessment.status === "active" ? "success" : "neutral"}>{assessment.status}</StatusBadge>
                    <p className="text-slate-500">
                      Risk {assessment.initialRiskScore || "—"} → {assessment.residualRiskScore || "—"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>
      ) : null}

      {formOpen && canManage ? (
        <Section title={editingId ? "Edit substance" : "Add substance"}>
          <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={(event) => void submitForm(event)}>
            {formErrors.length > 0 ? (
              <ul className="mb-4 space-y-1 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {formErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className={labelClass} htmlFor="coshh-product-name">
                  Product name *
                </label>
                <input
                  id="coshh-product-name"
                  value={form.productName}
                  onChange={(event) => setForm((current) => ({ ...current, productName: event.target.value }))}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="coshh-manufacturer">
                  Manufacturer
                </label>
                <input
                  id="coshh-manufacturer"
                  value={form.manufacturer}
                  onChange={(event) => setForm((current) => ({ ...current, manufacturer: event.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="coshh-supplier">
                  Supplier
                </label>
                <input
                  id="coshh-supplier"
                  value={form.supplier}
                  onChange={(event) => setForm((current) => ({ ...current, supplier: event.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="coshh-product-code">
                  Product code
                </label>
                <input
                  id="coshh-product-code"
                  value={form.productCode}
                  onChange={(event) => setForm((current) => ({ ...current, productCode: event.target.value }))}
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className={labelClass} htmlFor="coshh-description">
                  Description
                </label>
                <textarea
                  id="coshh-description"
                  value={form.description}
                  onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                  className={inputClass}
                  rows={2}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="coshh-site">
                  Site
                </label>
                <select
                  id="coshh-site"
                  value={form.siteId}
                  onChange={(event) => setForm((current) => ({ ...current, siteId: event.target.value, areaId: "" }))}
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
                <label className={labelClass} htmlFor="coshh-area">
                  Area
                </label>
                <select
                  id="coshh-area"
                  value={form.areaId}
                  onChange={(event) => setForm((current) => ({ ...current, areaId: event.target.value }))}
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
                <label className={labelClass} htmlFor="coshh-storage">
                  Storage location
                </label>
                <input
                  id="coshh-storage"
                  value={form.storageLocation}
                  onChange={(event) => setForm((current) => ({ ...current, storageLocation: event.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="coshh-review-date">
                  Review date
                </label>
                <input
                  id="coshh-review-date"
                  type="date"
                  value={form.reviewDate}
                  onChange={(event) => setForm((current) => ({ ...current, reviewDate: event.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>

            <div className="mt-5 rounded-xl border border-dashed border-sky-200 bg-sky-50/50 p-4">
              <p className="text-sm font-semibold text-slate-800">Safety Data Sheet (SDS)</p>
              <p className="mt-1 text-xs text-slate-600">
                Link the SDS file stored in Drive under <span className="font-semibold">{COSHH_SDS_DRIVE_PATH}</span>.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="coshh-sds-document-id">
                    Drive file ID
                  </label>
                  <input
                    id="coshh-sds-document-id"
                    value={form.sdsDocumentId}
                    onChange={(event) => setForm((current) => ({ ...current, sdsDocumentId: event.target.value }))}
                    className={inputClass}
                    placeholder="Google Drive file ID"
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="coshh-sds-file-name">
                    File name
                  </label>
                  <input
                    id="coshh-sds-file-name"
                    value={form.sdsFileName}
                    onChange={(event) => setForm((current) => ({ ...current, sdsFileName: event.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="coshh-sds-issue-date">
                    SDS issue date
                  </label>
                  <input
                    id="coshh-sds-issue-date"
                    type="date"
                    value={form.sdsIssueDate}
                    onChange={(event) => setForm((current) => ({ ...current, sdsIssueDate: event.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass} htmlFor="coshh-sds-version">
                    SDS version
                  </label>
                  <input
                    id="coshh-sds-version"
                    value={form.sdsVersion}
                    onChange={(event) => setForm((current) => ({ ...current, sdsVersion: event.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.assessmentRequired}
                  onChange={(event) => setForm((current) => ({ ...current, assessmentRequired: event.target.checked }))}
                />
                Assessment required
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.approvedForUse}
                  onChange={(event) => setForm((current) => ({ ...current, approvedForUse: event.target.checked }))}
                />
                Approved for use
              </label>
            </div>

            <div className="mt-4 flex gap-2">
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save changes" : "Add substance"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Section>
      ) : null}
    </PageContainer>
  );
}
