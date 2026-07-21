import type { AuditListItem } from "../types";
import { Button } from "../../components/ui/Button";
import { AuditStatusBadge } from "./AuditStatusBadge";
import { DataTable, TableBody, TableCell, TableContainer, TableHeadCell, TableHeader, TableRow } from "../../components/ui/Table";

export function AuditTable({ items, onOpenAudit }: { items: AuditListItem[]; onOpenAudit: (auditId: string) => void }) {
  return (
    <TableContainer>
      <DataTable>
        <TableHeader>
          <TableRow>
            <TableHeadCell>Audit</TableHeadCell>
            <TableHeadCell>Site / area</TableHeadCell>
            <TableHeadCell>Assignee</TableHeadCell>
            <TableHeadCell>Due</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell className="text-right">Action</TableHeadCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <p className="font-semibold text-[var(--ui-text-primary)]">{item.name}</p>
                {item.scheduleName ? <p className="text-xs text-[var(--ui-text-muted)]">{item.scheduleName}</p> : null}
              </TableCell>
              <TableCell>{item.area || "—"}</TableCell>
              <TableCell>{item.assignee || "—"}</TableCell>
              <TableCell>{item.dueLabel || "—"}</TableCell>
              <TableCell>
                <AuditStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => onOpenAudit(item.id)}>
                  {item.actionLabel}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </TableContainer>
  );
}
