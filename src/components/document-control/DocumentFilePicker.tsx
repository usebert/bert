import { useId, useRef, useState } from "react";

/** Client-side mirrors of shared/document-control.mjs allow-lists (presentation validation only). */
export const DOCUMENT_UPLOAD_EXTENSIONS = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "jpg",
  "jpeg",
  "png",
] as const;

export const DOCUMENT_UPLOAD_ACCEPT = DOCUMENT_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(",");
export const DOCUMENT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

type Props = {
  fileName?: string;
  disabled?: boolean;
  onFileSelected: (file: File) => void | Promise<void>;
  onClear?: () => void;
};

function extensionOf(fileName: string): string {
  const parts = String(fileName || "").trim().toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

export function validateDocumentUploadFile(file: File): string {
  const ext = extensionOf(file.name);
  if (!DOCUMENT_UPLOAD_EXTENSIONS.includes(ext as (typeof DOCUMENT_UPLOAD_EXTENSIONS)[number])) {
    return `Unsupported file type (.${ext || "unknown"}). Allowed: ${DOCUMENT_UPLOAD_EXTENSIONS.join(", ").toUpperCase()}.`;
  }
  if (file.size > DOCUMENT_UPLOAD_MAX_BYTES) {
    return "File is too large. Maximum size is 25 MB.";
  }
  return "";
}

/**
 * Bert-styled file picker: hidden native input + visible Choose document button,
 * optional drag-and-drop, selected filename, and clear action.
 */
export function DocumentFilePicker({ fileName, disabled, onFileSelected, onClear }: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [validationError, setValidationError] = useState("");

  const applyFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    const error = validateDocumentUploadFile(file);
    if (error) {
      setValidationError(error);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
      return;
    }
    setValidationError("");
    await onFileSelected(file);
  };

  return (
    <div className="space-y-2">
      <div
        className={`rounded-lg border-2 border-dashed p-4 transition ${
          dragOver ? "border-slate-700 bg-slate-50" : "border-slate-300 bg-white"
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (disabled) {
            return;
          }
          void applyFile(event.dataTransfer.files?.[0] || null);
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={DOCUMENT_UPLOAD_ACCEPT}
            className="sr-only"
            disabled={disabled}
            onChange={(event) => void applyFile(event.target.files?.[0] || null)}
          />
          <button
            type="button"
            className="min-h-11 rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            aria-controls={inputId}
          >
            Choose document
          </button>
          {fileName ? (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-800" title={fileName}>
                {fileName}
              </p>
              {onClear ? (
                <button
                  type="button"
                  className="mt-0.5 text-xs font-medium text-slate-600 underline"
                  disabled={disabled}
                  onClick={() => {
                    setValidationError("");
                    if (inputRef.current) {
                      inputRef.current.value = "";
                    }
                    onClear();
                  }}
                >
                  Remove file
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-slate-500">or drag and drop a file here</p>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Accepted: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, JPEG, PNG · Max 25 MB
        </p>
      </div>
      {validationError ? <p className="text-sm text-red-700">{validationError}</p> : null}
    </div>
  );
}
