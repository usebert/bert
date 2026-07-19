import type { ControlledDocument } from "../../types/documentControl";

type Props = {
  documents: ControlledDocument[];
  selectedId?: string;
  onSelect: (doc: ControlledDocument) => void;
};

function formatDate(dateKey?: string): string {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "—";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function statusClass(status: string): string {
  switch (status) {
    case "current":
      return "bg-emerald-100 text-emerald-800";
    case "awaiting_approval":
      return "bg-amber-100 text-amber-800";
    case "draft":
      return "bg-slate-100 text-slate-700";
    case "archived":
      return "bg-slate-100 text-slate-500";
    case "superseded":
      return "bg-slate-200 text-slate-600";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function DocumentRegister({ documents, selectedId, onSelect }: Props) {
  if (!documents.length) {
    return <p className="text-sm text-slate-500">No documents match the current filters.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Number</th>
            <th className="px-3 py-2">Title</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Standard</th>
            <th className="px-3 py-2">Rev</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Next review</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => (
            <tr
              key={doc.documentId}
              className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selectedId === doc.documentId ? "bg-sky-50" : ""}`}
              onClick={() => onSelect(doc)}
            >
              <td className="px-3 py-2 font-medium text-slate-900">{doc.documentNumber}</td>
              <td className="px-3 py-2 text-slate-700">{doc.title}</td>
              <td className="px-3 py-2 text-slate-600">{doc.documentType.replace(/_/g, " ")}</td>
              <td className="px-3 py-2 text-slate-600">{doc.primaryStandard}</td>
              <td className="px-3 py-2 text-slate-600">{doc.currentRevision || "—"}</td>
              <td className="px-3 py-2">
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusClass(doc.documentStatus)}`}>
                  {doc.documentStatus.replace(/_/g, " ")}
                </span>
                {doc.reviewStatus === "review_overdue" ? (
                  <span className="ml-1 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">Review overdue</span>
                ) : null}
                {doc.reviewStatus === "review_due_soon" ? (
                  <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Review due</span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-slate-600">{formatDate(doc.nextReviewDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
