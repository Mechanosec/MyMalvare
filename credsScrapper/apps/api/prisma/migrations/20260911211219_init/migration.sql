-- CreateTable
CREATE TABLE "candidates" (
    "repo_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discovered_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending'
);

-- CreateTable
CREATE TABLE "scanned_repos" (
    "repo_id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "last_commit_sha" TEXT,
    "status" TEXT NOT NULL,
    "started_at" DATETIME,
    "scanned_at" DATETIME,
    "fail_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "findings" (
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
    "context" TEXT
);
