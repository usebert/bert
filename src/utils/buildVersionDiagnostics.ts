import { apiUrl } from "../config/apiBase";

/** Dev-only warning when SPA and API build stamps diverge (does not block usage). */
export async function warnIfFrontendApiBuildMismatch() {
  if (!import.meta.env.DEV) {
    return;
  }
  const frontendSha = String(import.meta.env.VITE_BUILD_GIT_SHA || "").trim();
  if (!frontendSha) {
    return;
  }
  try {
    const response = await fetch(apiUrl("/api/health"), { credentials: "include" });
    const payload = (await response.json().catch(() => ({}))) as { shortSha?: string; gitSha?: string };
    const apiSha = String(payload?.shortSha || payload?.gitSha || "").trim().slice(0, 7);
    const normalizedFrontend = frontendSha.slice(0, 7);
    if (apiSha && normalizedFrontend && apiSha !== normalizedFrontend) {
      console.warn(
        `[bert] Frontend/API build mismatch: frontend=${normalizedFrontend} api=${apiSha}. Redeploy both SPA and API from the same commit if requests fail unexpectedly.`,
      );
    }
  } catch {
    /* API unreachable in dev — lolerService diagnostics cover fetch failures */
  }
}
