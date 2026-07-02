import type { Role } from "../permissions";
import { getRoleTheme } from "../config/roleTheme";

/** Navy / slate-950 hero shells and readable typography (titles, eyebrows, body). */

export const darkPanelShell =
  "rounded-[1.75rem] bg-slate-950 p-5 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]";

export const darkPanelShellCompact =
  "rounded-[1.75rem] bg-slate-950 px-5 py-4 text-white shadow-[0_18px_40px_rgba(15,23,42,0.22)]";

export const darkPanelShellBordered =
  "rounded-[1.75rem] border border-slate-800 bg-slate-950 p-4 shadow-[0_16px_36px_rgba(15,23,42,0.24)]";

export const darkPanelEyebrow =
  "text-xs font-semibold uppercase tracking-[0.3em] text-slate-300";

export const darkPanelTitle = "font-semibold tracking-tight text-[#F8FAFC]";

export const darkPanelTitleSm = `mt-1 text-xl ${darkPanelTitle}`;

export const darkPanelTitleLg = `mt-2 text-2xl ${darkPanelTitle}`;

export const darkPanelDescription = "text-sm leading-5 text-slate-200";

export const darkPanelBody = "text-sm leading-6 text-slate-200";

/** Role-accent intro copy on dark heroes (keeps border accent, light body text). */
export function darkPanelRoleIntro(role: Role): string {
  return getRoleTheme(role).sectionIntro.replace("text-slate-600", "text-slate-300");
}
