import type { ReactNode } from "react";
import { Button } from "../components/ui/Button";
import { PageContainer, PageHeader, Section } from "../components/ui/PageLayout";

const TAB_LABELS = {
  register: "Register",
  due: "Due",
  overdue: "Overdue",
  inspections: "Inspections",
  archived: "Archived",
} as const;

/** Equipment / LOLER module — Release 6 workspace shell. */
export function EquipmentWorkspace({ children }: { children: ReactNode }) {
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Equipment"
        title="LOLER register & inspections"
        description="Equipment register, examination schedules, certificates, and defect tracking."
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
