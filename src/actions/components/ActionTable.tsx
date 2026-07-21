import type { ActionListItem } from "../types";
import { Button } from "../../components/ui/Button";
import { ActionPriorityBadge } from "./ActionPriorityBadge";
import { ActionStatusBadge } from "./ActionStatusBadge";
import { DataTable, TableBody, TableCell, TableContainer, TableHeadCell, TableHeader, TableRow } from "../../components/ui/Table";

export function ActionTable({
  items,
  onSelect,
}: {
  items: ActionListItem[];
  onSelect: (actionId: string) => void;
}) {
  return (
    <TableContainer>
      <DataTable>
        <TableHeader>
          <TableRow>
            <TableHeadCell>Action</TableHeadCell>
            <TableHeadCell>Source</TableHeadCell>
            <TableHeadCell>Site / area</TableHeadCell>
            <TableHeadCell>Assignee</TableHeadCell>
            <TableHeadCell>Due</TableHeadCell>
            <TableHeadCell>Priority</TableHeadCell>
            <TableHeadCell>Status</TableHeadCell>
            <TableHeadCell className="text-right">Action</TableHeadCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <p className="font-semibold text-[var(--ui-text-primary)]">{item.title}</p>
                {item.urgency !== "Normal" ? (
                  <p className="text-xs text-[var(--ui-text-muted)]">{item.urgency}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <p>{item.sourceLabel}</p>
                {item.sourceReference ? <p className="text-xs text-[var(--ui-text-muted)]">{item.sourceReference}</p> : null}
              </TableCell>
              <TableCell>{item.area || item.site || "—"}</TableCell>
              <TableCell>{item.assignee || "—"}</TableCell>
              <TableCell>{item.dueLabel || "—"}</TableCell>
              <TableCell>
                <ActionPriorityBadge priority={item.priority} />
              </TableCell>
              <TableCell>
                <ActionStatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-right">
                <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => onSelect(item.id)}>
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
