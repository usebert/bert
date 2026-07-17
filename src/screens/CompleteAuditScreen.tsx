import { useEffect, useRef, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedButton } from "../components/animation/AnimatedButton";
import { AnimatedScreen } from "../components/animation/AnimatedScreen";
import { MetaPill, SectionHeader, StatusBadge } from "../components/dashboard/DashboardPrimitives";
import { bertSecondaryButtonInteract } from "../styles/interactions";
import { darkPanelEyebrow, darkPanelShell } from "../styles/darkPanel";
import { getAuditTrafficStatus, getDueWarning } from "../utils/dashboardHealth";
import type { CompleteAuditAnswerButtonProps, CompleteAuditScreenProps } from "../types/completeAuditScreenProps";
import { EvidenceUploadChoice } from "../components/evidence/EvidenceUploadChoice";

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
  const { t } = useTranslation();
  const answered = audit.questions.filter((question) => responses[question.id]).length;
  const evidenceTotal = audit.questions.reduce((total, question) => total + (evidence[question.id]?.length ?? 0), 0);

  return (
    <AnimatedScreen screenKey={`complete-audit-${audit.id}`}>
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
          <p className="text-xs text-slate-300">{t("audits.progress")}</p>
          <div className="mt-2 flex items-center justify-between">
            <div className="h-2 flex-1 rounded-full bg-white/10">
              <div className="h-2 rounded-full bg-white transition-all" style={{ width: `${(answered / audit.questions.length) * 100}%` }} />
            </div>
            <p className="ml-3 text-sm font-semibold">
              {answered}/{audit.questions.length}
            </p>
          </div>
          <p className="mt-2 text-xs text-slate-300">
            {t("audits.evidenceItemsAttached", { count: evidenceTotal })}
          </p>
          {offlineMode && <p className="mt-2 text-xs font-semibold text-amber-300">{t("audits.offlineModeActive")}</p>}
          {savedAt && <p className="mt-2 text-xs text-slate-300">{t("audits.lastSaved", { time: savedAt })}</p>}
        </div>
      </section>

      <section className="space-y-3">
        {audit.questions.map((question, index) => {
          const current = responses[question.id];
          const questionEvidence = evidence[question.id] ?? [];
          return (
            <div key={question.id} className="rounded-[1.6rem] border border-slate-200/80 bg-gradient-to-b from-white to-slate-50 p-4 shadow-[0_16px_30px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{t("audits.question", { number: index + 1 })}</p>
                <div className="flex flex-wrap gap-2">
                  <MetaPill icon="note" label={notes[question.id] ? t("audits.notesAdded") : t("audits.noNotes")} />
                  <MetaPill icon="camera" label={t("audits.photosCount", { count: questionEvidence.length })} />
                </div>
              </div>
              <p className="mt-3 text-[15px] font-semibold leading-6 text-slate-900">{question.text}</p>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <AnswerButton label={t("audits.pass")} selected={current === "pass"} tone="green" onClick={() => onSelect(question.id, "pass")} />
                <AnswerButton
                  label={t("audits.noConformance")}
                  selected={current === "nc"}
                  tone="amber"
                  onClick={() => onSelect(question.id, "nc")}
                />
                <AnswerButton label={t("audits.fail")} selected={current === "fail"} tone="red" onClick={() => onSelect(question.id, "fail")} />
              </div>
              <textarea
                value={notes[question.id] ?? ""}
                onChange={(event) => onNoteChange(question.id, event.target.value)}
                placeholder={t("audits.notesPlaceholder")}
                className="mt-3 min-h-[4.75rem] w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
              />
              <div className="mt-3 rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t("audits.evidence")}</p>
                    <p className="mt-1 text-xs text-slate-500">{t("audits.evidenceCaptureHint")}</p>
                  </div>
                  <EvidenceUploadChoice
                    triggerLabel={t("audits.uploadEvidence")}
                    triggerClassName="min-h-[48px] rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
                    onFiles={(files) => onAddEvidence(question.id, files)}
                  />
                </div>
                {questionEvidence.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {questionEvidence.map((item) => (
                      <div key={item.id} className="overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
                        {/\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(item.name) ? (
                          <img src={item.previewUrl} alt={item.name} className="h-24 w-full object-cover" />
                        ) : (
                          <div className="flex h-24 items-center justify-center bg-slate-100 px-3">
                            <p className="truncate text-xs font-semibold text-slate-600">{item.name}</p>
                          </div>
                        )}
                        <div className="p-2">
                          <p className="truncate text-xs font-semibold text-slate-900">{item.name}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{item.addedAt}</p>
                          <button
                            onClick={() => onRemoveEvidence(question.id, item.id)}
                            className="mt-2 text-[11px] font-semibold text-rose-600"
                          >
                            {t("common.remove")}
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
          eyebrow={t("audits.finalApproval")}
          title={t("audits.inspectorSignOff")}
          subtitle={t("audits.inspectorSignOffSubtitle")}
        />
        <div className="mt-4">
          <SignaturePad value={signatureDataUrl} onChange={onSignatureChange} clearLabel={t("audits.clearSignature")} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {signatureDataUrl ? t("audits.signedAt", { time: signatureSignedAt }) : t("audits.noSignatureYet")}
        </p>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <AnimatedButton
          type="button"
          onClick={onCancel}
          className={`h-14 rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700 ${bertSecondaryButtonInteract}`}
        >
          {t("common.cancel")}
        </AnimatedButton>
        <AnimatedButton
          type="button"
          onClick={onSaveDraft}
          className={`h-14 rounded-2xl bg-slate-200 text-sm font-semibold text-slate-800 ${bertSecondaryButtonInteract}`}
        >
          {t("common.save")}
        </AnimatedButton>
        <AnimatedButton
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className={[
            "h-14 rounded-2xl text-sm font-semibold text-white shadow-[0_14px_28px_rgba(15,23,42,0.18)]",
            canSubmit ? `bg-slate-900 ${slatePrimaryCtaInteract}` : "bg-slate-300",
          ].join(" ")}
        >
          {t("common.submit")}
        </AnimatedButton>
      </section>
    </div>
    </AnimatedScreen>
  );
}

function SignaturePad({ value, onChange, clearLabel }: { value: string; onChange: (dataUrl: string) => void; clearLabel: string }) {
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
          {clearLabel}
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
