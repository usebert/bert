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

const INVITE_STATUS_HELP: Record<string, string> = {
  "Invite created": "An invite link exists, but email may not have been sent.",
  "Email sent": "The setup email was sent. The user still needs to open it.",
  "Awaiting setup": "The user has not completed name/password setup yet.",
  "Setup incomplete": "Setup started but BERT could not finish creating login access.",
  Active: "The user has completed setup and can sign in.",
  Removed: "The user was removed or deactivated.",
};

export function getInviteStatusHelp(status: string): string {
  const label = formatInviteStatusLabel(status);
  return INVITE_STATUS_HELP[label] || "Current invite state for this person.";
}

/** Semantic chip colours — readable on light cards and dark admin rows. */
export function inviteStatusBadgeClass(status: string): string {
  const label = formatInviteStatusLabel(status);
  const base = "rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset";
  if (label === "Active") {
    return `${base} bg-emerald-100 text-emerald-900 ring-emerald-600/25`;
  }
  if (label === "Email sent") {
    return `${base} bg-sky-100 text-sky-900 ring-sky-600/25`;
  }
  if (label === "Awaiting setup" || label === "Invite created") {
    return `${base} bg-amber-100 text-amber-950 ring-amber-600/30`;
  }
  if (label === "Setup incomplete") {
    return `${base} bg-orange-100 text-orange-950 ring-orange-600/30`;
  }
  if (label === "Removed") {
    return `${base} bg-slate-200 text-slate-700 ring-slate-500/25`;
  }
  return `${base} bg-slate-100 text-slate-700 ring-slate-400/30`;
}

export function formatUserRoleLabel(role: string): string {
  if (role === "Master") return "Admin";
  return role;
}
