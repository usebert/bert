import { DOCUMENT_STANDARDS, DOCUMENT_TYPES, type CreateControlledDocumentInput } from "../../types/documentControl";

export type DocumentFormState = CreateControlledDocumentInput & {
  clausesText: string;
  fileMode: "upload" | "reference";
};

export const EMPTY_DOCUMENT_FORM: DocumentFormState = {
  title: "",
  documentType: "procedure",
  department: "",
  ownerName: "",
  ownerEmail: "",
  primaryStandard: "ISO9001",
  clauseReferences: [],
  clausesText: "",
  keywords: "",
  issueDate: "",
  effectiveDate: "",
  nextReviewDate: "",
  changeSummary: "",
  fileName: "",
  fileUrl: "",
  fileId: "",
  fileMode: "reference",
};

type Props = {
  form: DocumentFormState;
  onChange: (patch: Partial<DocumentFormState>) => void;
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

export function DocumentForm({ form, onChange, saving, onCancel, onSave }: Props) {
  const onFilePick = async (file: File | null) => {
    if (!file) {
      return;
    }
    onChange({ fileName: file.name, mimeType: file.type, fileSize: String(file.size) });
    try {
      const fileDataUrl = await readFileAsDataUrl(file);
      onChange({ fileDataUrl, fileMode: "upload" });
    } catch {
      /* leave reference fields */
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-10">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">New controlled document</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm">
            <span className="text-slate-600">Title *</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.title}
              onChange={(e) => onChange({ title: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-600">Type *</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.documentType}
              onChange={(e) => onChange({ documentType: e.target.value })}
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="text-slate-600">Department *</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.department}
              onChange={(e) => onChange({ department: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-600">Owner name</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.ownerName || ""}
              onChange={(e) => onChange({ ownerName: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-600">Owner email</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.ownerEmail || ""}
              onChange={(e) => onChange({ ownerEmail: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-slate-600">Standard *</span>
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.primaryStandard}
              onChange={(e) => onChange({ primaryStandard: e.target.value })}
            >
              {DOCUMENT_STANDARDS.map((std) => (
                <option key={std} value={std}>
                  {std}
                </option>
              ))}
            </select>
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="text-slate-600">Clause references * (comma-separated)</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              placeholder="ISO9001:7.5, ISO14001:7.5"
              value={form.clausesText}
              onChange={(e) =>
                onChange({
                  clausesText: e.target.value,
                  clauseReferences: e.target.value
                    .split(/[,;|]/)
                    .map((part) => part.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="text-slate-600">Keywords</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.keywords || ""}
              onChange={(e) => onChange({ keywords: e.target.value })}
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
          <label className="text-sm">
            <span className="text-slate-600">Next review date</span>
            <input
              type="date"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.nextReviewDate || ""}
              onChange={(e) => onChange({ nextReviewDate: e.target.value })}
            />
          </label>
          <label className="sm:col-span-2 text-sm">
            <span className="text-slate-600">Change summary</span>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              value={form.changeSummary || ""}
              onChange={(e) => onChange({ changeSummary: e.target.value })}
            />
          </label>
          <div className="sm:col-span-2 rounded-md border border-slate-200 p-3">
            <p className="text-sm font-medium text-slate-700">File *</p>
            <div className="mt-2 flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={form.fileMode === "reference"}
                  onChange={() => onChange({ fileMode: "reference", fileDataUrl: undefined })}
                />
                Google / URL reference
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={form.fileMode === "upload"}
                  onChange={() => onChange({ fileMode: "upload" })}
                />
                Upload file
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
                <input
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm sm:col-span-2"
                  placeholder="Google file ID (optional)"
                  value={form.fileId || ""}
                  onChange={(e) => onChange({ fileId: e.target.value })}
                />
              </div>
            ) : (
              <input
                type="file"
                className="mt-2 block w-full text-sm"
                onChange={(e) => void onFilePick(e.target.files?.[0] || null)}
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Create document"}
          </button>
        </div>
      </div>
    </div>
  );
}
