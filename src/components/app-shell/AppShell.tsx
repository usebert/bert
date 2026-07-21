import type { ReactNode } from "react";
import { AppBrand } from "./AppBrand";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";
import { SidebarItem } from "./SidebarItem";
import type { NavPresentationGroup } from "../../config/navPresentation";
import type { PresentedNavItem } from "../../config/roleNavigation";
import type { CompanySwitcherOption } from "./CompanyContextButton";
import type { Role } from "../../permissions";

type Props = {
  themeMode: "light" | "dark";
  pageTitle: string;
  pageSubtitle?: string;
  screen: string;
  setupOnlyShell?: boolean;
  mobileNavOpen: boolean;
  onCloseMobileNav: () => void;
  onOpenMobileNav: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebarCollapsed: () => void;
  groupedNav: Array<NavPresentationGroup & { items: PresentedNavItem[] }>;
  moreNavItems: PresentedNavItem[];
  isAuditCentreNavActive: boolean;
  labelForItem: (item: PresentedNavItem) => string;
  renderNavIcon: (name: string) => ReactNode;
  moreExpanded: boolean;
  onToggleMore: () => void;
  onNavigate: (screen: string) => void;
  sidebarFooter: ReactNode;
  searchControl?: ReactNode;
  notificationControl?: ReactNode;
  companyName: string;
  platformScope?: boolean;
  showCompanySwitcher: boolean;
  companyOptions: CompanySwitcherOption[];
  selectedCompanyId: string;
  onSelectCompany: (companyId: string) => void;
  offline: boolean;
  syncWaitingCount: number;
  syncFailedCount: number;
  syncSyncing?: boolean;
  onOpenSync: () => void;
  accountName: string;
  accountEmail?: string;
  accountRole: Role;
  accountPhotoUrl?: string;
  accountInitials: string;
  onOpenAccount?: () => void;
  onHelp?: () => void;
  onSignOut: () => void;
  siteSelector?: ReactNode;
  debugStrip?: ReactNode;
  mobileBottomNav?: ReactNode;
  logoVariant?: "mark" | "wordmark";
  children: ReactNode;
  contentClassName?: string;
};

export function AppShell({
  themeMode,
  pageTitle,
  pageSubtitle,
  screen,
  setupOnlyShell = false,
  mobileNavOpen,
  onCloseMobileNav,
  onOpenMobileNav,
  sidebarCollapsed,
  groupedNav,
  moreNavItems,
  isAuditCentreNavActive,
  labelForItem,
  renderNavIcon,
  moreExpanded,
  onToggleMore,
  onNavigate,
  sidebarFooter,
  searchControl,
  notificationControl,
  companyName,
  platformScope,
  showCompanySwitcher,
  companyOptions,
  selectedCompanyId,
  onSelectCompany,
  offline,
  syncWaitingCount,
  syncFailedCount,
  syncSyncing,
  onOpenSync,
  accountName,
  accountEmail,
  accountRole,
  accountPhotoUrl,
  accountInitials,
  onOpenAccount,
  onHelp,
  onSignOut,
  siteSelector,
  debugStrip,
  mobileBottomNav,
  logoVariant,
  children,
  contentClassName = "",
}: Props) {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900"
      >
        Skip to main content
      </a>
      <AppHeader
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        themeMode={themeMode}
        setupOnlyShell={setupOnlyShell}
        showMenuButton
        onOpenMenu={() => (mobileNavOpen ? onCloseMobileNav() : onOpenMobileNav())}
        searchControl={searchControl}
        notificationControl={notificationControl}
        companyName={companyName}
        platformScope={platformScope}
        showCompanySwitcher={showCompanySwitcher}
        companyOptions={companyOptions}
        selectedCompanyId={selectedCompanyId}
        onSelectCompany={onSelectCompany}
        offline={offline}
        syncWaitingCount={syncWaitingCount}
        syncFailedCount={syncFailedCount}
        syncSyncing={syncSyncing}
        onOpenSync={onOpenSync}
        accountName={accountName}
        accountEmail={accountEmail}
        accountRole={accountRole}
        accountPhotoUrl={accountPhotoUrl}
        accountInitials={accountInitials}
        onOpenAccount={onOpenAccount}
        onHelp={onHelp}
        onSignOut={onSignOut}
        siteSelector={siteSelector}
        debugStrip={debugStrip}
      />
      <main className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {mobileNavOpen ? (
          <div className="fixed inset-0 z-50 flex md:hidden" role="presentation">
            <button type="button" className="absolute inset-0 bg-slate-950/45" aria-label="Close navigation menu" onClick={onCloseMobileNav} />
            <div className="relative flex h-[100dvh] w-[min(18rem,88vw)] flex-col bg-gradient-to-b from-[#071525] via-[#0c1f36] to-[#050b14] text-slate-100 shadow-2xl">
              <div className="flex items-center justify-between px-3 py-3">
                <AppBrand collapsed={false} variant={logoVariant} />
                <button type="button" onClick={onCloseMobileNav} className="min-h-11 min-w-11 rounded-full border border-white/15" aria-label="Close navigation menu">
                  ×
                </button>
              </div>
              <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Mobile primary">
                {groupedNav.flatMap((group) =>
                  group.items.map((item) => (
                    <SidebarItem
                      key={`mobile-${item.id}`}
                      label={labelForItem(item)}
                      title={labelForItem(item)}
                      collapsed={false}
                      selected={screen === item.id}
                      icon={renderNavIcon(item.icon)}
                      onClick={() => {
                        onNavigate(item.id);
                        onCloseMobileNav();
                      }}
                    />
                  )),
                )}
              </nav>
              <div className="shrink-0 border-t border-white/10 px-2 py-3">
                <button
                  type="button"
                  data-testid="shell-sign-out-fallback"
                  onClick={onSignOut}
                  className="flex min-h-11 w-full items-center justify-center rounded-xl border border-rose-300/35 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <AppSidebar
          collapsed={sidebarCollapsed}
          groups={groupedNav}
          moreItems={moreNavItems}
          screen={screen}
          isAuditCentreNavActive={isAuditCentreNavActive}
          labelForItem={labelForItem}
          renderIcon={renderNavIcon}
          moreExpanded={moreExpanded}
          onToggleMore={onToggleMore}
          onNavigate={onNavigate}
          footer={sidebarFooter}
          logoVariant={logoVariant}
        />
        <div id="main-content" className={["qms-screen-stage h-full min-w-0 flex-1 overflow-y-auto px-4 pb-24 pt-4 md:pb-10", contentClassName].join(" ")}>
          {children}
        </div>
      </main>
      {mobileBottomNav}
    </>
  );
}