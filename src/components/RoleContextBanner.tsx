import type { ReactNode } from "react";
import type { Role } from "../permissions";
import { getRoleBannerCopy } from "../config/roleBanners";
import { getRoleTheme } from "../config/roleTheme";

type Props = {
  role: Role;
  workspaceName: string;
  className?: string;
};

function RoleBannerIcon({ role }: { role: Role }) {
  const theme = getRoleTheme(role);
  const paths: Record<Role, ReactNode> = {
    Master: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M12 3l8 4v5c0 5-3.5 8.5-8 10-3.5-1.5-8-5-8-10V7l8-4Z" />
      </svg>
    ),
    Admin: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M4 19h16M6 16V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8M9 11h6" />
      </svg>
    ),
    Manager: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="9" cy="8" r="3" />
        <circle cx="16" cy="9" r="2.5" />
        <path d="M4 19a5 5 0 0 1 10 0M14 19a4 4 0 0 1 6 0" />
      </svg>
    ),
    Auditor: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
  };
  return (
    <div
      className={["flex h-11 w-11 shrink-0 items-center justify-center rounded-xl shadow-sm", theme.bannerIcon].join(" ")}
      aria-hidden
    >
      {paths[role]}
    </div>
  );
}

export function RoleContextBanner({ role, workspaceName, className = "" }: Props) {
  const copy = getRoleBannerCopy(role, workspaceName);
  const theme = getRoleTheme(role);
  return (
    <section
      className={["rounded-2xl border px-4 py-3.5", theme.banner, className].join(" ")}
      aria-label="Your role and workspace"
    >
      <div className="flex items-start gap-3">
        <RoleBannerIcon role={role} />
        <div className="min-w-0 flex-1">
          <p className={["text-sm font-semibold leading-snug", theme.bannerHeadline].join(" ")}>{copy.headline}</p>
          <p className={["mt-1 text-sm leading-relaxed", theme.bannerDetail].join(" ")}>{copy.detail}</p>
        </div>
      </div>
    </section>
  );
}
