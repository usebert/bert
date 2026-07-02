import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");

const DARK_PANEL_TOKENS = [
  "bg-slate-950",
  "bg-slate-900",
  "bg-[#020617]",
  "bg-navy",
  "darkPanelClass",
  "darkPanelEyebrow",
];

const DARK_TEXT_TOKENS = [
  "text-slate-950",
  "text-slate-900",
  "text-slate-800",
  "text-black",
  "text-gray-900",
];

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(full));
    } else if (entry.isFile() && (full.endsWith(".tsx") || full.endsWith(".ts"))) {
      files.push(full);
    }
  }
  return files;
}

function hasSolidDarkBackground(line) {
  return (
    line.includes("bg-slate-950") ||
    (line.includes("bg-slate-900") && !line.includes("bg-slate-900/")) ||
    line.includes("bg-[#020617]") ||
    line.includes("bg-navy")
  );
}

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const issues = [];

  lines.forEach((line, index) => {
    const hasDarkPanelToken =
      DARK_PANEL_TOKENS.some((token) => line.includes(token)) && hasSolidDarkBackground(line);
    const hasDarkTextToken = DARK_TEXT_TOKENS.some((token) => line.includes(token));
    const hasLightTextOverride =
      line.includes("text-white") || line.includes("text-slate-100") || line.includes("text-blue-50");
    if (hasDarkPanelToken && hasDarkTextToken && !hasLightTextOverride) {
      issues.push({
        filePath,
        lineNumber: index + 1,
        line,
      });
    }
  });

  return issues;
}

const files = listFiles(srcDir);
const issues = files.flatMap(checkFile);

if (issues.length > 0) {
  console.error("Dark panel contrast verifier found potential issues:");
  for (const issue of issues) {
    const rel = path.relative(rootDir, issue.filePath);
    console.error(`- ${rel}:${issue.lineNumber}`);
    console.error(`  ${issue.line.trim()}`);
  }
  process.exit(1);
}

console.log("Dark panel contrast verifier: no obvious dark-on-dark class pairs found.");
