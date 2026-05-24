import type { Role } from "../permissions";
import { getRoleBannerCopy } from "../config/roleBanners";
import { getRoleTheme } from "../config/roleTheme";

type Props = {
  role: Role;
  workspaceName: string;
  className?: string;
};

export function RoleContextBanner({ role, workspaceName, className = "" }: Props) {
  const copy = getRoleBannerCopy(role, workspaceName);
  const theme = getRoleTheme(role);
  return (
    <section
      className={["rounded-2xl border px-4 py-3", theme.banner, className].join(" ")}
      aria-label="Your role and workspace"
    >
      <p className={["text-sm font-semibold leading-snug", theme.bannerHeadline].join(" ")}>
        {copy.headline}
      </p>
      <p className={["mt-1 text-sm leading-relaxed", theme.bannerDetail].join(" ")}>
        {copy.detail}
      </p>
    </section>
  );
}
