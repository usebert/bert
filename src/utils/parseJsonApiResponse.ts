/** Parse JSON from `fetch` responses — avoids throwing on empty/HTML error pages. */
export async function parseJsonApiResponse<T = Record<string, unknown>>(response: Response): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) {
    const hint =
      import.meta.env.DEV === true
        ? "Start the API: run `npm run dev:full` (or `npm run server` on port 8787)."
        : "The server did not return data.";
    throw new Error(`No response body (${response.status}). ${hint}`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    if (response.status === 404 && trimmed.startsWith("<!DOCTYPE")) {
      throw new Error(
        "Reminders API is not on this server yet. Deploy the latest API to Render, or use `npm run dev:full` locally (without pointing at production API).",
      );
    }
    const snippet = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
    throw new Error(`Server returned non-JSON (${response.status}). ${snippet}`);
  }
}
