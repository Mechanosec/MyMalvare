CREATE TABLE "scan_phases" (
  "repo_id" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "target_sha" TEXT,
  "completed_sha" TEXT,
  "scanner_version" TEXT,
  "started_at" DATETIME,
  "completed_at" DATETIME,
  "reason" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("repo_id", "phase")
);

INSERT INTO "scan_phases" (
  "repo_id", "phase", "status", "target_sha", "completed_sha",
  "scanner_version", "started_at", "completed_at", "retry_count"
)
SELECT
  "repo_id", 'head', 'done', "last_commit_sha", "last_commit_sha",
  "scanner_version", "started_at", "scanned_at", "retry_count"
FROM "scanned_repos"
WHERE "status" = 'done'
  AND "last_commit_sha" IS NOT NULL
  AND "scanner_version" IS NOT NULL;

INSERT INTO "scan_phases" (
  "repo_id", "phase", "status", "target_sha", "completed_sha",
  "scanner_version", "started_at", "completed_at", "retry_count"
)
SELECT
  "repo_id", 'history', 'done', "last_commit_sha", "last_commit_sha",
  "scanner_version", "started_at", "scanned_at", "retry_count"
FROM "scanned_repos"
WHERE "status" = 'done'
  AND "last_commit_sha" IS NOT NULL
  AND "scanner_version" IS NOT NULL;
