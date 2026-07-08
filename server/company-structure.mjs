/**
 * Company structure — Sites, Departments, Areas (access scopes).
 * Folder-first routes; extends existing Areas tab safely; creates Sites/Departments when missing.
 */
import crypto from "node:crypto";
import {
  AREAS_STRUCTURE_COLUMNS,
  AREAS_TAB,
  DEPARTMENTS_COLUMNS,
  DEPARTMENTS_TAB,
  SITES_COLUMNS,
  SITES_TAB,
  USERS_ACCESS_COLUMNS,
  accessScopeFromPersonRecord,
  canEditPersonAccess,
  canManageCompanyStructure,
  formatAccessSummary,
  normalizeAccessScope,
  normalizeStructureName,
  serializeScopeIds,
} from "../shared/company-structure-access.mjs";
import { AREAS_COLUMNS as LEGACY_AREAS_COLUMNS } from "./company-areas.mjs";
import { resolveCompanyFromFolder } from "./company-folder-resolver.mjs";
import { updateCompanyUserRecord, parseCompanyAreas } from "./company-users.mjs";

function trim(value) {
  return String(value ?? "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function pickField(row, ...keys) {
  if (!row || typeof row !== "object") {
    return "";
  }
  for (const key of keys) {
    const want = normalizeStructureName(key);
    for (const [rawKey, rawValue] of Object.entries(row)) {
      if (normalizeStructureName(rawKey) === want && trim(rawValue)) {
        return trim(rawValue);
      }
    }
  }
  return "";
}

function normalizeStatus(value) {
  const status = normalizeStructureName(value) || "active";
  if (status === "archived" || status === "inactive" || status === "disabled") {
    return "inactive";
  }
  return "active";
}

function rowToSite(row) {
  const id = pickField(row, "SiteId", "Site ID", "siteId", "id");
  const name = pickField(row, "SiteName", "Site Name", "Name", "name");
  if (!id && !name) {
    return null;
  }
  const status = normalizeStatus(pickField(row, "Status", "status"));
  return {
    id: id || createId("site"),
    name,
    status,
    active: status === "active",
    createdAt: pickField(row, "CreatedAt", "Created At", "createdAt"),
    updatedAt: pickField(row, "UpdatedAt", "Updated At", "updatedAt"),
  };
}

function rowToDepartment(row) {
  const id = pickField(row, "DepartmentId", "Department ID", "departmentId", "id");
  const name = pickField(row, "DepartmentName", "Department Name", "Name", "name");
  if (!id && !name) {
    return null;
  }
  const status = normalizeStatus(pickField(row, "Status", "status"));
  return {
    id: id || createId("dept"),
    name,
    status,
    active: status === "active",
    createdAt: pickField(row, "CreatedAt", "Created At", "createdAt"),
    updatedAt: pickField(row, "UpdatedAt", "Updated At", "updatedAt"),
  };
}

function rowToArea(row) {
  const id = pickField(row, "AreaId", "Area ID", "areaId", "id");
  const name = pickField(row, "AreaName", "Area Name", "Name", "name");
  if (!id || !name) {
    return null;
  }
  const status = normalizeStatus(pickField(row, "Status", "status"));
  return {
    id,
    name,
    siteId: pickField(row, "SiteId", "Site ID", "siteId"),
    departmentId: pickField(row, "DepartmentId", "Department ID", "departmentId"),
    status,
    active: status === "active",
    createdAt: pickField(row, "CreatedAt", "Created At", "createdAt"),
    updatedAt: pickField(row, "UpdatedAt", "Updated At", "updatedAt"),
    createdBy: pickField(row, "Created By", "CreatedBy", "createdBy"),
    archivedAt: pickField(row, "Archived At", "ArchivedAt", "archivedAt"),
  };
}

function sitesToRows(sites) {
  return sites.map((site) => ({
    SiteId: site.id,
    SiteName: site.name,
    Status: site.status === "inactive" ? "inactive" : "active",
    CreatedAt: site.createdAt || "",
    UpdatedAt: site.updatedAt || "",
  }));
}

function departmentsToRows(departments) {
  return departments.map((department) => ({
    DepartmentId: department.id,
    DepartmentName: department.name,
    Status: department.status === "inactive" ? "inactive" : "active",
    CreatedAt: department.createdAt || "",
    UpdatedAt: department.updatedAt || "",
  }));
}

function areasToRows(areas) {
  return areas.map((area) => ({
    AreaId: area.id,
    AreaName: area.name,
    SiteId: area.siteId || "",
    DepartmentId: area.departmentId || "",
    Status: area.status === "inactive" ? "inactive" : "active",
    CreatedAt: area.createdAt || "",
    UpdatedAt: area.updatedAt || "",
    "Area ID": area.id,
    Name: area.name,
    "Created At": area.createdAt || "",
    "Updated At": area.updatedAt || "",
    "Created By": area.createdBy || "",
    "Archived At": area.status === "inactive" ? area.archivedAt || area.updatedAt || "" : "",
  }));
}

function hasDuplicateActiveName(items, name, excludeId = "") {
  const want = normalizeStructureName(name);
  return items.some(
    (item) =>
      item.active &&
      item.id !== excludeId &&
      normalizeStructureName(item.name) === want,
  );
}

async function ensureTabWithHeaders(deps, auth, spreadsheetId, tabName, headers) {
  const { ensureRequiredTabs, ensureColumns } = deps;
  if (typeof ensureRequiredTabs === "function") {
    await ensureRequiredTabs(auth, deps, spreadsheetId, {
      requiredTabs: [tabName],
    }).catch(() => null);
  }
  if (typeof ensureColumns === "function") {
    // server.mjs ensureColumns(auth, spreadsheetId, tab, headers)
    // workbook-service ensureColumns(auth, deps, spreadsheetId, tab, headers)
    try {
      await ensureColumns(auth, spreadsheetId, tabName, headers);
    } catch {
      await ensureColumns(auth, deps, spreadsheetId, tabName, headers);
    }
  }
}

async function readStructureTab(deps, auth, spreadsheetId, tabName, headers, mapRow) {
  const { getTabValues, rowsToRecords } = deps;
  await ensureTabWithHeaders(deps, auth, spreadsheetId, tabName, headers);
  const values = await getTabValues(auth, spreadsheetId, tabName);
  const records = rowsToRecords(values);
  return records.map(mapRow).filter(Boolean);
}

async function writeStructureTab(deps, auth, spreadsheetId, tabName, columns, dataRows) {
  const { google, withSheetsQuotaRetry, ensureColumns } = deps;
  await ensureTabWithHeaders(deps, auth, spreadsheetId, tabName, columns);
  if (typeof ensureColumns === "function") {
    try {
      await ensureColumns(auth, spreadsheetId, tabName, columns);
    } catch {
      await ensureColumns(auth, deps, spreadsheetId, tabName, columns);
    }
  }
  const sheets = google.sheets({ version: "v4", auth });
  const clearRange = `${tabName}!A:Z`;
  const clearFn = () =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: clearRange,
    });
  const updateFn = () =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          columns,
          ...dataRows.map((row) => columns.map((header) => String(row[header] ?? "").trim())),
        ],
      },
    });
  if (withSheetsQuotaRetry) {
    await withSheetsQuotaRetry(clearFn);
    await withSheetsQuotaRetry(updateFn);
  } else {
    await clearFn();
    await updateFn();
  }
}

export async function readCompanyStructure(deps, auth, spreadsheetId) {
  const sites = await readStructureTab(deps, auth, spreadsheetId, SITES_TAB, SITES_COLUMNS, rowToSite);
  const departments = await readStructureTab(
    deps,
    auth,
    spreadsheetId,
    DEPARTMENTS_TAB,
    DEPARTMENTS_COLUMNS,
    rowToDepartment,
  );

  // Prefer structure columns; also ensure legacy Areas columns stay present for existing Area CRUD.
  const areaHeaders = [...new Set([...AREAS_STRUCTURE_COLUMNS, ...LEGACY_AREAS_COLUMNS])];
  const areas = await readStructureTab(deps, auth, spreadsheetId, AREAS_TAB, areaHeaders, rowToArea);

  // Deduplicate by normalized name (keep first active, prefer id match).
  const dedupe = (items) => {
    const byName = new Map();
    for (const item of items) {
      const key = normalizeStructureName(item.name);
      if (!key) {
        continue;
      }
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, item);
        continue;
      }
      if (!existing.active && item.active) {
        byName.set(key, item);
      }
    }
    return [...byName.values()];
  };

  return {
    sites: dedupe(sites),
    departments: dedupe(departments),
    areas: dedupe(areas),
  };
}

async function resolveMasterSheet(deps, auth, companyFolderId, masterSheetIdHint = "") {
  const folderId = trim(companyFolderId);
  if (!folderId) {
    return { ok: false, error: "Company folder ID is required.", httpStatus: 400 };
  }
  const resolved = await resolveCompanyFromFolder(auth, deps, folderId, {
    masterSheetId: trim(masterSheetIdHint),
    createIfMissing: false,
  });
  const masterSheetId = trim(resolved?.masterSheetId || masterSheetIdHint);
  if (!masterSheetId) {
    return {
      ok: false,
      error: "Company workbook could not be resolved for this folder.",
      httpStatus: 404,
      details: "missing_master_sheet",
    };
  }
  return { ok: true, masterSheetId, companyFolderId: folderId, companyName: trim(resolved?.companyName) };
}

function rejectIfCannotManage(req, res) {
  const role = trim(req.bertActor?.role || "");
  if (!canManageCompanyStructure(role)) {
    res.status(403).json({
      ok: false,
      error: "Only Master, Admin, or Manager can manage company structure and person access.",
    });
    return true;
  }
  return false;
}

function safeErrorMessage(error, fallback) {
  const message = error instanceof Error ? error.message : String(error || fallback);
  if (/token|password|credential|secret|stack/i.test(message)) {
    return fallback;
  }
  return message || fallback;
}

export function installCompanyStructureRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    requireGoogleWorkspaceSession,
    requireWorkspaceAdminActor,
    parseBertActorFromRequest,
    getCompanyUsersDeps,
    ensureRequiredTabs,
  } = deps;

  const structureDeps = {
    ...deps,
    ensureRequiredTabs:
      ensureRequiredTabs ||
      (async (auth, sheetDeps, spreadsheetId, options = {}) => {
        const { ensureRequiredTabs: ensureTabs } = await import("./workbook-service.mjs");
        return ensureTabs(auth, sheetDeps, spreadsheetId, options);
      }),
  };

  async function withResolvedWorkbook(req, res, handler) {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before managing company structure.",
      });
    }
    const companyFolderId = trim(req.params.companyFolderId || req.params.companyId);
    const masterSheetIdHint = trim(
      req.query?.masterSheetId || req.body?.masterSheetId || req.bertActor?.masterSheetId || "",
    );
    const resolved = await resolveMasterSheet(structureDeps, authed, companyFolderId, masterSheetIdHint);
    if (!resolved.ok) {
      return res.status(resolved.httpStatus || 400).json({
        ok: false,
        error: resolved.error,
        details: resolved.details,
      });
    }

    // Cross-company protection for company actors.
    const actor = req.bertActor || (typeof parseBertActorFromRequest === "function" ? parseBertActorFromRequest(req) : null);
    if (actor?.kind === "company") {
      const actorFolder = trim(actor.companyFolderId || actor.companyId);
      if (actorFolder && actorFolder !== resolved.companyFolderId) {
        return res.status(403).json({
          ok: false,
          error: "You can only manage structure in your own company workspace.",
        });
      }
    }

    return handler(authed, resolved, actor);
  }

  app.get(
    "/api/companies/:companyFolderId/structure",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          return res.json({
            ok: true,
            companyFolderId: resolved.companyFolderId,
            masterSheetId: resolved.masterSheetId,
            sites: structure.sites,
            departments: structure.departments,
            areas: structure.areas,
          });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to load company structure.",
          details: safeErrorMessage(error, "structure_load_failed"),
        });
      }
    },
  );

  app.post(
    "/api/companies/:companyFolderId/structure/sites",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const name = trim(req.body?.name || req.body?.siteName);
          if (!name) {
            return res.status(400).json({ ok: false, error: "Site name is required." });
          }
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          if (hasDuplicateActiveName(structure.sites, name)) {
            return res.status(409).json({
              ok: false,
              error: `An active site named "${name}" already exists.`,
            });
          }
          const stamp = nowIso();
          const site = {
            id: createId("site"),
            name,
            status: "active",
            active: true,
            createdAt: stamp,
            updatedAt: stamp,
          };
          await writeStructureTab(
            structureDeps,
            authed,
            resolved.masterSheetId,
            SITES_TAB,
            SITES_COLUMNS,
            sitesToRows([...structure.sites, site]),
          );
          return res.json({ ok: true, site, sites: [...structure.sites, site] });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to create site.",
          details: safeErrorMessage(error, "site_create_failed"),
        });
      }
    },
  );

  app.post(
    "/api/companies/:companyFolderId/structure/departments",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const name = trim(req.body?.name || req.body?.departmentName);
          if (!name) {
            return res.status(400).json({ ok: false, error: "Department name is required." });
          }
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          if (hasDuplicateActiveName(structure.departments, name)) {
            return res.status(409).json({
              ok: false,
              error: `An active department named "${name}" already exists.`,
            });
          }
          const stamp = nowIso();
          const department = {
            id: createId("dept"),
            name,
            status: "active",
            active: true,
            createdAt: stamp,
            updatedAt: stamp,
          };
          await writeStructureTab(
            structureDeps,
            authed,
            resolved.masterSheetId,
            DEPARTMENTS_TAB,
            DEPARTMENTS_COLUMNS,
            departmentsToRows([...structure.departments, department]),
          );
          return res.json({
            ok: true,
            department,
            departments: [...structure.departments, department],
          });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to create department.",
          details: safeErrorMessage(error, "department_create_failed"),
        });
      }
    },
  );

  app.post(
    "/api/companies/:companyFolderId/structure/areas",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const name = trim(req.body?.name || req.body?.areaName);
          if (!name) {
            return res.status(400).json({ ok: false, error: "Area name is required." });
          }
          const siteId = trim(req.body?.siteId || "");
          const departmentId = trim(req.body?.departmentId || "");
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          if (hasDuplicateActiveName(structure.areas, name)) {
            return res.status(409).json({
              ok: false,
              error: `An active area named "${name}" already exists.`,
            });
          }
          if (siteId && !structure.sites.some((site) => site.id === siteId)) {
            return res.status(400).json({ ok: false, error: "Linked site was not found." });
          }
          if (departmentId && !structure.departments.some((dept) => dept.id === departmentId)) {
            return res.status(400).json({ ok: false, error: "Linked department was not found." });
          }
          const stamp = nowIso();
          const area = {
            id: createId("area"),
            name,
            siteId,
            departmentId,
            status: "active",
            active: true,
            createdAt: stamp,
            updatedAt: stamp,
            createdBy: trim(req.body?.createdBy || req.bertActor?.email || "BERT"),
            archivedAt: "",
          };
          const areaHeaders = [...new Set([...AREAS_STRUCTURE_COLUMNS, ...LEGACY_AREAS_COLUMNS])];
          await writeStructureTab(
            structureDeps,
            authed,
            resolved.masterSheetId,
            AREAS_TAB,
            areaHeaders,
            areasToRows([...structure.areas, area]),
          );
          return res.json({ ok: true, area, areas: [...structure.areas, area] });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to create area.",
          details: safeErrorMessage(error, "area_create_failed"),
        });
      }
    },
  );

  app.patch(
    "/api/companies/:companyFolderId/structure/sites/:siteId",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const siteId = trim(req.params.siteId);
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          const index = structure.sites.findIndex((site) => site.id === siteId);
          if (index < 0) {
            return res.status(404).json({ ok: false, error: "Site not found." });
          }
          const next = { ...structure.sites[index], updatedAt: nowIso() };
          if (req.body?.name !== undefined) {
            const name = trim(req.body.name);
            if (!name) {
              return res.status(400).json({ ok: false, error: "Site name is required." });
            }
            if (hasDuplicateActiveName(structure.sites, name, siteId)) {
              return res.status(409).json({
                ok: false,
                error: `An active site named "${name}" already exists.`,
              });
            }
            next.name = name;
          }
          if (req.body?.status !== undefined) {
            next.status = normalizeStatus(req.body.status);
            next.active = next.status === "active";
          }
          const sites = [...structure.sites];
          sites[index] = next;
          await writeStructureTab(
            structureDeps,
            authed,
            resolved.masterSheetId,
            SITES_TAB,
            SITES_COLUMNS,
            sitesToRows(sites),
          );
          return res.json({ ok: true, site: next, sites });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to update site.",
          details: safeErrorMessage(error, "site_update_failed"),
        });
      }
    },
  );

  app.patch(
    "/api/companies/:companyFolderId/structure/departments/:departmentId",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const departmentId = trim(req.params.departmentId);
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          const index = structure.departments.findIndex((department) => department.id === departmentId);
          if (index < 0) {
            return res.status(404).json({ ok: false, error: "Department not found." });
          }
          const next = { ...structure.departments[index], updatedAt: nowIso() };
          if (req.body?.name !== undefined) {
            const name = trim(req.body.name);
            if (!name) {
              return res.status(400).json({ ok: false, error: "Department name is required." });
            }
            if (hasDuplicateActiveName(structure.departments, name, departmentId)) {
              return res.status(409).json({
                ok: false,
                error: `An active department named "${name}" already exists.`,
              });
            }
            next.name = name;
          }
          if (req.body?.status !== undefined) {
            next.status = normalizeStatus(req.body.status);
            next.active = next.status === "active";
          }
          const departments = [...structure.departments];
          departments[index] = next;
          await writeStructureTab(
            structureDeps,
            authed,
            resolved.masterSheetId,
            DEPARTMENTS_TAB,
            DEPARTMENTS_COLUMNS,
            departmentsToRows(departments),
          );
          return res.json({ ok: true, department: next, departments });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to update department.",
          details: safeErrorMessage(error, "department_update_failed"),
        });
      }
    },
  );

  app.patch(
    "/api/companies/:companyFolderId/structure/areas/:areaId",
    requireGoogleWorkspaceSession,
    async (req, res) => {
      try {
        if (typeof parseBertActorFromRequest === "function") {
          req.bertActor = parseBertActorFromRequest(req);
        }
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved) => {
          const areaId = trim(req.params.areaId);
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          const index = structure.areas.findIndex((area) => area.id === areaId);
          if (index < 0) {
            return res.status(404).json({ ok: false, error: "Area not found." });
          }
          const next = { ...structure.areas[index], updatedAt: nowIso() };
          if (req.body?.name !== undefined) {
            const name = trim(req.body.name);
            if (!name) {
              return res.status(400).json({ ok: false, error: "Area name is required." });
            }
            if (hasDuplicateActiveName(structure.areas, name, areaId)) {
              return res.status(409).json({
                ok: false,
                error: `An active area named "${name}" already exists.`,
              });
            }
            next.name = name;
          }
          if (req.body?.siteId !== undefined) {
            next.siteId = trim(req.body.siteId);
          }
          if (req.body?.departmentId !== undefined) {
            next.departmentId = trim(req.body.departmentId);
          }
          if (req.body?.status !== undefined) {
            next.status = normalizeStatus(req.body.status);
            next.active = next.status === "active";
            next.archivedAt = next.active ? "" : nowIso();
          }
          const areas = [...structure.areas];
          areas[index] = next;
          const areaHeaders = [...new Set([...AREAS_STRUCTURE_COLUMNS, ...LEGACY_AREAS_COLUMNS])];
          await writeStructureTab(
            structureDeps,
            authed,
            resolved.masterSheetId,
            AREAS_TAB,
            areaHeaders,
            areasToRows(areas),
          );
          return res.json({ ok: true, area: next, areas });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to update area.",
          details: safeErrorMessage(error, "area_update_failed"),
        });
      }
    },
  );

  app.patch(
    "/api/companies/:companyFolderId/people/:personId/access",
    requireGoogleWorkspaceSession,
    requireWorkspaceAdminActor,
    async (req, res) => {
      try {
        if (rejectIfCannotManage(req, res)) {
          return;
        }
        await withResolvedWorkbook(req, res, async (authed, resolved, actor) => {
          const personId = trim(req.params.personId).toLowerCase();
          if (!personId || !personId.includes("@")) {
            return res.status(400).json({ ok: false, error: "A valid person email is required." });
          }

          const allSites = Boolean(req.body?.allSites);
          const allDepartments = Boolean(req.body?.allDepartments);
          const allAreas = Boolean(req.body?.allAreas);
          const scope = normalizeAccessScope({
            siteIds: allSites ? [] : req.body?.siteIds,
            departmentIds: allDepartments ? [] : req.body?.departmentIds,
            areaIds: allAreas ? [] : req.body?.areaIds,
          });

          // Keep CompanyAreas in sync for legacy area consumers (schedules/briefings filters).
          const structure = await readCompanyStructure(structureDeps, authed, resolved.masterSheetId);
          let companyAreas = [];
          if (!scope.allAreas) {
            companyAreas = scope.areaIds.map((id) => {
              const match = structure.areas.find(
                (area) => area.id === id || normalizeStructureName(area.name) === normalizeStructureName(id),
              );
              return match?.name || id;
            });
          }

          const usersDeps = typeof getCompanyUsersDeps === "function" ? getCompanyUsersDeps() : deps;
          if (typeof usersDeps.migrateUsersTabColumns === "function") {
            await usersDeps.migrateUsersTabColumns(authed, resolved.masterSheetId, usersDeps).catch(() => null);
          }
          // Ensure access columns exist on Users tab.
          if (typeof usersDeps.ensureColumns === "function" || typeof deps.ensureColumns === "function") {
            const ensure = usersDeps.ensureColumns || deps.ensureColumns;
            try {
              await ensure(authed, resolved.masterSheetId, "Users", [
                "Email",
                "Name",
                "Role",
                "Status",
                "CompanyAreas",
                ...USERS_ACCESS_COLUMNS,
              ]);
            } catch {
              await ensure(authed, deps, resolved.masterSheetId, "Users", [
                "Email",
                "Name",
                "Role",
                "Status",
                "CompanyAreas",
                ...USERS_ACCESS_COLUMNS,
              ]);
            }
          }

          const updates = {
            companyAreas,
            siteIds: serializeScopeIds(scope.siteIds, scope.allSites),
            departmentIds: serializeScopeIds(scope.departmentIds, scope.allDepartments),
            areaIds: serializeScopeIds(scope.areaIds, scope.allAreas),
          };

          const result = await updateCompanyUserRecord(
            authed,
            resolved.masterSheetId,
            personId,
            updates,
            usersDeps,
          );
          if (!result.ok) {
            const reason = trim(result.reason);
            if (reason === "user_not_found") {
              return res.status(404).json({ ok: false, error: "Person not found on the company Users tab." });
            }
            return res.status(400).json({ ok: false, error: "Unable to update person access.", details: reason });
          }

          const user = result.user;
          const access = accessScopeFromPersonRecord({
            ...user,
            siteIds: updates.siteIds,
            departmentIds: updates.departmentIds,
            areaIds: updates.areaIds,
            companyAreas: Array.isArray(user.companyAreas) ? user.companyAreas : parseCompanyAreas(user.companyAreasRaw),
          });
          const summary = formatAccessSummary(access, structure);

          console.log("[company-structure] person access", {
            email: personId,
            companyFolderId: resolved.companyFolderId,
            actorRole: actor?.role,
            allSites: access.allSites,
            allDepartments: access.allDepartments,
            allAreas: access.allAreas,
          });

          return res.json({
            ok: true,
            personId,
            access,
            accessSummary: summary,
            user: {
              email: user.email || personId,
              name: user.name || personId,
              role: user.role || "",
              status: user.status || "ACTIVE",
              companyAreas: Array.isArray(user.companyAreas) ? user.companyAreas : [],
              siteIds: access.allSites ? [] : access.siteIds,
              departmentIds: access.allDepartments ? [] : access.departmentIds,
              areaIds: access.allAreas ? [] : access.areaIds,
              companyFolderId: resolved.companyFolderId,
            },
          });
        });
      } catch (error) {
        return res.status(500).json({
          ok: false,
          error: "Unable to update person access.",
          details: safeErrorMessage(error, "person_access_failed"),
        });
      }
    },
  );
}

export {
  canEditPersonAccess,
  canManageCompanyStructure,
  SITES_TAB,
  DEPARTMENTS_TAB,
  AREAS_TAB,
  SITES_COLUMNS,
  DEPARTMENTS_COLUMNS,
  AREAS_STRUCTURE_COLUMNS,
  USERS_ACCESS_COLUMNS,
};
