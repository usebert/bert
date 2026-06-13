/**
 * Tracks company user session revocations after Godmode user reset.
 * Godmode/master sessions are never revoked here.
 */
import fs from "node:fs";
import { isPlatformOwnerEmail } from "../shared/platform-owner.mjs";

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function createCompanySessionRevocationApi(storePath) {
  function readStore() {
    try {
      const raw = fs.readFileSync(storePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return { version: 1, byCompany: {}, byEmail: {} };
      }
      if (!parsed.byCompany || typeof parsed.byCompany !== "object") {
        parsed.byCompany = {};
      }
      if (!parsed.byEmail || typeof parsed.byEmail !== "object") {
        parsed.byEmail = {};
      }
      return parsed;
    } catch {
      return { version: 1, byCompany: {}, byEmail: {} };
    }
  }

  function writeStore(store) {
    const dir = storePath.replace(/[/\\][^/\\]+$/, "");
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
  }

  function revokeCompanyUserSessions({ companyFolderId, masterSheetId, emails = [] }) {
    const folderId = String(companyFolderId || "").trim();
    const sheetId = String(masterSheetId || "").trim();
    const normalizedEmails = [...new Set(emails.map(normalizeEmail).filter(Boolean))].filter(
      (email) => !isPlatformOwnerEmail(email, process.env),
    );
    const store = readStore();
    const revokedAt = Date.now();
    if (folderId) {
      store.byCompany[folderId] = {
        revokedAt,
        masterSheetId: sheetId || store.byCompany[folderId]?.masterSheetId || undefined,
        emails: normalizedEmails,
      };
    }
    for (const email of normalizedEmails) {
      store.byEmail[email] = {
        revokedAt,
        companyFolderId: folderId || undefined,
        masterSheetId: sheetId || undefined,
      };
    }
    writeStore(store);
    return { sessionsInvalidated: normalizedEmails.length, revokedAt };
  }

  function isCompanyUserSessionRevoked(email, companyFolderId = "", masterSheetId = "") {
    const key = normalizeEmail(email);
    if (!key || isPlatformOwnerEmail(key, process.env)) {
      return false;
    }
    const store = readStore();
    const direct = store.byEmail[key];
    if (direct?.revokedAt) {
      const folderMatch =
        !companyFolderId ||
        !direct.companyFolderId ||
        String(direct.companyFolderId).trim() === String(companyFolderId).trim();
      const sheetMatch =
        !masterSheetId || !direct.masterSheetId || String(direct.masterSheetId).trim() === String(masterSheetId).trim();
      if (folderMatch && sheetMatch) {
        return true;
      }
    }
    const folderId = String(companyFolderId || "").trim();
    if (!folderId) {
      return false;
    }
    const companyRevocation = store.byCompany[folderId];
    if (!companyRevocation?.revokedAt) {
      return false;
    }
    const revokedEmails = Array.isArray(companyRevocation.emails) ? companyRevocation.emails : [];
    if (revokedEmails.length === 0) {
      return true;
    }
    return revokedEmails.includes(key);
  }

  return {
    revokeCompanyUserSessions,
    isCompanyUserSessionRevoked,
    readStore,
  };
}
