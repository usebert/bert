import type { Role } from "../permissions";
import { getRoleBannerCopy } from "../config/roleBanners";

type Props = {
  role: Role;
  workspaceName: string;
  className?: string;
};

export function RoleContextBanner({ role, workspaceName, className = "" }: Props) {
  const copy = getRoleBannerCopy(role, workspaceName);
  return (
    <section
      className={[
        "rounded-2xl border px-4 py-3 shadow-sm",
        role === "Master"
          ? "border-slate-700 bg-gradient-to-r from-slate-950 via-[#0c1f36] to-slate-950 text-white"
          : "border-slate-200 bg-white text-slate-900",
        className,
      ].join(" ")}
      aria-label="Your role and workspace"
    >
      <p className={["text-sm font-semibold leading-snug", role === "Master" ? "text-white" : "text-slate-900"].join(" ")}>
        {copy.headline}
      </p>
      <p className={["mt-1 text-sm leading-relaxed", role === "Master" ? "text-slate-300" : "text-slate-600"].join(" ")}>
        {copy.detail}
      </p>
    </section>
  );
}
