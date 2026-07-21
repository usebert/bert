import type { ReactNode } from "react";

type Props = {
  label: string;
  selected: boolean;
  collapsed: boolean;
  title: string;
  onClick: () => void;
  icon: ReactNode;
};

export function SidebarItem({ label, selected, collapsed, title, onClick, icon }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={[
        "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold bert-nav-item transition motion-reduce:transition-none",
        selected ? "bg-[var(--bert-signal-orange)] text-[var(--qms-navy-950)]" : "text-slate-200 hover:bg-white/8 hover:text-white",
        collapsed ? "justify-center px-2" : "",
      ].join(" ")}
      title={title}
    >
      <span className="shrink-0 opacity-95">{icon}</span>
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </button>
  );
}
