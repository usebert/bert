import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatedButton } from "../animation/AnimatedButton";
import { SuccessTick } from "../animation/SuccessTick";
import { bertEvidencePanel, bertFadeIn } from "../animation/animationClasses";
import { usePrefersReducedMotion } from "../animation/usePrefersReducedMotion";
import { bertSecondaryButtonInteract } from "../../styles/interactions";

const DEVICE_ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx";
const CAMERA_ACCEPT = "image/*";

type UploadPhase = "idle" | "selecting" | "attached" | "saved";

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
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [lastFiles, setLastFiles] = useState<File[]>([]);
  const previewImage = useMemo(() => lastFiles.find((file) => file.type.startsWith("image/")) ?? null, [lastFiles]);
  const [previewUrl, setPreviewUrl] = useState("");
  const inputId = useId();
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!previewImage) {
      setPreviewUrl("");
      return;
    }
    const next = URL.createObjectURL(previewImage);
    setPreviewUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [previewImage]);

  useEffect(() => {
    if (phase !== "attached") return;
    const timer = window.setTimeout(() => setPhase("saved"), 400);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setLastFiles(Array.from(files));
    onFiles(files);
    setPhase("attached");
    setOpen(false);
  };

  const statusLine =
    phase === "selecting"
      ? "Selecting…"
      : phase === "attached"
        ? "Attached"
        : phase === "saved"
          ? "Saved"
          : null;

  return (
    <div className="space-y-2">
      <AnimatedButton
        type="button"
        onClick={() => {
          setOpen(true);
          setPhase("selecting");
        }}
        disabled={disabled}
        className={triggerClassName}
      >
        {triggerLabel}
      </AnimatedButton>
      {statusLine ? (
        <p
          className={[
            "flex items-center gap-2 text-xs font-medium text-emerald-700",
            phase === "saved" && !reducedMotion ? bertFadeIn : "",
          ].join(" ")}
        >
          {phase === "saved" ? <SuccessTick className="h-5 w-5" label="Evidence saved" /> : null}
          <span>{statusLine}</span>
          {phase === "attached" && !reducedMotion ? (
            <span className="bert-sync-spinner inline-flex text-emerald-600" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M12 3a9 9 0 1 0 9 9" strokeLinecap="round" className="bert-sync-spinner-stroke origin-center" />
              </svg>
            </span>
          ) : null}
        </p>
      ) : null}
      {previewImage ? (
        <div className={["overflow-hidden rounded-xl border border-slate-200 bg-white", !reducedMotion ? bertFadeIn : ""].join(" ")}>
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
          <div
            className={[
              "w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl",
              reducedMotion ? "" : bertEvidencePanel,
            ].join(" ")}
          >
            <h3 className="text-xl font-semibold text-slate-950">Add evidence</h3>
            <p className="mt-1 text-sm text-slate-600">Take a photo or choose a file from this device.</p>
            <div className="mt-4 space-y-2">
              <AnimatedButton
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white"
              >
                <CameraIcon />
                Take photo
              </AnimatedButton>
              <AnimatedButton
                type="button"
                onClick={() => deviceInputRef.current?.click()}
                className={`min-h-[48px] w-full rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 ${bertSecondaryButtonInteract}`}
              >
                Choose from device
              </AnimatedButton>
              <AnimatedButton
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (phase === "selecting") setPhase("idle");
                }}
                className={`min-h-[48px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}
              >
                Cancel
              </AnimatedButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
