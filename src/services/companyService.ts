import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";

export type ResolvedCompanyFromFolder = {
  ok: boolean;
  companyId: string;
  companyFolderId: string;
  companyName: string;
  masterSheetId: string;
  status?: string;
  usable?: boolean;
  userMessage?: string;
  reasonCode?: string;
};

/** Resolve company workbook from Drive folder — companyFolderId is companyId. */
export async function resolveCompanyFromFolder(input: {
  companyFolderId: string;
  masterSheetId?: string;
  companyName?: string;
}): Promise<ResolvedCompanyFromFolder> {
  const companyFolderId = input.companyFolderId.trim();
  const result = await fetchJson<ResolvedCompanyFromFolder>(
    apiUrl(`/api/godmode/companies/${encodeURIComponent(companyFolderId)}/resolve-from-folder`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyFolderId,
        masterSheetId: input.masterSheetId?.trim() || undefined,
        companyName: input.companyName?.trim() || undefined,
      }),
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      companyId: companyFolderId,
      companyFolderId,
      companyName: input.companyName?.trim() || "",
      masterSheetId: input.masterSheetId?.trim() || "",
      reasonCode: result.code,
      userMessage: result.message,
    };
  }
  if (!result.response.ok || result.data.ok === false) {
    return {
      ok: false,
      companyId: companyFolderId,
      companyFolderId,
      companyName: input.companyName?.trim() || "",
      masterSheetId: input.masterSheetId?.trim() || "",
      reasonCode: result.data.reasonCode,
      userMessage: result.data.userMessage,
    };
  }
  return result.data;
}
