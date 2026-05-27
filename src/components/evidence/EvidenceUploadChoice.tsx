import { useEffect, useId, useMemo, useRef, useState } from "react";

const DEVICE_ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx";
const CAMERA_ACCEPT = "image/*";

function CameraIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.6a1.8 1.8 0 0 1 1.45-.72h1.7c.57 0 1.1.27 1.45.72L15.5 6h2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" />
      <circle cx="12" cy="12.5" r="3.25" />
    </svg>
  );
}

type Props = {
  triggerLabel?: string;
  triggerClassName?: string;
  onFiles: (files: FileList) => void;
  disabled?: boolean;
};

export function EvidenceUploadChoice({
  triggerLabel = "Add evidence",
  triggerClassName = "min-h-[48px] rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800",
  onFiles,
  disabled = false,
}: Props) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const deviceInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const previewImage = useMemo(() => lastFiles.find((file) => file.type.startsWith("image/")) ?? null, [lastFiles]);
  const [previewUrl, setPreviewUrl] = useState("");
  const inputId = useId();

  useEffect(() => {
    if (!previewImage) {
      setPreviewUrl("");
      return;
    }
    const next = URL.createObjectURL(previewImage);
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [previewImage]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setLastFiles(Array.from(files));
    onFiles(files);
    setMessage("Evidence uploaded");
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={triggerClassName}>
        {triggerLabel}
      </button>
      {message ? <p className="text-xs font-medium text-emerald-700">{message}</p> : null}
      {previewImage ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {previewUrl ? <img src={previewUrl} alt={previewImage.name} className="h-28 w-full object-cover" /> : null}
          <p className="truncate px-3 py-2 text-xs font-medium text-slate-700">{previewImage.name}</p>
        </div>
      ) : lastFiles.length > 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          {lastFiles.map((file) => (
            <p key={`${file.name}-${file.size}`} className="truncate text-xs font-medium text-slate-700">
              {file.name}
            </p>
          ))}
        </div>
      ) : null}

      <input
        id={`${inputId}-camera`}
        ref={cameraInputRef}
        type="file"
        accept={CAMERA_ACCEPT}
        capture="environment"
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        id={`${inputId}-device`}
        ref={deviceInputRef}
        type="file"
        accept={DEVICE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-slate-950">Add evidence</h3>
            <p className="mt-1 text-sm text-slate-600">Take a photo or choose a file from this device.</p>
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white"
              >
                <CameraIcon />
                Take photo
              </button>
              <button
                type="button"
                onClick={() => deviceInputRef.current?.click()}
                className="min-h-[48px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900"
              >
                Choose from device
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
