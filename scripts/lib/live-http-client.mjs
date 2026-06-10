/** Minimal fetch client with Origin + cookie jar for live API verification. */

export class LiveHttpClient {
  constructor(baseUrl, origin) {
    this.baseUrl = String(baseUrl || "").replace(/\/$/, "");
    this.origin = String(origin || baseUrl || "").replace(/\/$/, "");
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  absorbSetCookies(response) {
    const raw =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    for (const line of raw) {
      const part = String(line || "").split(";")[0];
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  async request(path, { method = "GET", body, headers = {}, timeoutMs = 60_000 } = {}) {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          Origin: this.origin,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: controller.signal,
      });
      this.absorbSetCookies(response);
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: response.status, ok: response.ok, json, text, headers: response.headers };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function assertNoPasswordHash(value, label = "response") {
  const hits = [];
  const walk = (node, pathParts) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...pathParts, String(index)]));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (/passwordhash/i.test(key)) {
        hits.push([...pathParts, key].join("."));
      }
      walk(child, [...pathParts, key]);
    }
  };
  walk(value, []);
  if (hits.length > 0) {
    throw new Error(`${label} leaked PasswordHash at ${hits.join(", ")}`);
  }
}

export function redactJson(value) {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "string" && /password/i.test(_key)) {
      return "***";
    }
    return val;
  });
}
