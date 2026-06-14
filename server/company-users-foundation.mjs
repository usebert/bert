/**
 * BERT company users foundation — single canonical module for People, assignees, re-sync, Godmode.
 *
 * Routes and services must import listCompanyProfiles (or syncAndListActiveUsers alias) from here.
 * Never expose PasswordHash to API clients.
 */
import { resolveCompanyContextFields } from "./company-context-service.mjs";
import { readActiveUsersFromSheetWithStats } from "./company-user-sheet-flow.mjs";
import {
  getAssignableUsers,
  listActiveCompanyMembers,
  rebuildUsersFromSheet,
} from "./company-user-service.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

/**
 * Resolve company folder, workbook, and display name from a session or API actor.
 * companyFolderId === companyId everywhere.
 */
export async function resolveCompanyContextFromSession(auth, deps, session = {}) {
  const companyFolderId = trim(session.companyFolderId || session.companyId);
  return resolveCompanyContextFields(auth, deps, {
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId: session.masterSheetId,
    companyName: session.companyName || session.selectedCompanyName,
  });
}

/** @deprecated Prefer resolveCompanyContextFromSession — kept for route parity with docs. */
export const resolveCompanyContext = resolveCompanyContextFromSession;

/**
 * Read profile rows from the company workbook Users tab (header names, legacy + new schema).
 * Returns { members, totalSheetRows, profilesReturned, activeOnlyCount, ... } — never PasswordHash.
 */
export async function readUsersTabProfiles(auth, deps, companyContext = {}) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  return readActiveUsersFromSheetWithStats(auth, deps, {
    ...companyContext,
    companyFolderId,
    companyId: companyFolderId,
    masterSheetId,
  });
}

/**
 * Rebuild server company-users cache after a successful sheet read.
 */
export function syncCompanyUsersCache(deps, companyContext = {}, profiles = []) {
  const companyFolderId = trim(companyContext.companyFolderId || companyContext.companyId);
  const masterSheetId = trim(companyContext.masterSheetId);
  const cache = deps?.companyUsersCache;
  if (!cache || typeof cache.rebuildCompanyUsersCache !== "function" || !companyFolderId) {
    return {
      cacheUsersBefore: 0,
      cacheOnlyUsersRemoved: 0,
      cacheOnlyEmails: [],
      keptEmails: Array.isArray(profiles) ? profiles.map((row) => trim(row.email)).filter(Boolean) : [],
    };
  }
  return cache.rebuildCompanyUsersCache(companyFolderId, profiles, { masterSheetId });
}

/**
 * Canonical company profile list — resolve context, read Users tab, sync cache.
 * Used by GET /users, schedule assignees, Godmode People, and re-sync.
 */
export async function listCompanyProfiles(auth, deps, companyContext = {}) {
  return listActiveCompanyMembers(auth, deps, companyContext);
}

/** Backward-compatible alias — same implementation as listCompanyProfiles. */
export async function syncAndListActiveUsers(auth, deps, companyContext = {}) {
  return listCompanyProfiles(auth, deps, companyContext);
}

export { rebuildUsersFromSheet, getAssignableUsers };
