import type { Role } from "../permissions";
import { getAccountRoleDetail, getAccountRoleLabel, resolveUserEmail } from "../utils/uxDeclutter";

export type AccountIdentitySummaryProps = {
  name: string;
  username: string;
  email?: string;
  role: Role;
  companyName?: string;
  /** When Master is acting inside a company workspace. */
  actingCompanyName?: string;
  compact?: boolean;
  tone?: "onDark" | "onLight";
};

export function AccountIdentitySummary({
  name,
  username,
  email,
  role,
  companyName,
  actingCompanyName,
  compact = false,
  tone = "onLight",
}: AccountIdentitySummaryProps) {
  const resolvedEmail = resolveUserEmail({ username, email });
  const roleLabel = getAccountRoleLabel(role);
  const roleDetail = getAccountRoleDetail(role);
  const company =
    role === "Master"
      ? actingCompanyName?.trim() || (actingCompanyName === undefined ? "" : "")
      : companyName?.trim() || "";

  const nameClass =
    tone === "onDark"
      ? "truncate text-sm font-semibold text-white"
      : "truncate text-sm font-semibold text-slate-900";
  const metaClass = tone === "onDark" ? "truncate text-xs text-slate-400" : "truncate text-xs text-slate-500";
  const detailClass = tone === "onDark" ? "text-xs text-slate-300" : "text-xs text-slate-600";

  if (compact) {
    return (
      <span className="min-w-0">
        <span className={nameClass}>{name}</span>
        {resolvedEmail ? <span className={`block ${metaClass}`}>{resolvedEmail}</span> : null}
        <span className={`block ${metaClass}`}>
          {roleLabel}
          {role === "Master" ? ` · ${roleDetail}` : ""}
          {company ? ` · ${company}` : null}
        </span>
      </span>
    );
  }

  return (
    <dl className="space-y-2 text-sm">
      <div>
        <dt className="sr-only">Name</dt>
        <dd className={tone === "onDark" ? "text-base font-semibold text-white" : "text-base font-semibold text-slate-900"}>
          {name}
        </dd>
      </div>
      {resolvedEmail ? (
        <div>
          <dt className={metaClass}>Email</dt>
          <dd className={detailClass}>{resolvedEmail}</dd>
        </div>
      ) : null}
      <div>
        <dt className={metaClass}>Role</dt>
        <dd className={detailClass}>
          {roleLabel}
          {role === "Master" ? ` (${roleDetail})` : ""}
        </dd>
      </div>
      {company ? (
        <div>
          <dt className={metaClass}>Company</dt>
          <dd className={detailClass}>{company}</dd>
        </div>
      ) : null}
    </dl>
  );
}
