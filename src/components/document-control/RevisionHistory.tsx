import type { DocumentRevision } from "../../types/documentControl";

type Props = {
  revisions: DocumentRevision[];
  currentRevisionId?: string;
  canViewSuperseded: boolean;
  onOpenFile: (revision: DocumentRevision) => void;
};

function formatDateTime(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) {
    return "—";
  }
  try {
    return new Date(raw).toLocaleString();
  } catch {
    return raw;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "current":
      return "bg-emerald-100 text-emerald-800";
    case "awaiting_approval":
      return "bg-amber-100 text-amber-800";
    case "superseded":
      return "bg-slate-200 text-slate-600";
    case "rejected":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

export function RevisionHistory({ revisions, currentRevisionId, canViewSuperseded, onOpenFile }: Props) {
  if (!revisions.length) {
    return <p className="text-sm text-slate-500">No revisions recorded.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Rev</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">File</th>
            <th className="px-3 py-2">Change summary</th>
            <th className="px-3 py-2">Approved</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {revisions.map((rev) => {
            const isSuperseded = rev.revisionStatus === "superseded";
            const canOpen =
              rev.revisionStatus === "current" ||
              (canViewSuperseded && (rev.revisionStatus === "superseded" || rev.revisionStatus === "draft" || rev.revisionStatus === "awaiting_approval"));
            return (
              <tr
                key={rev.revisionId}
                className={`border-b border-slate-100 ${rev.revisionId === currentRevisionId ? "bg-sky-50" : ""}`}
              >
                <td className="px-3 py-2 font-medium">{rev.revision}</td>
                <td className="px-3 py-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusClass(rev.revisionStatus)}`}>
                    {rev.revisionStatus.replace(/_/g, " ")}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-600">{rev.fileName || "—"}</td>
                <td className="px-3 py-2 text-slate-600">{rev.changeSummary || "—"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {rev.approvedBy ? `${rev.approvedBy} · ${formatDateTime(rev.approvedAt)}` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {canOpen && rev.fileUrl ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-sky-700 hover:underline"
                      onClick={() => onOpenFile(rev)}
                    >
                      {isSuperseded ? "Open (superseded)" : "Open"}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
