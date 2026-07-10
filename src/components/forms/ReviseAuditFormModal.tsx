import { useState } from "react";

type ReviseAuditFormModalProps = {
  open: boolean;
  sourceTitle: string;
  revisionLabel?: string;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (input: { reason: string }) => void;
};

export function ReviseAuditFormModal({
  open,
  sourceTitle,
  revisionLabel = "",
  busy = false,
  error = "",
  onCancel,
  onSubmit,
}: ReviseAuditFormModalProps) {
  const [reason, setReason] = useState("");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-slate-900">Create new revision</h3>
        <p className="mt-2 text-sm text-slate-600">
          You are creating a new revision of this controlled form. The current version will be archived as superseded and
          the new version will become active.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Source: {sourceTitle}
          {revisionLabel ? ` · ${revisionLabel}` : ""}
        </p>

        <label className="mt-4 block text-sm font-semibold text-slate-700">
          Reason for revision
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What changed in this revision?"
            className="mt-2 min-h-[4.5rem] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            autoFocus
          />
        </label>

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
            onClick={() => onSubmit({ reason: reason.trim() })}
            className="inline-flex h-11 items-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create revision"}
          </button>
        </div>
      </div>
    </div>
  );
}
