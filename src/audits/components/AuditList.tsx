import type { AuditListItem } from "../types";
import { AssignedCheckActionRow } from "../../components/checks/AssignedCheckActionRow";
import type { AuditDraft } from "../../types/dashboardScreenProps";
import type { AssignedCheckScheduleMeta } from "../../utils/assignedCheckDisplay";
import type { Role } from "../../permissions";
import { AuditListCard } from "./AuditListCard";
import { AuditTable } from "./AuditTable";

export function AuditList({
  items,
  drafts,
  scheduleMeta = {},
  onOpenAudit,
  themeRole,
  layout = "auto",
}: {
  items: AuditListItem[];
  drafts: Record<string, AuditDraft>;
  scheduleMeta?: Record<string, AssignedCheckScheduleMeta>;
  onOpenAudit: (auditId: string) => void;
  themeRole?: Role;
  layout?: "auto" | "cards" | "table";
}) {
  if (items.length === 0) return null;

  const useTable = layout === "table";
  const useCards = layout === "cards";

  if (useTable) {
    return <AuditTable items={items} onOpenAudit={onOpenAudit} />;
  }

  if (useCards) {
    return (
      <ul className="space-y-3">
        {items.map((item) => (
          <AuditListCard key={item.id} item={item} onOpenAudit={onOpenAudit} />
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="md:hidden">
        <ul className="space-y-3">
          {items.map((item) => (
            <AssignedCheckActionRow
              key={item.id}
              audit={item.audit}
              drafts={drafts}
              scheduleMeta={scheduleMeta[item.id]}
              onOpenAudit={onOpenAudit}
              themeRole={themeRole}
            />
          ))}
        </ul>
      </div>
      <div className="hidden md:block">
        <AuditTable items={items} onOpenAudit={onOpenAudit} />
      </div>
    </>
  );
}

export { AssignedCheckActionRow };
