import type { DocumentControlIndexRow } from "../../types/documentControl";

type Props = {
  rows: DocumentControlIndexRow[];
  canManage: boolean;
  rebuilding: boolean;
  onRebuild?: () => void;
};

function formatDate(dateKey?: string): string {
  const raw = String(dateKey || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return raw || "—";
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function DocumentControlIndex({ rows, canManage, rebuilding, onRebuild }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div className="flex justify-end">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 disabled:opacity-50"
            disabled={rebuilding}
            onClick={onRebuild}
          >
            {rebuilding ? "Rebuilding…" : "Rebuild index"}
          </button>
        </div>
      ) : null}
      {!rows.length ? (
        <p className="text-sm text-slate-500">No index rows yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Standard</th>
                <th className="px-3 py-2">Clauses</th>
                <th className="px-3 py-2">Rev</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Next review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.documentNumber}-${row.currentRevision}`} className="border-b border-slate-100">
                  <td className="px-3 py-2 font-medium">{row.documentNumber}</td>
                  <td className="px-3 py-2">{row.title}</td>
                  <td className="px-3 py-2">{row.documentType.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">{row.standard}</td>
                  <td className="px-3 py-2 text-xs">{row.clauseReferences}</td>
                  <td className="px-3 py-2">{row.currentRevision || "—"}</td>
                  <td className="px-3 py-2">{row.documentStatus.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2">{formatDate(row.nextReviewDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
