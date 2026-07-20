import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "../permissions";
import { canManageDocuments } from "../permissions";
import type {
  ControlledCompanyDocument,
  CreateDocumentInput,
  DocumentFolder,
  MasterDocumentIndexRow,
} from "../types/documents";
import { bertSectionEnter, bertTabPanel, bertTabTrigger } from "../components/animation/animationClasses";
import { DocumentFolderTree } from "../components/documents/DocumentFolderTree";
import { DocumentList } from "../components/documents/DocumentList";
import { DocumentSearch } from "../components/documents/DocumentSearch";
import { AddDocumentDialog } from "../components/documents/AddDocumentDialog";
import {
  createDocument,
  fetchDocuments,
  provisionDocumentFolders,
  searchDocuments,
} from "../services/documentService";

type Props = {
  role: Role;
  companyFolderId: string;
  userEmail: string;
  offlineMode?: boolean;
  onOpenDocument: (documentId: string) => void;
  onBack?: () => void;
};

type TabId = "browse" | "index";

export function DocumentsScreen({
  role,
  companyFolderId,
  userEmail,
  offlineMode = false,
  onOpenDocument,
  onBack,
}: Props) {
  const folderId = String(companyFolderId || "").trim();
  const canManage = canManageDocuments(role);
  const [tab, setTab] = useState<TabId>("browse");
  const [documents, setDocuments] = useState<ControlledCompanyDocument[]>([]);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [masterIndex, setMasterIndex] = useState<MasterDocumentIndexRow[]>([]);
  const [users, setUsers] = useState<{ userId: string; name: string; email: string; role: string }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [indexStatusFilter, setIndexStatusFilter] = useState("");
  const [indexOwnerFilter, setIndexOwnerFilter] = useState("");
  const [indexClauseFilter, setIndexClauseFilter] = useState("");

  const load = useCallback(async () => {
    if (!folderId) {
      return;
    }
    setError("");
    try {
      const payload = search.trim()
        ? await searchDocuments(folderId, search.trim())
        : await fetchDocuments(folderId, { folderRecordId: selectedFolderId || undefined });
      setDocuments(payload.documents || []);
      setFolders(payload.folders || []);
      setMasterIndex(payload.masterIndex || []);
      setUsers(payload.users || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, [folderId, search, selectedFolderId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim()) {
        void load();
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, load]);

  const breadcrumb = useMemo(() => {
    if (!selectedFolderId) {
      return "All folders";
    }
    return folders.find((folder) => folder.folderRecordId === selectedFolderId)?.folderPath || "Selected folder";
  }, [folders, selectedFolderId]);

  const filteredIndex = useMemo(() => {
    return masterIndex.filter((row) => {
      if (indexStatusFilter && row.status !== indexStatusFilter) return false;
      if (indexOwnerFilter && row.owner !== indexOwnerFilter) return false;
      if (indexClauseFilter && row.isoClause !== indexClauseFilter) return false;
      if (search.trim()) {
        const needle = search.trim().toLowerCase();
        const hay = `${row.documentNumber} ${row.title} ${row.folder} ${row.owner}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [masterIndex, indexStatusFilter, indexOwnerFilter, indexClauseFilter, search]);

  const handleProvision = async () => {
    if (!folderId || offlineMode) {
      return;
    }
    setProvisioning(true);
    setError("");
    try {
      await provisionDocumentFolders(folderId);
      setSuccess("Document folders provisioned.");
      await load();
    } catch (provisionError) {
      setError(provisionError instanceof Error ? provisionError.message : "Could not provision folders.");
    } finally {
      setProvisioning(false);
    }
  };

  const handleCreate = async (input: CreateDocumentInput) => {
    if (!folderId || offlineMode) {
      throw new Error("You appear to be offline.");
    }
    setSaving(true);
    try {
      const ownerDefault = input.ownerUserId || userEmail;
      await createDocument(folderId, { ...input, ownerUserId: ownerDefault });
      setSuccess("Document registered.");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${bertSectionEnter} max-w-7xl mx-auto p-4 md:p-6 space-y-6`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          {onBack ? (
            <button type="button" className="text-sm text-slate-500 mb-2" onClick={onBack}>
              ← Back
            </button>
          ) : null}
          <h1 className="text-2xl font-semibold text-slate-900">Documents</h1>
          <p className="text-sm text-slate-500 mt-1">ISO 9001 controlled document register</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage ? (
            <>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-xl border border-slate-200 bg-white"
                disabled={provisioning || offlineMode}
                onClick={() => void handleProvision()}
              >
                {provisioning ? "Provisioning…" : "Provision folders"}
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm rounded-xl bg-slate-900 text-white disabled:opacity-60"
                disabled={offlineMode}
                onClick={() => setFormOpen(true)}
              >
                Add document
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <DocumentSearch value={search} onChange={setSearch} />

      <div className="flex gap-2 border-b border-slate-200">
        <button
          type="button"
          className={[
            "rounded-xl px-4 py-2 text-sm font-semibold",
            bertTabTrigger,
            tab === "browse" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
          ].join(" ")}
          onClick={() => setTab("browse")}
        >
          Browse
        </button>
        {canManage ? (
          <button
            type="button"
            className={[
              "rounded-xl px-4 py-2 text-sm font-semibold",
              bertTabTrigger,
              tab === "index" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700",
            ].join(" ")}
            onClick={() => setTab("index")}
          >
            Master Document Control Index
          </button>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading documents…</p> : null}

      {!loading && tab === "browse" ? (
        <div className={`${bertTabPanel} grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]`}>
          <aside className="border border-slate-200 rounded-xl bg-white p-3">
            <h2 className="text-sm font-medium text-slate-900 px-3 py-2">Folders</h2>
            <DocumentFolderTree
              folders={folders}
              selectedFolderId={selectedFolderId}
              onSelect={(next) => {
                setSelectedFolderId(next);
                setSearch("");
              }}
            />
          </aside>
          <section className="space-y-3">
            <p className="text-xs text-slate-500">Current folder: {breadcrumb}</p>
            <DocumentList documents={documents} onOpen={onOpenDocument} />
          </section>
        </div>
      ) : null}

      {!loading && tab === "index" && canManage ? (
        <div className={`${bertTabPanel} space-y-4`}>
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              value={indexStatusFilter}
              onChange={(e) => setIndexStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              {[...new Set(masterIndex.map((row) => row.status).filter(Boolean))].map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <select
              value={indexOwnerFilter}
              onChange={(e) => setIndexOwnerFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">All owners</option>
              {[...new Set(masterIndex.map((row) => row.owner).filter(Boolean))].map((owner) => (
                <option key={owner} value={owner}>
                  {owner}
                </option>
              ))}
            </select>
            <select
              value={indexClauseFilter}
              onChange={(e) => setIndexClauseFilter(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="">All ISO clauses</option>
              {[...new Set(masterIndex.map((row) => row.isoClause).filter(Boolean))].map((clause) => (
                <option key={clause} value={clause}>
                  {clause}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Document Number",
                    "Title",
                    "Folder",
                    "Revision",
                    "Status",
                    "Owner",
                    "Approver",
                    "ISO Clause",
                    "Department",
                    "Issue Date",
                    "Last Review",
                    "Next Review",
                    "Reminder Days",
                  ].map((heading) => (
                    <th key={heading} className="px-3 py-2 whitespace-nowrap">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredIndex.map((row) => (
                  <tr
                    key={row.documentId}
                    className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                    onClick={() => onOpenDocument(row.documentId)}
                  >
                    <td className="px-3 py-2">{row.documentNumber}</td>
                    <td className="px-3 py-2">{row.title}</td>
                    <td className="px-3 py-2">{row.folder}</td>
                    <td className="px-3 py-2">{row.revision}</td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">{row.owner}</td>
                    <td className="px-3 py-2">{row.approver}</td>
                    <td className="px-3 py-2">{row.isoClause}</td>
                    <td className="px-3 py-2">{row.department}</td>
                    <td className="px-3 py-2">{row.issueDate}</td>
                    <td className="px-3 py-2">{row.lastReview}</td>
                    <td className="px-3 py-2">{row.nextReview}</td>
                    <td className="px-3 py-2">{row.reminderDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <AddDocumentDialog
        open={formOpen}
        folders={folders}
        users={users}
        saving={saving}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
