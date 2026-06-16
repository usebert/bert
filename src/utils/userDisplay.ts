/** Display helpers — derive names/initials from profile or auth identity (never invent people). */

export function getFirstName(displayName: string, emailOrUsername: string): string {
  const trimmed = displayName.trim();
  if (trimmed) {
    const first = trimmed.split(/\s+/)[0];
    if (first) return first;
  }
  const id = emailOrUsername.trim();
  if (id.includes("@")) {
    const local = id.split("@")[0] || id;
    const part = local.split(/[._-]/)[0];
    if (part) return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }
  if (id) return id.charAt(0).toUpperCase() + id.slice(1).toLowerCase();
  return "there";
}

export function getUserInitials(displayName: string, emailOrUsername: string): string {
  const trimmed = displayName.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0]![0] || ""}${parts[1]![0] || ""}`.toUpperCase();
    }
    if (parts.length === 1 && parts[0]!.length >= 2) {
      return parts[0]!.slice(0, 2).toUpperCase();
    }
    if (parts.length === 1 && parts[0]!.length === 1) {
      return `${parts[0]!}${(emailOrUsername[0] || "?").toUpperCase()}`.toUpperCase();
    }
  }
  const id = emailOrUsername.trim();
  if (id.includes("@")) {
    const local = (id.split("@")[0] || id).replace(/[^a-zA-Z0-9]/g, "");
    if (local.length >= 2) return local.slice(0, 2).toUpperCase();
    if (local.length === 1) return `${local}X`.toUpperCase();
  }
  if (id.length >= 2) return id.slice(0, 2).toUpperCase();
  return "?";
}

export function getTimeBasedGreeting(date = new Date()): "Good morning" | "Good afternoon" | "Good evening" {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/** First token of profile display name for greetings; null if unset (do not substitute workspace or email). */
export function getGreetingFirstName(displayName: string): string | null {
  const trimmed = displayName.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  return first || null;
}
