/** Protected Initial Setup path (SPA — serve index.html for this path in production). */
export const SETUP_INITIAL_PATH = "/setup/initial";

export function isSetupInitialPath(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  return path === SETUP_INITIAL_PATH;
}

export function navigateToSetupInitial(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = SETUP_INITIAL_PATH;
  url.search = "";
  window.history.pushState({ bertSetupInitial: true }, "", `${url.pathname}${url.search}${url.hash}`);
}

export function leaveSetupInitialPath(fallbackPath = "/"): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = fallbackPath === "/" ? "/" : fallbackPath;
  url.search = "";
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
}
