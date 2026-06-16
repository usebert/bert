const RAW_API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.trim() || "";
export const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, "");
export function apiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (!API_BASE_URL) return cleanPath;
  return `${API_BASE_URL}${cleanPath}`;
}
