import { useMemo, useState } from "react";
import { AnimatedButton } from "../animation/AnimatedButton";
import { bertSecondaryButtonInteract } from "../../styles/interactions";
import type { IncidentReassignTarget } from "../../types/incidentsScreenProps";

type IncidentReassignModalProps = {
  open: boolean;
  incidentLabel: string;
  currentAssignee: string;
  targets: IncidentReassignTarget[];
  submitting?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (input: { toEmail: string; toName: string; toRole: string; reason: string }) => void;
};

export function IncidentReassignModal({
  open,
  incidentLabel,
  currentAssignee,
  targets,
  submitting = false,
  error,
  onClose,
  onConfirm,
}: IncidentReassignModalProps) {
  const [selectedEmail, setSelectedEmail] = useState("");
  const [reason, setReason] = useState("");

  const selectedTarget = useMemo(
    () => targets.find((target) => target.email.toLowerCase() === selectedEmail.toLowerCase()) || null,
    [targets, selectedEmail],
  );

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-xl font-semibold text-slate-950">Reassign incident</h3>
        <p className="mt-1 text-sm text-slate-600">
          {incidentLabel} is currently assigned to <strong>{currentAssignee || "Unassigned"}</strong>.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">New handler</span>
            <select
              value={selectedEmail}
              onChange={(event) => setSelectedEmail(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-800"
            >
              <option value="">Select a person…</option>
              {targets.map((target) => (
                <option key={target.email} value={target.email}>
                  {target.name} ({target.role})
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Reason (optional)
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="For example: shift cover or specialist handover"
              className="min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-800"
            />
          </label>

          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
        </div>

        <div className="mt-5 flex gap-2">
          <AnimatedButton
            type="button"
            onClick={onClose}
            disabled={submitting}
            className={`min-h-[44px] flex-1 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 ${bertSecondaryButtonInteract}`}
          >
            Cancel
          </AnimatedButton>
          <AnimatedButton
            type="button"
            disabled={submitting || !selectedTarget}
            onClick={() => {
              if (!selectedTarget) {
                return;
              }
              onConfirm({
                toEmail: selectedTarget.email,
                toName: selectedTarget.name,
                toRole: selectedTarget.role,
                reason: reason.trim(),
              });
            }}
            className="min-h-[44px] flex-1 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Reassigning…" : "Confirm reassignment"}
          </AnimatedButton>
        </div>
      </div>
    </div>
  );
}
