import type { ControlledCompanyDocument } from "../../types/documents";
import { bertRowInteractive } from "../animation/animationClasses";

type Props = {
  documents: ControlledCompanyDocument[];
  onOpen: (documentId: string) => void;
};

function fileTypeLabel(mimeType: string, fileName: string) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("pdf")) return "PDF";
  if (mime.includes("word")) return "Word";
  if (mime.includes("sheet") || mime.includes("excel")) return "Excel";
  if (mime.includes("presentation") || mime.includes("powerpoint")) return "PowerPoint";
  const ext = fileName.includes(".") ? fileName.split(".").pop()?.toUpperCase() : "";
  return ext || "File";
}

export function DocumentList({ documents, onOpen }: Props) {
  if (documents.length === 0) {
    return <p className="text-sm text-slate-500 py-6 text-center">No documents in this folder.</p>;
  }
  return (
    <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden bg-white">
      {documents.map((doc) => (
        <button
          key={doc.documentId}
          type="button"
          className={`${bertRowInteractive} w-full text-left px-4 py-3 grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center`}
          onClick={() => onOpen(doc.documentId)}
        >
          <div>
            <div className="font-medium text-slate-900">
              {doc.documentNumber} — {doc.title}
            </div>
            <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
              <span>Rev {doc.currentRevision || "—"}</span>
              <span>{doc.status || "—"}</span>
              <span>{doc.ownerName || "—"}</span>
              {doc.isoClause ? <span>Clause {doc.isoClause}</span> : null}
              {doc.nextReviewDate ? <span>Review {doc.nextReviewDate}</span> : null}
            </div>
          </div>
          <div className="text-xs text-slate-500 md:text-right">{fileTypeLabel(doc.mimeType, doc.googleFileName)}</div>
        </button>
      ))}
    </div>
  );
}
