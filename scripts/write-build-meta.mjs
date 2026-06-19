#!/usr/bin/env node
/** Writes public/build-meta.json and exports git sha for Vite define. */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");

function gitRef(args) {
  try {
    return execSync(`git ${args}`, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const gitSha = gitRef("rev-parse HEAD");
const shortSha = gitRef("rev-parse --short HEAD");
const meta = {
  gitSha,
  shortSha,
  builtAt: new Date().toISOString(),
};

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
fs.writeFileSync(path.join(publicDir, "build-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);

process.stdout.write(shortSha || "unknown");
