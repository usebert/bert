import type { ControlledDocument, DocumentControlClauseGroup } from "../../types/documentControl";

type Props = {
  clauseGroups: DocumentControlClauseGroup[];
  onSelect: (doc: ControlledDocument) => void;
};

export function ClauseBrowser({ clauseGroups, onSelect }: Props) {
  if (!clauseGroups.length) {
    return <p className="text-sm text-slate-500">No clause mappings available.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {clauseGroups.map((group) => (
        <div key={group.clauseCode} className="rounded-lg border border-slate-200 bg-white p-3">
          <h3 className="text-sm font-semibold text-slate-900">{group.clauseCode}</h3>
          <ul className="mt-2 divide-y divide-slate-100">
            {group.documents.map((doc) => (
              <li key={`${group.clauseCode}-${doc.documentId}`}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-1 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => onSelect(doc)}
                >
                  <span>
                    <span className="font-medium text-slate-900">{doc.documentNumber}</span>
                    <span className="ml-2 text-slate-600">{doc.title}</span>
                  </span>
                  <span className="text-xs text-slate-500">Rev {doc.currentRevision || "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
