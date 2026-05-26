import { useMemo, useState } from "react";
import type { NavItemId } from "../types/navigation";
import type { CompanyFolder } from "../types/dashboardScreenProps";
import { GodmodeCompanyContextSelector } from "../components/godmode/GodmodeCompanyContextSelector";
import { GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE } from "../utils/companyWorkspaceInvite";

export type GodmodeCompanyPickerRow = {
  id: string;
  name: string;
  masterSheetId: string;
  setupStatusLabel: string;
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
  requiresCompany?: boolean;
};

const QUICK_LINKS: QuickLink[] = [
  { label: "Users & Invites", screen: "users", requiresCompany: true },
  { label: "Areas", screen: "companies", requiresCompany: true },
  { label: "Templates", screen: "schedules", requiresCompany: true },
  { label: "Schedules", screen: "schedules", requiresCompany: true },
  { label: "Quality & Safety", screen: "qmsReadiness", requiresCompany: true },
  { label: "Reports", screen: "reports", requiresCompany: true },
  { label: "Repair workspace", screen: "companies", requiresCompany: true },
  { label: "Reset workspace", screen: "companies", requiresCompany: true },
];

type View = "landing" | "picker" | "hub";

type Props = {
  themeMode?: "light" | "dark";
  companies: GodmodeCompanyPickerRow[];
  selectableFolders: CompanyFolder[];
  rememberedFolderId: string;
  rememberedFolderName: string;
  selectedFolderId: string;
  selectedFolderName: string;
  companyContextReady: boolean;
  onSelectCompany: (folderId: string) => void;
  onClearCompany: () => void;
  onNavigate: (screen: NavItemId) => void;
  onOpenPlatformSetup: () => void;
  onOpenTabletSetup: () => void;
  onOpenDiagnostics: () => void;
  onOpenOnboarding: () => void;
  onNewCompany: () => void;
};

function LandingActionCard({
  card,
  onDark,
}: {
  card: LandingCard;
  onDark: boolean;
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
      <button
        type="button"
        onClick={card.onAction}
        className={[
          "mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl border px-4 text-sm font-semibold transition",
          onDark
            ? "border-orange-400/50 bg-orange-500/20 text-orange-100 hover:bg-orange-500/30"
            : "border-orange-300 bg-orange-50 text-orange-950 hover:bg-orange-100",
        ].join(" ")}
      >
        {card.actionLabel}
      </button>
    </article>
  );
}

export function GodmodeStartScreen({
  themeMode = "light",
  companies,
  selectableFolders,
  rememberedFolderId,
  rememberedFolderName,
  selectedFolderId,
  selectedFolderName,
  companyContextReady,
  onSelectCompany,
  onClearCompany,
  onNavigate,
  onOpenPlatformSetup,
  onOpenTabletSetup,
  onOpenDiagnostics,
  onOpenOnboarding,
  onNewCompany,
}: Props) {
  const onDark = themeMode === "dark";
  const [view, setView] = useState<View>("landing");
  const [search, setSearch] = useState("");

  const filteredCompanies = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return companies;
    }
    return companies.filter(
      (company) =>
        company.name.toLowerCase().includes(query) ||
        company.id.toLowerCase().includes(query) ||
        company.masterSheetId.toLowerCase().includes(query),
    );
  }, [companies, search]);

  const showRemembered =
    Boolean(rememberedFolderId) &&
    Boolean(rememberedFolderName) &&
    companies.some((company) => company.id === rememberedFolderId);

  const landingCards: LandingCard[] = [
    {
      id: "existing",
      title: "Work on existing company",
      description: "Choose a live company workspace to manage users, areas, templates, and reports.",
      actionLabel: "Select company",
      onAction: () => setView("picker"),
    },
    {
      id: "new",
      title: "Create new company",
      description: "Start with a clean company workspace. No previous company data will be used.",
      actionLabel: "Create company",
      onAction: onNewCompany,
    },
    {
      id: "platform",
      title: "Platform setup",
      description: "Connect Google, verify shared drive access, SMTP, and tablet kiosk controls.",
      actionLabel: "Open platform setup",
      onAction: onOpenPlatformSetup,
    },
    {
      id: "diagnostics",
      title: "Reports / Diagnostics",
      description: "Platform health, readiness checks, and Master diagnostics across workspaces.",
      actionLabel: "Open diagnostics",
      onAction: onOpenDiagnostics,
    },
  ];

  const pageShell = onDark ? "text-slate-100" : "text-slate-900";
  const muted = onDark ? "text-slate-400" : "text-slate-600";
  const inputClass = onDark
    ? "border-slate-600 bg-slate-950 text-white placeholder:text-slate-500"
    : "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400";

  const openHub = () => setView("hub");

  const handlePickCompany = (folderId: string) => {
    onSelectCompany(folderId);
    openHub();
  };

  const handleContinueRemembered = () => {
    if (!rememberedFolderId) {
      return;
    }
    onSelectCompany(rememberedFolderId);
    openHub();
  };

  if (view === "hub" && selectedFolderId) {
    return (
      <div className={pageShell}>
        <header className="mb-6">
          <button
            type="button"
            onClick={() => setView("landing")}
            className={["mb-3 text-sm font-semibold", onDark ? "text-orange-300 hover:text-orange-200" : "text-orange-700 hover:text-orange-800"].join(" ")}
          >
            ← Back to Godmode home
          </button>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Company workspace</h1>
          <p className={`mt-2 max-w-2xl text-sm leading-relaxed ${muted}`}>
            Manage this company&apos;s users, areas, templates, schedules, and quality tools.
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
          onNewCompany={onNewCompany}
          themeMode={themeMode}
        />

        <section className="mt-2">
          <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${onDark ? "text-slate-500" : "text-slate-500"}`}>
            Quick links
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_LINKS.map((link) => (
              <button
                key={`${link.screen}-${link.label}`}
                type="button"
                onClick={() => onNavigate(link.screen)}
                className={[
                  "flex min-h-[44px] items-center justify-center rounded-xl border px-3 text-sm font-semibold transition",
                  onDark
                    ? "border-slate-700 bg-slate-900/80 text-slate-100 hover:border-orange-400/40 hover:bg-slate-800"
                    : "border-slate-200 bg-white text-slate-800 hover:border-orange-200 hover:bg-orange-50/80",
                ].join(" ")}
              >
                {link.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpenTabletSetup}
            className={[
              "mt-3 text-sm font-semibold underline-offset-2 hover:underline",
              onDark ? "text-slate-400 hover:text-slate-200" : "text-slate-600 hover:text-slate-900",
            ].join(" ")}
          >
            Tablet / Kiosk setup
          </button>
        </section>
      </div>
    );
  }

  if (view === "picker") {
    return (
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
          <h1 className="text-2xl font-semibold tracking-tight">Select company</h1>
          <p className={`mt-2 text-sm ${muted}`}>Live company workspaces only — archive and platform folders are hidden.</p>
        </header>

        <label className="block">
          <span className="sr-only">Search companies</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by company name…"
            className={`h-11 w-full rounded-xl border px-4 text-sm outline-none focus:ring-2 focus:ring-orange-200 ${inputClass}`}
          />
        </label>

        {companies.length === 0 ? (
          <p className={`mt-6 rounded-2xl border px-4 py-6 text-sm ${onDark ? "border-white/10 bg-slate-900/50 text-slate-300" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
            No live company workspaces yet. Create a new company to begin.
          </p>
        ) : filteredCompanies.length === 0 ? (
          <p className={`mt-6 text-sm ${muted}`}>No companies match your search.</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {filteredCompanies.map((company) => (
              <li key={company.id}>
                <button
                  type="button"
                  onClick={() => handlePickCompany(company.id)}
                  className={[
                    "flex w-full flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition sm:flex-row sm:items-center sm:justify-between",
                    onDark
                      ? "border-white/10 bg-slate-900/50 hover:border-orange-400/40 hover:bg-slate-900"
                      : "border-slate-200 bg-white hover:border-orange-200 hover:bg-orange-50/50",
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{company.name}</p>
                    <p className={`mt-0.5 truncate font-mono text-xs ${muted}`}>
                      {company.masterSheetId ? `Sheet: ${company.masterSheetId}` : "Master sheet not linked yet"}
                    </p>
                    <p className={`mt-0.5 truncate font-mono text-[11px] ${muted}`}>Folder: {company.id}</p>
                  </div>
                  <span
                    className={[
                      "mt-1 inline-flex shrink-0 self-start rounded-full px-2.5 py-0.5 text-xs font-semibold sm:mt-0 sm:self-center",
                      company.setupStatusLabel === "Ready"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900",
                    ].join(" ")}
                  >
                    {company.setupStatusLabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className={pageShell}>
      <header className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Godmode</h1>
        <p className={`mt-2 text-sm leading-relaxed md:text-base ${muted}`}>
          Manage the BERT platform, onboard companies, or choose a company workspace to work on.
        </p>
      </header>

      {showRemembered ? (
        <section
          className={[
            "mb-6 rounded-2xl border px-4 py-4",
            onDark ? "border-orange-400/25 bg-orange-500/10" : "border-orange-200 bg-orange-50/80",
          ].join(" ")}
        >
          <p className={`text-sm ${onDark ? "text-orange-100" : "text-orange-950"}`}>
            Last worked on: <span className="font-semibold">{rememberedFolderName}</span>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleContinueRemembered}
              className="inline-flex h-10 items-center rounded-xl bg-[var(--bert-signal-orange)] px-4 text-sm font-semibold text-[var(--qms-navy-950)] hover:brightness-95"
            >
              Continue with this company
            </button>
            <button
              type="button"
              onClick={() => setView("picker")}
              className={[
                "inline-flex h-10 items-center rounded-xl border px-4 text-sm font-semibold",
                onDark
                  ? "border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
              ].join(" ")}
            >
              Choose another company
            </button>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {landingCards.map((card) => (
          <LandingActionCard key={card.id} card={card} onDark={onDark} />
        ))}
      </div>

      {!companyContextReady && selectedFolderId ? (
        <p className={`mt-4 text-sm ${onDark ? "text-amber-200" : "text-amber-800"}`}>{GODMODE_COMPANY_CONTEXT_REQUIRED_MESSAGE}</p>
      ) : null}
    </div>
  );
}
