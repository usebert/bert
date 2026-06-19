import { apiUrl } from "../config/apiBase";

export type PasswordResetRequestResult = {
  ok?: boolean;
  message?: string;
  smtpConfigured?: boolean;
  error?: string;
};

export type PasswordResetConfirmResult = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export async function requestPasswordReset(email: string): Promise<PasswordResetRequestResult> {
  const response = await fetch(apiUrl("/api/auth/password-reset/request"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase() }),
  });
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as PasswordResetRequestResult) : {};
  } catch {
    return { ok: false, error: "Unexpected response from the server." };
  }
}

export async function confirmPasswordReset(input: {
  tokenId: string;
  code: string;
  password: string;
  confirmPassword: string;
}): Promise<PasswordResetConfirmResult> {
  const response = await fetch(apiUrl("/api/auth/password-reset/confirm"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: input.tokenId,
      code: input.code,
      password: input.password,
      confirmPassword: input.confirmPassword,
    }),
  });
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as PasswordResetConfirmResult) : {};
  } catch {
    return { ok: false, error: "Unexpected response from the server." };
  }
}
