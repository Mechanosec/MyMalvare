-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_findings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "repo_id" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "secret_type" TEXT NOT NULL,
    "secret_value" TEXT NOT NULL,
    "line_number" INTEGER,
    "found_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "leak_commits" TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO "new_findings" ("commit_sha", "context", "file_path", "found_at", "id", "line_number", "name", "owner", "repo_id", "secret_type", "secret_value") SELECT "commit_sha", "context", "file_path", "found_at", "id", "line_number", "name", "owner", "repo_id", "secret_type", "secret_value" FROM "findings";
DROP TABLE "findings";
ALTER TABLE "new_findings" RENAME TO "findings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
