import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../../styles/ui-foundation";

export function TableContainer({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("w-full overflow-x-auto rounded-[var(--ui-radius-md)] border border-[var(--ui-border)]", className)} {...rest}>
      {children}
    </div>
  );
}

export function DataTable({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table className={cn("min-w-full border-collapse text-left text-sm", className)} {...rest}>
      {children}
    </table>
  );
}

export function TableHeader({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn("sticky top-0 z-[1] bg-[var(--ui-bg-muted)]", className)} {...rest}>
      {children}
    </thead>
  );
}

export function TableBody({ className, children, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-[var(--ui-border)] bg-[var(--ui-bg-surface)]", className)} {...rest}>{children}</tbody>;
}

export function TableRow({ className, children, interactive, ...rest }: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        interactive && "transition-colors hover:bg-[var(--ui-bg-muted)] focus-within:bg-[var(--ui-bg-muted)]",
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  );
}

export function TableHeadCell({ className, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn("px-3 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--ui-text-secondary)]", className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TableCell({ className, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-3 py-3 align-middle text-[var(--ui-text-primary)]", className)} {...rest}>
      {children}
    </td>
  );
}

export function TableActionCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <TableCell className={cn("min-w-[8rem] whitespace-nowrap", className)}>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </TableCell>
  );
}

/** Hook for responsive list/card fallback — consumers can render cards below breakpoint. */
export function ListFallback({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-2 md:hidden", className)}>{children}</div>;
}
