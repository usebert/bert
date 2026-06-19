/**
 * Company sheet `UserAuth.<email>` values: scrypt hashes only (Node crypto, same format as Master operators).
 * Legacy pilot rows may still hold plaintext; verify + migrate on successful login or via tool route.
 */
import { hashPassword, verifyPassword } from "./master-auth.mjs";

export function isUserAuthScryptHash(value) {
  const s = String(value || "");
  return s.startsWith("scrypt$") && s.split("$").length === 3;
}

/**
 * @param {unknown} auth
 * @param {string} spreadsheetId
 * @param {string} email
 * @param {string} plain
 * @param {(auth: unknown, id: string) => Promise<Record<string, string>>} getConfig
 * @param {(auth: unknown, id: string, patch: Record<string, string>) => Promise<unknown>} updateConfig
 */
export async function verifyUserAuthLoginOrMigrate(auth, spreadsheetId, email, plain, getConfig, updateConfig) {
  const key = `UserAuth.${String(email || "")
    .trim()
    .toLowerCase()}`;
  const cfg = await getConfig(auth, spreadsheetId);
  const stored = cfg[key];
  if (!stored) {
    return { ok: false };
  }
  if (isUserAuthScryptHash(stored)) {
    return { ok: verifyPassword(plain, stored) };
  }
  if (String(stored) !== String(plain)) {
    return { ok: false };
  }
  await updateConfig(auth, spreadsheetId, { ...cfg, [key]: hashPassword(plain) });
  return { ok: true, migrated: true };
}

/**
 * One-shot migration: hash every plaintext `UserAuth.*` value in Config.
 */
export async function migrateAllPlainUserAuthKeys(auth, spreadsheetId, getConfig, updateConfig) {
  const cfg = await getConfig(auth, spreadsheetId);
  const next = { ...cfg };
  let migrated = 0;
  for (const [k, v] of Object.entries(cfg)) {
    if (!k || typeof v !== "string") {
      continue;
    }
    if (!k.toLowerCase().startsWith("userauth.")) {
      continue;
    }
    if (!v.trim()) {
      continue;
    }
    if (isUserAuthScryptHash(v)) {
      continue;
    }
    next[k] = hashPassword(v);
    migrated += 1;
  }
  if (migrated > 0) {
    await updateConfig(auth, spreadsheetId, next);
  }
  return { migrated };
}
