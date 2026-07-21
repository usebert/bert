import type { ActionItem } from "../../types/reportsScreenProps";
import { EvidenceUploadChoice } from "../../components/evidence/EvidenceUploadChoice";
import { slatePrimaryCtaInteract } from "../../styles/interactions";

export function ActionEvidencePanel({
  action,
  onAddEvidence,
  triggerLabel = "Upload evidence",
  primary = false,
  syncQueued = false,
}: {
  action: ActionItem;
  onAddEvidence: (files: FileList) => void;
  triggerLabel?: string;
  primary?: boolean;
  syncQueued?: boolean;
}) {
  const className = primary
    ? `min-h-[48px] rounded-2xl bg-[var(--bert-signal-orange)] px-5 text-sm font-semibold text-[var(--qms-navy-950)] shadow-sm focus-visible:outline focus-visible:ring-2 focus-visible:ring-orange-300 ${slatePrimaryCtaInteract}`
    : "min-h-[48px] w-full max-w-xs rounded-2xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:ring-2 focus-visible:ring-slate-300";

  return (
    <section aria-label="Evidence" className="space-y-2">
      <p className="text-sm font-semibold text-[var(--ui-text-primary)]">Evidence</p>
      <p className="text-sm text-[var(--ui-text-secondary)]">
        {action.evidenceRequired
          ? action.evidenceCount === 0
            ? "Photo evidence is required before this can be verified."
            : `${action.evidenceCount} file${action.evidenceCount === 1 ? "" : "s"} attached.`
          : action.evidenceCount > 0
            ? `${action.evidenceCount} file${action.evidenceCount === 1 ? "" : "s"} attached.`
            : "Evidence is optional for this action."}
      </p>
      {syncQueued ? (
        <p className="text-xs font-medium text-amber-800">Awaiting sync — your evidence is saved on this device.</p>
      ) : null}
      <EvidenceUploadChoice triggerLabel={triggerLabel} triggerClassName={className} onFiles={onAddEvidence} />
    </section>
  );
}
