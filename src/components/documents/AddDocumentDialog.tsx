import { useEffect, useMemo, useRef, useState } from "react";
import type { CompanyDocumentUser, CreateDocumentInput, DocumentFolder } from "../../types/documents";
import {
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITY_OPTIONS,
  EMPTY_DOCUMENT_FORM,
} from "../../types/documents";

type Props = {
  open: boolean;
  folders: DocumentFolder[];
  users: CompanyDocumentUser[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (input: CreateDocumentInput) => Promise<void>;
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function AddDocumentDialog({ open, folders, users, saving = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateDocumentInput>({ ...EMPTY_DOCUMENT_FORM });
  const [error, setError] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const folderOptions = useMemo(
    () => [...folders].sort((a, b) => a.folderPath.localeCompare(b.folderPath)),
    [folders],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
    const focusTimer = window.setTimeout(() => {
      firstFieldRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  const update = (patch: Partial<CreateDocumentInput>) => setForm((current) => ({ ...current, ...patch }));

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("File is too large (max 25 MB).");
      return;
    }
    try {
      const fileDataUrl = await readFileAsDataUrl(file);
      update({ fileName: file.name, mimeType: file.type, fileDataUrl });
      setError("");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "Could not read file.");
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.documentNumber.trim() || !form.title.trim() || !form.folderRecordId || !form.ownerUserId) {
      setError("Complete all required fields.");
      return;
    }
    if (!form.fileDataUrl) {
      setError("Choose a file to upload.");
      return;
    }
    try {
      await onSubmit(form);
      setForm({ ...EMPTY_DOCUMENT_FORM });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save document.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-document-dialog-title"
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl"
        style={{ maxHeight: "calc(100vh - 32px)", width: "min(100%, 42rem)" }}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-slate-200 px-5 py-4 sm:px-6">
            <div className="flex items-start justify-between gap-4">
              <h2 id="add-document-dialog-title" className="text-lg font-semibold text-slate-900">
                Add controlled document
              </h2>
              <button type="button" className="text-sm text-slate-500" onClick={onClose}>
                Close
              </button>
            </div>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
          </header>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Document Number *</span>
                <input
                  ref={firstFieldRef}
                  required
                  value={form.documentNumber}
                  onChange={(e) => update({ documentNumber: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Title *</span>
                <input
                  required
                  value={form.title}
                  onChange={(e) => update({ title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Description</span>
                <textarea
                  value={form.description}
                  onChange={(e) => update({ description: e.target.value })}
                  className="min-h-[72px] w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Folder *</span>
                <select
                  required
                  value={form.folderRecordId}
                  onChange={(e) => update({ folderRecordId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Select folder…</option>
                  {folderOptions.map((folder) => (
                    <option key={folder.folderRecordId} value={folder.folderRecordId}>
                      {folder.folderPath}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Owner *</span>
                <select
                  required
                  value={form.ownerUserId}
                  onChange={(e) => update({ ownerUserId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">Select owner…</option>
                  {users.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Approver</span>
                <select
                  value={form.approverUserId}
                  onChange={(e) => update({ approverUserId: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  <option value="">None</option>
                  {users.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.name} ({user.email})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Current Revision *</span>
                <input
                  required
                  value={form.currentRevision}
                  onChange={(e) => update({ currentRevision: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => update({ status: e.target.value as CreateDocumentInput["status"] })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {DOCUMENT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">ISO Clause</span>
                <input
                  value={form.isoClause}
                  onChange={(e) => update({ isoClause: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Department</span>
                <input
                  value={form.department}
                  onChange={(e) => update({ department: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Issue Date</span>
                <input
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => update({ issueDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Next Review Date</span>
                <input
                  type="date"
                  value={form.nextReviewDate}
                  onChange={(e) => update({ nextReviewDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Review Frequency (months)</span>
                <input
                  value={form.reviewFrequencyMonths}
                  onChange={(e) => update({ reviewFrequencyMonths: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Reminder Days</span>
                <input
                  value={form.reminderDays}
                  onChange={(e) => update({ reminderDays: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block text-slate-600">Keywords</span>
                <input
                  value={form.keywords}
                  onChange={(e) => update({ keywords: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Visibility</span>
                <select
                  value={form.visibility}
                  onChange={(e) => update({ visibility: e.target.value as CreateDocumentInput["visibility"] })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {DOCUMENT_VISIBILITY_OPTIONS.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {visibility}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">File *</span>
                <input required type="file" onChange={handleFileChange} className="w-full text-sm" />
              </label>
            </div>
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className="flex justify-end gap-3">
              <button type="button" className="rounded-lg border border-slate-200 px-4 py-2 text-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-60"
              >
                {saving ? "Saving…" : "Add Document"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}
