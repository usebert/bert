import crypto from "node:crypto";
import { attachApiRouteTimingFinish, createApiTimingTrace } from "./api-timing.mjs";
import {
  getCompanyAreasCacheEntry,
  invalidateCompanyAreasCache,
  setCompanyAreasCacheEntry,
} from "./company-areas-cache.mjs";
import { getCompanyContextHint, setCompanyContextHint } from "./company-context-hint-cache.mjs";
import { isReservedWorkspaceAreaName } from "./invite-target.mjs";
import { safeLoginTimingMeta } from "./login-timing.mjs";
import {
  CONFIG_KEY_DEFAULT_FORM_LANGUAGE,
  DEFAULT_FORM_LANGUAGE,
  normalizeFormLanguage,
} from "./template-languages.mjs";

export const AREAS_TAB = "Areas";
export const AREAS_COLUMNS = [
  "Area ID",
  "Name",
  "Status",
  "Created At",
  "Updated At",
  "Created By",
  "Archived At",
];
export const CONFIG_KEY_AREA_RESTRICTIONS = "AreaRestrictionsEnabled";

function normalizeAreaName(name = "") {
  return String(name || "").trim();
}

function createAreaId() {
  return `area-${crypto.randomUUID()}`;
}

function rowToArea(row) {
  const id = String(row["Area ID"] || row.areaId || "").trim();
  const name = normalizeAreaName(row.Name || row.name);
  const status = String(row.Status || row.status || "active").trim().toLowerCase();
  if (!id || !name) {
    return null;
  }
  return {
    id,
    name,
    code: name.slice(0, 3).toUpperCase(),
    active: status !== "archived",
    status: status === "archived" ? "archived" : "active",
    createdAt: String(row["Created At"] || row.createdAt || "").trim(),
    updatedAt: String(row["Updated At"] || row.updatedAt || "").trim(),
    createdBy: String(row["Created By"] || row.createdBy || "").trim(),
    archivedAt: String(row["Archived At"] || row.archivedAt || "").trim(),
  };
}

function areasToSheetRows(areas) {
  return areas.map((area) => [
    area.id,
    area.name,
    area.active ? "active" : "archived",
    area.createdAt || "",
    area.updatedAt || "",
    area.createdBy || "",
    area.archivedAt || "",
  ]);
}

async function readAreasTab(deps, auth, spreadsheetId) {
  const { ensureColumns, getTabValues, rowsToRecords } = deps;
  await ensureColumns(auth, spreadsheetId, AREAS_TAB, AREAS_COLUMNS);
  const rows = rowsToRecords(await getTabValues(auth, spreadsheetId, AREAS_TAB));
  return rows.map(rowToArea).filter(Boolean);
}

async function writeAreasTab(deps, auth, spreadsheetId, areas) {
  const { ensureColumns, withSheetsQuotaRetry } = deps;
  const { google } = deps;
  await ensureColumns(auth, spreadsheetId, AREAS_TAB, AREAS_COLUMNS);
  const sheets = google.sheets({ version: "v4", auth });
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${AREAS_TAB}!A:G`,
    }),
  );
  await withSheetsQuotaRetry(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${AREAS_TAB}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [AREAS_COLUMNS, ...areasToSheetRows(areas)],
      },
    }),
  );
}

function parseRestrictionsFlag(config) {
  return String(config?.[CONFIG_KEY_AREA_RESTRICTIONS] || "")
    .trim()
    .toLowerCase() === "true";
}

function parseDefaultFormLanguage(config) {
  const value = config?.[CONFIG_KEY_DEFAULT_FORM_LANGUAGE];
  return value ? normalizeFormLanguage(value) : DEFAULT_FORM_LANGUAGE;
}

function trim(value) {
  return String(value ?? "").trim();
}

function resolveCompanyAreasContext(queryFolderId, config = {}) {
  const requestedFolderId = trim(queryFolderId);
  const configFolderId = trim(config.companyId || config.companyFolderId);
  let companyFolderId = requestedFolderId || configFolderId;
  let companyName = trim(config.companyName);
  let contextSource = requestedFolderId ? "query" : configFolderId ? "config" : "none";

  if (requestedFolderId) {
    companyFolderId = requestedFolderId;
    contextSource = "query_folder_first";
  }

  if (companyFolderId) {
    const hint = getCompanyContextHint(companyFolderId);
    if (hint) {
      companyName = companyName || hint.companyName || "";
      if (contextSource === "none") {
        contextSource = "hint_cache";
      }
    }
  }

  return { companyFolderId, companyName, contextSource };
}

function rememberVerifiedCompanyContext(companyFolderId, masterSheetId, companyName) {
  const folderId = trim(companyFolderId);
  const sheetId = trim(masterSheetId);
  if (!folderId || !sheetId) {
    return;
  }
  setCompanyContextHint(folderId, { masterSheetId: sheetId, companyName: trim(companyName) });
}

function invalidateAreasCacheForWrite(masterSheetId, companyFolderId = "") {
  invalidateCompanyAreasCache(masterSheetId, companyFolderId);
}

function validateAreaName(name) {
  const trimmed = normalizeAreaName(name);
  if (!trimmed) {
    return { ok: false, error: "Area name is required." };
  }
  if (isReservedWorkspaceAreaName(trimmed)) {
    return {
      ok: false,
      error: `"${trimmed}" is reserved and cannot be used as a company area.`,
    };
  }
  return { ok: true, name: trimmed };
}

export function installCompanyAreasRoutes(app, deps) {
  const {
    getAuthedClient,
    envConfigured,
    getConfig,
    updateConfig,
  } = deps;

  app.get("/api/company-areas/:masterSheetId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before loading company areas.",
      });
    }

    const masterSheetId = trim(req.params.masterSheetId);
    const queryCompanyFolderId = trim(req.query.companyFolderId);
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    const trace = createApiTimingTrace(
      safeLoginTimingMeta({
        route: "company-areas",
        masterSheetId,
        ...(queryCompanyFolderId ? { companyFolderId: queryCompanyFolderId } : {}),
      }),
    );
    trace.mark("route_start");
    attachApiRouteTimingFinish(res, trace);

    const cached = getCompanyAreasCacheEntry(masterSheetId, queryCompanyFolderId);
    if (cached) {
      trace.mark("cache_hit", { companyFolderId: cached.companyFolderId || queryCompanyFolderId });
      trace.mark("response_ready", { areaCount: cached.areas?.length ?? 0, cached: true });
      return res.json(cached);
    }
    trace.mark("cache_miss");

    try {
      const sheetsReadStartedMs = Date.now();
      trace.mark("sheets_read_start");
      const config = await getConfig(authed, masterSheetId);
      const areas = await readAreasTab(deps, authed, masterSheetId);
      trace.phase("sheets_read_end", sheetsReadStartedMs, {
        tabs: ["Config", AREAS_TAB],
        areaCount: areas.length,
      });

      const contextStartedMs = Date.now();
      const resolvedContext = resolveCompanyAreasContext(queryCompanyFolderId, config, { masterSheetId });
      const companyFolderId = resolvedContext.companyFolderId || queryCompanyFolderId;
      trace.phase("resolve_company_context", contextStartedMs, {
        contextSource: resolvedContext.contextSource,
        hasCompanyFolderId: Boolean(companyFolderId),
      });

      const parseStartedMs = Date.now();
      const payload = {
        ok: true,
        masterSheetId,
        companyFolderId,
        areaRestrictionsEnabled: parseRestrictionsFlag(config),
        defaultFormLanguage: parseDefaultFormLanguage(config),
        areas,
      };
      trace.phase("parse_rows", parseStartedMs, { areaCount: areas.length });

      setCompanyAreasCacheEntry(masterSheetId, queryCompanyFolderId, payload);
      if (companyFolderId && companyFolderId !== queryCompanyFolderId) {
        setCompanyAreasCacheEntry(masterSheetId, companyFolderId, payload);
      }
      rememberVerifiedCompanyContext(companyFolderId, masterSheetId, resolvedContext.companyName || config.companyName);
      trace.mark("response_ready", { areaCount: areas.length, cached: false });
      return res.json(payload);
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load company areas.",
      });
    }
  });

  app.put("/api/company-areas/:masterSheetId/default-form-language", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before updating default form language.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    try {
      const language = normalizeFormLanguage(req.body?.defaultFormLanguage);
      await updateConfig(authed, masterSheetId, {
        [CONFIG_KEY_DEFAULT_FORM_LANGUAGE]: language,
      });
      invalidateAreasCacheForWrite(masterSheetId);
      return res.json({ ok: true, defaultFormLanguage: language });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update default form language.",
      });
    }
  });

  app.post("/api/company-areas/:masterSheetId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before saving company areas.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    const nameCheck = validateAreaName(req.body?.name);
    if (!nameCheck.ok) {
      return res.status(400).json({ ok: false, error: nameCheck.error });
    }

    const createdBy = String(req.body?.createdBy || "BERT").trim();
    const now = new Date().toISOString();

    try {
      const areas = await readAreasTab(deps, authed, masterSheetId);
      const duplicate = areas.some(
        (area) => area.name.toLowerCase() === nameCheck.name.toLowerCase() && area.active,
      );
      if (duplicate) {
        return res.status(409).json({ ok: false, error: `An active area named "${nameCheck.name}" already exists.` });
      }

      const area = {
        id: createAreaId(),
        name: nameCheck.name,
        code: nameCheck.name.slice(0, 3).toUpperCase(),
        active: true,
        status: "active",
        createdAt: now,
        updatedAt: now,
        createdBy,
        archivedAt: "",
      };
      await writeAreasTab(deps, authed, masterSheetId, [...areas, area]);
      invalidateAreasCacheForWrite(masterSheetId);
      const config = await getConfig(authed, masterSheetId);
      return res.json({
        ok: true,
        area,
        areaRestrictionsEnabled: parseRestrictionsFlag(config),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to create company area.",
      });
    }
  });

  app.patch("/api/company-areas/:masterSheetId/:areaId", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before updating company areas.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    const areaId = String(req.params.areaId || "").trim();
    if (!masterSheetId || !areaId) {
      return res.status(400).json({ ok: false, error: "masterSheetId and areaId are required." });
    }

    try {
      const areas = await readAreasTab(deps, authed, masterSheetId);
      const index = areas.findIndex((area) => area.id === areaId);
      if (index < 0) {
        return res.status(404).json({ ok: false, error: "Area not found." });
      }

      const current = areas[index];
      const now = new Date().toISOString();
      let next = { ...current };

      if (req.body?.name !== undefined) {
        const nameCheck = validateAreaName(req.body.name);
        if (!nameCheck.ok) {
          return res.status(400).json({ ok: false, error: nameCheck.error });
        }
        const duplicate = areas.some(
          (area) =>
            area.id !== areaId &&
            area.active &&
            area.name.toLowerCase() === nameCheck.name.toLowerCase(),
        );
        if (duplicate) {
          return res.status(409).json({ ok: false, error: `An active area named "${nameCheck.name}" already exists.` });
        }
        next.name = nameCheck.name;
        next.code = nameCheck.name.slice(0, 3).toUpperCase();
      }

      if (req.body?.status === "archived") {
        next.active = false;
        next.status = "archived";
        next.archivedAt = now;
      } else if (req.body?.status === "active") {
        next.active = true;
        next.status = "active";
        next.archivedAt = "";
      }

      next.updatedAt = now;
      const updatedAreas = [...areas];
      updatedAreas[index] = next;
      await writeAreasTab(deps, authed, masterSheetId, updatedAreas);

      if (req.body?.areaRestrictionsEnabled !== undefined) {
        await updateConfig(authed, masterSheetId, {
          [CONFIG_KEY_AREA_RESTRICTIONS]: req.body.areaRestrictionsEnabled ? "true" : "false",
        });
      }

      invalidateAreasCacheForWrite(masterSheetId);
      const config = await getConfig(authed, masterSheetId);
      return res.json({
        ok: true,
        area: next,
        areaRestrictionsEnabled: parseRestrictionsFlag(config),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update company area.",
      });
    }
  });

  app.patch("/api/company-areas/:masterSheetId/config/restrictions", async (req, res) => {
    const authed = getAuthedClient();
    if (!envConfigured() || !authed) {
      return res.status(401).json({
        ok: false,
        error: "Connect Google Workspace before updating area restrictions.",
      });
    }

    const masterSheetId = String(req.params.masterSheetId || "").trim();
    if (!masterSheetId) {
      return res.status(400).json({ ok: false, error: "masterSheetId is required." });
    }

    const enabled = Boolean(req.body?.areaRestrictionsEnabled);
    try {
      await updateConfig(authed, masterSheetId, {
        [CONFIG_KEY_AREA_RESTRICTIONS]: enabled ? "true" : "false",
      });
      invalidateAreasCacheForWrite(masterSheetId);
      const areas = await readAreasTab(deps, authed, masterSheetId);
      return res.json({
        ok: true,
        areaRestrictionsEnabled: enabled,
        areas,
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error instanceof Error ? error.message : "Unable to update area restrictions.",
      });
    }
  });
}
