import { apiUrl } from "../config/apiBase";
import { fetchJson } from "../utils/fetchJson";

export type CreateCompanyInviteResult = {
  ok: boolean;
  tokenId?: string;
  inviteUrl?: string;
  emailWarning?: string;
  error?: string;
};

export type AcceptCompanyInviteResult = {
  ok: boolean;
  error?: string;
};

/** Create Auditor invite — token always returned; email failure never blocks. */
export async function createCompanyAuditorInvite(input: {
  companyId: string;
  companyFolderId: string;
  masterSheetId: string;
  companyName?: string;
  email: string;
  role?: string;
}): Promise<CreateCompanyInviteResult> {
  const companyId = input.companyId.trim();
  const result = await fetchJson<{
    ok?: boolean;
    tokenId?: string;
    token?: string;
    inviteUrl?: string;
    emailWarning?: string;
    error?: string;
  }>(apiUrl(`/api/companies/${encodeURIComponent(companyId)}/invites/auditor`), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      role: input.role || "Auditor",
      companyFolderId: input.companyFolderId.trim() || companyId,
      masterSheetId: input.masterSheetId.trim(),
      companyName: input.companyName?.trim(),
    }),
  });

  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  const payload = result.data;
  if (!result.response.ok || !payload.ok) {
    return { ok: false, error: payload.error || "Could not create invite." };
  }

  return {
    ok: true,
    tokenId: String(payload.tokenId || payload.token || "").trim(),
    inviteUrl: String(payload.inviteUrl || "").trim(),
    emailWarning: payload.emailWarning,
  };
}

/** Resend or replace invalid/expired invite with a fresh token + inviteUrl. */
export async function resendOrReplaceCompanyInvite(input: {
  email: string;
  role: string;
  companyFolderId: string;
  masterSheetId: string;
  companyName?: string;
  tokenId?: string;
}): Promise<CreateCompanyInviteResult> {
  const result = await fetchJson<{
    ok?: boolean;
    tokenId?: string;
    inviteUrl?: string;
    emailWarning?: string;
    error?: string;
  }>(apiUrl("/api/onboarding/app-invites/company-user"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      role: input.role,
      companyFolderId: input.companyFolderId.trim(),
      masterSheetId: input.masterSheetId.trim(),
      companyName: input.companyName?.trim(),
      resend: true,
      tokenId: input.tokenId,
    }),
  });

  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  const payload = result.data;
  if (!result.response.ok || !payload.ok) {
    return { ok: false, error: payload.error || "Could not resend invite." };
  }

  return {
    ok: true,
    tokenId: String(payload.tokenId || "").trim(),
    inviteUrl: String(payload.inviteUrl || "").trim(),
    emailWarning: payload.emailWarning,
  };
}

/** Accept invite — creates ACTIVE user in Users tab. */
export async function acceptCompanyUserInvite(
  token: string,
  input: { fullName: string; password: string; confirmPassword: string },
): Promise<AcceptCompanyInviteResult> {
  const result = await fetchJson<{ ok?: boolean; error?: string }>(
    apiUrl(`/api/invites/company-user/${encodeURIComponent(token)}/complete`),
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  const payload = result.data;
  if (!result.response.ok || payload.ok === false) {
    return { ok: false, error: payload.error || "Could not complete invite." };
  }

  return { ok: true };
}
