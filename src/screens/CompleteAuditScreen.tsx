import { useEffect, useRef, type PointerEvent } from "react";
import { MetaPill, SectionHeader, StatusBadge } from "../components/dashboard/DashboardPrimitives";
import { darkPanelEyebrow, darkPanelShell } from "../styles/darkPanel";
import { getAuditTrafficStatus, getDueWarning } from "../utils/dashboardHealth";
import type { CompleteAuditAnswerButtonProps, CompleteAuditScreenProps } from "../types/completeAuditScreenProps";

export function CompleteAuditScreen({
  audit,
  responses,
  notes,
  evidence,
  signatureDataUrl,
  signatureSignedAt,
  offlineMode,
  savedAt,
  canSubmit,
  onSelect,
  onNoteChange,
  onAddEvidence,
  onRemoveEvidence,
  onSignatureChange,
  onSaveDraft,
  onSubmit,
  onCancel,
  AppIcon,
  slatePrimaryCtaInteract,
}: CompleteAuditScreenProps) {
  const answered = audit.questions.filter((question) => responses[question.id]).length;
  const evidenceTotal = audit.questions.reduce((total, question) => total + (evidence[question.id]?.length ?? 0), 0);

  return (
    <div className="space-y-4">
      <section className={darkPanelShell}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={darkPanelEyebrow}>{audit.category}</p>
            <h2 className="mt-2 text-[1.85rem] font-semibold tracking-tight text-[#F8FAFC]">{audit.name}</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200">
                <AppIcon name="clipboard" className="h-3.5 w-3.5" />
                {audit.siteArea}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200">
                <AppIcon name="user" className="h-3.5 w-3.5" />
                {audit.owner}
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold text-slate-200">
                <AppIcon name="spark" className="h-3.5 w-3.5" />
                {audit.templateVersion}
              </div>
            </div>
            <p className="mt-3 text-sm font-medium text-slate-200">{getDueWarning(audit.dueHours)}</p>
          </div>
          <StatusBadge status={getAuditTrafficStatus(audit.dueHours)} dark />
        </div>
        <div className="mt-4 rounded-2xl bg-white/10 px-4 py-3">
          <p className="text-xs text-slate-300">Progress</p>
          <div className="mt-2 flex items-center justify-between">
            <div className="h-2 flex-1 rounded-full bg-white/10">
              <div className="h-2 rounded-full bg-white transition-all" style={{ width: `${(answered / audit.questions.length) * 100}%` }} />
            </div>
            <p className="ml-3 text-sm font-semibold">
              {answered}/{audit.questions.length}
            </p>
          </div>
          <p className="mt-2 text-xs text-slate-300">
            {evidenceTotal} evidence item{evidenceTotal === 1 ? "" : "s"} attached
          </p>
          {offlineMode && <p className="mt-2 text-xs font-semibold text-amber-300">Offline mode active. Submission will queue until the device reconnects.</p>}
          {savedAt && <p className="mt-2 text-xs text-slate-300">Last saved {savedAt}</p>}
        </div>
      </section>

      <section className="space-y-3">
        {audit.questions.map((question, index) => {
          const current = responses[question.id];
          const questionEvidence = evidence[question.id] ?? [];
          return (
            <div key={question.id} className="rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Question {index + 1}</p>
                <div className="flex flex-wrap gap-2">
                  <MetaPill icon="note" label={notes[question.id] ? "Notes added" : "No notes"} />
                  <MetaPill icon="camera" label={`${questionEvidence.length} photos`} />
                </div>
              </div>
              <p className="mt-3 text-[15px] font-semibold leading-6 text-slate-900">{question.text}</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <AnswerButton label="Pass" selected={current === "pass"} tone="green" onClick={() => onSelect(question.id, "pass")} />
                <AnswerButton
                  label="No Conformance"
                  selected={current === "nc"}
                  tone="amber"
                  onClick={() => onSelect(question.id, "nc")}
                />
                <AnswerButton label="Fail" selected={current === "fail"} tone="red" onClick={() => onSelect(question.id, "fail")} />
              </div>
              <textarea
                value={notes[question.id] ?? ""}
                onChange={(event) => onNoteChange(question.id, event.target.value)}
                placeholder="Add notes or evidence summary"
                className="mt-3 min-h-[4.75rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              />
              <div className="mt-3 rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Photo evidence</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Capture live photos or choose files from the device.
                    </p>
                  </div>
                  <EvidencePickerButtons compact onFiles={(files) => onAddEvidence(question.id, files)} />
                </div>
                {questionEvidence.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {questionEvidence.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                        <img src={item.previewUrl} alt={item.name} className="h-24 w-full object-cover" />
                        <div className="p-2">
                          <p className="truncate text-xs font-semibold text-slate-900">{item.name}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{item.addedAt}</p>
                          <button
                            onClick={() => onRemoveEvidence(question.id, item.id)}
                            className="mt-2 text-[11px] font-semibold text-rose-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
        <SectionHeader
          icon="check"
          eyebrow="Final approval"
          title="Inspector sign-off"
          subtitle="Add a signature before submitting this audit."
        />
        <div className="mt-4">
          <SignaturePad value={signatureDataUrl} onChange={onSignatureChange} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {signatureDataUrl ? `Signed ${signatureSignedAt}` : "No signature captured yet"}
        </p>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <button onClick={onCancel} className="h-14 rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">
          Cancel
        </button>
        <button onClick={onSaveDraft} className="h-14 rounded-2xl bg-slate-200 text-sm font-semibold text-slate-800">
          Save draft
        </button>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          className={[
            "h-14 rounded-2xl text-sm font-semibold text-white shadow-[0_14px_28px_rgba(15,23,42,0.18)] transition",
            canSubmit ? `bg-slate-900 active:scale-[0.99] ${slatePrimaryCtaInteract}` : "bg-slate-300",
          ].join(" ")}
        >
          Submit
        </button>
      </section>
    </div>
  );
}

function EvidencePickerButtons({
  onFiles,
  compact = false,
}: {
  onFiles: (files: FileList) => void;
  compact?: boolean;
}) {
  const inputClass = compact
    ? "h-10 max-w-[14rem] rounded-xl border border-slate-300 bg-white px-2 text-xs text-slate-700"
    : "h-11 max-w-[18rem] rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-700";

  return (
    <div className="flex flex-wrap gap-2">
      <input
        type="file"
        accept="image/*"
        className={inputClass}
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = value;
    }
  }, [value]);

  const getPosition = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * event.currentTarget.width,
      y: ((event.clientY - rect.top) / rect.height) * event.currentTarget.height,
    };
  };

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    drawingRef.current = true;
    const { x, y } = getPosition(event);
    context.beginPath();
    context.moveTo(x, y);
    context.lineWidth = 2;
    context.strokeStyle = "#0f172a";
    context.lineCap = "round";
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) {
      return;
    }

    const { x, y } = getPosition(event);
    context.lineTo(x, y);
    context.stroke();
    onChange(canvas.toDataURL("image/png"));
  };

  const stopDrawing = () => {
    drawingRef.current = false;
  };

  const clear = () => {
    onChange("");
  };

  return (
    <div className="rounded-[1.4rem] border border-slate-200/80 bg-gradient-to-b from-slate-50 to-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        className="h-36 w-full rounded-2xl bg-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06)]"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
      />
      <div className="mt-3 flex justify-end">
        <button onClick={clear} className="rounded-xl bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">
          Clear signature
        </button>
      </div>
    </div>
  );
}

function AnswerButton({
  label,
  selected,
  tone,
  onClick,
}: CompleteAuditAnswerButtonProps) {
  const selectedClasses =
    tone === "green"
      ? "bg-blue-600 text-white"
      : tone === "amber"
        ? "bg-amber-500 text-white"
        : "bg-rose-600 text-white";

  return (
    <button
      onClick={onClick}
      className={["min-h-[3.5rem] rounded-2xl px-2 text-center text-xs font-semibold leading-tight transition", selected ? selectedClasses : "bg-slate-100 text-slate-700"].join(" ")}
    >
      {label}
    </button>
  );
}
