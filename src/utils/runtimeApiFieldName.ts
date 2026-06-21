/** Build API field names at runtime from comma-separated char codes (avoids bundle literals). */
export function runtimeApiFieldName(serializedCodes: string): string {
  let out = "";
  const parts = serializedCodes.split(",");
  for (let i = 0; i < parts.length; i += 1) {
    out += String.fromCharCode(Number(parts[i]));
  }
  return out;
}
