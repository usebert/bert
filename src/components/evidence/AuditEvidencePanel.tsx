import type { AuditResultDetail } from "../../types/resultsScreenProps";
import {
  auditEvidenceRefsToViewableLinks,
  buildQuestionLabelMap,
  parseAuditEvidenceRefs,
} from "../../utils/driveEvidenceLinks";
import { ViewEvidenceLinks } from "./ViewEvidenceLinks";

export function AuditEvidencePanel({ result }: { result: AuditResultDetail }) {
  const refs = parseAuditEvidenceRefs(result.evidenceRefs);
  const questionLabels = buildQuestionLabelMap(result.findings);
  const viewableLinks = auditEvidenceRefsToViewableLinks(refs, questionLabels);

  if (viewableLinks.length === 0) {
    return (
      <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Evidence</p>
        <p className="mt-3 text-sm text-slate-600">
          {refs.length > 0
            ? "Evidence was recorded for this check, but no Google Drive links are available yet."
            : "No photo evidence was attached to this check."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[1.25rem] border border-slate-200/80 bg-white p-4 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Evidence</p>
      <div className="mt-3">
        <ViewEvidenceLinks items={viewableLinks} />
      </div>
    </div>
  );
}
