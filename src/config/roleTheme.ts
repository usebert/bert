import type { Role } from "../permissions";

/** Internal theme bucket — maps from `Role` in permissions.ts. */
export type RoleThemeKey = "master" | "admin" | "manager" | "auditor";

export type RoleTheme = {
  key: RoleThemeKey;
  accentName: "orange" | "blue" | "green" | "purple";
  label: string;
  /** Short badge in header (Master, Admin, …). */
  badgeShort: string;
  /** Accent-coloured page title in the top header row. */
  headerTitle: string;
  headerTitleColor: string;
  navActive: string;
  navHover: string;
  navMoreActive: string;
  navSubActive: string;
  navSubHover: string;
  banner: string;
  bannerIcon: string;
  bannerHeadline: string;
  bannerDetail: string;
  badge: string;
  pageBackground: string;
  card: string;
  metricCard: string;
  metricValue: string;
  metricValueAlert: string;
  metricLink: string;
  quickActionCard: string;
  quickActionCardHover: string;
  quickActionIconChip: string;
  primaryButton: string;
  primaryButtonHover: string;
  outlineButton: string;
  chip: string;
  statusTile: string;
  healthyStrip: string;
  mobileNavActive: string;
  sectionIntro: string;
  pageHeaderEyebrow: string;
  pageHeaderShell: string;
  avatarBg: string;
  avatarText: string;
  tabActiveOnDark: string;
  tabInactiveOnDark: string;
  iconChipTint: string;
  controlLoopCurrentOnLight: string;
  controlLoopCurrentOnDark: string;
  controlLoopCurrentDot: string;
};

const ROLE_THEMES: Record<RoleThemeKey, RoleTheme> = {
  master: {
    key: "master",
    accentName: "orange",
    label: "Platform owner",
    badgeShort: "Master",
    headerTitle: "BERT Platform Owner",
    headerTitleColor: "text-orange-600",
    navActive: "bg-orange-500 text-white shadow-[0_8px_20px_rgba(249,115,22,0.28)]",
    navHover: "text-slate-200 hover:bg-white/8 hover:text-white",
    navMoreActive: "border border-orange-400/45 bg-orange-500/15 text-orange-100",
    navSubActive: "bg-orange-500/22 text-orange-50",
    navSubHover: "text-slate-400 hover:bg-white/8 hover:text-slate-100",
    banner: "border-orange-200/80 bg-orange-50/95 text-slate-900 shadow-sm",
    bannerIcon: "bg-orange-500 text-white",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-orange-200 bg-orange-50 text-orange-800",
    pageBackground: "bg-slate-100",
    card: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm",
    metricCard: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm",
    pageHeaderEyebrow: "text-orange-300",
    pageHeaderShell: "rounded-[2rem] bg-slate-950",
    avatarBg: "bg-orange-500",
    avatarText: "text-white",
    tabActiveOnDark: "border-orange-400 bg-orange-400/15 text-orange-200",
    tabInactiveOnDark: "border-slate-700 bg-slate-900 text-slate-300",
    iconChipTint: "bg-orange-50 text-orange-600 ring-1 ring-orange-100",
    controlLoopCurrentOnLight: "border-orange-300 bg-orange-50 text-orange-950 ring-1 ring-orange-200/80",
    controlLoopCurrentOnDark: "border-orange-400/80 bg-orange-500/15 text-orange-50 ring-1 ring-orange-400/40",
    controlLoopCurrentDot: "bg-orange-500",
    metricValue: "text-3xl font-black tracking-tight text-slate-900",
    metricValueAlert: "text-3xl font-black tracking-tight text-rose-600",
    metricLink: "text-xs font-semibold text-orange-600 hover:text-orange-700",
    quickActionCard:
      "flex min-h-[5.5rem] flex-col items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-sm transition",
    quickActionCardHover: "hover:border-orange-200 hover:shadow-md",
    quickActionIconChip:
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white shadow-sm",
    primaryButton: "bg-orange-500 text-white",
    primaryButtonHover: "hover:bg-orange-600",
    outlineButton: "border border-orange-300 bg-white text-orange-700 hover:bg-orange-50",
    chip: "bg-orange-100 text-orange-900 ring-1 ring-orange-500/20",
    statusTile: "border-orange-100 bg-white",
    healthyStrip: "border-emerald-200 bg-emerald-50 text-emerald-900",
    mobileNavActive: "text-orange-600",
    sectionIntro: "border-l-2 border-orange-400 pl-3 text-slate-600",
  },
  admin: {
    key: "admin",
    accentName: "blue",
    label: "Company admin",
    badgeShort: "Admin",
    headerTitle: "Company Administrator",
    headerTitleColor: "text-blue-600",
    navActive: "bg-blue-500 text-white shadow-[0_8px_20px_rgba(59,130,246,0.28)]",
    navHover: "text-slate-200 hover:bg-white/8 hover:text-white",
    navMoreActive: "border border-blue-400/45 bg-blue-500/15 text-blue-100",
    navSubActive: "bg-blue-500/22 text-blue-50",
    navSubHover: "text-slate-400 hover:bg-white/8 hover:text-slate-100",
    banner: "border-blue-200/80 bg-blue-50/95 text-slate-900 shadow-sm",
    bannerIcon: "bg-blue-500 text-white",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-blue-200 bg-blue-50 text-blue-800",
    pageBackground: "bg-slate-100",
    card: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm",
    metricCard: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm",
    pageHeaderEyebrow: "text-blue-300",
    pageHeaderShell: "rounded-[2rem] bg-slate-950",
    avatarBg: "bg-blue-500",
    avatarText: "text-white",
    tabActiveOnDark: "border-blue-400 bg-blue-400/15 text-blue-200",
    tabInactiveOnDark: "border-slate-700 bg-slate-900 text-slate-300",
    iconChipTint: "bg-blue-50 text-blue-600 ring-1 ring-blue-100",
    controlLoopCurrentOnLight: "border-blue-300 bg-blue-50 text-blue-950 ring-1 ring-blue-200/80",
    controlLoopCurrentOnDark: "border-blue-400/80 bg-blue-500/15 text-blue-50 ring-1 ring-blue-400/40",
    controlLoopCurrentDot: "bg-blue-500",
    metricValue: "text-3xl font-black tracking-tight text-slate-900",
    metricValueAlert: "text-3xl font-black tracking-tight text-rose-600",
    metricLink: "text-xs font-semibold text-blue-600 hover:text-blue-700",
    quickActionCard:
      "flex min-h-[5.5rem] flex-col items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-sm transition",
    quickActionCardHover: "hover:border-blue-200 hover:shadow-md",
    quickActionIconChip:
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white shadow-sm",
    primaryButton: "bg-blue-500 text-white",
    primaryButtonHover: "hover:bg-blue-600",
    outlineButton: "border border-blue-300 bg-white text-blue-700 hover:bg-blue-50",
    chip: "bg-blue-100 text-blue-900 ring-1 ring-blue-500/20",
    statusTile: "border-blue-100 bg-white",
    healthyStrip: "border-emerald-200 bg-emerald-50 text-emerald-900",
    mobileNavActive: "text-blue-600",
    sectionIntro: "border-l-2 border-blue-400 pl-3 text-slate-600",
  },
  manager: {
    key: "manager",
    accentName: "green",
    label: "Manager",
    badgeShort: "Manager",
    headerTitle: "Operational Manager",
    headerTitleColor: "text-emerald-600",
    navActive: "bg-emerald-500 text-white shadow-[0_8px_20px_rgba(16,185,129,0.28)]",
    navHover: "text-slate-200 hover:bg-white/8 hover:text-white",
    navMoreActive: "border border-emerald-400/45 bg-emerald-500/15 text-emerald-100",
    navSubActive: "bg-emerald-500/22 text-emerald-50",
    navSubHover: "text-slate-400 hover:bg-white/8 hover:text-slate-100",
    banner: "border-emerald-200/80 bg-emerald-50/95 text-slate-900 shadow-sm",
    bannerIcon: "bg-emerald-500 text-white",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-emerald-200 bg-emerald-50 text-emerald-800",
    pageBackground: "bg-slate-100",
    card: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm",
    metricCard: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm",
    pageHeaderEyebrow: "text-emerald-300",
    pageHeaderShell: "rounded-[2rem] bg-slate-950",
    avatarBg: "bg-emerald-500",
    avatarText: "text-white",
    tabActiveOnDark: "border-emerald-400 bg-emerald-400/15 text-emerald-200",
    tabInactiveOnDark: "border-slate-700 bg-slate-900 text-slate-300",
    iconChipTint: "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100",
    controlLoopCurrentOnLight: "border-emerald-300 bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200/80",
    controlLoopCurrentOnDark: "border-emerald-400/80 bg-emerald-500/15 text-emerald-50 ring-1 ring-emerald-400/40",
    controlLoopCurrentDot: "bg-emerald-500",
    metricValue: "text-3xl font-black tracking-tight text-slate-900",
    metricValueAlert: "text-3xl font-black tracking-tight text-rose-600",
    metricLink: "text-xs font-semibold text-emerald-600 hover:text-emerald-700",
    quickActionCard:
      "flex min-h-[5.5rem] flex-col items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-sm transition",
    quickActionCardHover: "hover:border-emerald-200 hover:shadow-md",
    quickActionIconChip:
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm",
    primaryButton: "bg-emerald-500 text-white",
    primaryButtonHover: "hover:bg-emerald-600",
    outlineButton: "border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50",
    chip: "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-500/20",
    statusTile: "border-emerald-100 bg-white",
    healthyStrip: "border-emerald-200 bg-emerald-50 text-emerald-900",
    mobileNavActive: "text-emerald-600",
    sectionIntro: "border-l-2 border-emerald-400 pl-3 text-slate-600",
  },
  auditor: {
    key: "auditor",
    accentName: "purple",
    label: "Auditor",
    badgeShort: "Auditor",
    headerTitle: "Site Auditor / Tablet User",
    headerTitleColor: "text-violet-600",
    navActive: "bg-violet-500 text-white shadow-[0_8px_20px_rgba(139,92,246,0.28)]",
    navHover: "text-slate-200 hover:bg-white/8 hover:text-white",
    navMoreActive: "border border-violet-400/45 bg-violet-500/15 text-violet-100",
    navSubActive: "bg-violet-500/22 text-violet-50",
    navSubHover: "text-slate-400 hover:bg-white/8 hover:text-slate-100",
    banner: "border-violet-200/80 bg-violet-50/95 text-slate-900 shadow-sm",
    bannerIcon: "bg-violet-500 text-white",
    bannerHeadline: "text-slate-900",
    bannerDetail: "text-slate-600",
    badge: "border border-violet-200 bg-violet-50 text-violet-800",
    pageBackground: "bg-slate-100",
    card: "rounded-3xl border border-slate-200 bg-white p-6 shadow-sm",
    metricCard: "rounded-3xl border border-slate-200 bg-white p-5 shadow-sm",
    pageHeaderEyebrow: "text-violet-200",
    pageHeaderShell: "rounded-[2rem] bg-violet-700 shadow-lg shadow-violet-900/20",
    avatarBg: "bg-violet-500",
    avatarText: "text-white",
    tabActiveOnDark: "border-violet-400 bg-violet-400/15 text-violet-200",
    tabInactiveOnDark: "border-slate-700 bg-slate-900 text-slate-300",
    iconChipTint: "bg-violet-50 text-violet-600 ring-1 ring-violet-100",
    controlLoopCurrentOnLight: "border-violet-300 bg-violet-50 text-violet-950 ring-1 ring-violet-200/80",
    controlLoopCurrentOnDark: "border-violet-400/80 bg-violet-500/15 text-violet-50 ring-1 ring-violet-400/40",
    controlLoopCurrentDot: "bg-violet-500",
    metricValue: "text-3xl font-black tracking-tight text-slate-900",
    metricValueAlert: "text-3xl font-black tracking-tight text-rose-600",
    metricLink: "text-xs font-semibold text-violet-600 hover:text-violet-700",
    quickActionCard:
      "flex min-h-[5.5rem] flex-col items-start gap-3 rounded-2xl border border-slate-200/90 bg-white p-4 text-left shadow-sm transition",
    quickActionCardHover: "hover:border-violet-200 hover:shadow-md",
    quickActionIconChip:
      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white shadow-sm",
    primaryButton: "bg-violet-500 text-white",
    primaryButtonHover: "hover:bg-violet-600",
    outlineButton: "border border-violet-300 bg-white text-violet-700 hover:bg-violet-50",
    chip: "bg-violet-100 text-violet-900 ring-1 ring-violet-500/20",
    statusTile: "border-violet-100 bg-white",
    healthyStrip: "border-sky-200 bg-sky-50 text-sky-900",
    mobileNavActive: "text-violet-600",
    sectionIntro: "border-l-2 border-violet-400 pl-3 text-slate-600",
  },
};

export function mapRoleToThemeKey(role: Role): RoleThemeKey {
  if (role === "Master") return "master";
  if (role === "Admin") return "admin";
  if (role === "Manager") return "manager";
  return "auditor";
}

export function getRoleTheme(role: Role): RoleTheme {
  return ROLE_THEMES[mapRoleToThemeKey(role)];
}

/** Tailwind classes for a filled primary CTA button for the given role. */
export function primaryButtonClass(role: Role, extra = ""): string {
  const theme = getRoleTheme(role);
  return [theme.primaryButton, theme.primaryButtonHover, extra].filter(Boolean).join(" ");
}
