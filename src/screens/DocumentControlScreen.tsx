import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Role } from "../permissions";
import {
  canAccessDocumentControl,
  canApproveDocumentControl,
  canManageDocumentControl,
} from "../permissions";
import type {
  ControlledDocument,
  DocumentControlClauseGroup,
  DocumentControlIndexRow,
  DocumentControlSummary as SummaryType,
  DocumentRevision,
  SupersededWarningPayload,
} from "../types/documentControl";
import { EMPTY_DOCUMENT_CONTROL_SUMMARY } from "../types/documentControl";
import {
  approveDocumentRevision,
  archiveControlledDocument,
  createControlledDocument,
  createDocumentRevision,
  DOCUMENT_CONTROL_OFFLINE_WRITE_MESSAGE,
  fetchDocumentControlDocument,
  fetchDocumentControlDocuments,
  fetchDocumentControlIndex,
  fetchDocumentRevisionFile,
  readCachedDocumentControlDocuments,
  readCachedDocumentControlIndex,
  rebuildDocumentControlIndex,
  rejectDocumentRevision,
  restoreControlledDocument,
  submitDocumentRevision,
  upsertCachedDocumentControlDocument,
} from "../services/documentControlService";
import { DOCUMENT_STATUSES, DOCUMENT_STANDARDS, DOCUMENT_TYPES } from "../types/documentControl";
import { DocumentControlSummary } from "../components/document-control/DocumentControlSummary";
import { DocumentRegister } from "../components/document-control/DocumentRegister";
import { ClauseBrowser } from "../components/document-control/ClauseBrowser";
import { DocumentControlIndex } from "../components/document-control/DocumentControlIndex";
import { DocumentForm, EMPTY_DOCUMENT_FORM, type DocumentFormState } from "../components/document-control/DocumentForm";
import { DocumentDetails, EMPTY_REVISION_FORM } from "../components/document-control/DocumentDetails";
import { SupersededWarningDialog } from "../components/document-control/SupersededWarningDialog";
import type { NewRevisionFormState } from "../components/document-control/NewRevisionForm";

type Props = {
  role: Role;
  companyFolderId: string;
  masterSheetId?: string;
  userEmail: string;
  offlineMode?: boolean;
  onBack?: () => void;
};

type TabId = "register" | "clause" | "index" | "awaiting" | "archived" | "mine";

function deriveSummary(documents: ControlledDocument[]): SummaryType {
  let current = 0;
  let awaitingApproval = 0;
  let drafts = 0;
  let archived = 0;
  let reviewsDue = 0;
  for (const doc of documents) {
    if (doc.documentStatus === "current") current += 1;
    else if (doc.documentStatus === "awaiting_approval") awaitingApproval += 1;
    else if (doc.documentStatus === "draft") drafts += 1;
    else if (doc.documentStatus === "archived") archived += 1;
    if (
      doc.documentStatus !== "archived" &&
      (doc.reviewStatus === "review_overdue" || doc.reviewStatus === "review_due_soon")
    ) {
      reviewsDue += 1;
    }
  }
  return { current, awaitingApproval, drafts, reviewsDue, archived, total: documents.length };
}

export function DocumentControlScreen({
  role,
  companyFolderId,
  userEmail,
  offlineMode = false,
  onBack,
}: Props) {
  const { t } = useTranslation();
  const folderId = String(companyFolderId || "").trim();
  const canView = canAccessDocumentControl(role);
  const canManage = canManageDocumentControl(role);
  const canApprove = canApproveDocumentControl(role);

  const cached = readCachedDocumentControlDocuments(folderId);
  const [documents, setDocuments] = useState<ControlledDocument[]>(cached?.documents || []);
  const [summary, setSummary] = useState(cached?.summary || EMPTY_DOCUMENT_CONTROL_SUMMARY);
  const [clauseGroups, setClauseGroups] = useState<DocumentControlClauseGroup[]>(cached?.clauseGroups || []);
  const [indexRows, setIndexRows] = useState<DocumentControlIndexRow[]>(
    () => readCachedDocumentControlIndex(folderId)?.index || [],
  );
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexLoaded, setIndexLoaded] = useState(Boolean(readCachedDocumentControlIndex(folderId)?.index?.length));
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tab, setTab] = useState<TabId>("register");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [standardFilter, setStandardFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<ControlledDocument | null>(null);
  const [detailRevisions, setDetailRevisions] = useState<DocumentRevision[]>([]);
  const [detailCurrentRevision, setDetailCurrentRevision] = useState<DocumentRevision | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<DocumentFormState>({ ...EMPTY_DOCUMENT_FORM, ownerEmail: userEmail });
  const [showNewRevision, setShowNewRevision] = useState(false);
  const [revisionForm, setRevisionForm] = useState<NewRevisionFormState>(EMPTY_REVISION_FORM);
  const [saving, setSaving] = useState(false);
  const [supersededWarning, setSupersededWarning] = useState<SupersededWarningPayload | null>(null);
  const [pendingRevisionOpen, setPendingRevisionOpen] = useState<DocumentRevision | null>(null);
  const [openingFile, setOpeningFile] = useState(false);
  const initialLoadDone = useRef(false);

  const applyListPayload = useCallback((payload: {
    documents?: ControlledDocument[];
    summary?: SummaryType;
    clauseGroups?: DocumentControlClauseGroup[];
  }) => {
    const nextDocs = payload.documents || [];
    setDocuments(nextDocs);
    setSummary(payload.summary || deriveSummary(nextDocs));
    setClauseGroups(payload.clauseGroups || []);
  }, []);

  /** One register list request; never blanks existing rows; always uses deduped fetch. */
  const loadRegister = useCallback(
    async (options: { background?: boolean } = {}) => {
      if (!folderId || !canView) {
        return;
      }
      const hasRows = documents.length > 0 || Boolean(readCachedDocumentControlDocuments(folderId)?.documents?.length);
      if (options.background || hasRows) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError("");
      try {
        const payload = await fetchDocumentControlDocuments(folderId, {
          includeArchived: canManage,
        });
        applyListPayload(payload);
      } catch (err) {
        // Keep cached/register rows on failed refresh.
        if (!hasRows) {
          setError(err instanceof Error ? err.message : "Could not load controlled documents.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [folderId, canView, canManage, documents.length, applyListPayload],
  );

  useEffect(() => {
    if (!folderId || !canView || initialLoadDone.current) {
      return;
    }
    initialLoadDone.current = true;
    void loadRegister({ background: Boolean(cached) });
    // Initial open only — tab changes must not re-fetch the register.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, canView]);

  const loadIndex = useCallback(async () => {
    if (!folderId || tab !== "index") {
      return;
    }
    const cachedIndex = readCachedDocumentControlIndex(folderId);
    if (cachedIndex?.index?.length) {
      setIndexRows(cachedIndex.index);
      setIndexLoaded(true);
    }
    setIndexLoading(!cachedIndex?.index?.length);
    try {
      const payload = await fetchDocumentControlIndex(folderId);
      setIndexRows(payload.index || []);
      setIndexLoaded(true);
    } catch (err) {
      if (!cachedIndex?.index?.length) {
        setError(err instanceof Error ? err.message : "Could not load document control index.");
      }
    } finally {
      setIndexLoading(false);
    }
  }, [folderId, tab]);

  useEffect(() => {
    if (tab === "index") {
      void loadIndex();
    }
  }, [tab, loadIndex]);

  const guardWrite = () => {
    if (offlineMode) {
      setError(DOCUMENT_CONTROL_OFFLINE_WRITE_MESSAGE);
      return false;
    }
    return true;
  };

  const filteredDocuments = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return documents.filter((doc) => {
      if (tab === "awaiting" && doc.documentStatus !== "awaiting_approval") {
        return false;
      }
      if (tab === "archived" && doc.documentStatus !== "archived") {
        return false;
      }
      if (tab === "mine") {
        const ownerEmail = String(doc.ownerEmail || "").trim().toLowerCase();
        if (ownerEmail !== userEmail.trim().toLowerCase()) {
          return false;
        }
      }
      if (tab === "register" && doc.documentStatus === "archived" && !canManage) {
        return false;
      }
      if (typeFilter && doc.documentType !== typeFilter) {
        return false;
      }
      if (standardFilter && doc.primaryStandard !== standardFilter) {
        return false;
      }
      if (statusFilter && doc.documentStatus !== statusFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      const haystack = [
        doc.documentNumber,
        doc.title,
        doc.department,
        doc.keywords,
        doc.clauseReferences.join(" "),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [documents, tab, search, typeFilter, standardFilter, statusFilter, userEmail, canManage]);

  const openDetails = async (doc: ControlledDocument) => {
    setSelectedDoc(doc);
    setShowNewRevision(false);
    setRevisionForm(EMPTY_REVISION_FORM);
    setDetailLoading(true);
    setError("");
    try {
      const payload = await fetchDocumentControlDocument(folderId, doc.documentId);
      setSelectedDoc(payload.document || doc);
      setDetailRevisions(payload.revisions || []);
      setDetailCurrentRevision(payload.currentRevision || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load document.");
      setSelectedDoc(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const openRevisionFile = async (revision: DocumentRevision, acknowledge = false) => {
    setOpeningFile(true);
    setError("");
    try {
      const payload = await fetchDocumentRevisionFile(folderId, revision.revisionId, { acknowledge });
      const url = payload.file?.fileUrl;
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      setSupersededWarning(null);
      setPendingRevisionOpen(null);
    } catch (err) {
      const coded = err as Error & { code?: string; warning?: SupersededWarningPayload };
      if (coded.code === "SUPERSEDED_WARNING_REQUIRED" && coded.warning) {
        setSupersededWarning(coded.warning);
        setPendingRevisionOpen(revision);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not open revision file.");
    } finally {
      setOpeningFile(false);
    }
  };

  const saveCreate = async () => {
    if (!canManage || !guardWrite()) {
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const { clausesText: _c, fileMode: _m, ...input } = form;
      const result = await createControlledDocument(folderId, input);
      if (result.document) {
        upsertCachedDocumentControlDocument(folderId, result.document);
        setDocuments((prev) => [result.document!, ...prev.filter((row) => row.documentId !== result.document!.documentId)]);
        setSummary((prev) => deriveSummary([result.document!, ...documents.filter((row) => row.documentId !== result.document!.documentId)]));
      }
      setFormOpen(false);
      setForm({ ...EMPTY_DOCUMENT_FORM, ownerEmail: userEmail });
      setSuccess(`Draft ${result.document?.documentNumber || ""} saved.`);
      setTab("register");
      void loadRegister({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create document.");
    } finally {
      setSaving(false);
    }
  };

  const saveNewRevision = async () => {
    if (!selectedDoc || !canManage || !guardWrite()) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { fileMode: _m, ...input } = revisionForm;
      await createDocumentRevision(folderId, selectedDoc.documentId, input);
      setShowNewRevision(false);
      setRevisionForm(EMPTY_REVISION_FORM);
      await openDetails(selectedDoc);
      void loadRegister({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create revision.");
    } finally {
      setSaving(false);
    }
  };

  const onArchive = async () => {
    if (!selectedDoc || !canManage || !guardWrite()) {
      return;
    }
    setSaving(true);
    try {
      await archiveControlledDocument(folderId, selectedDoc.documentId);
      setSelectedDoc(null);
      void loadRegister({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive document.");
    } finally {
      setSaving(false);
    }
  };

  const onRestore = async () => {
    if (!selectedDoc || !canApprove || !guardWrite()) {
      return;
    }
    setSaving(true);
    try {
      await restoreControlledDocument(folderId, selectedDoc.documentId);
      await openDetails(selectedDoc);
      void loadRegister({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore document.");
    } finally {
      setSaving(false);
    }
  };

  const onRevisionAction = async (action: "submit" | "approve" | "reject", revisionId: string, reason = "") => {
    if (!guardWrite()) {
      return;
    }
    setSaving(true);
    try {
      if (action === "submit") {
        await submitDocumentRevision(folderId, revisionId);
      } else if (action === "approve") {
        await approveDocumentRevision(folderId, revisionId);
      } else {
        await rejectDocumentRevision(folderId, revisionId, { reason });
      }
      if (selectedDoc) {
        await openDetails(selectedDoc);
      }
      void loadRegister({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revision action failed.");
    } finally {
      setSaving(false);
    }
  };

  const onRebuildIndex = async () => {
    if (!canManage || !guardWrite()) {
      return;
    }
    setRebuilding(true);
    try {
      const payload = await rebuildDocumentControlIndex(folderId);
      setIndexRows(payload.index || []);
      setIndexLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rebuild index.");
    } finally {
      setRebuilding(false);
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600">You do not have access to Document Control.</p>
      </div>
    );
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "register", label: "Register" },
    { id: "clause", label: "By clause" },
    { id: "index", label: "Index" },
    ...(canManage ? [{ id: "awaiting" as const, label: "Awaiting approval" }] : []),
    ...(canManage ? [{ id: "archived" as const, label: "Archived" }] : []),
    { id: "mine", label: "My documents" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("nav.documentControl")}</p>
          <h1 className="text-2xl font-semibold text-slate-900">Document Control</h1>
          <p className="mt-1 text-sm text-slate-600">
            Controlled documents, revision history, and ISO clause mapping.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onBack ? (
            <button
              type="button"
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
              onClick={onBack}
            >
              {t("common.back")}
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={() => void loadRegister({ background: true })}
            disabled={loading || refreshing}
          >
            {refreshing ? "Refreshing…" : t("common.refresh")}
          </button>
          {canManage ? (
            <button
              type="button"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              onClick={() => {
                setForm({ ...EMPTY_DOCUMENT_FORM, ownerEmail: userEmail });
                setFormOpen(true);
                setSuccess("");
              }}
            >
              New document
            </button>
          ) : null}
        </div>
      </div>

      <DocumentControlSummary summary={summary} />

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`rounded-md px-3 py-1.5 text-sm ${tab === entry.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab !== "index" ? (
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-4">
          <input
            className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
            placeholder="Search title, number, keywords…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="">All types</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <select
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            value={standardFilter}
            onChange={(e) => setStandardFilter(e.target.value)}
          >
            <option value="">All standards</option>
            {DOCUMENT_STANDARDS.map((std) => (
              <option key={std} value={std}>
                {std}
              </option>
            ))}
          </select>
          {canManage && tab === "register" ? (
            <select
              className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-4"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              {DOCUMENT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{success}</div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}
      {loading && !documents.length && tab !== "index" ? (
        <p className="text-sm text-slate-500">Loading documents…</p>
      ) : null}
      {refreshing && documents.length > 0 ? (
        <p className="text-xs text-slate-400">Updating in the background…</p>
      ) : null}
      {indexLoading && tab === "index" && !indexLoaded ? (
        <p className="text-sm text-slate-500">Loading index…</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className={`${selectedDoc ? "lg:col-span-2" : "lg:col-span-5"}`}>
          {tab === "register" || tab === "awaiting" || tab === "archived" || tab === "mine" ? (
            <DocumentRegister
              documents={filteredDocuments}
              selectedId={selectedDoc?.documentId}
              onSelect={(doc) => void openDetails(doc)}
            />
          ) : null}
          {tab === "clause" ? (
            <ClauseBrowser clauseGroups={clauseGroups} onSelect={(doc) => void openDetails(doc)} />
          ) : null}
          {tab === "index" ? (
            <DocumentControlIndex
              rows={indexRows}
              canManage={canManage}
              rebuilding={rebuilding}
              onRebuild={() => void onRebuildIndex()}
            />
          ) : null}
        </div>

        {selectedDoc ? (
          <div className="lg:col-span-3">
            {detailLoading ? (
              <p className="text-sm text-slate-500">Loading document…</p>
            ) : (
              <DocumentDetails
                document={selectedDoc}
                revisions={detailRevisions}
                currentRevision={detailCurrentRevision}
                canManage={canManage}
                canApprove={canApprove}
                canViewSuperseded={canManage}
                saving={saving}
                showNewRevision={showNewRevision}
                revisionForm={revisionForm}
                onRevisionFormChange={(patch) => setRevisionForm((prev) => ({ ...prev, ...patch }))}
                onClose={() => setSelectedDoc(null)}
                onArchive={() => void onArchive()}
                onRestore={() => void onRestore()}
                onStartNewRevision={() => setShowNewRevision(true)}
                onCancelNewRevision={() => {
                  setShowNewRevision(false);
                  setRevisionForm(EMPTY_REVISION_FORM);
                }}
                onSaveNewRevision={() => void saveNewRevision()}
                onSubmitRevision={(id) => void onRevisionAction("submit", id)}
                onApproveRevision={(id) => void onRevisionAction("approve", id)}
                onRejectRevision={(id, reason) => void onRevisionAction("reject", id, reason)}
                onOpenFile={(rev) => void openRevisionFile(rev)}
              />
            )}
          </div>
        ) : null}
      </div>

      {formOpen ? (
        <DocumentForm
          form={form}
          onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
          saving={saving}
          onCancel={() => setFormOpen(false)}
          onSave={() => void saveCreate()}
        />
      ) : null}

      {supersededWarning && pendingRevisionOpen ? (
        <SupersededWarningDialog
          warning={supersededWarning}
          loading={openingFile}
          onCancel={() => {
            setSupersededWarning(null);
            setPendingRevisionOpen(null);
          }}
          onConfirm={() => void openRevisionFile(pendingRevisionOpen, true)}
        />
      ) : null}
    </div>
  );
}
