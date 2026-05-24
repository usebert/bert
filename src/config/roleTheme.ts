import type { Role } from "../permissions";

/** Internal theme bucket — maps from `Role` in permissions.ts. */
export type RoleThemeKey = "master" | "admin" | "manager" | "auditor";

export type RoleTheme = {
  key: RoleThemeKey;
  /** Human-readable accent colour name (design docs). */
  accentName: "orange" | "blue" | "green" | "purple";
  /** Short label for badges and chips. */
  label: string;
  /** Sidebar / primary nav — selected item. */
  navActive: string;
  /** Sidebar / primary nav — idle hover. */
  navHover: string;
  /** Sidebar “More” toggle when open or child selected. */
  navMoreActive: string;
  /** Sidebar nested “More” item — selected. */
  navSubActive: string;
  /** Sidebar nested “More” item — hover. */
  navSubHover: string;
  /** RoleContextBanner container. */
  banner: string;
  bannerHeadline: string;
  bannerDetail: string;
  /** Header / session bar role pill. */
  badge: string;
  /** Dashboard quick-action button (base). */
  quickAction: string;
  /** Dashboard quick-action button (hover). */
  quickActionHover: string;
  /** KPI / status icon chip on light cards. */
  chip: string;
  /** Status tile subtle tinted surface. */
  statusTile: string;
  /** Role dashboard hero shell. */
  dashboardShell: string;
  dashboardEyebrow: string;
  dashboardIntro: string;
  /** Mobile bottom nav — selected label/icon colour. */
  mobileNavActive: string;
  /** SectionIntro optional left accent. */
  sectionIntro: string;
};

const ROLE_THEMES: Record<RoleThemeKey, RoleTheme> = {
  master: {
    key: "master",
    accentName: "orange",
    label: "Platform owner",
    navActive:
      "bg-orange-500 text-slate-950 shadow-[0_8px_20px_rgba(249,115,22,0.28)]",
    navHover: "text-slate-200 hover:bg-orange-500/12 hover:text-white",
    navMoreActive: "border border-orange-400/45 bg-orange-500/15 text-orange-100",
    navSubActive: "bg-orange-500/22 text-orange-50",
    navSubHover: "text-slate-400 hover:bg-orange-500/10 hover:text-slate-100",
    banner:
      "border-orange-400/40 bg-gradient-to-r from-slate-950 via-[#0c1f36] to-slate-950 text-white shadow-sm",
    bannerHeadline: "text-white",
    bannerDetail: "text-slate-300",
    badge: "border border-orange-400/45 bg-orange-500/15 text-orange-100",
    quickAction: "border-slate-200 bg-white text-slate-800",
    quickActionHover: "hover:border-orange-300 hover:bg-orange-50",
    chip: "bg-orange-100 text-orange-900 ring-1 ring-orange-500/20",
    statusTile: "border-orange-100 bg-orange-50/80",
    dashboardShell:
      "bg-gradient-to-br from-slate-950 via-[#0c1f36] to-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)] ring-1 ring-orange-500/25",
    dashboardEyebrow: "text-orange-300",
    dashboardIntro: "text-slate-300",
    mobileNavActive: "text-orange-600",
    sectionIntro: "border-l-2 border-orange-400 pl-3 text-slate-600",
  },
  admin: {
    key: "admin",
    accentName: "blue",
    label: "Company admin",
    navActive: "bg-blue-500 text-white shadow-[0_8px_20px_rgba(59,130,246,0.28)]",
    navHover: "text-slate-200 hover:bg-blue-500/12 hover:text-white",
    navMoreActive: "border border-blue-400/45 bg-blue-500/15 text-blue-100",
    navSubActive: "bg-blue-500/22 text-blue-50",
    navSubHover: "text-slate-400 hover:bg-blue-500/10 hover:text-slate-100",
    banner: "border-blue-200 bg-blue-50/90 text-slate-900 shadow-sm",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-blue-200 bg-blue-50 text-blue-900",
    quickAction: "border-slate-200 bg-white text-slate-800",
    quickActionHover: "hover:border-blue-300 hover:bg-blue-50",
    chip: "bg-blue-100 text-blue-900 ring-1 ring-blue-500/20",
    statusTile: "border-blue-100 bg-blue-50/80",
    dashboardShell:
      "bg-gradient-to-br from-slate-950 via-[#0c1f36] to-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)] ring-1 ring-blue-500/25",
    dashboardEyebrow: "text-blue-300",
    dashboardIntro: "text-slate-300",
    mobileNavActive: "text-blue-600",
    sectionIntro: "border-l-2 border-blue-400 pl-3 text-slate-600",
  },
  manager: {
    key: "manager",
    accentName: "green",
    label: "Manager",
    navActive: "bg-emerald-500 text-slate-950 shadow-[0_8px_20px_rgba(16,185,129,0.28)]",
    navHover: "text-slate-200 hover:bg-emerald-500/12 hover:text-white",
    navMoreActive: "border border-emerald-400/45 bg-emerald-500/15 text-emerald-100",
    navSubActive: "bg-emerald-500/22 text-emerald-50",
    navSubHover: "text-slate-400 hover:bg-emerald-500/10 hover:text-slate-100",
    banner: "border-emerald-200 bg-emerald-50/90 text-slate-900 shadow-sm",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-emerald-200 bg-emerald-50 text-emerald-900",
    quickAction: "border-slate-200 bg-white text-slate-800",
    quickActionHover: "hover:border-emerald-300 hover:bg-emerald-50",
    chip: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500/20",
    statusTile: "border-emerald-100 bg-emerald-50/80",
    dashboardShell:
      "bg-gradient-to-br from-slate-950 via-[#0c1f36] to-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)] ring-1 ring-emerald-500/25",
    dashboardEyebrow: "text-emerald-300",
    dashboardIntro: "text-slate-300",
    mobileNavActive: "text-emerald-600",
    sectionIntro: "border-l-2 border-emerald-400 pl-3 text-slate-600",
  },
  auditor: {
    key: "auditor",
    accentName: "purple",
    label: "Auditor",
    navActive: "bg-violet-500 text-white shadow-[0_8px_20px_rgba(139,92,246,0.28)]",
    navHover: "text-slate-200 hover:bg-violet-500/12 hover:text-white",
    navMoreActive: "border border-violet-400/45 bg-violet-500/15 text-violet-100",
    navSubActive: "bg-violet-500/22 text-violet-50",
    navSubHover: "text-slate-400 hover:bg-violet-500/10 hover:text-slate-100",
    banner: "border-violet-200 bg-violet-50/90 text-slate-900 shadow-sm",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-violet-200 bg-violet-50 text-violet-900",
    quickAction: "border-slate-200 bg-white text-slate-800",
    quickActionHover: "hover:border-violet-300 hover:bg-violet-50",
    chip: "bg-violet-100 text-violet-900 ring-1 ring-violet-500/20",
    statusTile: "border-violet-100 bg-violet-50/80",
    dashboardShell:
      "bg-gradient-to-br from-slate-950 via-[#0c1f36] to-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)] ring-1 ring-violet-500/25",
    dashboardEyebrow: "text-violet-300",
    dashboardIntro: "text-slate-300",
    mobileNavActive: "text-violet-600",
    sectionIntro: "border-l-2 border-violet-400 pl-3 text-slate-600",
  },
};

/** Map `Role` from permissions.ts to theme bucket keys. */
export function mapRoleToThemeKey(role: Role): RoleThemeKey {
  if (role === "Master") return "master";
  if (role === "Admin") return "admin";
  if (role === "Manager") return "manager";
  return "auditor";
}

export function getRoleTheme(role: Role): RoleTheme {
  return ROLE_THEMES[mapRoleToThemeKey(role)];
}
