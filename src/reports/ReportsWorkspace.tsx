import type { ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";

const TAB_LABELS = {
  overview: "Overview",
  audits: "Audits",
  actions: "Actions",
  safety: "Safety",
  ncrs: "NCRs",
  equipment: "Equipment",
} as const;

/** Reports module — Release 6 workspace shell. */
export function ReportsWorkspace({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Reports"
        title="Compliance reports & exports"
        description="Operational summaries, KPIs, and export packs using live workbook data."
        secondaryActions={
          <div className="flex flex-wrap gap-2">
            {Object.entries(TAB_LABELS).map(([key, label]) => (
              <Button key={key} type="button" variant="secondary" className="min-h-[2.75rem]">
                {label}
              </Button>
            ))}
          </div>
        }
      />
      <Section>{children}</Section>
    </PageContainer>
  );
}
