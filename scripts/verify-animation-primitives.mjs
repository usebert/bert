#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(filePath) {
  return fs.readFileSync(path.join(root, filePath), "utf8");
}

function assertContains(filePath, snippets) {
  const content = read(filePath);
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`Missing "${snippet}" in ${filePath}`);
    }
  }
}

assertContains("src/components/animation/AnimatedScreen.tsx", ["{children}", "usePrefersReducedMotion"]);
assertContains("src/components/animation/AnimatedCard.tsx", ["{children}", "usePrefersReducedMotion"]);
assertContains("src/components/animation/AnimatedCount.tsx", ["usePrefersReducedMotion"]);
assertContains("src/index.css", [
  "prefers-reduced-motion: reduce",
  "bert-screen-enter",
  "bert-guidance-panel-enter",
  "scale(0.97)",
]);
assertContains("src/components/evidence/EvidenceUploadChoice.tsx", [
  "Take photo",
  "Choose from device",
  "Attaching",
  "Attached",
  "Saved on tablet",
  "Could not attach",
]);
assertContains("App.tsx", [
  "You are offline. Checks will be saved on this tablet and synced when internet returns.",
  "OfflineSyncBanner",
  "offlineSyncProgress",
]);
assertContains("src/components/animation/OfflineSyncBanner.tsx", ["Retry failed", "Syncing saved checks"]);
assertContains("src/components/animation/SubmitResultBanner.tsx", [
  "Submitted",
  "Saved on this tablet",
  "Check saved successfully.",
]);
assertContains("src/components/animation/animationPrimitives.test.tsx", [
  "Screen content",
  "Card content",
  "Retry failed",
]);
assertContains("src/screens/SyncCentreScreen.tsx", ["Retry sync"]);

console.log("[verify:animation-primitives] OK");
