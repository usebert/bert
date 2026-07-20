import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CompanyDocumentUser, CreateDocumentInput, DocumentFolder } from "../../types/documents";
import {
  DOCUMENT_STATUSES,
  DOCUMENT_VISIBILITY_OPTIONS,
  EMPTY_DOCUMENT_FORM,
} from "../../types/documents";
import {
  evaluateAddDocumentDialogViewportLayout,
  type LayoutRect,
} from "./addDocumentDialogLayout";

type Props = {
  open: boolean;
  folders: DocumentFolder[];
  users: CompanyDocumentUser[];
  saving?: boolean;
  onClose: () => void;
  onSubmit: (input: CreateDocumentInput) => Promise<void>;
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const OVERLAY_Z_INDEX = 10000;

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function toLayoutRect(domRect: DOMRect): LayoutRect {
  return {
    top: domRect.top,
    bottom: domRect.bottom,
    left: domRect.left,
    right: domRect.right,
    width: domRect.width,
    height: domRect.height,
  };
}

function isDevDiagnosticsEnabled() {
  return Boolean(import.meta.env?.DEV) && String(import.meta.env?.VITE_DOCUMENTS_MODAL_DEBUG || "") === "1";
}

export function AddDocumentDialog({ open, folders, users, saving = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<CreateDocumentInput>({ ...EMPTY_DOCUMENT_FORM });
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const folderOptions = useMemo(
    () => [...folders].sort((a, b) => a.folderPath.localeCompare(b.folderPath)),
    [folders],
  );

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const previousBody = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    const windowScrollY = window.scrollY;
    const stage = document.querySelector(".qms-screen-stage") as HTMLElement | null;
    const previousStageOverflow = stage?.style.overflow || "";
    const stageScrollTop = stage?.scrollTop || 0;

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${windowScrollY}px`;
    document.body.style.width = "100%";
    if (stage) {
      stage.style.overflow = "hidden";
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        if (bodyRef.current) {
          bodyRef.current.scrollTop = 0;
        }
        const field = firstFieldRef.current;
        if (field) {
          field.scrollIntoView({ block: "nearest", inline: "nearest" });
          field.focus({ preventScroll: true });
        }

        if (
          isDevDiagnosticsEnabled() &&
          dialogRef.current &&
          headerRef.current &&
          footerRef.current &&
          bodyRef.current &&
          firstFieldRef.current
        ) {
          const snapshot = {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            dialog: toLayoutRect(dialogRef.current.getBoundingClientRect()),
            header: toLayoutRect(headerRef.current.getBoundingClientRect()),
            footer: toLayoutRect(footerRef.current.getBoundingClientRect()),
            firstField: toLayoutRect(firstFieldRef.current.getBoundingClientRect()),
            bodyScrollHeight: bodyRef.current.scrollHeight,
            bodyClientHeight: bodyRef.current.clientHeight,
          };
          const layout = evaluateAddDocumentDialogViewportLayout(snapshot);
          console.info("[documents-modal-layout]", { snapshot, layout });
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousBody.overflow;
      document.body.style.position = previousBody.position;
      document.body.style.top = previousBody.top;
      document.body.style.width = previousBody.width;
      window.scrollTo(0, windowScrollY);
      if (stage) {
        stage.style.overflow = previousStageOverflow;
        stage.scrollTop = stageScrollTop;
      }
    };
  }, [open]);

  if (!open || typeof document === "undefined") {
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

  return createPortal(
    <div
      data-testid="add-document-overlay"
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: OVERLAY_Z_INDEX,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backgroundColor: "rgba(15, 23, 42, 0.4)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        data-testid="add-document-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-document-dialog-title"
        className="rounded-2xl border border-slate-200 bg-white shadow-xl"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "min(42rem, calc(100vw - 32px))",
          maxHeight: "calc(100dvh - 32px)",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            display: "flex",
            flexDirection: "column",
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <header
            ref={headerRef}
            data-testid="add-document-header"
            className="border-b border-slate-200 px-5 py-4 sm:px-6"
            style={{ flex: "0 0 auto" }}
          >
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

          <div
            ref={bodyRef}
            data-testid="add-document-body"
            className="px-5 py-4 sm:px-6"
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              overscrollBehavior: "contain",
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Document Number *</span>
                <input
                  ref={firstFieldRef}
                  data-testid="add-document-first-field"
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

          <footer
            ref={footerRef}
            data-testid="add-document-footer"
            className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6"
            style={{ flex: "0 0 auto" }}
          >
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
    </div>,
    document.body,
  );
}
