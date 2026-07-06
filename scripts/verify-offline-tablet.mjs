import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function assertContains(filePath, snippets) {
  const fullPath = path.join(root, filePath);
  const content = fs.readFileSync(fullPath, "utf8");
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      throw new Error(`Missing "${snippet}" in ${filePath}`);
    }
  }
}

assertContains("src/services/tabletOfflineService.ts", [
  "offlineSubmissions",
  "offlineEvidenceBlobs",
  "tabletAssignedWork",
  "defaultFormLanguage",
]);

assertContains("App.tsx", [
  "submissionQueueService",
  "enqueueOfflineSubmission",
  "Added to queue",
  "localSubmissionId",
]);

assertContains("server/server.mjs", [
  "Local Submission ID",
  "localSubmissionId",
  "deduped: true",
]);

console.log("[verify:offline-tablet] queue checks OK");
