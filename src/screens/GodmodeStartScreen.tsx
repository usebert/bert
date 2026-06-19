import { useMemo, useState } from "react";
import type { NavItemId } from "../types/navigation";
import type { CompanyFolder } from "../types/dashboardScreenProps";
import { AnimatedButton } from "../components/animation/AnimatedButton";
import { AnimatedCard } from "../components/animation/AnimatedCard";
import { AnimatedScreen } from "../components/animation/AnimatedScreen";
import { GodmodeCompanyContextSelector } from "../components/godmode/GodmodeCompanyContextSelector";
import { DashboardLandingCard, PageHeader } from "../components/dashboard/RoleDashboardPrimitives";
import { bertLightMuted, bertLightTechnical, bertLightTitle, BERT_LIGHT_SURFACE } from "../styles/bertText";
import { bertSecondaryButtonInteract } from "../styles/interactions";
import { GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE } from "../utils/companyWorkspaceInvite";
import { isGodmodeCompanyPickerReady } from "../services/godmodeService";

export type GodmodeCompanyPickerRow = {
  id: string;
  name: string;
  masterSheetId: string;
  setupStatusLabel: string;
  setupStatus?: "ready" | "incomplete";
};

type LandingCard = {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
};

type QuickLink = {
  label: string;
  screen: NavItemId;
};

const QUICK_LINKS: QuickLink[] = [
  { label: "People", screen: "users" },
  { label: "Areas", screen: "companies" },
  { label: "Forms & Checks", screen: "audits" },
  { label: "Schedules", screen: "schedules" },
  { label: "Quality & Safety", screen: "qmsReadiness" },
  { label: "Reports", screen: "reports" },
];

type View = "landing" | "picker" | "hub";

const GODMODE_NAV_DEBUG_FLAG = "bert:debug-godmode-nav";

function isGodmodeNavDebugEnabled() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(GODMODE_NAV_DEBUG_FLAG) === "1" || (import.meta.env.VITE_DEBUG_GODMODE_NAV ?? "") === "1";
}

type Props = {
  themeMode?: "light" | "dark";
  companies: GodmodeCompanyPickerRow[];
  selectableFolders: CompanyFolder[];
  selectedFolderId: string;
  selectedFolderName: string;
  companyContextReady: boolean;
  onSelectCompany: (folderId: string) => void;
  onClearCompany: () => void;
  onNavigate: (screen: NavItemId) => void;
  onOpenSelectCompany?: () => void;
  onOpenPlatformSetup: () => void;
  onOpenTabletSetup: () => void;
  onOpenDiagnostics: () => void;
  onOpenOnboarding: () => void;
  onCreateCompany: () => void;
  liveCompaniesWarning?: string;
  onRepairLiveCompanies?: () => void;
  onContinueCompanySetup?: (folderId: string) => void;
  onRepairCompany?: (folderId: string) => void;
  currentScreen?: NavItemId;
};

function LandingActionCard({
  card,
  onDark,
  primary = false,
}: {
  card: LandingCard;
  onDark: boolean;
  primary?: boolean;
}) {
  return (
    <article
      className={[
        "flex h-full flex-col rounded-2xl border p-5 shadow-sm transition hover:shadow-md",
        onDark ? "border-white/10 bg-slate-900/60 hover:border-orange-400/30" : "border-slate-200 bg-white hover:border-orange-200",
      ].join(" ")}
    >
      <h3 className={["text-base font-semibold tracking-tight", onDark ? "text-white" : "text-slate-900"].join(" ")}>
        {card.title}
      </h3>
      <p className={["mt-2 flex-1 text-sm leading-relaxed", onDark ? "text-slate-400" : "text-slate-600"].join(" ")}>
        {card.description}
      </p>
      <AnimatedButton
        type="button"
        onClick={card.onAction}
        showArrow={card.actionLabel.includes("→") || card.actionLabel.includes("+")}
        className={[
          "mt-4 h-12 w-full rounded-xl px-4 text-sm font-semibold",
          primary
            ? onDark
              ? "bg-orange-500 text-slate-950 hover:bg-orange-400"
              : "bg-orange-500 text-white hover:bg-orange-600"
            : onDark
              ? `border border-orange-400/50 bg-orange-500/20 text-orange-100 hover:bg-orange-500/30 ${bertSecondaryButtonInteract}`
              : `border border-orange-300 bg-orange-50 text-orange-950 hover:bg-orange-100 ${bertSecondaryButtonInteract}`,
        ].join(" ")}
      >
        {card.actionLabel}
      </AnimatedButton>
    </article>
  );
}

function CompanyPickerRow({
  company,
  onDark,
  onOpen,
  onContinueSetup,
  onRepairSetup,
}: {
  company: GodmodeCompanyPickerRow;
  onDark: boolean;
  onOpen: () => void;
  onContinueSetup?: () => void;
  onRepairSetup?: () => void;
}) {
  const ready = isGodmodeCompanyPickerReady({
    setupStatus: company.setupStatus,
    setupStatusLabel: company.setupStatusLabel,
    masterSheetId: company.masterSheetId,
  });
  const helperCopy = ready
    ? "This company is ready to open."
    : "This company needs setup finishing before it can be used.";

  return (
    <li
      className={[
        "rounded-3xl border p-6 shadow-sm transition",
        onDark
          ? "border-white/15 bg-slate-900/60 hover:border-orange-400/35"
          : `${BERT_LIGHT_SURFACE} hover:border-slate-300`,
      ].join(" ")}
    >
      <div className="flex flex-col gap-4">
        <div className="min-w-0 flex-1">
          <p className={["truncate", bertLightTitle(onDark)].join(" ")}>{company.name}</p>
          <span
            className={[
              "mt-3 inline-flex rounded-full border px-3 py-1 text-xs font-semibold",
              ready ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900",
            ].join(" ")}
          >
            {ready ? "Ready" : "Setup not finished"}
          </span>
          <p className={`mt-3 ${bertLightMuted(onDark)}`}>{helperCopy}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {ready ? (
            <button
              type="button"
              onClick={onOpen}
              className={[
                "inline-flex h-11 min-w-[8rem] items-center justify-center rounded-xl px-4 text-sm font-semibold",
                onDark ? "bg-orange-500 text-slate-950 hover:bg-orange-400" : "bg-orange-500 text-white hover:bg-orange-600",
              ].join(" ")}
            >
              Open company
            </button>
          ) : onContinueSetup ? (
            <>
              <AnimatedButton
                type="button"
                onClick={onContinueSetup}
                className={[
                  "inline-flex h-11 min-w-[8rem] items-center justify-center rounded-xl px-4 text-sm font-semibold",
                  onDark ? "bg-orange-500 text-slate-950 hover:bg-orange-400" : "bg-orange-500 text-white hover:bg-orange-600",
                ].join(" ")}
              >
                Continue setup
              </AnimatedButton>
              {onRepairSetup ? (
                <button
                  type="button"
                  onClick={onRepairSetup}
                  className={[
                    "inline-flex h-11 min-w-[8rem] items-center justify-center rounded-xl border px-4 text-sm font-semibold",
                    onDark
                      ? "border-slate-600 bg-slate-900 text-slate-200 hover:border-slate-500"
                      : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
                  ].join(" ")}
                >
                  Repair setup
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              onClick={onOpen}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
            >
                Open company
            </button>
          )}
        </div>
      </div>
      <details className="mt-3">
        <summary className={`cursor-pointer text-xs font-semibold ${onDark ? "text-slate-400" : "text-slate-600"}`}>
          Technical details
        </summary>
        <p className={`mt-2 ${bertLightTechnical(onDark)}`}>
          Folder ID: {company.id}
          <br />
          Sheet ID: {company.masterSheetId || "Not linked yet"}
        </p>
      </details>
    </li>
  );
}

export function GodmodeStartScreen({
  themeMode = "light",
  companies,
  selectableFolders,
  selectedFolderId,
  selectedFolderName,
  companyContextReady,
  onSelectCompany,
  onClearCompany,
  onNavigate,
  onOpenSelectCompany,
  onOpenPlatformSetup,
  onOpenTabletSetup,
  onOpenDiagnostics,
  onCreateCompany,
  liveCompaniesWarning,
  onRepairLiveCompanies,
  onContinueCompanySetup,
  onRepairCompany,
  currentScreen = "godmodeHome",
}: Props) {
  const onDark = themeMode === "dark";
  const [view, setView] = useState<View>("landing");
  const [search, setSearch] = useState("");

  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return companies;
    }
    return companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companies, search]);

  const openHub = () => setView("hub");
  const selectedCompany = useMemo(() => companies.find((company) => company.id === selectedFolderId), [companies, selectedFolderId]);
  const logNavTrace = (
    eventName: string,
    targetScreen: string,
    context?: { selectedFolderId?: string; masterSheetId?: string; incomplete?: boolean; view?: View },
  ) => {
    if (!isGodmodeNavDebugEnabled()) return;
    const pickedFolderId = context?.selectedFolderId ?? selectedFolderId;
    const pickedMasterSheetId = context?.masterSheetId ?? selectedCompany?.masterSheetId ?? "";
    const incomplete = context?.incomplete ?? !Boolean(pickedMasterSheetId);
    console.debug("[godmode-nav]", {
      eventName,
      currentScreen,
      targetScreen,
      selectedFolderId: pickedFolderId || "",
      masterSheetId: pickedMasterSheetId,
      incomplete,
      internalView: context?.view ?? view,
    });
  };

  const handlePickCompany = (folderId: string) => {
    const company = companies.find((item) => item.id === folderId);
    logNavTrace("pick-company", "godmodeHome.company-hub", {
      selectedFolderId: folderId,
      masterSheetId: company?.masterSheetId || "",
      incomplete: !Boolean(company?.masterSheetId),
      view,
    });
    onSelectCompany(folderId);
    openHub();
  };

  const landingCards: Array<LandingCard & { iconTone: "orange" | "blue" | "grey" | "green" }> = [
    {
      id: "existing",
      title: "Work on existing company",
      description: "Pick a live company workspace before viewing users, checks, actions, or reports.",
      actionLabel: "Select company",
      iconTone: "orange",
      onAction: () => {
        logNavTrace("open-select-company", "godmodeHome.select-company", { view: "landing" });
        onOpenSelectCompany?.();
        setView("picker");
      },
    },
    {
      id: "new",
      title: "Connect company folder",
      description: "Bootstrap a clean company from a Google Drive folder. No registry or old user data required.",
      actionLabel: "Connect folder +",
      iconTone: "blue",
      onAction: () => {
        logNavTrace("create-company", "onboarding", { view: "landing" });
        onCreateCompany();
      },
    },
    {
      id: "platform",
      title: "Platform setup",
      description: "Google, Shared Drive, email, and platform readiness in one place.",
      actionLabel: "Open setup",
      iconTone: "grey",
      onAction: () => {
        logNavTrace("open-platform-setup", "setup", { view: "landing" });
        onOpenPlatformSetup();
      },
    },
    {
      id: "diagnostics",
      title: "Reports / Diagnostics",
      description: "Check platform health and readiness without entering a company workspace.",
      actionLabel: "Open diagnostics",
      iconTone: "green",
      onAction: () => {
        logNavTrace("open-diagnostics", "reports", { view: "landing" });
        onOpenDiagnostics();
      },
    },
  ];

  const pageShell = onDark ? "text-slate-100" : "text-slate-900";
  const muted = onDark ? "text-slate-400" : "text-slate-600";
  const inputClass = onDark
    ? "border-slate-600 bg-slate-950 text-white placeholder:text-slate-500"
    : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400";

  if (view === "hub" && selectedFolderId) {
    return (
      <AnimatedScreen screenKey={`godmode-hub-${selectedFolderId}`}>
      <div className={pageShell}>
        <header className="mb-6">
          <button
            type="button"
            onClick={() => setView("landing")}
            className={["mb-3 text-sm font-semibold", onDark ? "text-orange-300 hover:text-orange-200" : "text-orange-700 hover:text-orange-800"].join(" ")}
          >
            ← Back
          </button>
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">{selectedFolderName || "No company linked"}</h2>
          <p className={`mt-2 max-w-2xl text-sm leading-relaxed ${muted}`}>
            Choose what to do for this company.
          </p>
        </header>

        <GodmodeCompanyContextSelector
          folders={selectableFolders}
          selectedFolderId={selectedFolderId}
          selectedFolderName={selectedFolderName}
          onSelectFolder={(folderId) => {
            if (!folderId) {
              onClearCompany();
              setView("landing");
              return;
            }
            onSelectCompany(folderId);
          }}
          onNewCompany={onCreateCompany}
          themeMode={themeMode}
        />

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.slice(0, 4).map((link) => (
            <button
              key={link.screen + link.label}
              type="button"
              onClick={() => {
                logNavTrace(`quick-link:${link.label}`, link.screen, { view: "hub" });
                onNavigate(link.screen);
              }}
              className={[
                "flex min-h-[3rem] items-center justify-center rounded-xl border px-4 text-sm font-semibold transition",
                onDark
                  ? "border-slate-700 bg-slate-900/80 text-slate-100 hover:border-orange-400/40"
                  : "border-slate-200 bg-white text-slate-800 hover:border-orange-200 hover:bg-orange-50/80",
              ].join(" ")}
            >
              {link.label}
            </button>
          ))}
        </div>

        <details className={["mt-4 rounded-2xl border px-4 py-3", onDark ? "border-white/10 bg-slate-900/40" : "border-slate-200 bg-slate-50"].join(" ")}>
          <summary className="cursor-pointer text-sm font-semibold">More for this company</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {QUICK_LINKS.slice(4).map((link) => (
              <button
                key={link.screen + link.label}
                type="button"
                onClick={() => onNavigate(link.screen)}
                className={[
                  "min-h-[2.75rem] rounded-xl border px-3 text-sm font-semibold",
                  onDark ? "border-slate-700 text-slate-200" : "border-slate-200 bg-white text-slate-700",
                ].join(" ")}
              >
                {link.label}
              </button>
            ))}
            <button
              type="button"
              onClick={onOpenTabletSetup}
              className={[
                "min-h-[2.75rem] rounded-xl border px-3 text-left text-sm font-semibold",
                onDark ? "border-slate-700 text-slate-300" : "border-slate-200 bg-white text-slate-600",
              ].join(" ")}
            >
              Tablet / Kiosk setup
            </button>
          </div>
        </details>
      </div>
      </AnimatedScreen>
    );
  }

  if (view === "picker") {
    return (
      <AnimatedScreen screenKey="godmode-picker">
      <div className={pageShell}>
        <header className="mb-5">
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setView("landing");
            }}
            className={["mb-3 text-sm font-semibold", onDark ? "text-orange-300 hover:text-orange-200" : "text-orange-700 hover:text-orange-800"].join(" ")}
          >
            ← Back
          </button>
          <h2 className="text-2xl font-semibold tracking-tight">Select company</h2>
          <p className={`mt-2 text-sm ${muted}`}>Search by name and choose whether to open the company or continue setup.</p>
        </header>

        <label className="block">
          <span className="sr-only">Search companies</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by company name…"
            className={`h-12 w-full rounded-xl border px-4 text-sm outline-none focus:ring-2 focus:ring-orange-200 ${inputClass}`}
          />
        </label>

        {companies.length === 0 ? (
          <div className={`mt-6 rounded-2xl border px-4 py-6 text-sm ${onDark ? "border-white/10 bg-slate-900/50 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
            <p>{liveCompaniesWarning || "No company workspaces yet."}</p>
            <button
              type="button"
              onClick={onCreateCompany}
              className={[
                "mt-4 inline-flex h-11 items-center rounded-xl px-5 text-sm font-semibold",
                onDark ? "bg-orange-500 text-slate-950" : "bg-orange-500 text-white hover:bg-orange-600",
              ].join(" ")}
            >
              Create company
            </button>
            {liveCompaniesWarning && onRepairLiveCompanies ? (
              <button
                type="button"
                onClick={onRepairLiveCompanies}
                className={[
                  "mt-2 block text-sm font-semibold underline-offset-2 hover:underline",
                  onDark ? "text-amber-200" : "text-amber-800",
                ].join(" ")}
              >
                Open platform setup
              </button>
            ) : null}
          </div>
        ) : filteredCompanies.length === 0 ? (
          <p className={`mt-6 text-sm ${muted}`}>No companies match your search.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {filteredCompanies.map((company) => (
              <CompanyPickerRow
                key={company.id}
                company={company}
                onDark={onDark}
                onOpen={() => handlePickCompany(company.id)}
                onContinueSetup={
                  company.setupStatusLabel !== "Ready" && onContinueCompanySetup
                    ? () => onContinueCompanySetup(company.id)
                    : undefined
                }
                onRepairSetup={
                  company.setupStatusLabel !== "Ready" && onRepairCompany
                    ? () => onRepairCompany(company.id)
                    : undefined
                }
              />
            ))}
          </ul>
        )}
      </div>
      </AnimatedScreen>
    );
  }

  if (onDark) {
    return (
      <AnimatedScreen screenKey="godmode-landing">
      <div className={pageShell}>
        <p className={`max-w-2xl text-sm leading-relaxed md:text-base ${muted}`}>
          Manage the platform, onboard companies, or open a company workspace.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {landingCards.map((card, index) => (
            <AnimatedCard key={card.id} index={index}>
              <LandingActionCard card={card} onDark={onDark} primary={index === 0} />
            </AnimatedCard>
          ))}
        </div>
        {!companyContextReady && selectedFolderId ? (
          <p className={`mt-4 text-sm text-amber-200`}>{GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE}</p>
        ) : null}
      </div>
      </AnimatedScreen>
    );
  }

  return (
    <AnimatedScreen screenKey="godmode-landing-light">
    <div className="space-y-6">
      <PageHeader
        role="Master"
        eyebrow="Platform control"
        title="Godmode"
        subtitle="Choose what you want to do. No company is loaded until you select one."
        primaryAction={{
          label: "Select company",
          icon: "search",
          onClick: () => {
            logNavTrace("open-select-company", "godmodeHome.select-company", { view: "landing" });
            onOpenSelectCompany?.();
            setView("picker");
          },
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {landingCards.map((card, index) => (
          <AnimatedCard key={card.id} index={index}>
            <DashboardLandingCard
              role="Master"
              title={card.title}
              description={card.description}
              actionLabel={card.actionLabel}
              onAction={card.onAction}
              primary={index === 0}
              iconTone={card.iconTone}
            />
          </AnimatedCard>
        ))}
      </div>
      {!companyContextReady && selectedFolderId ? (
        <p className="text-sm font-semibold text-amber-800">{GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE}</p>
      ) : null}
    </div>
    </AnimatedScreen>
  );
}
