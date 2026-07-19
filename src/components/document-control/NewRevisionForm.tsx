import type { CreateDocumentRevisionInput } from "../../types/documentControl";
import { DocumentFilePicker } from "./DocumentFilePicker";

export type NewRevisionFormState = CreateDocumentRevisionInput & {
  fileMode: "upload" | "reference";
};

export const EMPTY_REVISION_FORM: NewRevisionFormState = {
  changeSummary: "",
  issueDate: "",
  effectiveDate: "",
  fileName: "",
  fileUrl: "",
  fileId: "",
  fileMode: "upload",
};

type Props = {
  documentTitle: string;
  form: NewRevisionFormState;
  onChange: (patch: Partial<NewRevisionFormState>) => void;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

export function NewRevisionForm({ documentTitle, form, onChange, saving, onCancel, onSave }: Props) {
  const onFilePick = async (file: File) => {
    onChange({
      fileName: file.name,
      mimeType: file.type,
      fileSize: String(file.size),
      fileMode: "upload",
      fileUrl: "",
      fileId: "",
    });
    try {
      const fileDataUrl = await readFileAsDataUrl(file);
      onChange({ fileDataUrl, fileMode: "upload" });
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-semibold text-slate-900">New revision — {documentTitle}</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="sm:col-span-2 text-sm">
          <span className="text-slate-600">Change summary *</span>
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.changeSummary}
            onChange={(e) => onChange({ changeSummary: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Issue date</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.issueDate || ""}
            onChange={(e) => onChange({ issueDate: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="text-slate-600">Effective date</span>
          <input
            type="date"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            value={form.effectiveDate || ""}
            onChange={(e) => onChange({ effectiveDate: e.target.value })}
          />
        </label>
        <div className="sm:col-span-2 rounded-md border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-700">Replacement file *</p>
          <div className="mt-2 flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={form.fileMode === "upload"}
                onChange={() => onChange({ fileMode: "upload" })}
              />
              Upload
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={form.fileMode === "reference"}
                onChange={() => onChange({ fileMode: "reference", fileDataUrl: undefined })}
              />
              Reference
            </label>
          </div>
          {form.fileMode === "reference" ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="File name"
                value={form.fileName || ""}
                onChange={(e) => onChange({ fileName: e.target.value })}
              />
              <input
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                placeholder="File URL"
                value={form.fileUrl || ""}
                onChange={(e) => onChange({ fileUrl: e.target.value })}
              />
            </div>
          ) : (
            <div className="mt-2">
              <DocumentFilePicker
                fileName={form.fileName}
                disabled={saving}
                onFileSelected={onFilePick}
                onClear={() =>
                  onChange({
                    fileName: "",
                    fileDataUrl: undefined,
                    fileSize: "",
                    mimeType: "",
                    fileId: "",
                    fileUrl: "",
                  })
                }
              />
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="button"
          className="min-h-11 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save draft revision"}
        </button>
      </div>
    </div>
  );
}
