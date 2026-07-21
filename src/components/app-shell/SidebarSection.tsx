import type { ReactNode } from "react";

type Props = {
  label: string;
  collapsed: boolean;
  children: ReactNode;
};

export function SidebarSection({ label, collapsed, children }: Props) {
  return (
    <div className="space-y-0.5">
      {!collapsed && label !== "Home" ? (
        <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      ) : null}
      {children}
    </div>
  );
}
