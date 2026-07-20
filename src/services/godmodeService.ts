import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";
import { syncAndListActiveUsers, type CompanyMember } from "./companyUserService";
import { listCompanySchedules, type CompanyScheduleContext } from "./scheduleService";
import type { ManagedSchedule } from "../types/reportsScreenProps";
import { resolveCompanyFromFolder, type ResolvedCompanyFromFolder } from "./companyService";

export type GodmodeLiveCompany = {
  id: string;
  name: string;
  folderId?: string;
  masterSheetId?: string;
  sheetId?: string;
  registryStatus?: string;
  setupStatus?: "ready" | "incomplete";
  setupStatusLabel?: string;
  status?: string;
};

export type GodmodeWorkspaceFolder = ReturnType<typeof mapGodmodeLiveCompanyToWorkspaceFolder>;

type MergeableGodmodeFolder = {
  id: string;
  masterSheetId?: string;
  responseSheetId?: string;
  setupStatus?: "ready" | "incomplete";
  setupStatusLabel?: string;
  linkedAt?: string;
  onboardingVerified?: boolean;
  responseSheetVerified?: boolean;
  registryStatus?: string;
};

const GODMODE_PICKER_READY_LABELS = new Set(["ready", "usable", "live"]);

/** Folder-first connect-folder status and setup labels both mean picker-ready. */
export function isGodmodeCompanyPickerReady(input: {
  setupStatus?: "ready" | "incomplete";
  setupStatusLabel?: string;
  status?: string;
  masterSheetId?: string;
}): boolean {
  if (input.setupStatus === "ready") {
    return true;
  }
  const status = String(input.status || "").trim().toLowerCase();
  if (status === "usable") {
    return true;
  }
  const label = String(input.setupStatusLabel || "").trim().toLowerCase();
  if (GODMODE_PICKER_READY_LABELS.has(label)) {
    return Boolean(String(input.masterSheetId || "").trim());
  }
  return Boolean(String(input.masterSheetId || "").trim()) && input.setupStatus !== "incomplete";
}

/** Listed live-companies row master sheet id when picker-ready (folder-first). */
export function resolveListedGodmodeMasterSheetId(folder: {
  masterSheetId?: string;
  responseSheetId?: string;
  setupStatus?: "ready" | "incomplete";
  setupStatusLabel?: string;
  status?: string;
}): string {
  const masterSheetId = String(folder.masterSheetId || folder.responseSheetId || "").trim();
  if (!masterSheetId) {
    return "";
  }
  if (
    !isGodmodeCompanyPickerReady({
      setupStatus: folder.setupStatus,
      setupStatusLabel: folder.setupStatusLabel,
      status: folder.status,
      masterSheetId,
    })
  ) {
    return "";
  }
  return masterSheetId;
}

/** Godmode readiness accepts listed folder-first masterSheetId before sheet hydration. */
export function resolveMasterGodmodeCompanyMasterSheetId(input: {
  activeCompanyMasterSheetId?: string;
  selectedFolder?: {
    masterSheetId?: string;
    responseSheetId?: string;
    setupStatus?: "ready" | "incomplete";
    setupStatusLabel?: string;
    status?: string;
  } | null;
}): string {
  const hydrated = String(input.activeCompanyMasterSheetId || "").trim();
  if (hydrated) {
    return hydrated;
  }
  if (!input.selectedFolder) {
    return "";
  }
  return resolveListedGodmodeMasterSheetId(input.selectedFolder);
}

export function resolveGodmodeCompanySetupStatus(input: {
  setupStatus?: "ready" | "incomplete";
  setupStatusLabel?: string;
  status?: string;
  masterSheetId?: string;
}): { setupStatus: "ready" | "incomplete"; setupStatusLabel: string } {
  const masterSheetId = String(input.masterSheetId || "").trim();
  const ready = isGodmodeCompanyPickerReady({ ...input, masterSheetId });
  if (ready && masterSheetId) {
    return { setupStatus: "ready", setupStatusLabel: "Ready" };
  }
  const rawLabel = String(input.setupStatusLabel || "").trim();
  return {
    setupStatus: masterSheetId ? "incomplete" : "incomplete",
    setupStatusLabel: rawLabel || (masterSheetId ? "Setup in progress" : "Setup in progress"),
  };
}

/** Map live-companies API rows into App workspace folder shape. */
export function mapGodmodeLiveCompanyToWorkspaceFolder(company: GodmodeLiveCompany) {
  const id = String(company.id || company.folderId || "").trim();
  const masterSheetId = String(company.masterSheetId || company.sheetId || "").trim();
  const setup = resolveGodmodeCompanySetupStatus({
    setupStatus: company.setupStatus,
    setupStatusLabel: company.setupStatusLabel,
    status: company.status,
    masterSheetId,
  });
  return {
    id,
    name: String(company.name || "").trim(),
    onboardingFormName: "",
    auditFormCount: 0,
    responseSheetName: "",
    responseSheetId: masterSheetId || undefined,
    linkedAt: new Date().toISOString(),
    onboardingVerified: Boolean(masterSheetId),
    auditFormsVerified: false,
    responseSheetVerified: Boolean(masterSheetId),
    setupStatus: setup.setupStatus,
    setupStatusLabel: setup.setupStatusLabel,
    masterSheetId: masterSheetId || undefined,
    registryStatus: company.registryStatus,
  };
}

function mergeGodmodeLiveCompanyFolder<T extends MergeableGodmodeFolder>(
  existing: T,
  live: GodmodeWorkspaceFolder,
): T {
  const masterSheetId =
    live.masterSheetId ||
    live.responseSheetId ||
    existing.masterSheetId ||
    existing.responseSheetId ||
    "";
  const setup = resolveGodmodeCompanySetupStatus({
    setupStatus: existing.setupStatus === "ready" || live.setupStatus === "ready" ? "ready" : live.setupStatus || existing.setupStatus,
    setupStatusLabel: live.setupStatusLabel || existing.setupStatusLabel,
    masterSheetId,
  });
  return {
    ...existing,
    ...live,
    masterSheetId: masterSheetId || undefined,
    responseSheetId: masterSheetId || existing.responseSheetId,
    linkedAt: existing.linkedAt || live.linkedAt,
    onboardingVerified: existing.onboardingVerified || live.onboardingVerified || Boolean(masterSheetId),
    responseSheetVerified: existing.responseSheetVerified || live.responseSheetVerified || Boolean(masterSheetId),
    setupStatus: setup.setupStatus,
    setupStatusLabel: setup.setupStatusLabel,
    registryStatus: live.registryStatus || existing.registryStatus,
  };
}

/** Merge Live Companies API rows with session/local folders — never drop connected folder-first workspaces. */
export function mergeGodmodeLiveCompanyFolders<T extends MergeableGodmodeFolder>(
  existingFolders: T[],
  liveFolders: GodmodeWorkspaceFolder[],
): T[] {
  const liveById = new Map(liveFolders.map((folder) => [folder.id, folder]));
  const mergedById = new Map<string, T>();

  for (const folder of existingFolders) {
    const id = String(folder.id || "").trim();
    if (!id) {
      continue;
    }
    const live = liveById.get(id);
    mergedById.set(id, live ? mergeGodmodeLiveCompanyFolder(folder, live) : folder);
  }

  for (const folder of liveFolders) {
    const id = String(folder.id || "").trim();
    if (!id || mergedById.has(id)) {
      continue;
    }
    mergedById.set(id, folder as unknown as T);
  }

  const orderedIds: string[] = [];
  for (const folder of existingFolders) {
    const id = String(folder.id || "").trim();
    if (id && mergedById.has(id) && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }
  for (const folder of liveFolders) {
    const id = String(folder.id || "").trim();
    if (id && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  }

  return orderedIds.map((id) => mergedById.get(id)!).filter(Boolean);
}

export type ConnectedCompanyFolder = {
  companyId: string;
  companyFolderId: string;
  companyName: string;
  masterSheetId: string;
  workbookId: string;
  status: string;
};

export async function connectGodmodeCompanyFolder(input: {
  companyFolderId: string;
  companyName?: string;
  admin: { email: string; name?: string; password: string };
}): Promise<{
  ok: boolean;
  company?: ConnectedCompanyFolder;
  error?: string;
  missingTabs?: string[];
}> {
  const result = await fetchJson<{
    ok?: boolean;
    company?: ConnectedCompanyFolder;
    error?: string;
    missingTabs?: string[];
  }>(apiUrl("/api/godmode/companies/connect-folder"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyFolderId: input.companyFolderId.trim(),
      companyName: input.companyName?.trim() || undefined,
      admin: {
        email: input.admin.email.trim(),
        name: input.admin.name?.trim() || input.admin.email.trim(),
        password: input.admin.password,
      },
    }),
  });
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return { ok: false, error: payload.error || "Could not connect company folder." };
  }
  return {
    ok: true,
    company: payload.company,
    missingTabs: payload.missingTabs,
  };
}

export const COMPANY_PROVISION_STAGES = [
  { id: "creating_company_folder", label: "Creating company folder" },
  { id: "creating_workbook", label: "Creating workbook" },
  { id: "preparing_workbook_tabs", label: "Preparing workbook tabs" },
  { id: "creating_first_administrator", label: "Creating first administrator" },
  { id: "creating_bert_folders", label: "Creating BERT folders" },
  { id: "creating_iso_document_structure", label: "Creating ISO 9001 document structure" },
  { id: "registering_company", label: "Registering company" },
  { id: "finishing_setup", label: "Finishing setup" },
] as const;

export const COMPANY_TYPES = [
  "Construction",
  "Manufacturing",
  "Healthcare",
  "Education",
  "Hospitality",
  "Logistics",
  "Professional Services",
  "Other",
] as const;

export type CompanyProvisionStageEvent = {
  type: "stage" | "complete" | "error";
  operationId?: string;
  stage?: string;
  label?: string;
  status?: "running" | "done" | "pending" | "error";
  error?: string;
  company?: ConnectedCompanyFolder & {
    adminUsername?: string;
    adminEmail?: string;
    adminName?: string;
  };
};

export type CreateGodmodeCompanyInput = {
  companyName: string;
  companyType?: string;
  logoDataUrl?: string;
  logoFileName?: string;
  firstAdminName: string;
  firstAdminEmail: string;
  firstAdminUsername: string;
  adminPassword: string;
  confirmPassword: string;
  operationId?: string;
};

export async function createGodmodeCompany(
  input: CreateGodmodeCompanyInput,
  onEvent?: (event: CompanyProvisionStageEvent) => void,
): Promise<{
  ok: boolean;
  company?: ConnectedCompanyFolder & { adminUsername?: string; adminEmail?: string };
  operationId?: string;
  error?: string;
  errors?: string[];
  failedStage?: string;
  completedStages?: string[];
}> {
  const response = await fetch(apiUrl("/api/godmode/companies/create?stream=1"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({
      companyName: input.companyName,
      companyType: input.companyType,
      logoDataUrl: input.logoDataUrl,
      logoFileName: input.logoFileName,
      firstAdminName: input.firstAdminName,
      firstAdminEmail: input.firstAdminEmail,
      firstAdminUsername: input.firstAdminUsername,
      adminPassword: input.adminPassword,
      confirmPassword: input.confirmPassword,
      operationId: input.operationId,
      stream: "1",
    }),
  });

  if (!response.ok && !response.body) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: text || `Could not create company (${response.status}).` };
  }

  const contentType = String(response.headers.get("content-type") || "");
  if (!contentType.includes("ndjson") && !contentType.includes("json")) {
    return { ok: false, error: "Unexpected response from company creation." };
  }

  if (!response.body || !contentType.includes("ndjson")) {
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      company?: ConnectedCompanyFolder & { adminUsername?: string };
      operationId?: string;
      error?: string;
      errors?: string[];
      failedStage?: string;
      completedStages?: string[];
    } | null;
    if (!payload) {
      return { ok: false, error: "Could not create company." };
    }
    if (payload.ok === false) {
      return {
        ok: false,
        error: payload.error || payload.errors?.[0] || "Could not create company.",
        errors: payload.errors,
        failedStage: payload.failedStage,
        operationId: payload.operationId,
        completedStages: payload.completedStages,
      };
    }
    if (payload.company) {
      onEvent?.({ type: "complete", operationId: payload.operationId, company: payload.company });
    }
    return {
      ok: true,
      company: payload.company,
      operationId: payload.operationId,
      completedStages: payload.completedStages,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalCompany: (ConnectedCompanyFolder & { adminUsername?: string }) | undefined;
  let operationId = input.operationId || "";
  let failedStage = "";
  let errorMessage = "";
  let completedStages: string[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let event: CompanyProvisionStageEvent;
      try {
        event = JSON.parse(trimmed) as CompanyProvisionStageEvent;
      } catch {
        continue;
      }
      if (event.operationId) {
        operationId = event.operationId;
      }
      onEvent?.(event);
      if (event.type === "complete" && event.company) {
        finalCompany = event.company;
      }
      if (event.type === "error") {
        failedStage = event.stage || "";
        errorMessage = event.error || "Company creation failed.";
      }
      if (event.type === "stage" && event.status === "done" && event.stage) {
        completedStages = [...new Set([...completedStages, event.stage])];
      }
    }
  }

  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer.trim()) as CompanyProvisionStageEvent;
      onEvent?.(event);
      if (event.type === "complete" && event.company) {
        finalCompany = event.company;
      }
      if (event.type === "error") {
        failedStage = event.stage || "";
        errorMessage = event.error || "Company creation failed.";
      }
    } catch {
      // ignore trailing partial
    }
  }

  if (finalCompany) {
    return { ok: true, company: finalCompany, operationId, completedStages };
  }
  return {
    ok: false,
    error: errorMessage || "Could not create company.",
    failedStage,
    operationId,
    completedStages,
  };
}

export async function listGodmodeLiveCompanies(): Promise<{
  ok: boolean;
  companies: GodmodeLiveCompany[];
  error?: string;
}> {
  const result = await fetchJson<{ ok?: boolean; companies?: GodmodeLiveCompany[]; error?: string }>(
    apiUrl("/api/godmode/live-companies"),
    { credentials: "include" },
  );
  if (!result.ok) {
    return { ok: false, companies: [], error: result.message };
  }
  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return { ok: false, companies: [], error: payload.error || "Could not load companies." };
  }
  return { ok: true, companies: Array.isArray(payload.companies) ? payload.companies : [] };
}

export async function resolveGodmodeCompanyFromFolder(input: {
  companyFolderId: string;
  masterSheetId?: string;
  companyName?: string;
}): Promise<ResolvedCompanyFromFolder> {
  return resolveCompanyFromFolder(input);
}

/** Same Users tab as company admins — no credential hash returned. */
export async function listGodmodeCompanyUsers(input: {
  companyId: string;
  masterSheetId?: string;
  companyName?: string;
  signal?: AbortSignal;
}): Promise<{ ok: boolean; members: CompanyMember[]; loadError?: string }> {
  const result = await syncAndListActiveUsers(apiUrl, {
    companyId: input.companyId.trim(),
    masterSheetId: input.masterSheetId,
    companyName: input.companyName,
    signal: input.signal,
  });
  return {
    ok: result.ok,
    members: result.members,
    loadError: result.loadError,
  };
}

/** Same Schedules tab as company users. */
export async function listGodmodeCompanySchedules(
  context: CompanyScheduleContext,
  options?: { signal?: AbortSignal },
): Promise<{ ok: boolean; schedules: ManagedSchedule[]; loadError?: string }> {
  const result = await listCompanySchedules(context, options);
  return {
    ok: result.ok,
    schedules: result.schedules,
    loadError: result.loadError,
  };
}
