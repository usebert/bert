import type { ReactNode } from "react";
import { AppBrand } from "./AppBrand";
import { SidebarItem } from "./SidebarItem";
import { SidebarSection } from "./SidebarSection";
import type { NavPresentationGroup } from "../../config/navPresentation";
import type { PresentedNavItem } from "../../config/roleNavigation";

type Props = {
  collapsed: boolean;
  groups: Array<NavPresentationGroup & { items: PresentedNavItem[] }>;
  moreItems: PresentedNavItem[];
  screen: string;
  isAuditCentreNavActive: boolean;
  labelForItem: (item: PresentedNavItem) => string;
  renderIcon: (name: string) => ReactNode;
  moreExpanded: boolean;
  onToggleMore: () => void;
  onNavigate: (screen: string) => void;
  footer: ReactNode;
  logoVariant?: "mark" | "wordmark";
};

export function AppSidebar({
  collapsed,
  groups,
  moreItems,
  screen,
  isAuditCentreNavActive,
  labelForItem,
  renderIcon,
  moreExpanded,
  onToggleMore,
  onNavigate,
  footer,
  logoVariant = "wordmark",
}: Props) {
  return (
    <aside
      className={[
        "hidden min-h-0 flex-col border-r border-white/10 bg-gradient-to-b from-[#071525] via-[#0c1f36] to-[#050b14] text-slate-100 md:flex",
        collapsed ? "w-[4.75rem]" : "w-[15.5rem]",
      ].join(" ")}
    >
      <div className={`shrink-0 ${collapsed ? "px-2 py-3" : "px-3 py-4"}`}>
        <AppBrand collapsed={collapsed} variant={logoVariant} />
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2" aria-label="Primary">
        {groups.map((group) => (
          <SidebarSection key={`nav-group-${group.id}`} label={group.label} collapsed={collapsed}>
            {group.items.map((item) => (
              <SidebarItem
                key={`sidebar-${item.id}`}
                label={labelForItem(item)}
                title={labelForItem(item)}
                collapsed={collapsed}
                selected={screen === item.id || (isAuditCentreNavActive && item.id === "auditCentre")}
                icon={renderIcon(item.icon)}
                onClick={() => onNavigate(item.id)}
              />
            ))}
          </SidebarSection>
        ))}
        {moreItems.length > 0 ? (
          <div className="mt-1 border-t border-white/10 pt-2">
            <button
              type="button"
              onClick={onToggleMore}
              className={[
                "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold bert-nav-item transition motion-reduce:transition-none",
                moreExpanded || moreItems.some((item) => item.id === screen)
                  ? "border border-orange-400/40 bg-orange-500/15 text-orange-100"
                  : "text-slate-300 hover:bg-white/8 hover:text-white",
                collapsed ? "justify-center px-2" : "",
              ].join(" ")}
              aria-expanded={moreExpanded}
            >
              {renderIcon("grid")}
              {!collapsed ? <span>More</span> : null}
            </button>
            {moreExpanded ? (
              <div className="mt-1 space-y-1 pl-1">
                {moreItems.map((item) => (
                  <SidebarItem
                    key={`sidebar-more-${item.id}`}
                    label={labelForItem(item)}
                    title={labelForItem(item)}
                    collapsed={false}
                    selected={screen === item.id}
                    icon={renderIcon(item.icon)}
                    onClick={() => onNavigate(item.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </nav>
      <div className="mt-auto shrink-0 space-y-2 border-t border-white/10 px-2 py-3">{footer}</div>
    </aside>
  );
}
