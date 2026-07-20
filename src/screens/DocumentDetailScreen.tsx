import { useCallback, useEffect, useState } from "react";
import type { Role } from "../permissions";
import type { ControlledCompanyDocument, DocumentRevisionRecord } from "../types/documents";
import { bertSectionEnter } from "../components/animation/animationClasses";
import { DocumentProperties } from "../components/documents/DocumentProperties";
import { fetchDocumentDetail, openDocumentFile } from "../services/documentService";

type Props = {
  role: Role;
  companyFolderId: string;
  documentId: string;
  offlineMode?: boolean;
  onBack: () => void;
};

export function DocumentDetailScreen({ companyFolderId, documentId, offlineMode = false, onBack }: Props) {
  const [document, setDocument] = useState<ControlledCompanyDocument | null>(null);
  const [revisions, setRevisions] = useState<DocumentRevisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opening, setOpening] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  const load = useCallback(async () => {
    const folderId = String(companyFolderId || "").trim();
    const id = String(documentId || "").trim();
    if (!folderId || !id) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const payload = await fetchDocumentDetail(folderId, id);
      setDocument(payload.document);
      setRevisions(payload.revisions || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load document.");
    } finally {
      setLoading(false);
    }
  }, [companyFolderId, documentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleOpen = async () => {
    if (!document || offlineMode) {
      return;
    }
    setOpening(true);
    setError("");
    try {
      const file = await openDocumentFile(companyFolderId, document.documentId);
      const url = String(file.openUrl || "").trim();
      if (!url) {
        throw new Error("No preview URL available.");
      }
      if (String(file.mimeType || "").includes("pdf")) {
        setPreviewUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open document.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className={`${bertSectionEnter} max-w-4xl mx-auto p-4 md:p-6 space-y-6`}>
      <button type="button" className="text-sm text-slate-500" onClick={onBack}>
        ← Back to documents
      </button>
      {loading ? <p className="text-sm text-slate-500">Loading document…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {document ? (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                {document.documentNumber} — {document.title}
              </h1>
              <p className="text-sm text-slate-500 mt-1">{document.folderPath}</p>
            </div>
            <button
              type="button"
              disabled={opening || offlineMode}
              className="px-4 py-2 text-sm rounded-xl bg-slate-900 text-white disabled:opacity-60"
              onClick={() => void handleOpen()}
            >
              {opening ? "Opening…" : "Open document"}
            </button>
          </div>
          {previewUrl ? (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
              <iframe title={document.title} src={previewUrl} className="w-full min-h-[480px]" />
            </div>
          ) : null}
          <div className="border border-slate-200 rounded-xl bg-white p-5">
            <h2 className="text-sm font-medium text-slate-900 mb-4">Document properties</h2>
            <DocumentProperties document={document} revisions={revisions} />
          </div>
        </>
      ) : null}
    </div>
  );
}
