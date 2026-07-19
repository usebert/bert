import type { SupersededWarningPayload } from "../../types/documentControl";

type Props = {
  warning: SupersededWarningPayload;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
};

export function SupersededWarningDialog({ warning, onCancel, onConfirm, loading = false }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-4 shadow-lg">
        <h2 className="text-lg font-semibold text-amber-900">{warning.title || "Superseded document"}</h2>
        <p className="mt-2 text-sm text-slate-700">
          {warning.body || "This is not the current approved revision and must not be used for operational purposes."}
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Revision {warning.revision}
          {warning.currentRevision ? ` · Current approved: Rev ${warning.currentRevision}` : null}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Opening…" : "I understand — open file"}
          </button>
        </div>
      </div>
    </div>
  );
}
