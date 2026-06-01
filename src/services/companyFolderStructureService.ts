import { apiUrl } from "../config/apiBase";

type JsonResponse = Record<string, unknown> & { ok?: boolean; error?: string };

async function parseResponse<T extends JsonResponse>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || "Company folder structure request failed.");
  }
  return payload;
}

export type CompanyFolderStructureRepairResult = {
  ok: boolean;
  folderIds?: Record<string, string>;
  legacyFolderConfig?: Record<string, string>;
  folderCount?: number;
  placed?: Array<{ type: string; fileId: string; folderId: string }>;
  error?: string;
};

export const companyFolderStructureService = {
  async repairCompanyFolderStructure(input: {
    companyFolderId: string;
    masterSheetId?: string;
    companyName?: string;
  }): Promise<CompanyFolderStructureRepairResult> {
    const companyFolderId = String(input.companyFolderId || "").trim();
    if (!companyFolderId) {
      throw new Error("Company folder ID is required.");
    }
    return parseResponse<CompanyFolderStructureRepairResult>(
      await fetch(apiUrl(`/api/company-folder/${encodeURIComponent(companyFolderId)}/ensure-structure`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterSheetId: input.masterSheetId || "",
          companyName: input.companyName || "",
        }),
      }),
    );
  },
};
