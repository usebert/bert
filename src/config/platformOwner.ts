/** Keep in sync with `shared/platform-owner.mjs` (server + verify scripts). */
export const DEFAULT_PLATFORM_OWNER_EMAIL = "admin@usebert.co.uk";

export function normalizePlatformOwnerEmail(email: string): string {
  return String(email || "")
    .trim()
    .toLowerCase();
}

export function resolvePlatformOwnerEmail(env: Record<string, string | undefined> = {}): string {
  const raw = String(env.PLATFORM_OWNER_EMAIL ?? env.VITE_PLATFORM_OWNER_EMAIL ?? "")
    .trim()
    .toLowerCase();
  return raw || DEFAULT_PLATFORM_OWNER_EMAIL;
}

export function isPlatformOwnerEmail(
  email: string,
  env: Record<string, string | undefined> = {},
): boolean {
  const norm = normalizePlatformOwnerEmail(email);
  if (!norm.includes("@")) {
    return false;
  }
  return norm === resolvePlatformOwnerEmail(env);
}
