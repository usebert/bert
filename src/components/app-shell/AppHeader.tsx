import type { ReactNode } from "react";
import { ConnectionStatus } from "./ConnectionStatus";
import { SyncStatusButton } from "./SyncStatusButton";
import { CompanyContextButton, type CompanySwitcherOption } from "./CompanyContextButton";
import { AccountMenu } from "./AccountMenu";
import type { Role } from "../../permissions";
import { IconSearch } from "../ui/Icon";

type Props = {
  pageTitle: string;
  pageSubtitle?: string;
  themeMode: "light" | "dark";
  setupOnlyShell?: boolean;
  onOpenMenu?: () => void;
  showMenuButton?: boolean;
  searchControl?: ReactNode;
  notificationControl?: ReactNode;
  companyName: string;
  platformScope?: boolean;
  showCompanySwitcher: boolean;
  companyOptions: CompanySwitcherOption[];
  selectedCompanyId: string;
  companiesLoading?: boolean;
  companiesError?: string | null;
  onSelectCompany: (companyId: string) => void;
  onRetryCompanies?: () => void;
  offline: boolean;
  reconnecting?: boolean;
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
};

export function AppHeader({
  pageTitle,
  pageSubtitle,
  themeMode,
  setupOnlyShell = false,
  onOpenMenu,
  showMenuButton = false,
  searchControl,
  notificationControl,
  companyName,
  platformScope = false,
  showCompanySwitcher,
  companyOptions,
  selectedCompanyId,
  companiesLoading,
  companiesError,
  onSelectCompany,
  onRetryCompanies,
  offline,
  reconnecting = false,
  syncWaitingCount,
  syncFailedCount,
  syncSyncing = false,
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
}: Props) {
  return (
    <header
      className={[
        "qms-app-header relative z-10 border-b px-3 pb-2 pt-1 backdrop-blur",
        themeMode === "dark" ? "border-white/10 bg-slate-950/58" : "border-slate-200/80 bg-white/72",
      ].join(" ")}
    >
      {debugStrip}
      <div className="qms-app-header-main">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showMenuButton ? (
              <button
                type="button"
                onClick={onOpenMenu}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--ui-border)] md:hidden"
                aria-label="Open navigation menu"
              >
                <span className="text-lg leading-none">☰</span>
              </button>
            ) : null}
            <div className="min-w-0">
              <h1
                className={[
                  "truncate text-base font-semibold tracking-tight sm:text-lg",
                  themeMode === "dark" ? "text-white" : "text-slate-900",
                ].join(" ")}
              >
                {pageTitle}
              </h1>
              {pageSubtitle ? (
                <p className={["mt-0.5 truncate text-[11px] font-medium", themeMode === "dark" ? "text-slate-400" : "text-slate-500"].join(" ")}>
                  {pageSubtitle}
                </p>
              ) : null}
              {siteSelector}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {setupOnlyShell ? (
              <button
                type="button"
                onClick={onSignOut}
                className="inline-flex min-h-11 items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-800"
              >
                Sign out
              </button>
            ) : null}
            {!setupOnlyShell ? (
              <CompanyContextButton
                companyName={companyName}
                platformScope={platformScope}
                showSwitcher={showCompanySwitcher}
                options={companyOptions}
                selectedId={selectedCompanyId}
                loading={companiesLoading}
                error={companiesError}
                onSelect={onSelectCompany}
                onRetry={onRetryCompanies}
              />
            ) : null}
            {!setupOnlyShell ? searchControl : null}
            {!setupOnlyShell ? notificationControl : null}
            <ConnectionStatus offline={offline} reconnecting={reconnecting} />
            {!setupOnlyShell ? (
              <SyncStatusButton
                waitingCount={syncWaitingCount}
                failedCount={syncFailedCount}
                syncing={syncSyncing}
                onOpenSync={onOpenSync}
              />
            ) : null}
            {!setupOnlyShell ? (
              <AccountMenu
                displayName={accountName}
                email={accountEmail}
                role={accountRole}
                companyName={companyName}
                photoUrl={accountPhotoUrl}
                initials={accountInitials}
                showCompanySwitcher={showCompanySwitcher}
                onOpenAccount={onOpenAccount}
                onHelp={onHelp}
                onSignOut={onSignOut}
              />
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export function HeaderSearchButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
      aria-label="Search BERT"
    >
      <IconSearch size="sm" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-current/20 px-1.5 py-0.5 text-[10px] font-medium opacity-70 md:inline">
        ⌘K
      </kbd>
    </button>
  );
}
