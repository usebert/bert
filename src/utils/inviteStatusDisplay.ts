/** Consistent invite/user row status labels for admin UI. */
export function formatInviteStatusLabel(status: string): string {
  const normalized = String(status || "").trim();
  if (normalized === "Invite sent") return "Email sent";
  if (normalized === "Removed") return "Removed";
  if (normalized === "Invite created") return "Invite created";
  if (normalized === "Email sent") return "Email sent";
  if (normalized === "Awaiting setup") return "Awaiting setup";
  if (normalized === "Setup incomplete") return "Setup incomplete";
  if (normalized === "Active") return "Active";
  return normalized || "Unknown";
}

export function inviteStatusBadgeClass(status: string): string {
  const label = formatInviteStatusLabel(status);
  if (label === "Active") return "bg-emerald-500/15 text-emerald-200";
  if (label === "Email sent") return "bg-sky-500/15 text-sky-200";
  if (label === "Awaiting setup" || label === "Invite created") return "bg-amber-500/15 text-amber-100";
  if (label === "Setup incomplete") return "bg-rose-500/15 text-rose-200";
  if (label === "Removed") return "bg-slate-700/80 text-slate-300";
  return "bg-slate-700/80 text-slate-200";
}

export function formatUserRoleLabel(role: string): string {
  if (role === "Master") return "Admin";
  return role;
}
