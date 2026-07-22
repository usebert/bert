import type { ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite calls `os.networkInterfaces()` when `server.host` is `true` (to print LAN URLs). That
 * throws in some environments (`uv_interface_addresses` / system error 1), so the dev server
 * never starts → ERR_CONNECTION_REFUSED in the browser.
 *
 * - Default: `localhost` — no LAN interface scan (unlike `host: true`), but accepts both
 *   `http://localhost:5173` and `http://127.0.0.1:5173` (binding only `127.0.0.1` breaks the former
 *   when `localhost` resolves to `::1` first).
 * - IPv4-only loopback: `VITE_DEV_HOST=127.0.0.1`.
 * - LAN / all interfaces: `VITE_DEV_HOST=all` (or `lan`, `0.0.0.0`) → same as former `host: true`.
 */
function viteDevHost(): boolean | string {
  const raw = String(process.env.VITE_DEV_HOST || "").trim().toLowerCase();
  if (raw === "all" || raw === "lan" || raw === "0.0.0.0" || raw === "true") {
    return true;
  }
  if (raw && raw !== "false") {
    return raw;
  }
  return "localhost";
}

/** Vite's default proxy error responds with HTTP 500 and an empty body, which breaks JSON clients. */
const backendProxy: ProxyOptions = {
  target: "http://127.0.0.1:8787",
  changeOrigin: true,
  configure(proxy) {
    proxy.on("error", (_err, _req, res) => {
      if (!res || typeof (res as ServerResponse).writeHead !== "function") {
        return;
      }
      const response = res as ServerResponse;
      if (response.headersSent || response.writableEnded) {
        return;
      }
      const error =
        "API server is not reachable on port 8787. From the project root run `npm run dev:full` (starts API + UI), or run `npm run server` in one terminal and `npm run dev` in another.";
      response.writeHead(502, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error }));
    });
  },
};

/** Legacy template display name — must not appear in production bundles; normalize to default. */
function sanitizeViteAppName(mode: string, cwd: string): string {
  const loaded = loadEnv(mode, cwd, "");
  const raw = String(loaded.VITE_APP_NAME ?? "").trim();
  if (raw.toLowerCase() === "audit app") {
    return "";
  }
  return raw;
}

function readBuildGitSha(cwd: string): string {
  try {
    const metaPath = path.join(cwd, "public/build-meta.json");
    if (!fs.existsSync(metaPath)) {
      return "";
    }
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as { shortSha?: string; gitSha?: string };
    return String(meta.shortSha || meta.gitSha || "").trim();
  } catch {
    return "";
  }
}

export default defineConfig(({ mode }) => {
  const sanitizedViteAppName = sanitizeViteAppName(mode, process.cwd());
  const buildGitSha = readBuildGitSha(process.cwd());

  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_APP_NAME": JSON.stringify(sanitizedViteAppName),
      "import.meta.env.VITE_BUILD_GIT_SHA": JSON.stringify(buildGitSha),
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(process.cwd(), "index.html"),
          accountMenuHarness: path.resolve(process.cwd(), "e2e/account-menu.harness.html"),
          healthSafetyNavHarness: path.resolve(process.cwd(), "e2e/health-safety-nav.harness.html"),
          healthSafetyOverviewHarness: path.resolve(process.cwd(), "e2e/health-safety-overview.harness.html"),
          riddorAssessmentHarness: path.resolve(process.cwd(), "e2e/riddor-assessment.harness.html"),
        },
      },
    },
    server: {
      allowedHosts: true,
      host: viteDevHost(),
      port: 5173,
      strictPort: false,
      proxy: {
        "/api": backendProxy,
        "/auth": backendProxy,
      },
    },
  };
});
