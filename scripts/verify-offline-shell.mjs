#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const distDir = path.join(root, "dist");

function fail(message) {
  console.error("[verify:offline-shell] FAIL:", message);
  process.exit(1);
}

function assertFileExists(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`);
  }
}

function readFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!fs.existsSync(fullPath)) {
    fail(`missing ${relativePath}`);
  }
  return fs.readFileSync(fullPath, "utf8");
}

function findDistJsFiles() {
  const assetsDir = path.join(distDir, "assets");
  if (!fs.existsSync(assetsDir)) {
    fail("missing dist/assets directory");
  }

  return fs
    .readdirSync(assetsDir)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(assetsDir, name));
}

assertFileExists("dist/service-worker.js");
assertFileExists("dist/manifest.webmanifest");

const indexHtml = readFile("dist/index.html");
if (!indexHtml.includes('rel="manifest"') || !indexHtml.includes("/manifest.webmanifest")) {
  fail("dist/index.html is missing manifest link to /manifest.webmanifest");
}

const jsFiles = findDistJsFiles();
if (jsFiles.length === 0) {
  fail("no built JS files found in dist/assets");
}

const jsBundle = jsFiles.map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
const hasRegisterCall = /register\((["'])\/service-worker\.js\1\)/.test(jsBundle);
const hasUnregisterCall = /unregister\(\)|getRegistrations\(\)/.test(jsBundle);

if (!hasRegisterCall) {
  fail("built JS is missing serviceWorker.register('/service-worker.js') call");
}

if (hasUnregisterCall && !hasRegisterCall) {
  fail("built JS appears unregister-only (unregister found without register)");
}

console.log("[verify:offline-shell] OK");
