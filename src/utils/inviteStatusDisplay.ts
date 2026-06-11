/** Consistent invite/user row status labels for admin UI. */
export function formatInviteStatusLabel(status: string): string {
  const normalized = String(status || "").trim();
  if (normalized === "Invite sent") return "Email sent";
  if (normalized === "Removed") return "Removed";
  if (normalized === "Invite created") return "Invite created";
  if (normalized === "Email sent") return "Email sent";
  if (normalized === "Awaiting setup") return "Awaiting setup";
  if (normalized === "Setup incomplete") return "Stale invite";
  if (normalized === "Stale invite") return "Stale invite";
  if (normalized === "Active") return "Active";
  return normalized || "Unknown";
}

const INVITE_STATUS_HELP: Record<string, string> = {
  "Invite created": "An invite link exists, but email may not have been sent.",
  "Email sent": "The setup email was sent. The user still needs to open it.",
  "Awaiting setup": "The user has not completed name/password setup yet.",
  "Setup incomplete": "This invite could not be completed. Use Send fresh invite to issue a new link.",
  "Stale invite": "This invite could not be completed. Use Send fresh invite to issue a new link.",
  Active: "The user has completed setup and can sign in.",
  Removed: "The user was removed or deactivated.",
};

export function getInviteStatusHelp(status: string): string {
  const label = formatInviteStatusLabel(status);
  return INVITE_STATUS_HELP[label] || "Current invite state for this person.";
}

/** Semantic chip colours — aligned with design mockup legend. */
export function inviteStatusBadgeClass(status: string): string {
  const label = formatInviteStatusLabel(status);
  const base = "rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset";
  if (label === "Active") {
    return `${base} bg-emerald-100 text-emerald-900 ring-emerald-600/25`;
  }
  if (label === "Email sent") {
    return `${base} bg-sky-100 text-sky-900 ring-sky-600/25`;
  }
  if (label === "Awaiting setup") {
    return `${base} bg-amber-100 text-amber-950 ring-amber-600/30`;
  }
  if (label === "Invite created") {
    return `${base} bg-slate-100 text-slate-700 ring-slate-400/35`;
  }
  if (label === "Setup incomplete" || label === "Stale invite") {
    return `${base} bg-orange-100 text-orange-950 ring-orange-600/30`;
  }
  if (label === "Removed") {
    return `${base} bg-slate-200 text-slate-600 ring-slate-500/25 line-through decoration-slate-500/60`;
  }
  return `${base} bg-slate-100 text-slate-700 ring-slate-400/30`;
}

/** Dot colour for legend rows. */
export function inviteStatusDotClass(status: string): string {
  const label = formatInviteStatusLabel(status);
  if (label === "Active") return "bg-emerald-500";
  if (label === "Email sent") return "bg-sky-500";
  if (label === "Awaiting setup") return "bg-amber-500";
  if (label === "Invite created") return "bg-slate-400";
  if (label === "Setup incomplete" || label === "Stale invite") return "bg-orange-500";
  if (label === "Removed") return "bg-slate-400";
  return "bg-slate-400";
}

export const INVITE_STATUS_LEGEND: Array<{ status: string; description: string }> = [
  { status: "Invite created", description: "Invite link created; email may not have been sent yet." },
  { status: "Email sent", description: "Setup email sent; waiting for the user to open it." },
  { status: "Awaiting setup", description: "User opened the email but has not finished setup." },
  { status: "Stale invite", description: "Setup could not finish — use Send fresh invite to issue a new link." },
  { status: "Active", description: "User completed setup and can sign in." },
  { status: "Removed", description: "User was removed or deactivated." },
];

export function formatUserRoleLabel(role: string): string {
  if (role === "Master") return "Admin";
  return role;
}

export function isStaleOrIncompleteInviteStatus(status: string): boolean {
  const label = formatInviteStatusLabel(status);
  return label === "Stale invite";
}

export function isLegacyInviteRowId(id: string): boolean {
  return id.startsWith("invite-") || id.startsWith("sheet-user-");
}
