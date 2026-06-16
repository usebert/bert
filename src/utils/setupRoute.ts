/** Platform Setup routes (SPA — serve index.html in production). */
export const SETUP_PATH = "/setup";
export const SETUP_INITIAL_PATH = "/setup/initial";

export function isSetupPath(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  return path === SETUP_PATH;
}

export function isSetupInitialPath(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  return path === SETUP_INITIAL_PATH;
}

export function isAnyProtectedSetupPath(): boolean {
  return isSetupPath() || isSetupInitialPath();
}

export function navigateToSetup(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = SETUP_PATH;
  url.search = "";
  window.history.pushState({ bertSetup: true }, "", `${url.pathname}${url.search}${url.hash}`);
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

export function leaveSetupPath(fallbackPath = "/"): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = fallbackPath === "/" ? "/" : fallbackPath;
  url.search = "";
  window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function leaveSetupInitialPath(fallbackPath = "/"): void {
  leaveSetupPath(fallbackPath);
}
