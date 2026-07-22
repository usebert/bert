import type { RiskAssessmentRecord, RiskHazardRecord, RiskLinkRecord, RiskReviewRecord } from "../types/riskAssessment";
import { getClientRiskBand } from "../services/riskAssessmentService";
import { Button } from "../components/ui/Button";
import { PageContainer, Section } from "../components/ui/PageLayout";

type Props = {
  assessment: RiskAssessmentRecord;
  hazards: RiskHazardRecord[];
  links: RiskLinkRecord[];
  reviews: RiskReviewRecord[];
  onClose: () => void;
};

export function RiskAssessmentPrintView({ assessment, hazards, links, reviews, onClose }: Props) {
  return (
    <PageContainer>
      <div className="mb-4 flex justify-between gap-3 print:hidden">
        <Button type="button" variant="secondary" onClick={onClose}>
          Close print view
        </Button>
        <Button type="button" onClick={() => window.print()}>
          Print
        </Button>
      </div>
      <article className="rounded-2xl border bg-white p-6 shadow-sm">
        <header className="border-b pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Risk Assessment</p>
          <h1 className="text-2xl font-black text-slate-900">{assessment.title}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {assessment.assessmentNumber} · Version {assessment.version} · {assessment.status}
          </p>
        </header>
        <Section title="Assessment details">
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div><dt className="text-slate-500">Type</dt><dd>{assessment.assessmentType}</dd></div>
            <div><dt className="text-slate-500">Activity</dt><dd>{assessment.activity || "—"}</dd></div>
            <div><dt className="text-slate-500">Owner</dt><dd>{assessment.ownerName || "—"}</dd></div>
            <div><dt className="text-slate-500">Assessor</dt><dd>{assessment.assessorName || "—"}</dd></div>
            <div><dt className="text-slate-500">Review date</dt><dd>{assessment.reviewDate || "—"}</dd></div>
            <div><dt className="text-slate-500">Highest residual risk</dt><dd>{getClientRiskBand(assessment.highestResidualRiskScore).label}</dd></div>
          </dl>
          <p className="mt-3 text-sm text-slate-700">{assessment.description}</p>
        </Section>
        <Section title="People at risk">
          <p className="text-sm text-slate-700">{assessment.peopleAtRisk || "—"}</p>
        </Section>
        <Section title="Hazards and controls">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Hazard</th>
                <th className="py-2">Initial</th>
                <th className="py-2">Residual</th>
                <th className="py-2">Controls</th>
              </tr>
            </thead>
            <tbody>
              {hazards.map((hazard) => (
                <tr key={hazard.id} className="border-b align-top">
                  <td className="py-2">{hazard.hazardTitle || hazard.hazardType}</td>
                  <td className="py-2">{hazard.initialRiskScore} ({getClientRiskBand(hazard.initialRiskScore).label})</td>
                  <td className="py-2">{hazard.residualRiskScore} ({getClientRiskBand(hazard.residualRiskScore).label})</td>
                  <td className="py-2">{hazard.additionalControls || hazard.existingControls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section title="Linked records">
          {links.length === 0 ? (
            <p className="text-sm text-slate-500">None</p>
          ) : (
            <ul className="text-sm">
              {links.map((link) => (
                <li key={link.id}>{link.linkedRecordType}: {link.linkedRecordTitle || link.linkedRecordId}</li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Approval">
          <p className="text-sm text-slate-700">
            Approved by {assessment.approvedBy || "—"} on {assessment.approvedAt || "—"}
          </p>
        </Section>
        <footer className="mt-6 border-t pt-4 text-xs text-slate-500">
          This printable view reflects records held in BERT and does not replace competent Health & Safety review.
        </footer>
      </article>
    </PageContainer>
  );
}
