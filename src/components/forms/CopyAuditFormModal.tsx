import { useState } from "react";

type CopyAuditFormModalProps = {
  open: boolean;
  sourceTitle: string;
  mode?: "audit" | "form";
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (input: { title: string; reason: string; confirmArchivedTitle?: boolean }) => void;
};

export function CopyAuditFormModal({
  open,
  sourceTitle,
  mode: _mode = "audit",
  busy = false,
  error = "",
  onCancel,
  onSubmit,
}: CopyAuditFormModalProps) {
  void _mode;
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [confirmArchivedTitle, setConfirmArchivedTitle] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Copy form</h3>
        <p className="mt-2 text-sm text-slate-600">
          You are creating a new form based on this one. It will get its own form number and start at Rev 1.
        </p>
        <p className="mt-1 text-xs text-slate-500">Source: {sourceTitle}</p>

        <label className="mt-4 block text-sm font-semibold text-slate-700">
          New title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Warehouse H&S Audit"
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
            autoFocus
          />
        </label>

        <label className="mt-3 block text-sm font-semibold text-slate-700">
          Copy notes
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Based on DC H&S Audit"
            className="mt-2 min-h-[4.5rem] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
          />
        </label>

        {error?.toLowerCase().includes("archived") ? (
          <label className="mt-3 flex items-start gap-2 text-sm text-amber-900">
            <input
              type="checkbox"
              checked={confirmArchivedTitle}
              onChange={(event) => setConfirmArchivedTitle(event.target.checked)}
              className="mt-1"
            />
            <span>I understand a previous archived form used this title and want to continue.</span>
          </label>
        ) : null}

        {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              onSubmit({
                title: title.trim(),
                reason: reason.trim(),
                confirmArchivedTitle: confirmArchivedTitle || undefined,
              })
            }
            className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
