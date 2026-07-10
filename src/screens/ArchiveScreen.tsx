import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyPanel, SectionHeader } from "../components/dashboard/DashboardPrimitives";
import {
  ARCHIVE_OFFLINE_MESSAGE,
  RESTORE_OFFLINE_MESSAGE,
  archiveCompanyRecord,
  fetchCompanyArchive,
  restoreCompanyRecord,
  type ArchivedListItem,
} from "../services/archiveService";
import { restoreAuditTemplateAsRevision } from "../services/auditBuilderService";
import type { ArchiveScreenProps, ArchiveSectionId } from "../types/archive";

const SECTIONS: Array<{ id: ArchiveSectionId; label: string; restoreVerb: string }> = [
  { id: "users", label: "Users", restoreVerb: "Reactivate" },
  { id: "actions", label: "Actions", restoreVerb: "Restore" },
  { id: "ncrs", label: "NCRs", restoreVerb: "Restore" },
  { id: "incidents", label: "Incidents", restoreVerb: "Restore" },
  { id: "briefings", label: "Briefings", restoreVerb: "Restore" },
  { id: "audits", label: "Audits", restoreVerb: "Restore as new revision" },
  { id: "googleForms", label: "Google Forms", restoreVerb: "Restore" },
  { id: "schedules", label: "Schedules", restoreVerb: "Restore" },
];

const TYPE_BY_SECTION: Record<ArchiveSectionId, string> = {
  users: "user",
  actions: "action",
  ncrs: "ncr",
  incidents: "incident",
  briefings: "briefing",
  audits: "audit",
  googleForms: "googleForm",
  schedules: "schedule",
};

function formatWhen(value?: string) {
  if (!value) return "—";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(parsed));
  } catch {
    return value;
  }
}

export function ArchiveScreen({
  companyFolderId,
  masterSheetId,
  offlineMode = false,
  canManageUsers = false,
  canManageRecords = false,
  onToast,
  onViewAudit,
}: ArchiveScreenProps) {
  const [activeSection, setActiveSection] = useState<ArchiveSectionId>("users");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sections, setSections] = useState<Partial<Record<ArchiveSectionId, ArchivedListItem[]>>>({});
  const [counts, setCounts] = useState<Partial<Record<ArchiveSectionId, number>>>({});
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    if (!companyFolderId) {
      setError("Company workbook is not linked.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const debugArchive =
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.search.includes("debugArchive=1") ||
          window.localStorage?.getItem("BERT_ARCHIVE_DEBUG") === "1");
      const result = await fetchCompanyArchive(companyFolderId, { masterSheetId, debugArchive });
      if (!result.ok) {
        setError(result.message || result.error || "Could not load archived records.");
        setSections({});
        setCounts({});
        return;
      }
      const nextSections = result.sections || {};
      const nextCounts = { ...(result.counts || {}) };
      // Prefer API counts, but never show stale zeros when sections actually have rows.
      for (const [sectionId, rows] of Object.entries(nextSections)) {
        const key = sectionId as ArchiveSectionId;
        const rowCount = Array.isArray(rows) ? rows.length : 0;
        if (typeof nextCounts[key] !== "number" || nextCounts[key] !== rowCount) {
          nextCounts[key] = rowCount;
        }
      }
      setSections(nextSections);
      setCounts(nextCounts);
      if (debugArchive && result.diagnostics) {
        console.info("[archive-diagnostics]", result.diagnostics);
      }
    } catch {
      setError("Could not load archived records.");
    } finally {
      setLoading(false);
    }
  }, [companyFolderId, masterSheetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleSections = useMemo(() => SECTIONS, []);
  const activeItems = sections[activeSection] || [];
  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return activeItems;
    return activeItems.filter((item) =>
      [
        item.title,
        item.email,
        item.status,
        item.site,
        item.department,
        item.role,
        item.archiveReason,
        item.formNumber,
        item.revisionNumber ? `rev ${item.revisionNumber}` : "",
        item.id,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    );
  }, [activeItems, search]);

  const canRestoreSection = (section: ArchiveSectionId) =>
    section === "users" ? canManageUsers : canManageRecords;

  const handleRestore = async (item: ArchivedListItem) => {
    if (offlineMode) {
      onToast?.("Offline", RESTORE_OFFLINE_MESSAGE, "neutral");
      return;
    }
    const section = activeSection;
    const confirmed = window.confirm(
      section === "users"
        ? "Reactivate this user? They will be able to access BERT again if their login details are valid."
        : section === "audits"
          ? "Restore as a new revision? This creates a new active revision from the old version. It does not overwrite the current active form."
          : "Restore this item? It will return to active views.",
    );
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      if (section === "audits") {
        await restoreAuditTemplateAsRevision(item.id, {
          companyFolderId,
          masterSheetId,
          reason: `Restored as new revision from archived template ${item.title}`,
        });
        onToast?.(
          "Restored as new revision",
          `${item.title} was restored as a new active revision. The previous active form was superseded.`,
          "success",
        );
        await load();
        return;
      }
      const result = await restoreCompanyRecord(companyFolderId, {
        type: TYPE_BY_SECTION[section],
        id: item.id,
        masterSheetId,
      });
      if (!result.ok) {
        onToast?.("Restore failed", result.message || result.error || "Could not restore item. Try again.", "warning");
        return;
      }
      onToast?.(section === "users" ? "User reactivated" : "Restored", `${item.title} is active again.`, "success");
      await load();
    } catch (error) {
      onToast?.(
        "Restore failed",
        error instanceof Error ? error.message : "Could not restore item. Try again.",
        "warning",
      );
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        icon="clipboard"
        eyebrow="Company records"
        title="Archive"
        subtitle="View, restore, or reactivate archived records across the company."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visibleSections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActiveSection(section.id)}
            className={[
              "rounded-2xl border px-4 py-4 text-left shadow-sm transition",
              activeSection === section.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-300",
            ].join(" ")}
          >
            <p className={activeSection === section.id ? "text-xs font-semibold uppercase tracking-[0.14em] text-slate-300" : "text-xs font-semibold uppercase tracking-[0.14em] text-slate-500"}>
              Archived {section.label}
            </p>
            <p className="mt-2 text-3xl font-black">{counts[section.id] ?? 0}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {visibleSections.map((section) => (
          <button
            key={`tab-${section.id}`}
            type="button"
            onClick={() => setActiveSection(section.id)}
            className={[
              "rounded-full px-4 py-2 text-sm font-semibold",
              activeSection === section.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
            ].join(" ")}
          >
            {section.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">
          Search archived {visibleSections.find((section) => section.id === activeSection)?.label.toLowerCase()}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title, email, status, site, or reason"
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-slate-400"
          />
        </label>
      </div>

      {offlineMode ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {ARCHIVE_OFFLINE_MESSAGE} {RESTORE_OFFLINE_MESSAGE}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading archived records…</p>
      ) : error ? (
        <EmptyPanel title="Archive unavailable" text={error} />
      ) : filteredItems.length === 0 ? (
        <EmptyPanel
          title={`No archived ${visibleSections.find((section) => section.id === activeSection)?.label.toLowerCase()}`}
          text="Archived records for this section will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {filteredItems.map((item) => (
            <li key={`${activeSection}-${item.id}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-slate-900">{item.title}</h2>
                    <span
                      className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-700"
                      data-testid={
                        activeSection === "audits" || activeSection === "googleForms"
                          ? "archive-status-badge"
                          : undefined
                      }
                    >
                      {String(item.status || "").toLowerCase() === "superseded" ? "Superseded" : "Archived"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {item.email || item.id}
                    {item.role ? ` · ${item.role}` : ""}
                    {item.status ? ` · ${item.status}` : ""}
                  </p>
                  {(activeSection === "audits" || activeSection === "googleForms") &&
                  (item.formNumber || item.revisionNumber) ? (
                    <p className="mt-1 text-sm font-medium text-slate-700" data-testid="archive-audit-revision-meta">
                      {item.formNumber || "Form"}
                      {item.revisionNumber ? ` · Rev ${item.revisionNumber}` : ""}
                    </p>
                  ) : null}
                  <div className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                    <p>Archived: {formatWhen(item.archivedAt)}</p>
                    <p>By: {item.archivedBy || "—"}</p>
                    <p className="sm:col-span-2">Reason: {item.archiveReason || "—"}</p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {(activeSection === "audits" || activeSection === "googleForms") && onViewAudit ? (
                    <button
                      type="button"
                      data-testid="archive-view-audit-button"
                      onClick={() => onViewAudit(item.id)}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800"
                    >
                      View
                    </button>
                  ) : null}
                  {canRestoreSection(activeSection) ? (
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={() => void handleRestore(item)}
                      className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-black text-white shadow-sm disabled:opacity-60"
                    >
                      {visibleSections.find((section) => section.id === activeSection)?.restoreVerb || "Restore"}
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
